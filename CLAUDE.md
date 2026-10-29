# message-times: notes for whoever works on this repo

Read this, then `00-catalog/CATALOG.md`, then only what it
points to.

One hooks module, no dependencies: `session.append` notes each kept prompt and
reply row (id, time, start of text) in the session's state and one local file;
`ui.render` on `UserMessage` and `AssistantMessage` puts the time in front of
the text. Rules: render hooks only read (the engine denies a write while
drawing); never a time guessed from when a row was drawn; never change the
stored row or what the model reads; no network; a failure of its own is
swallowed and the row drawn as the engine drew it.
