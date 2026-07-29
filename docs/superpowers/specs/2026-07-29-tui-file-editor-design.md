# Design: In-TUI file tree and editor

**Date:** 2026-07-29
**Status:** Approved, not yet planned
**One-line goal:** Press one key and CrokCode's terminal becomes a file browser and text editor over your project, so you can read and change code without leaving the session or shelling out to `$EDITOR`.

---

## Decisions taken (interview)

- **Q1 What happens on Enter?** → **Edit the file in the TUI.** Not a picker, not a viewer, not a file manager. Full cursor/type/save/undo.
- **Q2 Where does it live?** → **Full-screen mode, toggled.** A key swaps the terminal between chat and editor; no three-column squeeze on an 80-column terminal.
- **Q3 Agent edits a file you have open?** → **Reload if clean, ask if dirty.** Never silently lose typing, never hard-block the agent.
- **Q4 What is in v1?** → syntax highlighting, fuzzy open, send-to-prompt, and tree file ops — all four, built in stages.
- **Q5 Which approach?** → **A: new `system/editor` plugin sharing an extracted tree module.** Not growing diff-viewer, not duplicating the tree.
- **Q6 How does saving work?** → **Add a server write endpoint.** The editor must work wherever the TUI works, including against a remote server.
- **Q7 (implicit, from "make it look good and easy to use")** → visual and discoverability requirements are first-class, specified in §7.

---

## Current state (verified 2026-07-29)

- `@opentui/core` ships **`EditBuffer`** (native rope buffer: undo/redo, grapheme-aware editing, syntax-highlight ranges) and **`EditorView`** (viewport, scrolling, selection, word boundaries). The prompt's `TextareaRenderable` is built on them. *This feature mounts an existing editor primitive; it does not implement one.*
- `feature-plugins/system/diff-viewer.tsx` (1077 lines) already registers a full-screen plugin route via `api.route.register()` + `api.keymap.registerLayer()`, and already renders a navigable file tree (`diff-viewer-file-tree.tsx` + `-utils.ts`, 394 lines). It is the working template.
- Route types live in `context/route.tsx`; `PluginRoute = { type: "plugin", id, data }` is the full-screen mechanism.
- Server API has `file.list` (`GET /file`), `file.read` (`GET /file/content`), `file.status` — **no write endpoint**. Routes are Effect `HttpApi` with `Authorization` + `WorkspaceRoutingMiddleware`.
- `find.files` exists server-side (fuzzy path search, used by `dialog-tag.tsx`) — fuzzy open is wiring, not new search.
- TUI has mouse support (`useMouse`, `onMouseDown` used in `sidebar/files.tsx`) and a `which-key` plugin for key discoverability.
- `sidebar/files.tsx` lists *modified* files only; it is not a browsable tree and is not touched by this work.

---

## Architecture

A new feature-plugin registering one full-screen route and one keymap layer.

| File | Purpose |
|---|---|
| `feature-plugins/system/file-tree.tsx`, `file-tree-utils.ts` | generic tree extracted from diff-viewer's, consumed by both |
| `feature-plugins/system/editor/index.tsx` | route registration, keymap layer, two-pane layout |
| `feature-plugins/system/editor/buffer.ts` | EditBuffer lifecycle, dirty tracking, save, reload |
| `feature-plugins/system/editor/tree-source.ts` | lazy per-directory listing via `file.list` |
| `crokcode/src/server/routes/instance/httpapi/groups/file.ts` | new write endpoint |
| `tui/src/config/keybind.ts` | new rebindable bindings |

The only change to existing behavior is the tree extraction. Diff-viewer keeps what it does, feeding the shared tree a changed-file list; the editor feeds it directory entries.

### Tree module interface

One generic tree over `{ path, type: "file" | "directory", meta? }`. It owns expand/collapse state, keyboard selection, and rendering. Callers supply:

- **children** — a synchronous list (diff-viewer) or an async loader (editor)
- **row decoration** — a callback rendering trailing content per row (`+12 -3` for diffs, dirty dot for the editor)

It knows nothing about diffs or editing. If it grows a `mode` flag, the boundary is wrong.

### Buffer lifecycle and the dirty/reload machine

One `EditBuffer` per open file, held in a map so switching files preserves undo history. Per buffer: `savedText` (content as of last read or write), `mtime`, and `dirty = getText() !== savedText`.

On a session file-change event, or on regaining focus:

| Buffer state | Behavior |
|---|---|
| not dirty | re-read, `replaceText()` (stays undoable), cursor preserved by offset |
| dirty | banner: `session.ts changed on disk — [k]eep mine · [t]ake theirs · [d]iff`; buffer untouched until you choose |

Save writes, then sets `savedText` and `mtime` from the response. A stale `mtime` at save time raises the same banner instead of clobbering.

### Server write endpoint

`HttpApiEndpoint.put("write", "/file/content")` in the existing file group, body `{ path, content }`, returning the new `mtime`. It reuses `Authorization` and `WorkspaceRoutingMiddleware`, inheriting auth and workspace scoping.

**This is the one genuinely new attack surface in the feature.** It must:

- resolve the path and reject anything outside the workspace root **after `realpath`**, so a symlink cannot escape
- refuse to create files outside the workspace root
- reject paths that traverse (`../`) regardless of where they land

These rules get dedicated tests (§6). Do not simplify them away.

---

## Keymap

Active only inside the editor route, all rebindable via `Definitions` in `keybind.ts` (same pattern as `voice_dictate`).

| Key | Action |
|---|---|
| `^E` | toggle editor mode ↔ chat (global, the way in) |
| `^S` | save |
| `^P` | fuzzy open |
| `tab` | move focus tree ↔ editor |
| `^Z` / `^Y` | undo / redo (free from EditBuffer) |
| `esc` | one step back: from the editor pane, move focus to the tree; from the tree, leave to chat |
| `^Q` | leave to chat from anywhere |

Send-to-prompt and file ops get keys when those stages land.

---

## Look and feel

"Looks good and easy to use" as testable requirements, using what the TUI already has.

**Visual**

- Every color comes from the theme (`api.theme.current`) — no literals. The editor must be legible in all built-in themes, not just the default.
- The focused pane is unmistakable: active pane gets a highlighted border, the inactive one drops to `textMuted`. You should never have to press a key to discover where focus is.
- The header is a breadcrumb of the open path, with a `●` in the theme's accent when the buffer is dirty. Dirty state is visible without moving the cursor.
- Tree rows use the same `▾`/`▸` affordances the diff-viewer and sidebar already use, so it reads as the same product.
- Gutter line numbers in `textMuted`; the cursor line's number in `text`.

**Easy to use**

- A footer strip shows the live keys for the focused pane, driven by the same shortcut lookup the tips view uses, so rebound keys display correctly. `which-key` covers the rest.
- Mouse works: click a row to select, click a directory to expand, click into the editor to place the cursor, scroll wheel scrolls the focused pane. The TUI already supports mouse; an editor that ignores it feels broken.
- `esc` always goes back exactly one step (editor pane → tree → chat) and never discards buffer content. Leaving with unsaved changes keeps the buffer, so returning finds your work intact. No modal state a user can get stuck in.
- Opening a directory never blocks the UI — listings are async and per-directory, showing a placeholder row while loading. A large repo must not freeze the pane.
- The banner in §"dirty/reload" states the filename and offers exactly three labeled choices. No jargon, no silent resolution.

---

## Testing

| Unit | Test |
|---|---|
| Tree module | pure unit tests: expand, collapse, selection movement across nested nodes (utils are already pure) |
| Buffer machine | four transitions driven directly, no terminal: clean+external change, dirty+external change, save with stale mtime, save clean |
| Write endpoint | path confinement: `../` traversal, absolute path outside root, symlink pointing outside the workspace, and the happy path |
| Route | one smoke test mounting the route and opening a file |

TUI rendering beyond that smoke test is not worth deep tests.

---

## Build stages

Each stage is independently shippable; stopping after any of them leaves a working feature.

1. **Spine** — shared tree module, directory source, open/edit/save, write endpoint, dirty machine, keymap, focus and footer chrome. Usable alone.
2. **Highlight + fuzzy open** — `setSyntaxStyle`/`addHighlight` with the bundled grammars; `^P` over the existing `find.files`.
3. **Send to prompt** — current file or selection into the prompt, via the same `insertText` path dictation uses.
4. **Tree file ops** — create, rename, delete; each confirmed, each needing its own endpoint. The natural stopping point.

---

## Out of scope

- LSP diagnostics, completion, go-to-definition in the editor pane.
- Multi-cursor, macros, vim/emacs keybinding emulation.
- Split-pane editing of two files at once.
- Editing files outside the workspace root — deliberate, and enforced server-side.
- Replacing `/editor` (`$EDITOR` shell-out). It stays; this is an addition.

---

## Risks

- **The write endpoint is a write-anything API if path confinement is wrong.** Mitigated by §"Server write endpoint" rules plus dedicated tests. This is the one part of the feature where the lazy version is not acceptable.
- **Tree extraction could regress the diff viewer.** Mitigated by extracting behavior-preserving and leaning on the existing pure-util tests before wiring the editor to it.
- **EditBuffer is native (Zig).** A crash there takes the TUI down rather than throwing. Buffer operations need defensive handling at the boundary, and the smoke test exists to catch a mounting regression early.
- **Large directories** could make listing slow; per-directory lazy loading is the mitigation, not a full-repo walk at open.
