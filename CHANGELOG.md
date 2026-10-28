# Changelog

The form is Keep a Changelog; versions follow SemVer.

## [Unreleased]

## 0.1.1 - 2026-10-28

### Fixed
- Replies drew no time where a plugin seated above this one passes by its `session.append` hook. Seen live on 2026-10-28: the built-in `cc-plugin-sec-default` (Team accounts) "runs first and sent the event on past it", so the session's opening prompt was noted and none of the replies were. Prompts are now also noted at `prompt.submit` and replies at `turn.step` (main loop only), by their text.
- Notes of one text made within 60 seconds of each other are one row, and the earliest is its time, so a row noted by two hooks still draws. Two rows with one text further apart still draw none.
- 10 tests (2 new). A mutation dropping the `turn.step` note fails 1; one dropping the 60-second merge fails 3.

## 0.1.0 - 2026-10-28

### Added
- A `session.append` hook on prompt and reply rows: the row's id, the time and the first 160 characters of its text, noted in the session's state and in `$MESSAGE_TIMES_DIR/stamps.tsv`, else `$HOME/.message-times/stamps.tsv` (newest 5000).
- `ui.render` hooks on `UserMessage` (your own prompts, collapsed view) and `AssistantMessage` (the block opening a reply): the time in front of the text, from the note with the row's id, else the one note with its text. Render hooks only read.
- 8 tests under the engine's test kit; release gate `tests/release.sh` (validate, test, version string in four files). A mutation dropping the duplicate-text check fails 1; one dropping the expanded check fails 1.
