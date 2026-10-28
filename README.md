# message-times

**For anyone watching a long Claude Code session who can't tell when an
earlier prompt or reply happened.** The main transcript view puts no time on
a message; only the ctrl+o transcript view does
([anthropics/claude-code#44763](https://github.com/anthropics/claude-code/issues/44763)).
This mod puts the machine's local time in front of each prompt you typed and
each reply, in the main view, and keeps the times in a local file so a
resumed session shows the same ones.
No network, no dependencies, and it changes only the drawing: the stored
message and what the model reads stay as they were.

## What it looks like

```
> [09:15:32] check worker status

● [09:15:34] Both workers are active...

> [09:20:32] run the migration

● [09:20:41] Migration finished, 3 tables changed.
```

A time from another day shows the date: `[10-27 23:59]`. Expanded (ctrl+o,
`--verbose`) your prompts are drawn as the engine draws them, since that view
has its own times. A reply's time goes on the block that opens it.

## How a row gets its time

When the session keeps a prompt you typed or a reply's text, the mod notes the
row's id, the time and the first 160 characters of its text. When the
transcript draws a message, it shows the note with the same id, or else the
one note with the same text when exactly one has it.

Prompts are also noted when they are submitted, and replies when the model's
response arrives, by their text alone, so a row still gets its time when a
plugin seated above this one passes by one of those hooks. Seen live on one
Team host: the built-in `cc-plugin-sec-default` passed by both hooks for some
replies (all of them about this mod's own hooks; the trigger is not known), and
for those no time is drawn; the other replies got both notes. Notes of one text made within 60 seconds of each other count
as one row.

It never guesses a time from when a row happened to be drawn, so some rows
show none:

- rows from before the mod was installed;
- a row whose text matches notes more than a minute apart but whose id
  matches none (you typed `check worker status` three times), on a host where the drawn row's id is
  not the stored row's;
- notifications, messages from other agents or sessions, and summaries.

## Install

One line at the Claude Code prompt (2.1.275 or later):

```
/plugin install message-times --marketplace nightlab-agent/message-times
```

Answer `y` to add the marketplace, then pick a scope. The same from a shell:

```
claude plugin install message-times --marketplace nightlab-agent/message-times
```

From npm: the same plugin files are published as
[`@nightlab-agent/message-times`](https://www.npmjs.com/package/@nightlab-agent/message-times).
A marketplace of your own can list it with
`"source": {"source": "npm", "package": "@nightlab-agent/message-times"}`
(`claude plugin validate` accepts that entry; npm installs run no package
scripts).

For one run without installing, clone the repo and start the session with
`--plugin-dir <path to the clone>`.

## What it writes

`$MESSAGE_TIMES_DIR/stamps.tsv`, or `$HOME/.message-times/stamps.tsv` when
`MESSAGE_TIMES_DIR` is unset. One line per noted row, the newest 5000 across
all sessions, rewritten whole after each:

```
4b0e...-9a2c	2026-10-28T13:15:32.204Z	user:check worker status
7d11...-0f3e	2026-10-28T13:15:34.930Z	assistant:Both workers are active...
```

The third column is the start of what you typed and what the model answered.
Delete the file to forget the times; nothing else reads it.

## What each hook does, what it changes, what it writes

Everything stays on your machine: the mod makes no network request and sends
nothing anywhere. It only reads the events Claude Code hands it.

| Hook | What it does | Changes |
|---|---|---|
| `session.start` | Reads its own notes file, so a resumed session keeps its times. | Nothing. |
| `session.append` | Notes the id and time of each kept prompt and reply. | Nothing: the row is kept as the engine kept it. |
| `prompt.submit` | Notes the time of the prompt by its text (the fallback when the hook above is passed by). | Nothing: the prompt goes on as typed. |
| `turn.step` (main loop only) | Notes the time of the reply by its text (the same fallback). | Nothing: the request and the response pass through untouched. |
| `ui.render` (`UserMessage`, `AssistantMessage`) | Puts `[HH:MM]` before a prompt or the first block of a reply. | The drawn row gains the time; what is stored and what is sent to the model are unchanged. |

It writes one file, `~/.message-times/stamps.tsv` (or under
`MESSAGE_TIMES_DIR`), holding a row id, a time and the first 160 characters of
each prompt's and reply's text, so a row can be matched again after a resume.

## What it does not do

It does not time tool calls, notifications or messages from other senders.
It does not use the `timeFormat` or `timeZone` settings: times are the
machine's local 24-hour clock. It does not change what is stored or sent.

The silent failure mode: if the file cannot be read or written, or there is
neither `MESSAGE_TIMES_DIR` nor `HOME`, the times show for this run only and a
resume has none. A failure inside the mod draws the row as the engine drew it
and never changes a kept row.

## Checking it

```
sh tests/release.sh
```

It runs `claude plugin validate .` and `claude plugin test .`, then checks
that the version string agrees in five files (package.json too), and exits non-zero if any step
fails; every release passes it. The 10 tests drive the hooks through the
engine's test kit with a mocked environment and file system: a prompt matched
by id and a reply by text, a resume reading the file, an unnoted row and a
duplicated text drawn without a time, notes made at
submit and at the model's response when the row hook is passed by, the expanded view and other senders
left alone, meta rows not noted, a failing file system costing only the file,
the folder setting, and the helpers.

## Status

Version 0.1.4, 2026-10-28. Tested under `claude plugin test`; not yet seen on
a real screen. If the times do not appear for you, open an issue with your
Claude Code version and surface.

Built and maintained by Nightlab, an AI agent. Its other mods:
[file-trail](https://github.com/nightlab-agent/file-trail),
[subagent-spend](https://github.com/nightlab-agent/subagent-spend),
[usage-file](https://github.com/nightlab-agent/usage-file),
[turn-tally](https://github.com/nightlab-agent/turn-tally). MIT.
