import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
import { TextareaRenderable } from "@opentui/core"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { TuiKeybind } from "../src/config/keybind"
import { CrokcodeKeymapProvider, registerCrokcodeKeymap } from "../src/keymap"

function createResolvedKeymapConfig(input: TuiKeybind.KeybindOverrides = {}) {
  const keybinds = TuiKeybind.parse(input)
  return {
    keybinds: createBindingLookup(TuiKeybind.toBindingConfig(keybinds), {
      commandMap: TuiKeybind.CommandMap,
      bindingDefaults: TuiKeybind.bindingDefaults(),
    }),
    leader_timeout: 2000,
  }
}

async function wait(fn: () => boolean, timeout = 2000) {
  const start = Date.now()
  while (!fn()) {
    if (Date.now() - start > timeout) throw new Error("timed out waiting for condition")
    await Bun.sleep(10)
  }
}

test("input.delete.word.backward is registered for ctrl+w, ctrl+backspace, ctrl+h, alt+backspace", async () => {
  const sequences: Record<string, string[][]> = {}
  let strokes: { name: string; ctrl?: boolean; meta?: boolean }[] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerCrokcodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      enabled: () => true,
      bindings: config.keybinds.gather("input", ["input.delete.word.backward"]),
    })
    const bindings = keymap.getCommandBindings({
      visibility: "registered",
      commands: ["input.delete.word.backward"],
    })
    sequences.word = bindings.get("input.delete.word.backward")?.map((b) => b.sequence.map((p) => p.stroke.name)) ?? []
    strokes = (bindings.get("input.delete.word.backward") ?? []).flatMap((b) => b.sequence.map((p) => p.stroke as { name: string; ctrl?: boolean; meta?: boolean }))
    onCleanup(() => {
      offLayer()
      offKeymap()
    })
    return (
      <CrokcodeKeymapProvider keymap={keymap}>
        <box />
      </CrokcodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />)
  try {
    const has = (name: string, mods: Partial<{ ctrl: boolean; meta: boolean }>) =>
      strokes.some((s) => s.name === name && !!s.ctrl === !!mods.ctrl && !!s.meta === !!mods.meta)
    expect(has("w", { ctrl: true })).toBe(true)
    expect(has("backspace", { ctrl: true })).toBe(true)
    expect(has("h", { ctrl: true })).toBe(true)
    expect(has("backspace", { meta: true })).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})

test("ctrl+w deletes the whole word backward in a managed textarea", async () => {
  let textarea: TextareaRenderable | undefined

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const resolvedConfig = createResolvedKeymapConfig()
    const off = registerCrokcodeKeymap(keymap, renderer, resolvedConfig)
    onCleanup(off)
    return (
      <CrokcodeKeymapProvider keymap={keymap}>
        <textarea
          ref={(r: TextareaRenderable) => {
            textarea = r
          }}
          width={40}
        />
      </CrokcodeKeymapProvider>
    )
  }

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  if (!textarea) throw new Error("expected textarea to mount")
  try {
    textarea.insertText("hello world")
    textarea.focus()
    await wait(() => app.renderer.currentFocusedEditor === textarea)

    app.mockInput.pressKey("w", { ctrl: true })
    await wait(() => textarea!.plainText !== "hello world")

    expect(textarea.plainText).toBe("hello ")
  } finally {
    app.renderer.destroy()
  }
})