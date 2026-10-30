import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { byText, fileText, FILES, KEEP, keyOf, parseFile, stampFor, timeOf, trim } from './register'

// Each test stands for the engine beneath the plugin: it answers
// `session.start`, `$.fs.read` and `$.fs.write`, keeps the rows
// the session appends, and draws a message row by handing back the text the
// plugin passed down. Nothing touches the real file system.

type On = Parameters<TestBody>[1]
// the test runtime has timers; the declarations the mod builds against do not name them
declare const setTimeout: (f: () => void, ms: number) => unknown
type $T = Parameters<TestBody>[0]

const world = (on: On, opts: { file?: string; readFails?: boolean; writeFails?: boolean} = {}) => {
  const writes: { path: string; text: string }[] = []
  const drawn: string[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's-1' }))
  on('fs.list', () => ({ value: opts.file === undefined ? [] : [{ name: 'stamps.tsv', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => {
    if (opts.readFails || opts.file === undefined) throw Object.assign(new Error('no such file'), { code: 'ENOENT' })
    return { value: opts.file }
  })
  on('fs.write', (_, e) => {
    if (opts.writeFails) throw new Error('read-only file system')
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const text = String((e.props as { text?: unknown }).text)
    drawn.push(text)
    const { Text } = $.ui.resolve(e)
    return <Text>{text}</Text>
  })
  return { writes, drawn }
}

const start = ($: $T) => $.session.start({ cwd: '/work', surface: 'terminal', isInteractive: true })

const prompt = ($: $T, uuid: string, text: string) =>
  $.session.append({ message: { type: 'user', role: 'user', content: [{ type: 'text', text }] }, door: 'prompt', origin: { kind: 'composer' }, uuid })

const reply = ($: $T, uuid: string, ...texts: string[]) =>
  $.session.append({
    message: { type: 'assistant', role: 'assistant', content: texts.map(text => ({ type: 'text' as const, text })) },
    door: 'response',
    origin: { kind: 'model', model: 'claude-test' },
    uuid,
  })

const drawUser = ($: $T, requestId: string, text: string, extra: Record<string, unknown> = {}) =>
  $.ui.render({ surface: 'terminal', component: 'UserMessage', requestId, props: { text, origin: { kind: 'composer' }, isExpanded: false, ...extra } as never })

const drawReply = ($: $T, requestId: string, text: string, extra: Record<string, unknown> = {}) =>
  $.ui.render({ surface: 'terminal', component: 'AssistantMessage', requestId, props: { text, isFirstOfReply: true, ...extra } as never })

const STAMP = /^\[\d\d:\d\d:\d\d\] /

const submit = ($: $T, text: string, extra: Record<string, unknown> = {}) => $.prompt.submit({ text, ...extra } as never)

const step = async ($: $T, turnId: string, index: number, extra: Record<string, unknown> = {}) => {
  const s = $.turn.step({ turnId, index, model: 'claude-test', messageCount: 1, ...extra } as never)
  for await (const _ of s) {
    // the chunks are the engine's; only the result is read
  }
  return s.result
}

// What the engine beneath answers when asked: the prompt as typed, and a response with one text.
const engine = (on: On, answer: string) => {
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.step', async function* (_, e) {
    return { turnId: e.turnId, index: e.index, answer, toolUses: [], stopReason: 'end_turn', usage: null } as never
  })
}

test('a prompt and a reply the session kept are drawn with the time, by id or by their text', async ($, on) => {
  const { writes, drawn } = world(on)
  await start($)
  await prompt($, 'u-1', 'check worker status')
  await reply($, 'a-1', 'Both workers are active.')
  await drawUser($, 'u-1', 'check worker status')
  await drawReply($, 'msg_other_id', 'Both workers are active.')
  expect(drawn[0]).toMatch(STAMP)
  expect(drawn[0]).toEndWith('] check worker status')
  expect(drawn[1]).toMatch(STAMP)
  expect(drawn[1]).toEndWith('] Both workers are active.')
  expect(writes.at(-1)!.path.endsWith('/.message-times/stamps-s-1.tsv')).toBe(true)
  expect(Object.keys(parseFile(writes.at(-1)!.text))).toEqual(['u-1', 'a-1'])
})

test('with session.append passed by, a prompt and a reply are noted at prompt.submit and turn.step and drawn with the time', async ($, on) => {
  const { writes, drawn } = world(on)
  engine(on, 'All four workers are up.')
  await start($)
  await submit($, 'check worker status')
  await step($, 't-1', 0)
  await drawUser($, 'r-1', 'check worker status')
  await drawReply($, 'r-2', 'All four workers are up.')
  expect(drawn[0]).toMatch(STAMP)
  expect(drawn[1]).toMatch(STAMP)
  expect(writes.at(-1)!.text).toContain('step:t-1:0\t')
})

test('a row noted by both doors draws one time; a subagent step, a meta prompt and a tool-only step are not noted', async ($, on) => {
  const { writes, drawn } = world(on)
  engine(on, '')
  await start($)
  await submit($, 'check worker status')
  await prompt($, 'u-1', 'check worker status')
  await drawUser($, 'r-9', 'check worker status')
  expect(drawn[0]).toMatch(STAMP)
  const before = writes.length
  await step($, 't-1', 0)
  await step($, 't-2', 0, { agentId: 'a-1' })
  await submit($, 'hidden', { isMeta: true })
  expect(writes.length).toBe(before)
})

test('a resumed session reads the times from the file', async ($, on) => {
  const file = 'u-9\t2026-10-27T13:15:32.000Z\tuser:deploy the fix\n'
  const { drawn } = world(on, { file })
  await start($)
  await drawUser($, 'u-9', 'deploy the fix')
  expect(drawn[0]).toBe(`[${timeOf('2026-10-27T13:15:32.000Z', new Date())}] deploy the fix`)
})

test('a row with no note, or one of two rows with the same text and other ids, is drawn without a time', async ($, on) => {
  const old = new Date(Date.now() - 2 * 3600_000).toISOString()
  const { drawn } = world(on, { file: `u-1\t${old}\t${keyOf('user', 'check worker status')}\n` })
  await start($)
  await prompt($, 'u-2', 'check worker status')
  await drawUser($, 'r-1', 'check worker status')
  await drawUser($, 'r-0', 'something typed before the mod was installed')
  await drawUser($, 'u-2', 'check worker status')
  expect(drawn[0]).toBe('check worker status')
  expect(drawn[1]).toBe('something typed before the mod was installed')
  expect(drawn[2]).toMatch(STAMP)
})

test('the expanded view, a message from another sender, a reply block after the first and a summary are left alone', async ($, on) => {
  const { drawn } = world(on)
  await start($)
  await prompt($, 'u-1', 'hello')
  await reply($, 'a-1', 'one', 'two')
  await drawUser($, 'u-1', 'hello', { isExpanded: true })
  await drawUser($, 'u-1', 'hello', { origin: { kind: 'unclassified' } })
  await drawReply($, 'a-1:1', 'two', { isFirstOfReply: false })
  await drawReply($, 'a-1', 'one', { isSummary: true })
  expect(drawn).toEqual(['hello', 'hello', 'two', 'one'])
})

test('meta rows, tool results and empty replies are not noted', async ($, on) => {
  const { writes } = world(on)
  await start($)
  await $.session.append({ message: { type: 'user', role: 'user', isMeta: true, content: [{ type: 'text', text: 'reminder' }] }, door: 'prompt', origin: { kind: 'composer' }, uuid: 'm-1' })
  await reply($, 'a-1')
  expect(writes.length).toBe(0)
})

test('a file that cannot be read or written costs the file alone: rows are kept and still drawn with the time', async ($, on) => {
  const { writes, drawn } = world(on, { readFails: true, writeFails: true })
  await start($)
  const r = await prompt($, 'u-1', 'still works')
  expect(r.uuid).toBe('u-1')
  await drawUser($, 'u-1', 'still works')
  expect(writes.length).toBe(0)
  expect(drawn[0]).toMatch(STAMP)
})

test('the dir option moves the file', { options: { dir: '/var/notes' } }, async ($, on) => {
  const { writes } = world(on)
  await start($)
  await prompt($, 'u-1', 'a')
  expect(writes.map(w => w.path)).toEqual(['/var/notes/stamps-s-1.tsv'])
})

test('with dir set to the project itself, the project\'s own .gitignore is left alone', { options: { dir: '.' } }, async ($, on) => {
  const { writes } = world(on)
  await start($)
  await prompt($, 'u-1', 'a')
  expect(writes.filter(w => w.path.endsWith('.gitignore')).length).toBe(0)
  expect(writes.filter(w => w.path.endsWith('stamps-s-1.tsv')).length).toBe(1)
})

test('comparison: an absolute folder named .message-times gets its .gitignore', { options: { dir: '/var/notes/.message-times/' } }, async ($, on) => {
  const { writes } = world(on)
  await start($)
  await prompt($, 'u-1', 'a')
  expect(writes[0]!.path.endsWith('/.message-times/.gitignore')).toBe(true)
})

test('helpers: time on another day shows the date; the file keeps the newest KEEP; bad lines are skipped', () => {
  const now = new Date(2026, 9, 28, 12, 0, 0)
  expect(timeOf(new Date(2026, 9, 28, 9, 5, 7).toISOString(), now)).toBe('09:05:07')
  expect(timeOf(new Date(2026, 9, 27, 23, 59, 0).toISOString(), now)).toBe('10-27 23:59')
  expect(timeOf('not a time', now)).toBe('')
  const many = Object.fromEntries(Array.from({ length: KEEP + 3 }, (_, i) => [`id-${i}`, { at: '2026-10-28T00:00:00.000Z', key: `user:${i}` }]))
  const kept = trim(many)
  expect(Object.keys(kept).length).toBe(KEEP)
  expect(Object.keys(kept)[0]).toBe('id-3')
  expect(parseFile('x\t2026-10-28T00:00:00Z\tuser:a\nbroken line\ny\tnot-a-date\tuser:b\n')).toEqual({ x: { at: '2026-10-28T00:00:00Z', key: 'user:a' } })
  expect(parseFile(fileText({ a: { at: '2026-10-28T00:00:00Z', key: 'user:tab\there' } }))).toEqual({ a: { at: '2026-10-28T00:00:00Z', key: 'user:tab here' } })
  expect(keyOf('user', '  check\n worker   status ')).toBe('user:check worker status')
  expect(stampFor({}, 'x', 'user:a')).toBe('')
})

test('before its first write the mod writes <dir>/.gitignore holding one line, *, once, so git never sees the folder', async ($, on) => {
  const { writes } = world(on)
  await start($)
  await prompt($, 'u-1', 'first')
  await prompt($, 'u-2', 'second')
  expect(writes[0]!.path.endsWith('/.message-times/.gitignore')).toBe(true)
  expect(writes[0]!.text).toBe('*\n')
  expect(writes.filter(w => w.path.endsWith('/.gitignore')).length).toBe(1)
  expect(writes.filter(w => w.path.endsWith('/stamps-s-1.tsv')).length).toBe(2)
})

test('"yes" kept twice under two ids 30 seconds apart: a row not under either id gets no time; each own row keeps its own', async ($, on) => {
  const earlier = new Date(Date.now() - 30_000).toISOString()
  const { drawn } = world(on, { file: `u-1\t${earlier}\t${keyOf('user', 'yes')}\n` })
  await start($)
  await prompt($, 'u-2', 'yes')
  await drawUser($, 'r-unknown', 'yes')
  await drawUser($, 'u-1', 'yes')
  await drawUser($, 'u-2', 'yes')
  expect(drawn[0]).toBe('yes')
  expect(drawn[1]).toBe(`[${timeOf(earlier, new Date())}] yes`)
  expect(drawn[2]).toMatch(STAMP)
})

test('control: one row noted by its text at submit and under its id a second later is one row, and a row drawn under another id gets its time', async ($, on) => {
  const earlier = new Date(Date.now() - 1_000).toISOString()
  const { drawn } = world(on, { file: `prompt:${earlier}\t${earlier}\t${keyOf('user', 'yes')}\n` })
  await start($)
  await prompt($, 'u-1', 'yes')
  await drawUser($, 'r-unknown', 'yes')
  expect(drawn[0]).toBe(`[${timeOf(earlier, new Date())}] yes`)
})

test('"yes" noted by text alone 30 seconds ago (its keep passed by) and "yes" kept now under an id are two rows: an unrecognized row gets no time', async ($, on) => {
  const earlier = new Date(Date.now() - 30_000).toISOString()
  const { drawn } = world(on, { file: `prompt:${earlier}\t${earlier}\t${keyOf('user', 'yes')}\n` })
  engine(on, '')
  await start($)
  await submit($, 'yes')
  await prompt($, 'u-2', 'yes')
  await drawUser($, 'r-unknown', 'yes')
  await drawUser($, 'u-2', 'yes')
  expect(drawn[0]).toBe('yes')
  expect(drawn[1]).toMatch(STAMP)
})

test('stampFor: two row ids or two submit notes refuse, however close; one row id with text notes answers; text notes alone answer; byText names the text-only ids', () => {
  const at = (s: number) => new Date(Date.UTC(2026, 9, 29, 9, 0, s)).toISOString()
  const key = 'user:yes'
  expect(stampFor({ 'u-1': { at: at(0), key }, 'u-2': { at: at(30), key } }, 'r', key)).toBe('')
  expect(stampFor({ 'u-1': { at: at(0), key }, 'u-2': { at: at(1), key } }, 'r', key)).toBe('')
  expect(stampFor({ 'u-1': { at: at(0), key }, 'prompt:x': { at: at(1), key }, 'u-2': { at: at(30), key } }, 'r', key)).toBe('')
  expect(stampFor({ 'prompt:x': { at: at(0), key }, 'u-1': { at: at(3), key } }, 'r', key)).toBe(at(0))
  expect(stampFor({ 'prompt:x': { at: at(0), key }, 'u-1': { at: at(30), key } }, 'r', key)).toBe('')
  expect(stampFor({ 'prompt:x': { at: at(0), key }, 'step:t:0': { at: at(5), key } }, 'r', key)).toBe(at(0))
  expect(stampFor({ 'prompt:x': { at: at(0), key }, 'prompt:y': { at: at(30), key } }, 'r', key)).toBe('')
  expect(stampFor({ 'prompt:x': { at: at(0), key }, 'prompt:y': { at: at(8), key } }, 'r', key)).toBe('')
  expect(stampFor({ 'step:t:0': { at: at(0), key: 'assistant:Done.' }, 'step:u:0': { at: at(4), key: 'assistant:Done.' } }, 'r', 'assistant:Done.')).toBe('')
  expect(stampFor({ 'step:t:0': { at: at(0), key: 'assistant:Done.' }, 'a-1': { at: at(1), key: 'assistant:Done.' } }, 'r', 'assistant:Done.')).toBe(at(0))
  expect(stampFor({ 'a-1': { at: at(0), key: 'assistant:same' }, 'a-1:1': { at: at(0), key: 'assistant:same' } }, 'r', 'assistant:same')).toBe(at(0))
  expect(byText('prompt:2026')).toBe(true)
  expect(byText('step:t-1:0')).toBe(true)
  expect(byText('u-1')).toBe(false)
})

test('"yes" sent twice 8 seconds apart with both keeps passed by: two rows noted by text alone, and an unrecognized row gets no time', async ($, on) => {
  const earlier = new Date(Date.now() - 8_000).toISOString()
  const { drawn } = world(on, { file: `prompt:${earlier}\t${earlier}\t${keyOf('user', 'yes')}\n` })
  engine(on, '')
  await start($)
  await submit($, 'yes')
  await drawUser($, 'r-unknown', 'yes')
  expect(drawn[0]).toBe('yes')
})

test('a subagent\'s kept rows are not noted, so a main reply with the same text keeps its own time', async ($, on) => {
  const { writes, drawn } = world(on)
  await start($)
  await reply($, 'a-1', 'Done.')
  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Done.' }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-test' },
    uuid: 's-1',
    agentId: 'agent-1',
  } as never)
  expect(Object.keys(parseFile(writes.at(-1)!.text))).toEqual(['a-1'])
  await drawReply($, 'r-unknown', 'Done.')
  expect(drawn[0]).toMatch(STAMP)
})

// A folder held in memory, shared by every session the test runs in turn.
const disk = (on: On, files: Map<string, string>, session: { id: string }) => {
  // a file already there counts as written in the order the map holds it, oldest first
  let tick = 0
  const mtimes = new Map<string, number>([...files.keys()].map(f => [f, ++tick]))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.root', () => ({ value: '/work' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: session.id }))
  on('fs.list', (_, e) => {
    const dir = String((e as { path?: unknown }).path ?? '')
    const names = [...files.keys()].filter(f => f.startsWith(`${dir}/`)).map(f => f.slice(dir.length + 1)).filter(n => !n.includes('/'))
    return { value: names.map(name => ({ name, kind: 'file', size: 1, mtimeMs: mtimes.get(`${dir}/${name}`) ?? 0, isLink: false })) }
  })
  on('fs.read', (_, e) => {
    const text = files.get(e.path)
    if (text === undefined) throw Object.assign(new Error('no such file'), { code: 'ENOENT' })
    return { value: text }
  })
  on('fs.exists', (_, e) => ({ value: files.has(e.path) }))
  on('fs.write', (_, e) => {
    files.set(e.path, e.text)
    mtimes.set(e.path, ++tick)
    return { value: undefined }
  })
  const drawn: string[] = []
  on('ui.render', ($, e) => {
    const text = String((e.props as { text?: unknown }).text)
    drawn.push(text)
    const { Text } = $.ui.resolve(e)
    return <Text>{text}</Text>
  })
  return drawn
}

test('two sessions in one project, B writes between A\'s read and write: neither loses a note, and the next start has both', async ($, on) => {
  const files = new Map<string, string>()
  const session = { id: 's-a' }
  const drawn = disk(on, files, session)
  await start($)
  await prompt($, 'u-a1', 'from A')
  // session B writes while A is between notes, the moment that lost notes before
  files.set('/work/.message-times/stamps-s-b.tsv', 'u-b1\t2026-10-29T10:01:00.000Z\tuser:from B\n')
  await prompt($, 'u-a2', 'from A again')
  expect(Object.keys(parseFile(files.get('/work/.message-times/stamps-s-b.tsv')!))).toEqual(['u-b1'])
  expect(Object.keys(parseFile(files.get('/work/.message-times/stamps-s-a.tsv')!))).toEqual(['u-a1', 'u-a2'])
  // a third session starts and draws all three with their times
  session.id = 's-c'
  await start($)
  await drawUser($, 'u-b1', 'from B')
  await drawUser($, 'u-a2', 'from A again')
  expect(drawn[0]).toBe(`[${timeOf('2026-10-29T10:01:00.000Z', new Date())}] from B`)
  expect(drawn[1]).toMatch(STAMP)
})

test('comparison: a stamps.tsv left by an earlier version is read at start and never written again', async ($, on) => {
  const files = new Map<string, string>([['/work/.message-times/stamps.tsv', 'u-9\t2026-10-27T13:15:32.000Z\tuser:deploy the fix\n']])
  const drawn = disk(on, files, { id: 's-1' })
  await start($)
  await prompt($, 'u-1', 'new')
  await drawUser($, 'u-9', 'deploy the fix')
  expect(drawn[0]).toBe(`[${timeOf('2026-10-27T13:15:32.000Z', new Date())}] deploy the fix`)
  expect(files.get('/work/.message-times/stamps.tsv')).toBe('u-9\t2026-10-27T13:15:32.000Z\tuser:deploy the fix\n')
  expect(files.has('/work/.message-times/stamps-s-1.tsv')).toBe(true)
})

test('at start only the FILES most recently written notes files are read', async ($, on) => {
  // session 0's file is the oldest of FILES + 1
  const files = new Map<string, string>(
    Array.from({ length: FILES + 1 }, (_, i) => [`/work/.message-times/stamps-s${i}.tsv`, `u-${i}\t2026-10-29T10:00:00.000Z\tuser:row ${i}\n`] as [string, string]),
  )
  const drawn = disk(on, files, { id: 's-new' })
  await start($)
  await drawUser($, 'u-0', 'row 0')
  await drawUser($, 'u-1', 'row 1')
  expect(drawn[0]).toBe('row 0')
  expect(drawn[1]).toBe(`[${timeOf('2026-10-29T10:00:00.000Z', new Date())}] row 1`)
})

test('/clear: a row of the new conversation saying what an old one said is drawn without the old time', async ($, on) => {
  const files = new Map<string, string>()
  const session = { id: 's-a' }
  const drawn = disk(on, files, session)
  await start($)
  await prompt($, 'u-old', 'yes')
  await $.session.end({ reason: 'clear', sessionId: 's-a', resume: {} as never })
  session.id = 's-b'
  await prompt($, 'u-new', 'something new')
  await drawUser($, 'u-other', 'yes')
  await drawUser($, 'u-new', 'something new')
  expect(drawn[0]).toBe('yes')
  expect(drawn[1]).toMatch(STAMP)
  expect(Object.keys(parseFile(files.get('/work/.message-times/stamps-s-b.tsv')!))).toEqual(['u-new'])
  expect(Object.keys(parseFile(files.get('/work/.message-times/stamps-s-a.tsv')!))).toEqual(['u-old'])
})

test('comparison: a session that ends any other way keeps its notes', async ($, on) => {
  const drawn = disk(on, new Map(), { id: 's-a' })
  await start($)
  await prompt($, 'u-old', 'yes')
  await $.session.end({ reason: 'prompt_input_exit', sessionId: 's-a', resume: {} as never })
  await drawUser($, 'u-other', 'yes')
  expect(drawn[0]).toMatch(STAMP)
})

test('a notes file that is there but whose read is refused (EBUSY) is left alone, not rewritten with this session\'s notes', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  let refuse = false
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's-1' }))
  on('fs.list', () => ({ value: [{ name: 'stamps-s-1.tsv', kind: 'file', size: 1, mtimeMs: 1, isLink: false }] }))
  on('fs.read', () => {
    if (refuse) throw Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' })
    return { value: 'u-1\t2026-10-29T10:00:00.000Z\tuser:first\n' }
  })
  on('fs.exists', () => ({ value: true }))
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await start($)
  refuse = true
  await prompt($, 'u-3', 'today')
  expect(writes.filter(w => w.path.endsWith('stamps-s-1.tsv')).length).toBe(0)
})

test('comparison: with no file yet, the first note writes the file', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's-1' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => {
    throw Object.assign(new Error('no such file'), { code: 'ENOENT' })
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.write', (_, e) => {
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await start($)
  await prompt($, 'u-3', 'today')
  expect(writes.filter(w => w.path.endsWith('stamps-s-1.tsv')).at(-1)!.text).toContain('u-3\t')
})

test('one session, two notes at once, the first one\'s write answered late: the file still ends with both', async ($, on) => {
  const writes: { path: string; text: string }[] = []
  let first = true
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: 's-1' }))
  on('fs.list', () => ({ value: [] }))
  on('fs.read', () => {
    throw Object.assign(new Error('no such file'), { code: 'ENOENT' })
  })
  on('fs.write', async (_, e) => {
    if (e.path.endsWith('stamps.tsv') && first) {
      first = false
      await new Promise<void>(r => setTimeout(() => r(), 50))
    }
    writes.push({ path: e.path, text: e.text })
    return { value: undefined }
  })
  await start($)
  await Promise.all([prompt($, 'u-1', 'first'), prompt($, 'u-2', 'second')])
  const last = writes.filter(w => w.path.endsWith('stamps-s-1.tsv')).at(-1)!.text
  expect(last).toContain('u-1\t')
  expect(last).toContain('u-2\t')
})
