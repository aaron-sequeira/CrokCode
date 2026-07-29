import { FSUtil } from "@crokcode/core/fs-util"
import path from "path"
import { existsSync, lstatSync, readlinkSync, realpathSync } from "fs"

export type ResolvedWorkspaceFile = { ok: true; absolute: string } | { ok: false; reason: "escapes" }

/** Enough hops for any sane link chain; beyond it a loop is the likeliest explanation. */
const MAX_LINK_HOPS = 8

/**
 * The target of `candidate` if it is a symlink whose own target is missing.
 *
 * `existsSync` follows links, so it answers false for a dangling one and the
 * caller would mistake it for a path nobody has created yet. `lstat` is the only
 * call that sees the link itself.
 */
function danglingLinkTarget(candidate: string) {
  try {
    if (!lstatSync(candidate).isSymbolicLink()) return undefined
    return path.resolve(path.dirname(candidate), readlinkSync(candidate))
  } catch {
    return undefined
  }
}

/**
 * Resolve a client-supplied path against the workspace root, refusing anything
 * that lands outside it. Symlinks are followed at every level, so a link inside
 * the workspace pointing out of it is still caught, even if the leaf does not
 * exist yet. A path that does not exist yet resolves to its would-be location
 * under the realpath-resolved ancestor, which allows writing new files.
 */
export function resolveWorkspaceFile(directory: string, requestPath: string): ResolvedWorkspaceFile {
  return resolveWithinWorkspace(directory, requestPath, 0)
}

function resolveWithinWorkspace(directory: string, requestPath: string, hops: number): ResolvedWorkspaceFile {
  // A chain this long is a loop, not a real path. Refusing is the safe answer.
  if (hops > MAX_LINK_HOPS) return { ok: false, reason: "escapes" }

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

    // Not "missing" but "dangling": a write through this segment follows the
    // link, so containment has to be judged at the link's target instead.
    const target = danglingLinkTarget(current)
    if (target !== undefined) {
      const redirected = nonExistentSegments.reduce((p, seg) => path.join(p, seg), target)
      return resolveWithinWorkspace(directory, redirected, hops + 1)
    }

    nonExistentSegments.unshift(path.basename(current))
    current = path.dirname(current)
  }

  // Reached filesystem root; fall back to FSUtil.resolve for safety
  const absolute = FSUtil.resolve(fullPath)
  if (!FSUtil.contains(root, absolute)) return { ok: false, reason: "escapes" }
  return { ok: true, absolute }
}
