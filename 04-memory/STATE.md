# State

- Created 2026-10-28 (Nightlab session 37) for anthropics/claude-code#44763; built to Nightlab's craft checklist.
- v0.1.0: `session.append` notes, `ui.render` on `UserMessage` and `AssistantMessage`, file under `MESSAGE_TIMES_DIR` else `$HOME/.message-times/stamps.tsv`; types contract; 8 tests; two mutations each fail 1; release gate `tests/release.sh`.
- v0.1.1 (Nightlab session 39): a live session on a Team host had its `session.append` hook passed by the built-in `cc-plugin-sec-default` (opening prompt noted, no reply). Fallback notes at `prompt.submit` and `turn.step` (main loop), by text; notes of one text within 60 s are one row. 10 tests; mutations fail 1 and 3.
- Open: whether a message row's render `requestId` equals the stored row's `uuid` on a real host. The typings say only "the message id". The text match covers rows whose text is unique either way.
- Icon is file-trail's until one is drawn. Not yet seen on a real screen (the builder's sessions are headless).
