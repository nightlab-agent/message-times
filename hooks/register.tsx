import { atom, read, update } from 'claude-code'
import type { Engine, Register } from 'claude-code'

import type { Stamp, Stamps } from '../types'

// message-times: the time on each prompt and each reply in the main transcript
// view (anthropics/claude-code#44763). The ctrl+o transcript view has times of
// its own; the main view, where a long-running session is watched, has none.
//
// How a row gets its time: when the session keeps a prompt or a reply row
// (`session.append`), its id, the time and the start of its text are noted, in
// the session's state and in one local file, so a resumed session has them.
// When the transcript draws a message row it reads them and never writes (a
// render hook may not): the row whose id was noted shows that time; otherwise
// the one noted row of that kind with the same text, when exactly one has it.
// A row with no such note (one drawn from before the mod was installed, or one
// of several rows saying the same thing) shows no time: the mod never guesses a
// time from when a row happened to be drawn.
//
// DESIGN NOTE, deliberately narrow: it changes the drawing only, never the
// stored message or what the model reads; no network; every failure of its own
// is swallowed and the engine's row drawn as it was.

/** Notes kept in the session and the file, newest last. */
export const KEEP = 5000

// Change the tag when Stamp's fields change: it declines what an earlier version stored.
const stamps = atom({ plugin: 'message-times', key: 'stamps' } as const, {} as Stamps, { shape: 'stamps-1' })

/** What a row's text is matched by: its kind and its first 160 characters, spaces folded. */
export const keyOf = (kind: 'user' | 'assistant', text: string) => `${kind}:${text.replace(/\s+/g, ' ').trim().slice(0, 160)}`

const pad = (n: number) => String(n).padStart(2, '0')

/** `09:15:32` on the day it is drawn; `10-27 09:15` on another day. Local to the machine. */
export const timeOf = (iso: string, now: Date) => {
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const sameDay = t.getFullYear() === now.getFullYear() && t.getMonth() === now.getMonth() && t.getDate() === now.getDate()
  return sameDay
    ? `${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`
    : `${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`
}

/** The newest KEEP notes, oldest first. */
export const trim = (all: Stamps): Stamps => Object.fromEntries(Object.entries(all).slice(-KEEP))

/** The file's text: one `id<TAB>iso<TAB>key` line per note. */
export const fileText = (all: Stamps) =>
  Object.entries(all)
    .map(([id, s]) => `${id}\t${s.at}\t${s.key.replace(/[\t\n]/g, ' ')}`)
    .join('\n') + '\n'

/** The notes a file holds; a line that is not `id<TAB>iso<TAB>key` is skipped. */
export const parseFile = (text: string): Stamps => {
  const out: Stamps = {}
  for (const line of text.split('\n')) {
    const [id, at, key, extra] = line.split('\t')
    if (id && at && key && extra === undefined && !Number.isNaN(new Date(at).getTime())) out[id] = { at, key }
  }
  return out
}

/** The time a drawn row shows: its own id's note, else the only note with its text; '' when neither. */
export const stampFor = (all: Stamps, id: string, key: string) => {
  const own = all[id]
  if (own) return own.at
  let found: Stamp | undefined
  for (const s of Object.values(all)) {
    if (s.key !== key) continue
    if (found) return ''
    found = s
  }
  return found ? found.at : ''
}

type Block = { type: string; text?: unknown }
/** The non-empty text blocks of a row, in order. */
export const textsOf = (content: unknown): string[] =>
  Array.isArray(content)
    ? (content as Block[]).filter(b => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '').map(b => b.text as string)
    : []

/** Where the notes are kept: MESSAGE_TIMES_DIR, else ~/.message-times; '' with neither. */
async function fileOf($: Engine) {
  const home = await $.env.get('HOME')
  const dir = (await $.env.get('MESSAGE_TIMES_DIR')) || (home ? `${home}/.message-times` : '')
  return dir ? `${dir}/stamps.tsv` : ''
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    try {
      const file = await fileOf($)
      if (file) {
        const kept = parseFile(await $.fs.read(file))
        await update($, stamps, xs => trim({ ...kept, ...xs }))
      }
    } catch {
      // no file yet, or none readable: the notes start empty
    }
    return next(e)
  })

  // A prompt or reply row is being kept: note its id, time and text.
  on('session.append', async ($, e, next) => {
    const r = await next(e)
    try {
      const m = e.message
      const kind = e.door === 'prompt' && m.type === 'user' && !m.isMeta ? 'user' : e.door === 'response' && m.type === 'assistant' ? 'assistant' : null
      if (!kind || r.uuid === undefined) return r
      const texts = textsOf(r.message.content)
      if (texts.length === 0) return r
      const at = new Date().toISOString()
      const uuid = r.uuid
      // A prompt is one row; a reply's text blocks are each drawn as a row of their own.
      const keys = kind === 'user' ? [keyOf(kind, texts.join('\n'))] : texts.map(t => keyOf(kind, t))
      const notes: Stamps = Object.fromEntries(keys.map((key, i) => [i === 0 ? uuid : `${uuid}:${i}`, { at, key }]))
      const all = await update($, stamps, xs => trim({ ...xs, ...notes }))
      const file = await fileOf($)
      if (file) await $.fs.write(file, fileText(all))
    } catch {
      // this row goes unnoted; the row is kept as the engine kept it
    }
    return r
  })

  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    // expanded (ctrl+o) the engine draws its own times; other senders' rows are left alone
    if (e.props.isExpanded || e.props.origin.kind !== 'composer') return next(e)
    let t = ''
    try {
      const at = stampFor(await read($, stamps), e.requestId, keyOf('user', e.props.text))
      t = at ? timeOf(at, new Date()) : ''
    } catch {
      // drawn as the engine draws it
    }
    return t ? next({ ...e, props: { ...e.props, text: `[${t}] ${e.props.text}` } }) : next(e)
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    // the time goes on the block that opens a reply; a summary block is left alone
    if (e.props.isSummary || !e.props.isFirstOfReply) return next(e)
    let t = ''
    try {
      const at = stampFor(await read($, stamps), e.requestId, keyOf('assistant', e.props.text))
      t = at ? timeOf(at, new Date()) : ''
    } catch {
      // drawn as the engine draws it
    }
    return t ? next({ ...e, props: { ...e.props, text: `[${t}] ${e.props.text}` } }) : next(e)
  })
}
