import { expect, test } from "bun:test"
import { CommandMap, Definitions } from "../src/config/keybind"

test("the editor bindings exist and map to editor commands", () => {
  expect(Definitions.editor_open).toBeDefined()
  expect(CommandMap.editor_open).toBe("editor.open")
  expect(CommandMap.editor_save).toBe("editor.save")
})

test("every editor binding has a command", () => {
  for (const name of Object.keys(Definitions)) {
    if (!name.startsWith("editor_")) continue
    expect(CommandMap[name as keyof typeof CommandMap]).toBeTruthy()
  }
})
