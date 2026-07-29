import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { resolveWorkspaceFile } from "../../src/server/routes/instance/httpapi/handlers/file-path"

function workspace() {
  const root = mkdtempSync(path.join(tmpdir(), "crok-ws-"))
  mkdirSync(path.join(root, "src"))
  writeFileSync(path.join(root, "src", "index.ts"), "export {}\n")
  return root
}

/**
 * Windows refuses plain symlinks without developer mode but allows junctions,
 * which are reparse points the same `lstat`/`readlink` calls see through. Trying
 * both keeps these cases running on a Windows dev box instead of silently
 * skipping the only tests that cover symlink confinement.
 */
function link(target: string, linkPath: string) {
  try {
    symlinkSync(target, linkPath)
    return true
  } catch {
    try {
      symlinkSync(target, linkPath, "junction")
      return true
    } catch {
      return false
    }
  }
}

test("a plain relative path inside the workspace resolves", () => {
  const root = workspace()
  const result = resolveWorkspaceFile(root, "src/index.ts")
  expect(result.ok).toBe(true)
})

test("a file that does not exist yet still resolves, so new files can be written", () => {
  const root = workspace()
  const result = resolveWorkspaceFile(root, "src/brand-new.ts")
  expect(result.ok).toBe(true)
})

test("traversal out of the workspace is rejected", () => {
  const root = workspace()
  expect(resolveWorkspaceFile(root, "../escaped.ts")).toEqual({ ok: false, reason: "escapes" })
  expect(resolveWorkspaceFile(root, "src/../../escaped.ts")).toEqual({ ok: false, reason: "escapes" })
})

test("an absolute path outside the workspace is rejected", () => {
  const root = workspace()
  const outside = path.join(tmpdir(), "definitely-outside.ts")
  expect(resolveWorkspaceFile(root, outside)).toEqual({ ok: false, reason: "escapes" })
})

test("a symlink pointing outside the workspace is rejected", () => {
  const root = workspace()
  const outsideDir = mkdtempSync(path.join(tmpdir(), "crok-outside-"))
  writeFileSync(path.join(outsideDir, "secret.txt"), "secret\n")
  if (!link(outsideDir, path.join(root, "link"))) return
  expect(resolveWorkspaceFile(root, "link/secret.txt")).toEqual({ ok: false, reason: "escapes" })
})

// `existsSync` follows symlinks, so a link whose target is missing reports
// false and looks like a plain not-yet-created file. Rejoined under the
// realpath'd parent it is judged contained, and the write then follows the link
// out of the workspace. The leaf itself has to be lstat'd, not just exists'd.
test("a dangling symlink whose target is outside the workspace is rejected", () => {
  const root = workspace()
  const outsideDir = mkdtempSync(path.join(tmpdir(), "crok-outside-"))
  // The target deliberately does not exist, so `existsSync` on the link is false
  // and the leaf looks like a file nobody has created yet.
  if (!link(path.join(outsideDir, "not-created-yet"), path.join(root, "evil.txt"))) return
  expect(resolveWorkspaceFile(root, "evil.txt")).toEqual({ ok: false, reason: "escapes" })
})

test("a dangling symlink pointing back inside the workspace still resolves", () => {
  const root = workspace()
  if (!link(path.join(root, "src", "not-created-yet"), path.join(root, "inside.txt"))) return
  expect(resolveWorkspaceFile(root, "inside.txt").ok).toBe(true)
})

test("a loop of dangling symlinks is rejected instead of hanging", () => {
  const root = workspace()
  if (!link(path.join(root, "b.txt"), path.join(root, "a.txt"))) return
  if (!link(path.join(root, "a.txt"), path.join(root, "b.txt"))) return
  expect(resolveWorkspaceFile(root, "a.txt")).toEqual({ ok: false, reason: "escapes" })
})

test("a symlink to a directory with a nonexistent leaf is rejected", () => {
  const root = workspace()
  const outsideDir = mkdtempSync(path.join(tmpdir(), "crok-outside-"))
  if (!link(outsideDir, path.join(root, "evil"))) return
  // Requesting a file that does not exist yet inside the symlinked directory
  // should still be rejected because the directory itself points outside
  expect(resolveWorkspaceFile(root, "evil/newfile.txt")).toEqual({ ok: false, reason: "escapes" })
})
