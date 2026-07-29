import { expect, test } from "bun:test"
import { createBindingLookup } from "@opentui/keymap/extras"
import * as TuiKeybind from "../../src/config/keybind"

// The editor registers its keys in three groups that go live in different
// states: the tree keys only when the buffer does not hold focus, the banner
// keys only during a conflict, and the chrome keys always. `gather` MEMOISES BY
// ITS FIRST ARGUMENT and returns the very same array for every later call with
// that name — so the three groups must not share one name. They did, and the
// first call (tree) won: ctrl+s/tab/escape/ctrl+q were never bound at all, and
// `space` stayed bound to editor.toggle while the user was typing.

function lookup() {
  return createBindingLookup(TuiKeybind.toBindingConfig(TuiKeybind.parse({})), {
    commandMap: TuiKeybind.CommandMap,
    bindingDefaults: TuiKeybind.bindingDefaults(),
  })
}

const commands = (bindings: readonly { cmd?: unknown }[]) => bindings.map((binding) => String(binding.cmd))

test("gather memoises by name — the behaviour these groups have to work around", () => {
  const view = lookup()
  const first = view.gather("same-name", ["editor.down"])
  const second = view.gather("same-name", ["editor.save"])
  expect(second).toBe(first)
  expect(commands(second)).toEqual(["editor.down"])
})

test("each editor binding group gathers under its own name and gets its own commands", () => {
  const view = lookup()
  const tree = view.gather("editor.tree", ["editor.down", "editor.up", "editor.toggle"])
  const banner = view.gather("editor.conflict", ["editor.conflict.keep", "editor.conflict.take", "editor.conflict.diff"])
  const chrome = view.gather("editor", ["editor.save", "editor.focus.next", "editor.back", "editor.close"])

  expect(commands(tree)).toEqual(["editor.down", "editor.up", "editor.toggle"])
  expect(commands(banner)).toEqual(["editor.conflict.keep", "editor.conflict.take", "editor.conflict.diff"])
  expect(commands(chrome)).toEqual(["editor.save", "editor.focus.next", "editor.back", "editor.close"])
})

test("the keys that let you leave and save are actually bound", () => {
  const view = lookup()
  const chrome = view.gather("editor", ["editor.save", "editor.focus.next", "editor.back", "editor.close"])
  const keys = Object.fromEntries(chrome.map((binding) => [String(binding.cmd), binding.key]))
  expect(keys["editor.back"]).toBe("escape")
  expect(keys["editor.close"]).toBe("ctrl+q")
  expect(keys["editor.save"]).toBe("ctrl+s")
})

test("space belongs to the tree group only, so it can reach the buffer while typing", () => {
  const view = lookup()
  const tree = view.gather("editor.tree", ["editor.down", "editor.up", "editor.toggle"])
  const toggle = tree.find((binding) => String(binding.cmd) === "editor.toggle")
  expect(toggle?.key).toContain("space")
  const chrome = view.gather("editor", ["editor.save", "editor.focus.next", "editor.back", "editor.close"])
  expect(commands(chrome)).not.toContain("editor.toggle")
})
