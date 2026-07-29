export type BufferState = {
  /** Content as of the last successful read or write. */
  readonly savedText: string
  /** Disk mtime as of that same read or write. */
  readonly mtime: number
}

export type ExternalChange =
  | { action: "none" }
  | { action: "reload"; text: string; mtime: number }
  | { action: "conflict" }

export function isDirty(state: BufferState, currentText: string) {
  return currentText !== state.savedText
}

/**
 * Something changed the file underneath us. A buffer the user has not touched
 * silently follows the file; one with unsaved edits asks, because the only
 * unrecoverable outcome here is discarding typing.
 */
export function onExternalChange(
  state: BufferState,
  currentText: string,
  disk: { text: string; mtime: number },
): ExternalChange {
  if (disk.text === state.savedText) return { action: "none" }
  if (isDirty(state, currentText)) return { action: "conflict" }
  return { action: "reload", text: disk.text, mtime: disk.mtime }
}

/** Refuse to write over a file that moved since we last read it. */
export function beforeSave(state: BufferState, disk: { mtime: number }) {
  return disk.mtime === state.mtime ? ({ action: "write" } as const) : ({ action: "conflict" } as const)
}
