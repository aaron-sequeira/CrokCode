# TUI Updates and Local Models Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Codex-style startup update dialog, make `/local` show every installed Ollama model plus curated downloads without corrupting the TUI, and publish installable v0.3.4 binaries and the site.

**Architecture:** Keep the existing asynchronous release check and upgrade API, replacing only the two-choice confirmation with a focused three-action dialog. Keep Ollama as the local runtime, enrich its `/api/tags` response, and merge installed tags with the existing curated catalog through one pure function. Fix rendering at the shared `DialogSelect` boundary and publish through the existing GitHub Actions and Vercel paths.

**Tech Stack:** TypeScript, SolidJS, OpenTUI, Bun tests, Ollama HTTP API, GitHub Actions, Vercel

## Global Constraints

- Preserve the user's existing edits in `packages/tui/src/component/dialog-local.tsx`, `packages/tui/src/ui/dialog-select.tsx`, `packages/tui/src/util/local-models.ts`, the two untracked local-model TUI tests, and unrelated Supabase files.
- Run tests and `bun typecheck` from package directories, never the repository root.
- Do not edit generated client files.
- Add no dependencies.
- Failed release checks stay silent; failed upgrades leave the TUI open.
- `/local` shows every locally installed Ollama model and a curated downloadable list, deduplicated by model ID.
- Release version is `0.3.4`; the binary must report `0.3.4`.

---

### Task 1: Merge installed Ollama models with the curated catalog

**Files:**
- Modify: `packages/tui/src/util/local-models.ts`
- Modify: `packages/tui/src/component/dialog-local.tsx`
- Create: `packages/tui/test/util/local-models.test.ts`

**Interfaces:**
- Consumes: Ollama `GET /api/tags` objects with `name` and optional byte `size`.
- Produces: `mergeLocalModels(models: OllamaModel[]): LocalModel[]`.
- Produces: `ollamaStatus(): Promise<{ running: boolean; installed: Set<string>; models: OllamaModel[] }>`.

- [ ] **Step 1: Write the failing merge tests**

Create `packages/tui/test/util/local-models.test.ts`:

```ts
import { expect, test } from "bun:test"
import { LOCAL_MODELS, mergeLocalModels } from "../../src/util/local-models"

test("includes installed Ollama models that are not curated", () => {
  const models = mergeLocalModels([{ name: "custom-coder:latest", size: 2 * 1024 ** 3 }])

  expect(models[0]).toMatchObject({
    id: "custom-coder:latest",
    name: "custom-coder:latest",
    sizeGb: 2,
    minRamGb: 0,
    note: "Installed in Ollama",
  })
})

test("deduplicates installed and curated models by Ollama ID", () => {
  const models = mergeLocalModels([{ name: LOCAL_MODELS[0].id, size: 99 }])

  expect(models.filter((model) => model.id === LOCAL_MODELS[0].id)).toHaveLength(1)
  expect(models.find((model) => model.id === LOCAL_MODELS[0].id)).toEqual(LOCAL_MODELS[0])
})
```

- [ ] **Step 2: Run the tests and verify RED**

Run from `packages/tui`:

```powershell
bun test test/util/local-models.test.ts
```

Expected: FAIL because `mergeLocalModels` is not exported.

- [ ] **Step 3: Add the Ollama tag type and pure merge**

Add beside `LocalModel` in `packages/tui/src/util/local-models.ts`:

```ts
export type OllamaModel = {
  name: string
  size?: number
}

export function mergeLocalModels(models: OllamaModel[]) {
  const curated = new Map(LOCAL_MODELS.map((model) => [model.id, model]))
  const installed = new Set(models.map((model) => model.name))
  return [
    ...models.map(
      (model): LocalModel =>
        curated.get(model.name) ?? {
          id: model.name,
          name: model.name,
          params: "",
          sizeGb: (model.size ?? 0) / 1024 ** 3,
          minRamGb: 0,
          note: "Installed in Ollama",
        },
    ),
    ...LOCAL_MODELS.filter((model) => !installed.has(model.id)),
  ]
}
```

Keep this directly below `LOCAL_MODELS` so the catalog and merge remain one unit.

- [ ] **Step 4: Return tag metadata from `ollamaStatus`**

Replace `ollamaStatus` with:

```ts
export async function ollamaStatus(): Promise<{
  running: boolean
  installed: Set<string>
  models: OllamaModel[]
}> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { running: false, installed: new Set(), models: [] }
    const body = (await res.json()) as { models?: OllamaModel[] }
    const models = body.models ?? []
    return { running: true, installed: new Set(models.map((model) => model.name)), models }
  } catch {
    return { running: false, installed: new Set(), models: [] }
  }
}
```

- [ ] **Step 5: Render the merged catalog**

In `packages/tui/src/component/dialog-local.tsx`:

```ts
import {
  canRun,
  deviceSpecs,
  gb,
  mergeLocalModels,
  modelInfo,
  OLLAMA_URL,
  ollamaStatus,
  OUTPUT_LIMIT,
  pullModel,
  type DeviceSpecs,
  type LocalModel,
  type OllamaModel,
} from "../util/local-models"
```

Add state:

```ts
const [models, setModels] = createSignal<OllamaModel[]>([])
```

After `setInstalled(status.installed)`, add:

```ts
setModels(status.models)
```

Change the options source:

```ts
const options = createMemo(() =>
  mergeLocalModels(models()).map((model) => {
```

For installed models whose tool capability has not been curated, use neutral copy rather than claiming they are chat-only:

```tsx
footer: !runnable ? (
  <span style={{ fg: theme.error }}>needs {model.minRamGb} GB RAM</span>
) : model.agent === true ? (
  <span style={{ fg: theme.success }}>{has ? "✓ downloaded · " : ""}tools ✓</span>
) : model.agent === false ? (
  <span style={{ fg: theme.textMuted }}>{has ? "✓ downloaded · " : ""}chat only</span>
) : has ? (
  <span style={{ fg: theme.textMuted }}>✓ downloaded</span>
) : (
  <span style={{ fg: theme.textMuted }}>tool support checked on connect</span>
),
```

- [ ] **Step 6: Verify GREEN**

Run from `packages/tui`:

```powershell
bun test test/util/local-models.test.ts
```

Expected: 2 PASS, 0 FAIL.

- [ ] **Step 7: Commit the catalog merge**

```powershell
git add packages/tui/src/util/local-models.ts packages/tui/src/component/dialog-local.tsx packages/tui/test/util/local-models.test.ts
git commit -m "fix(tui): show all installed local models"
```

---

### Task 2: Lock down the black-bar renderer regression

**Files:**
- Modify: `packages/tui/src/ui/dialog-select.tsx`
- Modify: `packages/tui/test/cli/tui/local-render.test.tsx`
- Modify: `packages/tui/test/cli/tui/local-height.test.tsx`

**Interfaces:**
- Consumes: `DialogSelect` options whose `footer` is inline JSX.
- Produces: a scrollbox height of at least one row for every terminal height.

- [ ] **Step 1: Run the screenshot regressions before further edits**

Run from `packages/tui`:

```powershell
bun test test/cli/tui/local-render.test.tsx test/cli/tui/local-height.test.tsx
```

Expected: the nested-text and short-terminal regressions are exercised. If the existing working-tree fixes are present, both pass; do not discard them merely to manufacture a failure.

- [ ] **Step 2: Keep footer children as spans**

Confirm every `/local` option footer in `packages/tui/src/component/dialog-local.tsx` uses `<span>`, because `DialogSelect` already wraps it in `<text>`. The resulting shape must remain:

```tsx
footer: <span style={{ fg: theme.textMuted }}>✓ downloaded</span>
```

No `<text>` may appear inside an option footer.

- [ ] **Step 3: Clamp the shared select height**

Keep the shared calculation in `packages/tui/src/ui/dialog-select.tsx`:

```ts
const height = createMemo(() => Math.max(1, Math.min(rows(), Math.floor(dimensions().height / 2) - 6)))
```

Do not add a `/local`-specific height override.

- [ ] **Step 4: Verify the exact screenshot failure**

Run from `packages/tui`:

```powershell
bun test test/cli/tui/local-render.test.tsx test/cli/tui/local-height.test.tsx
```

Expected: 3 PASS, 0 FAIL; short heights 10, 12, and 14 each contain a legible model row with no interleaved names.

- [ ] **Step 5: Commit the renderer fix**

```powershell
git add packages/tui/src/ui/dialog-select.tsx packages/tui/test/cli/tui/local-render.test.tsx packages/tui/test/cli/tui/local-height.test.tsx
git commit -m "fix(tui): keep local model list legible"
```

---

### Task 3: Add the Codex-style three-action update dialog

**Files:**
- Create: `packages/tui/src/ui/dialog-update.tsx`
- Create: `packages/tui/test/cli/tui/dialog-update.test.tsx`
- Modify: `packages/tui/src/app.tsx`

**Interfaces:**
- Produces: `UpdateChoice = "update" | "later" | "skip"`.
- Produces: `DialogUpdate.show(dialog: DialogContext, version: string): Promise<UpdateChoice>`.
- Consumes: existing `installation.update-available` event and `sdk.client.global.upgrade`.

- [ ] **Step 1: Write the failing component test**

Create `packages/tui/test/cli/tui/dialog-update.test.tsx`:

```tsx
/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { TuiConfigProvider } from "../../../src/config"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider } from "../../../src/context/theme"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { ClipboardProvider } from "../../../src/context/clipboard"
import { DialogUpdate, type UpdateChoice } from "../../../src/ui/dialog-update"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"

const config = createTuiResolvedConfig()

test("renders and selects every update action", async () => {
  const selected: UpdateChoice[] = []

  function Root() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    registerOpencodeKeymap(keymap, renderer, config)
    return (
      <TestTuiContexts>
        <OpencodeKeymapProvider keymap={keymap}>
          <TuiConfigProvider config={config}>
            <KVProvider>
              <ThemeProvider mode="dark">
                <ClipboardProvider>
                  <ToastProvider>
                    <DialogProvider>
                      <DialogUpdate version="0.3.4" onSelect={(choice) => selected.push(choice)} />
                    </DialogProvider>
                  </ToastProvider>
                </ClipboardProvider>
              </ThemeProvider>
            </KVProvider>
          </TuiConfigProvider>
        </OpencodeKeymapProvider>
      </TestTuiContexts>
    )
  }

  const app = await testRender(() => <Root />, { width: 80, height: 24 })
  try {
    const frame = await app.waitForFrame((value) => value.includes("CrokCode update available"))
    expect(frame).toContain("0.3.4")
    expect(frame).toContain("Update now")
    expect(frame).toContain("Later")
    expect(frame).toContain("Skip this version")

    app.mockInput.pressArrow("right")
    app.mockInput.pressArrow("right")
    app.mockInput.pressEnter()
    await app.renderOnce()

    expect(selected).toEqual(["skip"])
  } finally {
    app.renderer.destroy()
  }
})
```

- [ ] **Step 2: Run the test and verify RED**

Run from `packages/tui`:

```powershell
bun test test/cli/tui/dialog-update.test.tsx
```

Expected: FAIL because `dialog-update.tsx` does not exist.

- [ ] **Step 3: Implement the focused dialog**

Create `packages/tui/src/ui/dialog-update.tsx`:

```tsx
import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { useDialog, type DialogContext } from "./dialog"

export type UpdateChoice = "update" | "later" | "skip"

export function DialogUpdate(props: {
  version: string
  onSelect: (choice: UpdateChoice) => void
}) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const choices = [
    { value: "update" as const, label: "Update now" },
    { value: "later" as const, label: "Later" },
    { value: "skip" as const, label: "Skip this version" },
  ]
  const [store, setStore] = createStore({ selected: 0 })
  const select = () => {
    props.onSelect(choices[store.selected].value)
    dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      {
        key: "left",
        desc: "Previous update action",
        group: "Dialog",
        cmd: () => setStore("selected", (store.selected + choices.length - 1) % choices.length),
      },
      {
        key: "right",
        desc: "Next update action",
        group: "Dialog",
        cmd: () => setStore("selected", (store.selected + 1) % choices.length),
      },
      { key: "return", desc: "Choose update action", group: "Dialog", cmd: select },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1} width={58}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        CrokCode update available
      </text>
      <text fg={theme.textMuted}>
        Version {props.version} is ready. Update now or continue with your current version.
      </text>
      <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
        <For each={choices}>
          {(choice, index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index() === store.selected ? theme.primary : undefined}
              onMouseUp={() => {
                props.onSelect(choice.value)
                dialog.clear()
              }}
            >
              <text fg={index() === store.selected ? theme.selectedListItemText : theme.textMuted}>
                {choice.label}
              </text>
            </box>
          )}
        </For>
      </box>
      <text fg={theme.textMuted}>← → choose · enter confirm</text>
    </box>
  )
}

DialogUpdate.show = (dialog: DialogContext, version: string) =>
  new Promise<UpdateChoice>((resolve) => {
    dialog.replace(
      () => <DialogUpdate version={version} onSelect={resolve} />,
      () => resolve("later"),
    )
  })
```

- [ ] **Step 4: Wire the existing update event**

In `packages/tui/src/app.tsx`, replace the `DialogConfirm` import with:

```ts
import { DialogUpdate } from "./ui/dialog-update"
```

Replace the current confirmation block with:

```ts
const choice = await DialogUpdate.show(dialog, version)

if (choice === "skip") {
  kv.set("skipped_version", version)
  return
}

if (choice === "later") return
```

Keep the existing upgrade toast, API request, error toast, success alert, and exit flow unchanged.

- [ ] **Step 5: Verify GREEN**

Run from `packages/tui`:

```powershell
bun test test/cli/tui/dialog-update.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit the update screen**

```powershell
git add packages/tui/src/ui/dialog-update.tsx packages/tui/test/cli/tui/dialog-update.test.tsx packages/tui/src/app.tsx
git commit -m "feat(tui): add startup update screen"
```

---

### Task 4: Make release binaries report the release tag

**Files:**
- Modify: `.github/workflows/crokcode-release.yml`

**Interfaces:**
- Consumes: pushed tag or manual `tag` input such as `v0.3.4`.
- Produces: build environment `CROKCODE_VERSION=0.3.4` and `CROKCODE_CHANNEL=latest`.

- [ ] **Step 1: Add a cross-platform version-resolution step**

Insert after `oven-sh/setup-bun`:

```yaml
      - name: Resolve version
        id: version
        shell: bash
        env:
          TAG: ${{ github.event.inputs.tag || github.ref_name }}
        run: echo "version=${TAG#v}" >> "$GITHUB_OUTPUT"
```

- [ ] **Step 2: Pass the version into the build**

Change the build step to:

```yaml
      - name: Build crokcode
        working-directory: packages/opencode
        env:
          CROKCODE_CHANNEL: latest
          CROKCODE_VERSION: ${{ steps.version.outputs.version }}
        run: bun run script/build.ts --single --skip-install
```

- [ ] **Step 3: Validate the workflow source**

Run from the repository root:

```powershell
bun -e "const y = await Bun.file('.github/workflows/crokcode-release.yml').text(); if (!y.includes('CROKCODE_VERSION: ${{ steps.version.outputs.version }}')) process.exit(1)"
```

Expected: exit 0.

- [ ] **Step 4: Build a local release-version binary**

Run from `packages/opencode`:

```powershell
$env:CROKCODE_CHANNEL='latest'
$env:CROKCODE_VERSION='0.3.4'
bun run script/build.ts --single --skip-install
```

Expected: build exits 0 and its smoke test prints `0.3.4`.

- [ ] **Step 5: Commit the release correction**

```powershell
git add .github/workflows/crokcode-release.yml
git commit -m "fix(release): embed tagged crokcode version"
```

---

### Task 5: Full verification

**Files:**
- Verify only; do not modify generated files.

- [ ] **Step 1: Run focused TUI tests**

Run from `packages/tui`:

```powershell
bun test test/util/local-models.test.ts test/cli/tui/local-render.test.tsx test/cli/tui/local-height.test.tsx test/cli/tui/dialog-update.test.tsx
```

Expected: all focused tests pass with 0 failures.

- [ ] **Step 2: Run the TUI suite and typecheck**

Run from `packages/tui`:

```powershell
bun test
bun typecheck
```

Expected: both commands exit 0.

- [ ] **Step 3: Run opencode typecheck and relevant installation tests**

Run from `packages/opencode`:

```powershell
bun test test/installation/installation.test.ts test/server/httpapi-global.test.ts
bun typecheck
```

Expected: both commands exit 0.

- [ ] **Step 4: Build the site**

Run from `packages/site`:

```powershell
bun run build
```

Expected: Vite build exits 0 and emits `dist/install.ps1`.

- [ ] **Step 5: Verify installer-to-workflow asset agreement**

Run from the repository root:

```powershell
bun -e "const ps = await Bun.file('packages/site/public/install.ps1').text(); const wf = await Bun.file('.github/workflows/crokcode-release.yml').text(); if (!ps.includes('crokcode-windows-$arch.zip') || !wf.includes('crokcode-${{ matrix.target }}.${{ matrix.ext }}')) process.exit(1)"
```

Expected: exit 0.

---

### Task 6: Publish v0.3.4 and deploy the site

**Files:**
- External release and deployment state only.

- [ ] **Step 1: Push the implementation commit**

```powershell
git push origin HEAD
```

Expected: current branch is present on GitHub.

- [ ] **Step 2: Create and push the release tag**

```powershell
git tag -a v0.3.4 -m "v0.3.4"
git push origin v0.3.4
```

Expected: GitHub starts `.github/workflows/crokcode-release.yml`.

- [ ] **Step 3: Monitor the release workflow**

```powershell
$run = gh run list --repo aaron-sequeira/crokcode --workflow crokcode-release.yml --limit 1 --json databaseId --jq '.[0].databaseId'
gh run watch $run --repo aaron-sequeira/crokcode --exit-status
```

Expected: Linux x64, macOS arm64, macOS x64, and Windows x64 jobs all succeed.

- [ ] **Step 4: Verify the published assets**

```powershell
gh release view v0.3.4 --repo aaron-sequeira/crokcode --json isDraft,isPrerelease,assets
```

Expected: public non-draft release with `crokcode-linux-x64.tar.gz`, `crokcode-darwin-arm64.zip`, `crokcode-darwin-x64.zip`, and `crokcode-windows-x64.zip`.

- [ ] **Step 5: Deploy `packages/site` to the existing Vercel production project**

Use the Vercel connector to list the user's teams and projects, select the project serving `www.crokcode.tech`, and deploy the exact committed `packages/site` source to production. Do not create a second project.

Expected: production deployment succeeds and retains the `www.crokcode.tech` domain.

- [ ] **Step 6: Verify the live installer response**

```powershell
$response = Invoke-WebRequest 'https://www.crokcode.tech/install.ps1'
if ($response.StatusCode -ne 200) { throw "install.ps1 returned $($response.StatusCode)" }
if ($response.Headers.'Content-Type' -notmatch 'text/plain') { throw "unexpected content type" }
if ($response.Content -notmatch 'aaron-sequeira/crokcode') { throw "unexpected installer source" }
```

Expected: HTTP 200, `text/plain; charset=utf-8`, and the CrokCode repository in the body.

- [ ] **Step 7: Smoke-install the public Windows release in an isolated directory**

```powershell
$smoke = Join-Path $env:TEMP "crokcode-v0.3.4-smoke"
$env:CROKCODE_INSTALL_DIR = $smoke
$env:CROKCODE_NO_MODIFY_PATH = "1"
Invoke-RestMethod 'https://www.crokcode.tech/install.ps1' | Invoke-Expression
& (Join-Path $smoke 'crokcode.exe') --version
```

Expected: installer succeeds and the binary prints `0.3.4`.

- [ ] **Step 8: Report published endpoints**

Report the GitHub release URL, Vercel production URL, live installer URL, test counts, and the installed binary version.
