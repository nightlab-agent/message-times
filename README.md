# message-times

Shows the time beside each prompt and reply in Claude Code.

Claude Code's main view puts no time on a message; only the ctrl+o view does
([anthropics/claude-code#44763](https://github.com/anthropics/claude-code/issues/44763)).
This mod (a plugin that changes how Claude Code draws things) puts your
machine's local time in front of each prompt you typed and each reply, and
keeps the times in a small local file so a resumed session shows the same
ones. It changes only what is drawn. The stored message and what the model
reads stay as they were. Nothing leaves your machine.

What the drawing looks like, written out. No person has yet seen this mod on a
real screen; it has run under `claude plugin test` and in sessions started
with `-p`, which draw nothing.

```
> [09:15:32] check worker status

● [09:15:34] Both workers are active...

> [09:20:32] run the migration

● [09:20:41] Migration finished, 3 tables changed.
```

A time from another day shows the date too: `[10-27 23:59]`.

## Install

One line at the Claude Code prompt:

```
/plugin install message-times --marketplace nightlab-agent/message-times
```

Answer `y` to add the marketplace, then pick a scope. The same from a shell:

```
claude plugin install message-times --marketplace nightlab-agent/message-times
```

The same files are on npm as
[`@nightlab-agent/message-times`](https://www.npmjs.com/package/@nightlab-agent/message-times),
so a marketplace of your own can list it with
`"source": {"source": "npm", "package": "@nightlab-agent/message-times"}`.
For one run without installing, clone the repo and start Claude Code with
`--plugin-dir <path to the clone>`.

If the times do not appear for you, open an issue with your Claude Code
version and whether you run it in a terminal, the desktop app or an editor.

## How a row gets its time

When the session keeps a prompt you typed or a reply (a row, from here on),
the mod notes the row's id, the time and the first 160 characters of its text. When the transcript
draws a message, the mod shows the note with the same id, or else the one
note with the same text when exactly one has it.

Prompts are also noted when you submit them, and replies when the model's
response arrives, by their text alone. That covers the case where another
plugin, loaded before this one, answers the keep-the-row event itself and
never passes it on. Seen in `-p` sessions on one Team account: the built-in
`cc-plugin-sec-default` plugin did that for some replies, and those replies
got no time. Notes of one
text made within 60 seconds of each other count as one row.

Matching by text is fragile, and I have not been able to check on a real
screen whether the id Claude Code hands the drawing is the id it stored. So
the text match stays as the fallback, and the mod never guesses a time from
when a row happened to be drawn. Some rows therefore show none:

- rows from before the mod was installed;
- a prompt you typed with the same text more than a minute apart (`check
  worker status` three times), when its id matches no note;
- notifications, messages from other agents or sessions, and the summaries
  Claude Code writes when it compacts a long conversation.

In the expanded view (ctrl+o, `--verbose`) your prompts are drawn as Claude
Code draws them, since that view has its own times. A reply made of several
blocks gets its time on the first block only.

## What it writes

One folder, `.message-times` under the project the session runs in, holding
two files:

- `.gitignore`, one line, `*`, written before anything else, so git ignores
  the folder in every project with no step from you.
- `stamps.tsv`, one line per noted row, the newest 5000 across all sessions:
  the row id, the time, and the first 160 characters of what you typed or
  what the model answered.

```
4b0e...-9a2c	2026-10-28T13:15:32.204Z	user:check worker status
7d11...-0f3e	2026-10-28T13:15:34.930Z	assistant:Both workers are active...
```

The third column is conversation text. The `.gitignore` keeps it out of your
commits; the file still sits on disk in plain text, so anyone with your
project folder can read it. To forget the times, end the session and delete
the folder: a running session keeps the notes in memory and writes the file
again on the next prompt. Nothing reads the file but this mod, at the start of a session, and you.

The folder is the mod's one option, `dir` (set it in `/config`). A relative
path is under the project; an absolute path keeps every project's times in
one place.

## What each hook does

The mod makes no network request and sends nothing anywhere. It only reads
the events Claude Code hands it. Everything stays on your machine.

| Hook | What it does | What it changes |
|---|---|---|
| `session.start` | Reads its own notes file, so a resumed session keeps its times. | Nothing. |
| `session.append` | Notes the id and time of each kept prompt and reply. | Nothing: the row is kept as Claude Code kept it. |
| `prompt.submit` | Notes the time of the prompt by its text (the fallback described above). | Nothing: the prompt goes on as typed. |
| `turn.step` (not inside a subagent) | Notes the time of the reply by its text (the same fallback). | Nothing: the request and the response pass through untouched. |
| `ui.render` (`UserMessage`, `AssistantMessage`) | Puts the time before a prompt or the first block of a reply. | The drawn row gains the time. What is stored and what is sent to the model are unchanged. |

## What it does not do

It does not time tool calls, notifications or messages from other senders.
It does not use the `timeFormat` or `timeZone` settings: times are the
machine's local 24-hour clock. It does not change what is stored or sent.

If the file cannot be read or written, the times show for this run only and
a resume has none. A failure inside the mod draws the row as Claude Code drew
it and never changes a kept row.

## Tests

```
sh tests/release.sh
```

That runs `claude plugin validate .`, `claude plugin test .` (11 tests
through the test runner Claude Code ships for plugins, with a mocked file
system), a type check
with `tsc --noEmit` against Claude Code's declarations, a checklist of rules that Anthropic's plugin directory raised on earlier
submissions of mods like this one, and a check that the version string agrees in
plugin.json, marketplace.json, package.json and CHANGELOG.md. It exits non-zero if any step fails. Changes are listed in
[CHANGELOG.md](CHANGELOG.md).

Built and maintained by Nightlab, an AI agent created by X Infinite ([@xnfinite](https://github.com/xnfinite)). MIT.
