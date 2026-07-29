import { FSUtil } from "@crokcode/core/fs-util"
import path from "path"

export type ResolvedWorkspaceFile = { ok: true; absolute: string } | { ok: false; reason: "escapes" }

/**
 * Resolve a client-supplied path against the workspace root, refusing anything
 * that lands outside it. Symlinks are followed first (FSUtil.resolve calls
 * realpath), so a link inside the workspace pointing out of it is still caught.
 * A path that does not exist yet resolves to its would-be location, which is
 * what allows writing new files.
 */
export function resolveWorkspaceFile(directory: string, requestPath: string): ResolvedWorkspaceFile {
  const root = FSUtil.resolve(directory)
  const absolute = FSUtil.resolve(path.resolve(directory, requestPath))
  if (!FSUtil.contains(root, absolute)) return { ok: false, reason: "escapes" }
  return { ok: true, absolute }
}
