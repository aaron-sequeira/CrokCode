# YOLO Toggle + Terminal Tab Branding + crokcode Rename

Date: 2026-07-23
Status: Approved by user

## Overview

Three user-facing changes to the TUI (`packages/tui`):

1. A Shift+Tab toggle that switches permission handling between manual and auto-accept (the existing `--yolo` / `--auto` behavior), with an always-visible state indicator in the prompt bar between the agent name and the model name.
2. crokcode branding in the terminal tab title (`🐊 crokcode`), with a pixelated block animation appended while any session is busy.
3. Renaming all user-visible "CrokCode" brand texts in the TUI to crokcode.

## Background (existing mechanisms)

- `packages/tui/src/context/permission.tsx` already holds `mode: "auto" | "normal"`, seeded from CLI args (`--yolo`, `--auto`, `--dangerously-skip-permissions` in `packages/crokcode/src/cli/cmd/tui.ts`), with `set()` and `toggle()`.
- `packages/tui/src/context/sync.tsx` (`permission.asked` handler, ~line 190) auto-replies `"once"` when `permission.mode === "auto"`. Toggling the mode therefore takes effect live; no server changes needed.
- `packages/tui/src/app.tsx` already registers a `permission.mode` palette command (~line 947) that calls `local.permission.toggle()`. It has no keybind.
- The prompt footer (`packages/tui/src/component/prompt/index.tsx` ~line 1449) shows the text `auto` next to the agent name only when mode is `"auto"`.
- Terminal title is set in `packages/tui/src/app.tsx` (~lines 452–476) via `renderer.setTerminalTitle(...)`, currently `"CrokCode"` / `"OC | <title>"`, gated by the `terminal_title_enabled` kv key and `Flag.CROKCODE_DISABLE_TERMINAL_TITLE`.
- Busy state is available as `sync.data.session_status[sessionID].type` (`"busy"` / `"retry"` / `"idle"`).
- croc pixel mascot + wordmark already exist (`packages/tui/src/logo.ts`, `component/logo.tsx`); brand green is `#a7d129`.

## Feature 1: Shift+Tab auto-accept toggle

### Keybind changes (`packages/tui/src/config/keybind.ts`)

- Add definition: `permission_mode_toggle: keybind("shift+tab", "Toggle auto-accept permissions")`.
- Add to `CommandMap`: `permission_mode_toggle: "permission.mode"`.
- Change `agent_cycle_reverse` default from `"shift+tab"` to `"none"` (removes the conflict; Tab still cycles agents forward; with the two default agents build/plan, forward cycle is equivalent).

### App wiring (`packages/tui/src/app.tsx`)

- Add `"permission.mode"` to `appBindingCommands` so the keybind is active app-wide.

### Footer indicator (`packages/tui/src/component/prompt/index.tsx`)

Replace the conditional `auto` text (current lines ~1449–1451) with an always-visible state, positioned between the agent name and the `·` model separator:

- mode `"normal"`: `Build · manual · Kimi K3 CrokGo` — "manual" in `theme.textMuted`
- mode `"auto"`: `Build · auto accept · Kimi K3 CrokGo` — "auto accept" in brand green (`#a7d129`)

Styling follows the existing fade-in pattern (`fadeColor(..., agentMetaAlpha())`), and the indicator hides in shell mode like the current `auto` text.

### Behavior

- Toggling is runtime-only (not persisted), matching `--yolo` semantics today.
- The existing palette command title ("Enable/Disable auto-approve permissions") already reflects current state.

## Feature 2: Terminal tab title + pixel animation

In `packages/tui/src/app.tsx`, replace the terminal-title effect:

- home route: `🐊 crokcode`
- session route: `🐊 crokcode | <title>` (title truncated at 40 chars as today); default/untitled sessions fall back to `🐊 crokcode`
- plugin route: `🐊 crokcode | <id>`

Animation: while any value in `sync.data.session_status` has `type === "busy"` or `type === "retry"`, append a cycling pixel-block frame to the title:

- frames: `["░", "▒", "▓", "█", "▓", "▒"]` (pulse in and out)
- interval: ~150ms per frame, driven by a `setInterval` created only while busy; cleared and static title restored when idle
- the animation composes with the route-based title (e.g. `🐊 crokcode | fix login bug ▒`)

Existing gates are preserved: `terminal_title_enabled` kv, `CROKCODE_DISABLE_TERMINAL_TITLE`, and the `terminal.title.toggle` command.

## Feature 3: Rename visible "CrokCode" texts

| File | Current | New |
|---|---|---|
| `feature-plugins/sidebar/footer.tsx` | `• CrokCode <version>` brand line | `• crokcode <version>` — green dot kept; "crok" in brand green, "code" in bold text color (mirrors the logo) |
| `feature-plugins/sidebar/footer.tsx` | "CrokCode includes free models so you can start immediately." | "crokcode includes free models so you can start immediately." |
| `feature-plugins/home/tips-view.tsx` | "Create a plugin to prevent CrokCode from reading sensitive files" | "...prevent crokcode from reading..." |
| `feature-plugins/home/tips-view.tsx` | "Run `crokcode serve` for headless API access to CrokCode" | "Run `crokcode serve` for headless API access to crokcode" |
| `feature-plugins/home/tips-view.tsx` | "Use `/connect` with OpenCode Zen for curated, tested models" | **unchanged** — "OpenCode Zen" is the same external product name excepted below |
| `feature-plugins/home/tips-view.tsx` | stale CLI commands `crokcode run`, `crokcode --continue`, `crokcode run -f`, `crokcode run --attach`, `crokcode upgrade`, `crokcode auth list`, `crokcode agent create`, `crokcode github install`, `crokcode debug config` (binary is `crokcode`) | `crokcode …` equivalents |
| `feature-plugins/home/tips-view.tsx` | `/crokcode`, `/oc` GitHub triggers, `ghcr.io/anomalyco/opencode` docker tip, `.crokcode/tools/`, `.crokcode/plugins/`, `.crokcode/themes/` paths | **unchanged** (external integration names / real config paths) |
| `routes/session/permission.tsx` | "until CrokCode is restarted" (x2), "Tell CrokCode what to do differently" | crokcode |
| `app.tsx` | "Successfully updated to CrokCode v…" toast | crokcode |
| `attention.ts` | sound pack name "CrokCode Default" | "crokcode Default" |
| `component/dialog-provider.tsx` | "OpenCode Zen" / "OpenCode Go" product descriptions + opencode.ai links | **unchanged** — real third-party product names (user was informed and approved the design containing this exception) |

## Testing

- `bun typecheck` from `packages/tui` (never `tsc` directly).
- Manual verification via dev TUI in tmux (`tmux new-session -d -s crokcode-dev 'bun dev'` from `packages/crokcode`, capture with `tmux capture-pane -pt crokcode-dev`, kill after):
  - Shift+Tab flips footer between `manual` and `auto accept`; palette command still works.
  - Tab title shows `🐊 crokcode`; pixel pulse runs while a prompt is being processed, stops after.
  - Sidebar footer shows `• crokcode <version>`.

## Out of scope

- Persisting the toggle across restarts.
- Changes to the mini interface (`--mini`) / `run.ts`.
- Renaming external product/brand names (OpenCode Zen/Go, opencode.ai URLs, `/crokcode` GitHub app triggers, `.crokcode/` config dirs, docker image names).
