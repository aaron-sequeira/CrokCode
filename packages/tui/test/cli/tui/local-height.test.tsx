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
      ) : has ? (
        <span style={{ fg: theme.success }}>✓ downloaded</span>
      ) : (
        <span style={{ fg: theme.textMuted }}>available</span>
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

async function rowsAt(height: number) {
  const app = await testRender(() => <Root />, { width: 90, height })
  try {
    for (let i = 0; i < 60; i++) {
      await app.renderOnce()
      await Bun.sleep(20)
      if (/GB · /.test(app.captureCharFrame())) break
    }
    return app
      .captureCharFrame()
      .split("\n")
      .map((l: string) => l.trimEnd())
      .filter((l: string) => /GB · /.test(l))
  } finally {
    app.renderer.destroy()
  }
}

// A <=0 list height made the scrollbox draw every row at the same position,
// overprinting them into one garbled strip that reads as a black bar.
test("short terminals still render a legible model row", async () => {
  for (const height of [10, 12, 14]) {
    const rows = await rowsAt(height)
    expect(rows.length).toBeGreaterThan(0)
    // An overprinted row interleaves characters from several models at once.
    const overprinted = rows.some((l) => /Qwen.*Llama|Llama.*Qwen/.test(l))
    expect(overprinted).toBe(false)
  }
})

test("taller terminals show more rows", async () => {
  expect((await rowsAt(30)).length).toBeGreaterThan((await rowsAt(16)).length)
})
