import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Stamp, Stamps } from '../types'

// message-times: the time on each prompt and each reply in the main conversation
// view (anthropics/claude-code#44763). The ctrl+o detail view has times of
// its own; the main view, where a long-running session is watched, has none.
//
// How a row gets its time: when the session keeps a prompt or a reply row
// (`session.append`), its id, the time and the start of its text are noted, in
// the session's state and in one local file, so a resumed session has them.
// When the conversation draws a message row it reads them and never writes (a
// render hook may not): the row whose id was noted shows that time; otherwise
// the one noted row of that kind with the same text, when exactly one has it.
// A row with no such note (one drawn from before the mod was installed, or one
// of several rows saying the same thing, however close together) shows no
// time: the mod never guesses a time from when a row happened to be drawn.
//
// A plugin seated above this one may continue past its `session.append` hook
// (the built-in cc-plugin-sec-default does on Team accounts: "runs first and
// sent the event on past it"). So a prompt is noted at `prompt.submit` too and
// a reply at `turn.step`, by text alone; notes of one text made within
// SAME_ROW_MS of each other, with at most one note from each source among
// them (one row id, one submit note, one step note), are one row, and the
// earliest is its time.
//
// DESIGN NOTE, deliberately narrow: it changes the drawing only, never the
// stored message or what the model reads; no network; every failure of its own
// is swallowed and the engine's row drawn as it was.

/** Notes kept in the session and the file, newest last. */
export const KEEP = 5000

/** Notes of one row made by two hooks sit this close together; a note further off is another row. */
export const SAME_ROW_MS = 10_000

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

/** A note made by text alone (at `prompt.submit` or `turn.step`), not under the row's own id. */
export const byText = (id: string) => id.startsWith('prompt:') || id.startsWith('step:')

/** Where a note came from: one row gets at most one note from each source. A row id's notes share
 * their uuid (a reply's later blocks are `uuid:1`, `uuid:2`); a prompt is noted once at submit; a reply
 * once at the step that produced it. */
const sourceOf = (id: string) => (id.startsWith('prompt:') ? 'prompt' : id.startsWith('step:') ? 'step' : `row:${id.split(':')[0]!}`)

/** The time a drawn row shows: its own id's note, else the time of the one row with its text; '' when
 * there is none, or more than one. The notes of one row all sit within SAME_ROW_MS of its first and
 * come one from each source at most: one row id, one submit note, one step note. A note further off, a
 * second row id however close ("yes" typed twice, 30 seconds apart), or a second submit note, is a
 * second row, and which of the two an unrecognized row is cannot be known. */
export const stampFor = (all: Stamps, id: string, key: string) => {
  const own = all[id]
  if (own) return own.at
  const notes = Object.entries(all)
    .filter(([, s]) => s.key === key)
    .map(([nid, s]) => ({ id: nid, t: new Date(s.at).getTime() }))
    .filter(n => !Number.isNaN(n.t))
    .sort((a, b) => a.t - b.t)
  if (notes.length === 0) return ''
  const first = notes[0]!.t
  const sources = new Set<string>()
  for (const n of notes) {
    if (n.t - first > SAME_ROW_MS) return ''
    const source = sourceOf(n.id)
    // a second note from the same source is a second row, except a reply's own later blocks
    if (sources.has(source) ? !source.startsWith('row:') : source.startsWith('row:') && [...sources].some(x => x.startsWith('row:'))) return ''
    sources.add(source)
  }
  return new Date(first).toISOString()
}

type Block = { type: string; text?: unknown }
/** The non-empty text blocks of a row, in order. */
export const textsOf = (content: unknown): string[] =>
  Array.isArray(content)
    ? (content as Block[]).filter(b => b && b.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '').map(b => b.text as string)
    : []

type Options = Parameters<Register>[1]

/** The folder the notes are kept in: the `dir` option, else `.message-times` under the project. */
const dirOf = (options: Options) => String(options.dir || '.message-times')

/** Adds notes to the session's and writes the file. Before the first write of a session it writes
 * `<dir>/.gitignore` holding `*`, so git ignores the folder in every project with no step from the user:
 * the file holds the start of what was typed and answered, and must never ride along in a commit. */
async function note($: EngineInterface, options: Options, notes: Stamps, done: { ignore: boolean }) {
  const all = await update($, stamps, xs => trim({ ...xs, ...notes }))
  if (!done.ignore) {
    await $.fs.write(`${dirOf(options)}/.gitignore`, '*\n')
    done.ignore = true
  }
  await $.fs.write(`${dirOf(options)}/stamps.tsv`, fileText(all))
}

export const register: Register = (on, options) => {
  // whether this session has written the folder's .gitignore yet
  const done = { ignore: false }
  on('session.start', async ($, e, next) => {
    try {
      const kept = parseFile(await $.fs.read(`${dirOf(options)}/stamps.tsv`))
      await update($, stamps, xs => trim({ ...kept, ...xs }))
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
      // a subagent's rows are not drawn in the main view, and their text must not stand for a main row's
      if (e.agentId !== undefined) return r
      const kind = e.door === 'prompt' && m.type === 'user' && !m.isMeta ? 'user' : e.door === 'response' && m.type === 'assistant' ? 'assistant' : null
      if (!kind || r.uuid === undefined) return r
      const texts = textsOf(r.message.content)
      if (texts.length === 0) return r
      const at = new Date().toISOString()
      const uuid = r.uuid
      // A prompt is one row; a reply's text blocks are each drawn as a row of their own.
      const keys = kind === 'user' ? [keyOf(kind, texts.join('\n'))] : texts.map(t => keyOf(kind, t))
      await note($, options, Object.fromEntries(keys.map((key, i) => [i === 0 ? uuid : `${uuid}:${i}`, { at, key }])), done)
    } catch {
      // this row goes unnoted; the row is kept as the engine kept it
    }
    return r
  })

  // The same prompt by its text, for when the hook above is passed by.
  on('prompt.submit', async ($, e, next) => {
    const at = new Date().toISOString()
    const r = await next(e)
    try {
      if (!e.isMeta && !e.command && 'text' in r && typeof r.text === 'string' && r.text.trim() !== '') {
        await note($, options, { [`prompt:${at}`]: { at, key: keyOf('user', r.text) } }, done)
      }
    } catch {
      // unnoted here; the prompt goes on as the engine had it
    }
    return r
  })

  // The same reply by its text, once the model's response is in (main loop only: a subagent's is not drawn there).
  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    try {
      if (!e.agentId && r.answer.trim() !== '') {
        const at = new Date().toISOString()
        await note($, options, { [`step:${e.turnId}:${e.index}`]: { at, key: keyOf('assistant', r.answer) } }, done)
      }
    } catch {
      // unnoted here; the response is the engine's as streamed
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
