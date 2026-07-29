# YOLO Toggle + Terminal Tab Branding + crokcode Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Shift+Tab manual/auto-accept toggle with an always-visible prompt-bar indicator, brand the terminal tab title as `🐊 crokcode` with a pixel-block animation while the agent works, and rename all user-visible "CrokCode" texts in the TUI to crokcode.

**Architecture:** All changes are in the SolidJS TUI (`packages/tui`). The permission auto-approve machinery already exists (`context/permission.tsx` + `sync.tsx` + palette command `permission.mode`); this plan binds it to Shift+Tab, makes its state always visible, rebrands the terminal title effect in `app.tsx`, and rewords user-visible strings. No server/SDK changes.

**Tech Stack:** SolidJS (opentui), Bun test, TypeScript.

**Spec:** `docs/superpowers/specs/2026-07-23-yolo-toggle-branding-design.md`

## Global Constraints

- Run tests and typecheck from `packages/tui`, NEVER from the repo root (`bun test`, `bun typecheck`).
- Brand green is `#a7d129` (`RGBA.fromHex("#a7d129")`), matching `packages/tui/src/component/logo.tsx`.
- Terminal title frames, in order: `["░", "▒", "▓", "█", "▓", "▒"]`, 150ms interval.
- Do NOT rename: "OpenCode Zen" / "OpenCode Go" product descriptions and opencode.ai links in `component/dialog-provider.tsx`, the `OpenCode Zen` tip in `tips-view.tsx`, `/crokcode` and `/oc` GitHub trigger tips, `ghcr.io/anomalyco/opencode` docker tip, `.crokcode/` config paths.
- Commits: repo policy requires explicit user confirmation before any `git commit`. Ask before each commit step.
- Branch: work on current branch; do not create/push branches without asking.

---

### Task 1: Shift+Tab keybind for permission.mode

**Files:**
- Modify: `packages/tui/src/config/keybind.ts` (Definitions ~line 130, CommandMap ~line 337)
- Modify: `packages/tui/src/app.tsx` (`appBindingCommands` ~line 106)
- Test: `packages/tui/test/keybind-defaults.test.ts` (create)

**Interfaces:**
- Consumes: existing palette command `permission.mode` registered in `app.tsx` (~line 947) which calls `local.permission.toggle()`.
- Produces: keybind definition `permission_mode_toggle` (default `"shift+tab"`) mapped via `TuiKeybind.CommandMap` to command `"permission.mode"`; `agent_cycle_reverse` default becomes `"none"`.

- [ ] **Step 1: Write the failing test**

Create `packages/tui/test/keybind-defaults.test.ts`:

```ts
import { expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"

test("shift+tab toggles auto-accept permissions by default", () => {
  const keybinds = TuiKeybind.parse({})
  expect(keybinds.permission_mode_toggle).toBe("shift+tab")
  expect(TuiKeybind.CommandMap.permission_mode_toggle).toBe("permission.mode")
})

test("agent reverse cycle is unbound by default", () => {
  const keybinds = TuiKeybind.parse({})
  expect(keybinds.agent_cycle_reverse).toBe("none")
})
```

- [ ] **Step 2: Run test to verify it fails**

Run from `packages/tui`: `bun test test/keybind-defaults.test.ts`
Expected: FAIL — `keybinds.permission_mode_toggle` is `undefined` (definition does not exist yet).

- [ ] **Step 3: Implement the keybind changes**

In `packages/tui/src/config/keybind.ts`, in `Definitions`, change line 131 and add the new definition right after it:

```ts
  agent_cycle: keybind("tab", "Next agent"),
  agent_cycle_reverse: keybind("none", "Previous agent"),
  permission_mode_toggle: keybind("shift+tab", "Toggle auto-accept permissions"),
```

In `CommandMap`, after `agent_cycle_reverse: "agent.cycle.reverse",` add:

```ts
  permission_mode_toggle: "permission.mode",
```

In `packages/tui/src/app.tsx`, in `appBindingCommands` (~line 106, the array containing `"agent.cycle"`, `"agent.cycle.reverse"`, …), add `"permission.mode"` after `"agent.cycle.reverse"`:

```ts
  "agent.cycle",
  "agent.cycle.reverse",
  "permission.mode",
```

- [ ] **Step 4: Run test to verify it passes**

Run from `packages/tui`: `bun test test/keybind-defaults.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Run existing keymap/config tests and typecheck**

Run from `packages/tui`: `bun test test/keymap.test.tsx test/config.test.tsx` then `bun typecheck`
Expected: all PASS, no type errors.

- [ ] **Step 6: Commit (ask user first)**

```bash
git add packages/tui/src/config/keybind.ts packages/tui/src/app.tsx packages/tui/test/keybind-defaults.test.ts
git commit -m "feat(tui): bind shift+tab to toggle auto-accept permissions"
```

---

### Task 2: Always-visible auto/manual indicator in the prompt bar

**Files:**
- Modify: `packages/tui/src/component/prompt/index.tsx` (footer ~lines 1449–1451; helper ~line 111)

**Interfaces:**
- Consumes: `local.permission.mode` (`"auto" | "normal"`, reactive getter from `context/permission.tsx` via `useLocal()`), existing `fadeColor(color: RGBA, alpha: number)` helper (line 111) and `agentMetaAlpha()` signal. `RGBA` is already imported (line 3).
- Produces: footer renders `Agent · manual · Model Provider` or `Agent · auto accept · Model Provider`.

- [ ] **Step 1: Add the brand green constant**

In `packages/tui/src/component/prompt/index.tsx`, directly above the `fadeColor` function (~line 111), add:

```ts
const GREEN = RGBA.fromHex("#a7d129")
```

- [ ] **Step 2: Replace the conditional "auto" indicator**

Replace these lines (~1449–1451):

```tsx
                      <Show when={store.mode === "normal" && local.permission.mode === "auto"}>
                        <text fg={fadeColor(theme.textMuted, agentMetaAlpha())}>auto</text>
                      </Show>
```

with:

```tsx
                      <Show when={store.mode === "normal"}>
                        <text fg={fadeColor(theme.textMuted, agentMetaAlpha())}>·</text>
                        <Show
                          when={local.permission.mode === "auto"}
                          fallback={<text fg={fadeColor(theme.textMuted, agentMetaAlpha())}>manual</text>}
                        >
                          <text fg={fadeColor(GREEN, agentMetaAlpha())}>auto accept</text>
                        </Show>
                      </Show>
```

- [ ] **Step 3: Typecheck**

Run from `packages/tui`: `bun typecheck`
Expected: no errors.

- [ ] **Step 4: Visual verification**

Start the dev TUI in tmux from `packages/crokcode`: `tmux new-session -d -s crokcode-dev 'bun dev'`
Capture with `tmux capture-pane -pt crokcode-dev` and confirm the prompt bar shows `Build · manual · …`. Stop with `tmux kill-session -t crokcode-dev`.
(Interactive Shift+Tab flip is verified manually by the user; Task 1's test covers the binding.)

- [ ] **Step 5: Commit (ask user first)**

```bash
git add packages/tui/src/component/prompt/index.tsx
git commit -m "feat(tui): always show manual/auto-accept state in prompt bar"
```

---

### Task 3: Terminal tab title branding + pixel animation

**Files:**
- Modify: `packages/tui/src/app.tsx` (terminal-title effect ~lines 452–476)

**Interfaces:**
- Consumes: `renderer.setTerminalTitle(string)`, `route.data`, `sync.session.get(id)`, `isDefaultTitle` (already imported line 62), `sync.data.session_status` (values have `.type`: `"busy" | "retry" | "idle"`), `terminalTitleEnabled()` signal, `Flag.CROKCODE_DISABLE_TERMINAL_TITLE`. `createMemo`/`onCleanup` already imported.
- Produces: titles `🐊 crokcode`, `🐊 crokcode | <title>`, `🐊 crokcode | <plugin id>`; while any session is busy/retry, a cycling pixel frame is appended.

- [ ] **Step 1: Replace the terminal-title effect**

Replace the entire `createEffect` block (~lines 452–476, starting with the comment `// Update terminal window title based on current route and session`) with:

```tsx
  // Update terminal window title based on current route and session
  const TITLE_BASE = "🐊 crokcode"
  const TITLE_FRAMES = ["░", "▒", "▓", "█", "▓", "▒"]
  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.CROKCODE_DISABLE_TERMINAL_TITLE) return

    const title = (() => {
      if (route.data.type === "session") {
        const session = sync.session.get(route.data.sessionID)
        if (session && !isDefaultTitle(session.title)) {
          const name = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
          return `${TITLE_BASE} | ${name}`
        }
        return TITLE_BASE
      }
      if (route.data.type === "plugin") return `${TITLE_BASE} | ${route.data.id}`
      return TITLE_BASE
    })()

    const working = Object.values(sync.data.session_status).some(
      (status) => status.type === "busy" || status.type === "retry",
    )

    if (!working) {
      renderer.setTerminalTitle(title)
      return
    }

    let frame = 0
    const tick = () => renderer.setTerminalTitle(`${title} ${TITLE_FRAMES[frame++ % TITLE_FRAMES.length]}`)
    tick()
    const timer = setInterval(tick, 150)
    onCleanup(() => clearInterval(timer))
  })
```

Notes for the implementer:
- The effect re-runs when route, session title, or `session_status` changes (all are reactive reads inside the effect body), which recreates or clears the interval as needed.
- `onCleanup` inside `createEffect` clears the previous interval on re-run/dispose.

- [ ] **Step 2: Typecheck and existing tests**

Run from `packages/tui`: `bun typecheck` then `bun test test/app-lifecycle.test.tsx`
Expected: no type errors; lifecycle tests PASS.

- [ ] **Step 3: Verification**

The OSC title sequence is not visible in `tmux capture-pane` output. Verify by: `bun typecheck` (Step 2) plus code review against this plan; final interactive confirmation is done by the user in their terminal (tab shows `🐊 crokcode`, pixel pulse while a prompt runs).

- [ ] **Step 4: Commit (ask user first)**

```bash
git add packages/tui/src/app.tsx
git commit -m "feat(tui): brand terminal title as crokcode with busy pixel animation"
```

---

### Task 4: Rename visible "CrokCode" texts to crokcode

**Files:**
- Modify: `packages/tui/src/feature-plugins/sidebar/footer.tsx` (brand line ~67–77, getting-started text ~56)
- Modify: `packages/tui/src/feature-plugins/home/tips-view.tsx` (tips ~236–245, 267)
- Modify: `packages/tui/src/routes/session/permission.tsx` (lines 144, 148, ~486)
- Modify: `packages/tui/src/app.tsx` (update toast ~line 1073)
- Modify: `packages/tui/src/attention.ts` (line 48)

**Interfaces:**
- Consumes: nothing from other tasks.
- Produces: no remaining user-visible "CrokCode" brand strings except the Global Constraints exclusions.

- [ ] **Step 1: Sidebar footer**

In `packages/tui/src/feature-plugins/sidebar/footer.tsx`, add the import at the top:

```ts
import { RGBA } from "@opentui/core"
```

add the constant above `function View`:

```ts
const GREEN = RGBA.fromHex("#a7d129")
```

change the getting-started line (~56):

```tsx
            <text fg={theme().textMuted}>crokcode includes free models so you can start immediately.</text>
```

and replace the brand line (~71–77):

```tsx
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span> <b>Open</b>
        <span style={{ fg: theme().text }}>
          <b>Code</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
```

with:

```tsx
      <text fg={theme().textMuted}>
        <span style={{ fg: theme().success }}>•</span>{" "}
        <span style={{ fg: GREEN }}>
          <b>crok</b>
        </span>
        <span style={{ fg: theme().text }}>
          <b>code</b>
        </span>{" "}
        <span>{props.api.app.version}</span>
      </text>
```

- [ ] **Step 2: Home tips**

In `packages/tui/src/feature-plugins/home/tips-view.tsx`, replace exactly these tip strings (leave every other tip untouched):

```ts
  "Create a plugin to prevent crokcode from reading sensitive files",
  "Use {highlight}crokcode run{/highlight} for non-interactive scripting",
  "Use {highlight}crokcode --continue{/highlight} to resume the last session",
  "Use {highlight}crokcode run -f file.ts{/highlight} to attach files via CLI",
  "Run {highlight}crokcode serve{/highlight} for headless API access to crokcode",
  "Use {highlight}crokcode run --attach{/highlight} to connect to a running server",
  "Run {highlight}crokcode upgrade{/highlight} to update to the latest version",
  "Run {highlight}crokcode auth list{/highlight} to see all configured providers",
  "Run {highlight}crokcode agent create{/highlight} for guided agent creation",
```

and:

```ts
  "Run {highlight}crokcode debug config{/highlight} to troubleshoot configuration",
```

(These replace the corresponding `crokcode …` / `CrokCode` strings at lines 236–245 and 267. Do NOT touch lines 246–249, 251, 277, 278 — see Global Constraints.)

- [ ] **Step 3: Permission dialog strings**

In `packages/tui/src/routes/session/permission.tsx`:
- line 144: `" until crokcode is restarted."`
- line 148: `This will allow the following patterns until crokcode is restarted`
- ~line 486: `Tell crokcode what to do differently`

- [ ] **Step 4: Update toast and sound pack name**

In `packages/tui/src/app.tsx` (~line 1073):

```ts
      `Successfully updated to crokcode v${result.data.version}. Please restart the application.`,
```

In `packages/tui/src/attention.ts` (line 48):

```ts
  name: "crokcode Default",
```

- [ ] **Step 5: Verify no stray brand strings remain**

Run from repo root: `rg -n "CrokCode" packages/tui/src` (if `rg` is unavailable, use the Grep tool with pattern `CrokCode` in `packages/tui/src`)
Expected: matches ONLY in `component/dialog-provider.tsx` (Zen/Go product descriptions + comment) and `feature-plugins/home/tips-view.tsx` line ~278 (`OpenCode Zen` tip). Anything else is a miss; fix it.

Then from `packages/tui`: `bun typecheck` and `bun test`
Expected: no type errors, all tests PASS.

- [ ] **Step 6: Commit (ask user first)**

```bash
git add packages/tui/src/feature-plugins/sidebar/footer.tsx packages/tui/src/feature-plugins/home/tips-view.tsx packages/tui/src/routes/session/permission.tsx packages/tui/src/app.tsx packages/tui/src/attention.ts
git commit -m "feat(tui): rename visible CrokCode branding to crokcode"
```

---

### Task 5: End-to-end verification

**Files:** none (verification only)

- [ ] **Step 1: Full test suite + typecheck**

Run from `packages/tui`: `bun test` and `bun typecheck`
Expected: all PASS.

- [ ] **Step 2: Dev TUI smoke check in tmux**

From `packages/crokcode`: `tmux new-session -d -s crokcode-dev 'bun dev'`, then `tmux capture-pane -pt crokcode-dev`.
Expected: home screen renders (croc logo, prompt bar with `Build · manual · …`), no error component.
Stop: `tmux kill-session -t crokcode-dev`.

- [ ] **Step 3: User interactive confirmation**

Ask the user to run crokcode and confirm: Shift+Tab flips `manual` ↔ `auto accept`; tab title is `🐊 crokcode` and pulses `░▒▓█` while the agent works; sidebar footer shows `• crokcode <version>`.
