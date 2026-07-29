# In-TUI File Tree and Editor — Implementation Plan (Stage 1: the spine)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Press `ctrl+e` and CrokCode's terminal becomes a two-pane file browser and text editor over the workspace, where you can open a file, edit it, and save it — without leaving the session.

**Architecture:** A new TUI feature-plugin registers a full-screen route and a keymap layer, exactly as `system/diff-viewer` does. The tree comes from diff-viewer's already-generic tree utils, renamed to a shared module. The text buffer is `EditBuffer` + `EditorView` from `@opentui/core` — the same native primitive the prompt is built on, so undo/redo, selection and grapheme handling are free. Saving goes through a new `PUT /file/content` server endpoint so the editor works against a remote server, not just a local one.

**Tech Stack:** TypeScript, SolidJS (via `@opentui/solid`), `@opentui/core` (`EditBuffer`, `EditorView`), Effect `HttpApi` on the server, `bun test`.

**Spec:** `docs/superpowers/specs/2026-07-29-tui-file-editor-design.md`

## Global Constraints

- **Colors come from the theme only.** Use `api.theme.current` / `useTheme()`. No color literals — the editor must be legible in every built-in theme.
- **Keybindings are rebindable.** Every key goes in `Definitions` in `packages/tui/src/config/keybind.ts` with a `CommandMap` entry, following the `voice_dictate` precedent. Never hardcode a key in a component.
- **Path confinement is not negotiable.** Every server path check resolves symlinks with `FSUtil.resolve` before comparing with `FSUtil.contains`. This rule has its own tests and does not get simplified.
- **Test the pure core, not the terminal.** Extract decisions into pure functions and unit-test those. TUI rendering gets exactly one smoke test.
- **Do not modify `sidebar/files.tsx`** — it lists modified files for the session and is unrelated to this feature.
- Run TUI tests with `cd packages/tui && bun test <path>`; server tests with `cd packages/crokcode && bun test <path>`. `bun test` from the repo root is blocked on purpose.
- Existing typecheck errors in `packages/crokcode` (`src/plugin/index.ts`, `src/tool/edit.ts`, `test/guard/guard.test.ts`, `test/tool/apply_patch.test.ts`, `test/tool/pentest.test.ts`) are pre-existing. Do not fix them, and do not treat them as caused by your change.

---

## File Structure

| File | Responsibility |
|---|---|
| `packages/tui/src/feature-plugins/system/file-tree-utils.ts` | **renamed** from `diff-viewer-file-tree-utils.ts` — generic tree building, flattening, selection |
| `packages/tui/src/feature-plugins/system/editor/tree-source.ts` | accumulate lazily-loaded directory listings into a path list |
| `packages/tui/src/feature-plugins/system/editor/buffer.ts` | pure dirty/reload/save decisions over a file buffer |
| `packages/tui/src/feature-plugins/system/editor/index.tsx` | route registration, keymap layer, two-pane layout, chrome |
| `packages/crokcode/src/server/routes/instance/httpapi/groups/file.ts` | `write` endpoint + `raw` read flag declarations |
| `packages/crokcode/src/server/routes/instance/httpapi/handlers/file.ts` | `write` handler, raw read |
| `packages/crokcode/src/server/routes/instance/httpapi/handlers/file-path.ts` | pure workspace path resolution/confinement |
| `packages/tui/src/config/keybind.ts` | new rebindable bindings |
| `packages/web/src/content/docs/keybinds.mdx` | document the new bindings |

---

### Task 1: Rename the tree utils into a shared module

The tree utils are already generic — they build a tree from a flat list of paths and know nothing about diffs. Only the filename and its test's filename say "diff-viewer". Rename so the editor can import them without implying it depends on the diff viewer.

**Files:**
- Rename: `packages/tui/src/feature-plugins/system/diff-viewer-file-tree-utils.ts` → `packages/tui/src/feature-plugins/system/file-tree-utils.ts`
- Rename: `packages/tui/test/feature-plugins/diff-viewer-file-tree-utils.test.ts` → `packages/tui/test/feature-plugins/file-tree-utils.test.ts`
- Modify: `packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx` (import path)
- Modify: `packages/tui/src/feature-plugins/system/diff-viewer.tsx` (import path)

**Interfaces:**
- Consumes: nothing.
- Produces: `packages/tui/src/feature-plugins/system/file-tree-utils.ts` exporting unchanged `FileTreeItem`, `FileTreeNode`, `FileTree`, `FileTreeRow`, `buildFileTree(files: readonly FileTreeItem[]): FileTree`, `flattenFileTree(tree, expanded?): FileTreeRow[]`, `moveFileTreeSelection(rows, selected, offset)`, `moveFileTreeSelectionToFirstChild`, `moveFileTreeSelectionToParent`, `toggleFileTreeDirectory(tree, expanded, selected)`, `allExpandedFileTreeDirectories(tree)`.

- [ ] **Step 1: Run the existing test to record the green baseline**

```bash
cd packages/tui && bun test test/feature-plugins/diff-viewer-file-tree-utils.test.ts
```

Expected: PASS. Note the number of tests — the same number must pass after the rename.

- [ ] **Step 2: Rename both files with git so history follows**

```bash
git mv packages/tui/src/feature-plugins/system/diff-viewer-file-tree-utils.ts packages/tui/src/feature-plugins/system/file-tree-utils.ts
git mv packages/tui/test/feature-plugins/diff-viewer-file-tree-utils.test.ts packages/tui/test/feature-plugins/file-tree-utils.test.ts
```

- [ ] **Step 3: Update the three import sites**

In `packages/tui/test/feature-plugins/file-tree-utils.test.ts`, `packages/tui/src/feature-plugins/system/diff-viewer-file-tree.tsx`, and `packages/tui/src/feature-plugins/system/diff-viewer.tsx`, change every occurrence of `diff-viewer-file-tree-utils` to `file-tree-utils`. Find them with:

```bash
grep -rn "diff-viewer-file-tree-utils" packages/tui
```

Expected after editing: no matches.

- [ ] **Step 4: Run the test and typecheck**

```bash
cd packages/tui && bun test test/feature-plugins/file-tree-utils.test.ts && bun run typecheck
```

Expected: same test count PASS, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add packages/tui
git commit -m "refactor(tui): rename file-tree utils out of the diff-viewer namespace"
```

---

### Task 2: Stop `file.read` trimming content

`content` in `handlers/file.ts:116` returns `text.value.trim()`. For a viewer that is harmless. For an editor it is **data loss**: open a file with a trailing newline or leading blank line, save it back, and the whitespace is gone. Add an opt-in `raw` flag rather than changing existing callers' behavior.

**Files:**
- Modify: `packages/crokcode/src/server/routes/instance/httpapi/groups/file.ts` (add `raw` to `FileQuery`)
- Modify: `packages/crokcode/src/server/routes/instance/httpapi/handlers/file.ts:96-125` (honor it)

**Interfaces:**
- Consumes: nothing.
- Produces: `GET /file/content?path=<p>&raw=true` returns the file byte-for-byte as text. Without `raw`, behavior is exactly as today (trimmed).

- [ ] **Step 1: Add the query field**

In `groups/file.ts`, change `FileQuery`:

```ts
export const FileQuery = Schema.Struct({
  ...WorkspaceRoutingQueryFields,
  path: Schema.String,
  raw: Schema.optional(Schema.Literals(["true", "false"])),
})
```

- [ ] **Step 2: Honor it in the handler**

In `handlers/file.ts`, change the `content` signature and the text branch:

```ts
    const content = Effect.fn("FileHttpApi.content")(function* (ctx: {
      query: { path: string; raw?: "true" | "false" }
    }) {
```

and, in the `Effect.map` that builds the result, replace `content: text.value.trim()` with:

```ts
            ? { type: "text" as const, content: ctx.query.raw === "true" ? text.value : text.value.trim() }
```

- [ ] **Step 3: Typecheck**

```bash
cd packages/crokcode && bun run typecheck
```

Expected: no NEW errors. The five pre-existing failures listed in Global Constraints remain; nothing in `handlers/file.ts` or `groups/file.ts` should appear.

- [ ] **Step 4: Commit**

```bash
git add packages/crokcode/src/server/routes/instance/httpapi
git commit -m "feat(server): add raw flag to file read so content round-trips"
```

---

### Task 3: Workspace path resolution, as a pure function

The write endpoint needs to reject any path that escapes the workspace, including via symlink. Put that decision in a pure function so it can be tested without an HTTP harness.

**Files:**
- Create: `packages/crokcode/src/server/routes/instance/httpapi/handlers/file-path.ts`
- Create: `packages/crokcode/test/server/file-path.test.ts`

**Interfaces:**
- Consumes: `FSUtil.resolve(p: string): string` and `FSUtil.contains(parent: string, child: string): boolean` from `@crokcode/core/fs-util`. `FSUtil.resolve` follows symlinks via `realpathSync` and falls back to the plain resolved path when the file does not exist yet (ENOENT) — which is what lets a *new* file inside the workspace resolve.
- Produces: `resolveWorkspaceFile(directory: string, requestPath: string): { ok: true; absolute: string } | { ok: false; reason: "escapes" }`, used by Task 4.

- [ ] **Step 1: Write the failing test**

Create `packages/crokcode/test/server/file-path.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/crokcode && bun test test/server/file-path.test.ts
```

Expected: FAIL — cannot resolve module `file-path`.

- [ ] **Step 3: Write the implementation**

Create `packages/crokcode/src/server/routes/instance/httpapi/handlers/file-path.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

```bash
cd packages/crokcode && bun test test/server/file-path.test.ts
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/crokcode/src/server/routes/instance/httpapi/handlers/file-path.ts packages/crokcode/test/server/file-path.test.ts
git commit -m "feat(server): workspace path confinement helper with symlink escape tests"
```

---

### Task 4: The `PUT /file/content` write endpoint

**Files:**
- Modify: `packages/crokcode/src/server/routes/instance/httpapi/groups/file.ts` (payload schema, endpoint, path)
- Modify: `packages/crokcode/src/server/routes/instance/httpapi/handlers/file.ts` (handler + registration)

**Interfaces:**
- Consumes: `resolveWorkspaceFile` from Task 3.
- Produces: `PUT /file/content` with body `{ path: string; content: string }` returning `{ mtime: number }`. Reachable from the TUI as `sdk.client.file.write({ path, content, workspace })` after SDK regeneration.

- [ ] **Step 1: Declare the payload and success schemas**

In `groups/file.ts`, after `LegacyContent`, add:

```ts
export const FileWritePayload = Schema.Struct({
  path: Schema.String,
  content: Schema.String,
})

export const FileWriteResult = Schema.Struct({
  mtime: NonNegativeInt,
}).annotate({ identifier: "FileWriteResult" })
```

- [ ] **Step 2: Add the endpoint**

In the same file, immediately after the `HttpApiEndpoint.get("content", ...)` block and before `HttpApiEndpoint.get("status", ...)`, add:

```ts
        HttpApiEndpoint.put("write", FilePaths.content, {
          urlParams: WorkspaceRoutingQuery,
          payload: FileWritePayload,
          success: described(FileWriteResult, "Write result"),
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "file.write",
            summary: "Write file",
            description: "Write content to a file inside the workspace.",
          }),
        ),
```

- [ ] **Step 3: Write the handler**

In `handlers/file.ts`, import the helper at the top:

```ts
import { resolveWorkspaceFile } from "./file-path"
```

Add the handler next to `content`:

```ts
    const write = Effect.fn("FileHttpApi.write")(function* (ctx: {
      payload: { path: string; content: string }
    }) {
      const directory = (yield* InstanceState.context).directory
      const resolved = resolveWorkspaceFile(directory, ctx.payload.path)
      if (!resolved.ok) return yield* Effect.die(new Error("Path escapes the workspace"))
      yield* Effect.tryPromise({
        try: () => Bun.write(resolved.absolute, ctx.payload.content),
        catch: (cause) => new Error(`Could not write ${ctx.payload.path}`, { cause }),
      }).pipe(Effect.orDie)
      const stat = yield* Effect.sync(() => Bun.file(resolved.absolute).lastModified)
      return { mtime: stat }
    })
```

- [ ] **Step 4: Register it**

In the returned handler chain, add `.handle("write", write)` after `.handle("content", content)`.

- [ ] **Step 5: Typecheck**

```bash
cd packages/crokcode && bun run typecheck
```

Expected: no new errors beyond the five pre-existing ones.

- [ ] **Step 6: Regenerate the SDK so the TUI can call it**

```bash
bun run script/generate.ts
```

Expected: `packages/sdk/js/src/v2/gen/sdk.gen.ts` now contains a `write` operation for `/file/content`. Verify:

```bash
grep -n "FileWrite" packages/sdk/js/src/v2/gen/sdk.gen.ts
```

Expected: matches found.

- [ ] **Step 7: Commit**

```bash
git add packages/crokcode/src/server packages/sdk
git commit -m "feat(server): add PUT /file/content so the TUI can save files"
```

---

### Task 5: Tree source — lazy directory listing

`buildFileTree` takes a flat list of paths. The editor accumulates paths as directories are expanded, then rebuilds. Rebuilding is cheap and keeps all tree state in one place.

**Files:**
- Create: `packages/tui/src/feature-plugins/system/editor/tree-source.ts`
- Create: `packages/tui/test/feature-plugins/editor-tree-source.test.ts`

**Interfaces:**
- Consumes: `FileTreeItem` from `file-tree-utils` (Task 1).
- Produces: `mergeEntries(known: readonly string[], entries: readonly { path: string; type: "file" | "directory" }[]): string[]` and `treeItems(paths: readonly string[]): FileTreeItem[]`, used by Task 7.

- [ ] **Step 1: Write the failing test**

Create `packages/tui/test/feature-plugins/editor-tree-source.test.ts`:

```ts
import { expect, test } from "bun:test"
import { mergeEntries, treeItems } from "../../src/feature-plugins/system/editor/tree-source"

test("merging keeps paths unique and sorted", () => {
  const merged = mergeEntries(["src/b.ts"], [
    { path: "src/a.ts", type: "file" },
    { path: "src/b.ts", type: "file" },
  ])
  expect(merged).toEqual(["src/a.ts", "src/b.ts"])
})

test("a directory contributes a trailing-slash marker so empty directories still show", () => {
  const merged = mergeEntries([], [{ path: "src/empty", type: "directory" }])
  expect(merged).toEqual(["src/empty/"])
})

test("expanding a second directory does not drop the first one's files", () => {
  const first = mergeEntries([], [{ path: "src/a.ts", type: "file" }])
  const second = mergeEntries(first, [{ path: "test/b.ts", type: "file" }])
  expect(second).toEqual(["src/a.ts", "test/b.ts"])
})

test("tree items strip the directory marker", () => {
  expect(treeItems(["src/empty/", "src/a.ts"])).toEqual([{ file: "src/empty" }, { file: "src/a.ts" }])
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/tui && bun test test/feature-plugins/editor-tree-source.test.ts
```

Expected: FAIL — cannot resolve module `tree-source`.

- [ ] **Step 3: Write the implementation**

Create `packages/tui/src/feature-plugins/system/editor/tree-source.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

```bash
cd packages/tui && bun test test/feature-plugins/editor-tree-source.test.ts
```

Expected: 4 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/feature-plugins/system/editor/tree-source.ts packages/tui/test/feature-plugins/editor-tree-source.test.ts
git commit -m "feat(tui): lazy directory source for the editor tree"
```

---

### Task 6: Buffer state — the dirty/reload machine

The rule from the spec: **reload if clean, ask if dirty**, and never clobber on a stale save. Keep the decision pure; the EditBuffer wiring in Task 7 is a thin shell around it.

**Files:**
- Create: `packages/tui/src/feature-plugins/system/editor/buffer.ts`
- Create: `packages/tui/test/feature-plugins/editor-buffer.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `type BufferState = { savedText: string; mtime: number }`
  - `isDirty(state: BufferState, currentText: string): boolean`
  - `onExternalChange(state: BufferState, currentText: string, disk: { text: string; mtime: number }): { action: "none" } | { action: "reload"; text: string; mtime: number } | { action: "conflict" }`
  - `beforeSave(state: BufferState, disk: { mtime: number }): { action: "write" } | { action: "conflict" }`
  used by Task 7.

- [ ] **Step 1: Write the failing test**

Create `packages/tui/test/feature-plugins/editor-buffer.test.ts`:

```ts
import { expect, test } from "bun:test"
import { beforeSave, isDirty, onExternalChange } from "../../src/feature-plugins/system/editor/buffer"

const state = { savedText: "one\n", mtime: 1000 }

test("a buffer matching what was saved is not dirty", () => {
  expect(isDirty(state, "one\n")).toBe(false)
  expect(isDirty(state, "one changed\n")).toBe(true)
})

test("a clean buffer reloads when the agent edits the file", () => {
  expect(onExternalChange(state, "one\n", { text: "agent wrote this\n", mtime: 2000 })).toEqual({
    action: "reload",
    text: "agent wrote this\n",
    mtime: 2000,
  })
})

test("a dirty buffer asks instead of reloading, so typing is never lost", () => {
  expect(onExternalChange(state, "my edits\n", { text: "agent wrote this\n", mtime: 2000 })).toEqual({
    action: "conflict",
  })
})

test("an event that carries no actual change does nothing, dirty or not", () => {
  expect(onExternalChange(state, "one\n", { text: "one\n", mtime: 1000 })).toEqual({ action: "none" })
  expect(onExternalChange(state, "my edits\n", { text: "one\n", mtime: 1000 })).toEqual({ action: "none" })
})

test("saving over a file that changed underneath us conflicts instead of clobbering", () => {
  expect(beforeSave(state, { mtime: 1000 })).toEqual({ action: "write" })
  expect(beforeSave(state, { mtime: 2000 })).toEqual({ action: "conflict" })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/tui && bun test test/feature-plugins/editor-buffer.test.ts
```

Expected: FAIL — cannot resolve module `buffer`.

- [ ] **Step 3: Write the implementation**

Create `packages/tui/src/feature-plugins/system/editor/buffer.ts`:

```ts
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
```

- [ ] **Step 4: Run the tests**

```bash
cd packages/tui && bun test test/feature-plugins/editor-buffer.test.ts
```

Expected: 5 pass.

- [ ] **Step 5: Commit**

```bash
git add packages/tui/src/feature-plugins/system/editor/buffer.ts packages/tui/test/feature-plugins/editor-buffer.test.ts
git commit -m "feat(tui): dirty and reload rules for editor buffers"
```

---

### Task 7: The editor route

Two panes, focus handling, chrome, and the keymap layer. Follows `system/diff-viewer.tsx`'s registration shape exactly.

**Files:**
- Create: `packages/tui/src/feature-plugins/system/editor/index.tsx`
- Modify: `packages/tui/src/feature-plugins/builtins.ts`
- Create: `packages/tui/test/feature-plugins/editor-route.test.tsx`

**Interfaces:**
- Consumes: `buildFileTree`, `flattenFileTree`, `moveFileTreeSelection`, `toggleFileTreeDirectory` from `../file-tree-utils` (Task 1); `mergeEntries`, `treeItems` from `./tree-source` (Task 5); `isDirty`, `onExternalChange`, `beforeSave`, `BufferState` from `./buffer` (Task 6); `sdk.client.file.list`, `file.read` with `raw: "true"` (Task 2), `file.write` (Task 4).
- Produces: a plugin module default-exporting `{ id: "editor", tui }`, registering route name `editor` and command `editor.open`.

- [ ] **Step 1: Write the failing smoke test**

Create `packages/tui/test/feature-plugins/editor-route.test.tsx`:

```tsx
import { expect, test } from "bun:test"
import plugin from "../../src/feature-plugins/system/editor"

test("the editor plugin registers a route and an open command", async () => {
  const routes: string[] = []
  const commands: string[] = []
  const api = {
    route: { register: (list: { name: string }[]) => routes.push(...list.map((item) => item.name)) },
    keymap: { registerLayer: (layer: { commands: { name: string }[] }) => commands.push(...layer.commands.map((c) => c.name)) },
  }
  await plugin.tui(api as never, undefined, {} as never)
  expect(routes).toContain("editor")
  expect(commands).toContain("editor.open")
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/tui && bun test test/feature-plugins/editor-route.test.tsx
```

Expected: FAIL — cannot resolve module `system/editor`.

- [ ] **Step 3: Write the component and registration**

Create `packages/tui/src/feature-plugins/system/editor/index.tsx`. Read `packages/tui/src/feature-plugins/system/diff-viewer.tsx` lines 1045-1077 first and mirror its registration shape. The component must satisfy these, all from the spec:

- Two panes: tree left (fixed ~30 columns), editor right (fills). The focused pane's border uses `theme().text`; the unfocused one `theme().textMuted`.
- Header: the open file's path, plus `●` in `theme().warning` when `isDirty(...)` is true.
- Footer: live key hints for the focused pane, resolved through `useCommandShortcut` so rebound keys display correctly — copy the pattern from `feature-plugins/home/tips-view.tsx`.
- Gutter line numbers in `theme().textMuted`, the cursor's line in `theme().text`.
- Tree rows reuse the `▾`/`▸` markers already used by `diff-viewer-file-tree.tsx`.
- Expanding a directory calls `sdk.client.file.list({ path, workspace })`, feeds the result through `mergeEntries`, and rebuilds via `treeItems` + `buildFileTree`. While a directory's listing is in flight, render a `theme().textMuted` `loading…` row beneath it — never block.
- Opening a file calls `file.read` with `raw: "true"`, creates an `EditBuffer` via `EditBuffer.create(...)` and an `EditorView`, stores `BufferState` from the response, and keeps the buffer in a `Map<string, ...>` keyed by path so returning to a file keeps its undo history.
- `^S` runs `beforeSave`; on `write` it calls `file.write` and updates `BufferState` from the response; on `conflict` it shows the banner.
- The session file-change event runs `onExternalChange`; `reload` calls `buffer.replaceText(text)` (undoable) and restores the cursor by offset; `conflict` shows the banner.
- The banner reads `<name> changed on disk` with three labeled choices: `[k]eep mine`, `[t]ake theirs`, `[d]iff`. `keep mine` clears the banner and leaves the buffer; `take theirs` calls `replaceText` with the disk text; `diff` navigates to the diff-viewer route for that file.
- Mouse: `onMouseDown` on a tree row selects it and toggles a directory (copy the handler shape from `sidebar/files.tsx`); clicking the editor pane focuses it.
- `onCleanup` destroys every `EditorView` and `EditBuffer` in the map. These are native handles — leaking them leaks memory outside the JS heap.

- [ ] **Step 4: Register the plugin**

In `packages/tui/src/feature-plugins/builtins.ts`, add `import Editor from "./system/editor"` beside the `DiffViewer` import, and add `Editor` to the array returned by `createBuiltinPlugins`, after `DiffViewer`.

- [ ] **Step 5: Run the smoke test and typecheck**

```bash
cd packages/tui && bun test test/feature-plugins/editor-route.test.tsx && bun run typecheck
```

Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add packages/tui/src/feature-plugins
git commit -m "feat(tui): file tree and editor route"
```

---

### Task 8: Bindings and documentation

**Files:**
- Modify: `packages/tui/src/config/keybind.ts`
- Modify: `packages/web/src/content/docs/keybinds.mdx`
- Create: `packages/tui/test/editor-keybind.test.ts`

**Interfaces:**
- Consumes: the `editor.open` command from Task 7.
- Produces: `editor_open`, `editor_save`, `editor_focus_next`, `editor_close` definitions.

- [ ] **Step 1: Write the failing test**

Create `packages/tui/test/editor-keybind.test.ts`. Read `packages/tui/test/voice-keybind.test.tsx` first and follow its shape:

```ts
import { expect, test } from "bun:test"
import { CommandMap, Definitions } from "../src/config/keybind"

test("the editor bindings exist and map to editor commands", () => {
  expect(Definitions.editor_open).toBeDefined()
  expect(CommandMap.editor_open).toBe("editor.open")
  expect(CommandMap.editor_save).toBe("editor.save")
})

test("every editor binding has a command", () => {
  for (const name of Object.keys(Definitions)) {
    if (!name.startsWith("editor_")) continue
    expect(CommandMap[name as keyof typeof CommandMap]).toBeTruthy()
  }
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
cd packages/tui && bun test test/editor-keybind.test.ts
```

Expected: FAIL — `Definitions.editor_open` is undefined.

- [ ] **Step 3: Add the definitions**

In `packages/tui/src/config/keybind.ts`, beside the `voice_dictate` block, add:

```ts
  // The editor's own keys only bind inside the editor route's keymap layer;
  // editor_open is the one that works from anywhere.
  editor_open: keybind("ctrl+e", "Open the file tree and editor"),
  editor_save: keybind("ctrl+s", "Save the open file"),
  editor_focus_next: keybind("tab", "Move focus between tree and editor"),
  editor_close: keybind("ctrl+q", "Leave the editor"),
```

and in `CommandMap`:

```ts
  editor_open: "editor.open",
  editor_save: "editor.save",
  editor_focus_next: "editor.focus.next",
  editor_close: "editor.close",
```

- [ ] **Step 4: Run the test**

```bash
cd packages/tui && bun test test/editor-keybind.test.ts
```

Expected: 2 pass.

- [ ] **Step 5: Document the keys**

In `packages/web/src/content/docs/keybinds.mdx`, in the JSON block, beside `"voice_dictate"`, add:

```
    "editor_open": "ctrl+e",
    "editor_save": "ctrl+s",
    "editor_focus_next": "tab",
    "editor_close": "ctrl+q",
```

- [ ] **Step 6: Run the whole TUI suite for regressions**

```bash
cd packages/tui && bun test
```

Expected: no failures introduced by this work. The `entities`/htmlparser2 harness break noted in the spec's risks is pre-existing — if it appears, it is not yours.

- [ ] **Step 7: Commit**

```bash
git add packages/tui packages/web
git commit -m "feat(tui): rebindable editor keys, documented"
```

---

## Follow-on plans

These are stages 2-4 from the spec. Each gets its own plan once the spine is in your hands and you know how it actually feels to use.

- **Stage 2 — Syntax highlighting + fuzzy open.** `EditBuffer.setSyntaxStyle` / `addHighlight` with the grammars already bundled for the diff viewer; `ctrl+p` over the existing `find.files`.
- **Stage 3 — Send to prompt.** Current file or selection into the prompt, through the same `input.insertText` path dictation uses.
- **Stage 4 — Tree file ops.** Create, rename, delete; each confirmed, each needing its own endpoint and its own path-confinement tests.

---

## Self-review

**Spec coverage:** Architecture → Tasks 1, 5, 6, 7. Tree module interface → Tasks 1, 5. Buffer lifecycle and dirty/reload machine → Tasks 6, 7. Server write endpoint → Tasks 3, 4. Keymap → Task 8. Look and feel → Task 7 step 3 (every bullet from the spec's §"Look and feel" appears as a requirement). Testing → Tasks 3, 5, 6, 7, 8 match the spec's testing table. Stages 2-4 → deferred to follow-on plans, as agreed.

**Gap found and closed:** the spec assumed `file.read` round-trips content. It does not — it trims. Task 2 was added to fix that before anything reads a file for editing.

**Type consistency:** `BufferState`, `isDirty`, `onExternalChange`, `beforeSave` are defined in Task 6 and consumed under those exact names in Task 7. `mergeEntries`/`treeItems` defined in Task 5, consumed in Task 7. `resolveWorkspaceFile` defined in Task 3, consumed in Task 4. `FileTreeItem` produced by Task 1, consumed by Task 5.
