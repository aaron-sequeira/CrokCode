import { expect, test } from "bun:test"
import { TuiKeybind } from "../src/config/keybind"

test("shift+tab toggles auto-accept permissions by default", () => {
  const keybinds = TuiKeybind.parse({})
  expect(keybinds.permission_mode_toggle).toBe("shift+tab")
  expect(TuiKeybind.CommandMap.permission_mode_toggle).toBe("permission.mode")
})

test("agent reverse cycle is unbound by default", () => {
  const keybinds = TuiKeybind.parse({})
  expect(keybinds.agent_cycle_reverse).toBe("none")
})
