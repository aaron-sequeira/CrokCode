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
  try {
    symlinkSync(outsideDir, path.join(root, "link"))
  } catch {
    return // Windows without developer mode cannot create symlinks; the other cases still cover confinement
  }
  expect(resolveWorkspaceFile(root, "link/secret.txt")).toEqual({ ok: false, reason: "escapes" })
})
