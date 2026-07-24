# Ollama Models in Provider Menu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Register every installed Ollama model and open it in CrokCode's normal provider/model selector without rendering the `/local` picker.

**Architecture:** Build the existing OpenAI-compatible Ollama provider block from the tags returned by `ollamaStatus()`. The provider menu writes that block through the existing config API, refreshes provider state, and opens `DialogModel` filtered to Ollama.

**Tech Stack:** TypeScript, SolidJS, Bun test, CrokCode SDK config API.

## Global Constraints

- Keep `/local` available for curated model downloads.
- Do not add dependencies or a new picker.
- Preserve model IDs exactly as returned by Ollama.
- Show actionable messages when Ollama is stopped or has no installed models.
- Run tests and type checking from `packages/tui`, never the repository root.

---

### Task 1: Ollama provider configuration

**Files:**
- Modify: `packages/tui/src/util/local-models.ts`
- Modify: `packages/tui/test/util/local-models.test.ts`

**Interfaces:**
- Consumes: `OllamaModel[]` from `ollamaStatus()`.
- Produces: `ollamaProvider(models: OllamaModel[])`, an OpenAI-compatible provider block whose `models` keys preserve every installed Ollama tag.

- [ ] **Step 1: Write the failing test**

Add a test that calls `ollamaProvider()` with `llama3.1:8b`, `llava:latest`, and `minimax-m3:cloud` and expects all three exact IDs under `provider.models`, with matching display names.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/util/local-models.test.ts`

Expected: FAIL because `ollamaProvider` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add:

```ts
export function ollamaProvider(models: OllamaModel[]) {
  return {
    npm: "@ai-sdk/openai-compatible",
    name: "Ollama (local)",
    options: { baseURL: `${OLLAMA_URL}/v1`, apiKey: "ollama" },
    models: Object.fromEntries(models.map((model) => [model.name, { name: model.name }])),
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test test/util/local-models.test.ts`

Expected: all tests PASS.

### Task 2: Provider-menu connection flow

**Files:**
- Modify: `packages/tui/src/component/dialog-provider.tsx`
- Modify: `packages/tui/test/cli/cmd/tui/provider-options.test.ts`

**Interfaces:**
- Consumes: `ollamaStatus()` and `ollamaProvider()` from `../util/local-models`.
- Produces: the existing **Local models** provider option registers installed tags, refreshes sync state, and opens `<DialogModel providerID="ollama" />`.

- [ ] **Step 1: Write the failing test**

Extend the provider-options test to confirm the local provider option copy identifies installed Ollama models and no longer describes the entry as the download picker.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test test/cli/cmd/tui/provider-options.test.ts`

Expected: FAIL because the current description is `Download & run on-device (Ollama)`.

- [ ] **Step 3: Write minimal implementation**

Change the local option description to `Use models installed in Ollama`. In its existing `onSelect` callback:

1. Await `ollamaStatus()`.
2. Show a warning and return if Ollama is unavailable.
3. Show a warning and return if no models are installed.
4. Write `{ provider: { ollama: ollamaProvider(status.models) } }`.
5. Dispose the instance, bootstrap sync, and replace the dialog with `DialogModel` filtered to `ollama`.
6. Catch config/refresh failures, show an error, and clear the dialog.

- [ ] **Step 4: Run focused tests**

Run:

```powershell
bun test test/util/local-models.test.ts test/cli/cmd/tui/provider-options.test.ts test/cli/tui/local-render.test.tsx test/cli/tui/local-height.test.tsx
```

Expected: all tests PASS.

### Task 3: Verification and release

**Files:**
- Modify only release metadata required by the existing release workflow.

**Interfaces:**
- Consumes: verified TUI implementation.
- Produces: the next public patch release and a locally installed Windows binary.

- [ ] **Step 1: Verify**

From `packages/tui`, run:

```powershell
bun typecheck
bun run test
```

Expected: typecheck succeeds and the full TUI test suite passes.

- [ ] **Step 2: Commit implementation**

```powershell
git add packages/tui/src/util/local-models.ts packages/tui/src/component/dialog-provider.tsx packages/tui/test/util/local-models.test.ts packages/tui/test/cli/cmd/tui/provider-options.test.ts
git commit -m "fix(tui): list Ollama models by provider"
```

- [ ] **Step 3: Publish**

Push the current branch to `crok/dev`, create the next unused patch tag, and monitor `.github/workflows/crokcode-release.yml` until every platform asset is attached.

- [ ] **Step 4: Verify installer**

Fetch `https://www.crokcode.tech/install.ps1`, confirm it resolves the new release, run it, and verify `crokcode --version` reports the new patch version.
