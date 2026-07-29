import { expect, test } from "bun:test"
import plugin from "../../src/feature-plugins/system/editor"

test("the editor plugin registers a route and an open command", async () => {
  const routes: string[] = []
  const commands: string[] = []
  const api = {
    route: { register: (list: { name: string }[]) => routes.push(...list.map((item) => item.name)) },
    keymap: { registerLayer: (layer: { commands: { name: string }[] }) => commands.push(...layer.commands.map((c) => c.name)) },
  }
  await plugin.tui(api as never, undefined, {} as never)
  expect(routes).toContain("editor")
  expect(commands).toContain("editor.open")
})
