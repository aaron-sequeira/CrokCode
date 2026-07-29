import { createBindingLookup } from "@opentui/keymap/extras"
import { testRender, useRenderer } from "@opentui/solid"
import { expect, test } from "bun:test"
import { onCleanup } from "solid-js"
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

test("prompt.dictate binds ctrl+alt+v on both press and release", async () => {
  let strokes: { name: string; ctrl?: boolean; meta?: boolean }[] = []
  let events: (string | undefined)[] = []

  function Harness() {
    const renderer = useRenderer()
    const keymap = createDefaultOpenTuiKeymap(renderer)
    const config = createResolvedKeymapConfig()
    const offKeymap = registerCrokcodeKeymap(keymap, renderer, config)
    const offLayer = keymap.registerLayer({
      enabled: () => true,
      bindings: config.keybinds.gather("prompt.palette", ["prompt.dictate"]),
    })
    const bindings = keymap.getCommandBindings({ visibility: "registered", commands: ["prompt.dictate"] })
    const found = bindings.get("prompt.dictate") ?? []
    strokes = found.flatMap((binding) =>
      binding.sequence.map((part) => part.stroke as { name: string; ctrl?: boolean; meta?: boolean }),
    )
    events = found.map((binding) => (binding as { event?: string }).event)
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

  const app = await testRender(() => <Harness />, { kittyKeyboard: true })
  try {
    // ctrl+alt+v — "meta" is how the parser reports alt.
    expect(strokes.some((stroke) => stroke.name === "v" && stroke.ctrl && stroke.meta)).toBe(true)
    // A press binding (undefined event) for the tap-toggle, and a release
    // binding for hold-to-talk.
    expect(events).toContain("release")
    expect(events.some((event) => event !== "release")).toBe(true)
  } finally {
    app.renderer.destroy()
  }
})
