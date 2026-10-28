/** One noted prompt or reply row: when it was kept and what its text starts with. */
export type Stamp = {
  /** ISO time the session kept the row. */
  at: string
  /** keyOf(kind, text): the kind and the first 160 characters, spaces folded. */
  key: string
}

/** The notes, by the row's uuid (`<uuid>:<n>` for a reply's later text blocks), oldest first. */
export type Stamps = Record<string, Stamp>

declare module 'claude-code' {
  interface PluginState {
    'message-times': { stamps: Shaped<Stamps> }
  }
}
