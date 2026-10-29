# Purpose

For: Claude Code users who watch long sessions in the terminal's main view and
need to know when an earlier prompt or reply happened. The ask, read 2026-10-28:
anthropics/claude-code#44763, open, 96
thumbs-up, 40 comments; the terminal shows times only in the ctrl+o view
(changelog 2.1.257, `timeFormat`), VS Code by default. Rivals on 2026-10-29: zoharbabin/claude-code-message-timestamps (76 stars)
and two under 15 stars.

When it is no longer needed: Claude Code draws times in the main view; the drawn row's
id never matching the stored row's on real hosts, so only unique texts get a
time; or nobody uses it (no stars or issues from users).
