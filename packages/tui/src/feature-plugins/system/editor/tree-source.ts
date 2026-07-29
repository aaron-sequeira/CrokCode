import type { FileTreeItem } from "../file-tree-utils"

export type DirectoryEntry = { path: string; type: "file" | "directory" }

// A trailing slash marks a directory, so buildFileTree still produces a node for
// a directory with nothing in it yet (or nothing loaded yet).
const DIRECTORY_MARK = "/"

export function mergeEntries(known: readonly string[], entries: readonly DirectoryEntry[]): string[] {
  const next = new Set(known)
  for (const entry of entries) next.add(entry.type === "directory" ? `${entry.path}${DIRECTORY_MARK}` : entry.path)
  return [...next].sort()
}

export function treeItems(paths: readonly string[]): FileTreeItem[] {
  return paths.map((path) => ({ file: path.endsWith(DIRECTORY_MARK) ? path.slice(0, -1) : path }))
}
