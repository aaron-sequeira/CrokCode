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

// The component used to spell these keys out next to the rebindable ones, so
// rebinding editor_save left ctrl+s live and the hardcoded ctrl+w collided with
// input_delete_word_backward. Every editor verb needs its own definition for the
// route to be able to source its keys from the keymap alone.
test("every editor command the route binds is rebindable", () => {
  const commands = [
    "editor.save",
    "editor.focus.next",
    "editor.back",
    "editor.close",
    "editor.down",
    "editor.up",
    "editor.toggle",
    "editor.conflict.keep",
    "editor.conflict.take",
    "editor.conflict.diff",
  ]
  const mapped = new Set(Object.values(CommandMap))
  for (const command of commands) expect(mapped).toContain(command)
})

// The spec's keymap: esc walks back one step, ctrl+q leaves from anywhere.
test("esc goes back one step and ctrl+q leaves", () => {
  expect(Definitions.editor_back.default).toBe("escape")
  expect(Definitions.editor_close.default).toBe("ctrl+q")
})

test("no editor default collides with the input word-delete binding", () => {
  const inputWordDelete = String(Definitions.input_delete_word_backward.default).split(",")
  for (const [name, item] of Object.entries(Definitions)) {
    if (!name.startsWith("editor_")) continue
    for (const key of String(item.default).split(",")) {
      if (key === "none") continue
      expect(inputWordDelete, `${name} collides with input_delete_word_backward`).not.toContain(key)
    }
  }
})
