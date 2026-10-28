# Changelog

The form is Keep a Changelog; versions follow SemVer.

## [Unreleased]

## 0.1.0 - 2026-10-28

### Added
- A `session.append` hook on prompt and reply rows: the row's id, the time and the first 160 characters of its text, noted in the session's state and in `$MESSAGE_TIMES_DIR/stamps.tsv`, else `$HOME/.message-times/stamps.tsv` (newest 5000).
- `ui.render` hooks on `UserMessage` (your own prompts, collapsed view) and `AssistantMessage` (the block opening a reply): the time in front of the text, from the note with the row's id, else the one note with its text. Render hooks only read.
- 8 tests under the engine's test kit; release gate `tests/release.sh` (validate, test, version string in four files). A mutation dropping the duplicate-text check fails 1; one dropping the expanded check fails 1.
