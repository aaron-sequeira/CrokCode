/** @jsxImportSource @opentui/solid */
import { expect, test, mock } from "bun:test"
import { testRender, useRenderer } from "@opentui/solid"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"

mock.module("../../../src/context/sdk", () => ({
  useSDK: () => ({
    client: { global: { config: { update: async () => ({}) } }, instance: { dispose: async () => ({}) } },
  }),
  SDKProvider: (p: any) => p.children,
}))
mock.module("../../../src/context/sync", () => ({
  useSync: () => ({ bootstrap: async () => ({}) }),
  SyncProvider: (p: any) => p.children,
}))

const { TestTuiContexts } = await import("../../fixture/tui-environment")
const { OpencodeKeymapProvider, registerOpencodeKeymap } = await import("../../../src/keymap")
const { TuiConfigProvider } = await import("../../../src/config")
const { KVProvider } = await import("../../../src/context/kv")
const { ThemeProvider } = await import("../../../src/context/theme")
const { DialogProvider } = await import("../../../src/ui/dialog")
const { ToastProvider } = await import("../../../src/ui/toast")
const { ClipboardProvider } = await import("../../../src/context/clipboard")
const { createTuiResolvedConfig } = await import("../../fixture/tui-runtime")
const { DialogLocal } = await import("../../../src/component/dialog-local")

const config = createTuiResolvedConfig()

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
                    <DialogLocal />
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
