import { FSUtil } from "@crokcode/core/fs-util"
import path from "path"
import { existsSync, realpathSync } from "fs"

export type ResolvedWorkspaceFile = { ok: true; absolute: string } | { ok: false; reason: "escapes" }

/**
 * Resolve a client-supplied path against the workspace root, refusing anything
 * that lands outside it. Symlinks are followed at every level, so a link inside
 * the workspace pointing out of it is still caught, even if the leaf does not
 * exist yet. A path that does not exist yet resolves to its would-be location
 * under the realpath-resolved ancestor, which allows writing new files.
 */
export function resolveWorkspaceFile(directory: string, requestPath: string): ResolvedWorkspaceFile {
  const root = FSUtil.resolve(directory)
  const fullPath = path.resolve(directory, requestPath)

  // Walk up from the requested path to find the deepest existing ancestor.
  // Realpath that ancestor to resolve any symlinks, then rejoin with
  // non-existent segments. This ensures intermediate symlinks are caught.
  let current = fullPath
  const nonExistentSegments: string[] = []

  while (current !== path.dirname(current)) {
    if (existsSync(current)) {
      // Found an existing ancestor; realpath it to resolve symlinks
      const resolvedAncestor = realpathSync(current)
      // Rejoin non-existent segments
      const absolute = nonExistentSegments.reduce((p, seg) => path.join(p, seg), resolvedAncestor)
      if (!FSUtil.contains(root, absolute)) return { ok: false, reason: "escapes" }
      return { ok: true, absolute }
    }
    nonExistentSegments.unshift(path.basename(current))
    current = path.dirname(current)
  }

  // Reached filesystem root; fall back to FSUtil.resolve for safety
  const absolute = FSUtil.resolve(fullPath)
  if (!FSUtil.contains(root, absolute)) return { ok: false, reason: "escapes" }
  return { ok: true, absolute }
}
