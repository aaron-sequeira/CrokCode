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

  function Inner() {
    return <DialogUpdate version="0.3.4" onSelect={(choice) => selected.push(choice)} />
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

  const app = await testRender(() => <Root />, { width: 80, height: 24 })
  try {
    for (let i = 0; i < 60; i++) {
      await app.renderOnce()
      await Bun.sleep(10)
      if (app.captureCharFrame().includes("CrokCode update available")) break
    }
    const frame = app.captureCharFrame()
    expect(frame).toContain("CrokCode update available")
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
