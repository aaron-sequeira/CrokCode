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

// The whole point of the server write endpoint is that the editor works against a
// remote server. Reaching for the local filesystem to stat a file silently
// disables the stale-write guard in exactly that case, so the route must get its
// mtime from the read response and nowhere else.
test("the editor route never touches the local filesystem", async () => {
  const source = await Bun.file(new URL("../../src/feature-plugins/system/editor/index.tsx", import.meta.url)).text()
  expect(source).not.toInclude("node:fs")
  expect(source).not.toInclude("statSync")
})
