/** @jsxImportSource @opentui/solid */
import { expect, test } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { TestTuiContexts } from "../../fixture/tui-environment"
import { OpencodeKeymapProvider, registerOpencodeKeymap } from "../../../src/keymap"
import { TuiConfigProvider } from "../../../src/config"
import { KVProvider } from "../../../src/context/kv"
import { ThemeProvider, useTheme } from "../../../src/context/theme"
import { DialogProvider } from "../../../src/ui/dialog"
import { ToastProvider } from "../../../src/ui/toast"
import { ClipboardProvider } from "../../../src/context/clipboard"
import { DialogSelect } from "../../../src/ui/dialog-select"
import { createTuiResolvedConfig } from "../../fixture/tui-runtime"
import { LOCAL_MODELS, canRun, gb, type DeviceSpecs } from "../../../src/util/local-models"

const config = createTuiResolvedConfig()

// Guards the /local black bar: option footers must be <span>, never a nested
// <text>, or opentui throws "TextNodeRenderable only accepts strings..." during
// the checking->list swap and the dialog renders as an empty panel.
test("/local model list renders its rows", async () => {
  function Inner() {
    const { theme } = useTheme()
    const specs: DeviceSpecs = { ramGb: 15.4, cpus: 24, platform: "win32" }
    const options = LOCAL_MODELS.map((model) => {
      const has = model.id === "llama3.1:8b"
      const runnable = canRun(model, specs)
      return {
        title: `${model.name} ${model.params}`,
        value: model.id,
        description: `${gb(model.sizeGb)} · ${model.note}`,
        disabled: !has && !runnable,
        footer: !runnable ? (
          <span style={{ fg: theme.error }}>needs {model.minRamGb} GB RAM</span>
        ) : model.agent ? (
          <span style={{ fg: theme.success }}>{has ? "✓ downloaded · " : ""}tools ✓</span>
        ) : has ? (
          <span style={{ fg: theme.textMuted }}>✓ downloaded · chat only</span>
        ) : (
          <span style={{ fg: theme.textMuted }}>chat only</span>
        ),
      }
    })
    return (
      <DialogSelect
        title="Local models"
        options={options}
        footer={<text fg={theme.textMuted}>Your machine: 15 GB RAM · 24 cores</text>}
      />
    )
  }

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
                      <Inner />
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

  const app = await testRender(() => <Root />, { width: 80, height: 30 })
  try {
    // KV/Theme gate children behind an async readiness flag; wait for paint.
    for (let i = 0; i < 60; i++) {
      await app.renderOnce()
      await Bun.sleep(10)
      if (/\S/.test(app.captureCharFrame())) break
    }
    const frame = app.captureCharFrame()
    expect(frame).toContain("Llama 3.1")
    expect(frame).toContain("Qwen2.5 Coder")
  } finally {
    app.renderer.destroy()
  }
})
