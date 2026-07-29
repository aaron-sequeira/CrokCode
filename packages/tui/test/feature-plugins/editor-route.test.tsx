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

function editorSource() {
  return Bun.file(new URL("../../src/feature-plugins/system/editor/index.tsx", import.meta.url)).text()
}

// Global constraint: never hardcode a key in a component. A literal here means a
// rebound key silently leaves the original one live.
test("the editor route spells out no keys of its own", async () => {
  const source = await editorSource()
  for (const key of ['"ctrl+s"', '"ctrl+w"', '"escape"', '"ctrl+q"', '"j,down"', '"k,up"', '"enter,space"']) {
    expect(source, `${key} is hardcoded in the editor route`).not.toInclude(key)
  }
})

// The buffers have to outlive the route: esc leaves, and re-entering must find
// the unsaved text still there. Route-scoped state cannot do that.
test("the buffer store lives in plugin scope, not route scope", async () => {
  const source = await editorSource()
  const pluginScope = source.slice(source.indexOf("const tui: TuiPlugin"))
  expect(pluginScope).toInclude("createEditorSession()")
  expect(source).toInclude("session={session}")
})

// Colors come from theme tokens only.
test("the editor route uses no color literals", async () => {
  const source = await editorSource()
  expect(source).not.toMatch(/#[0-9a-fA-F]{3,8}"/)
})
