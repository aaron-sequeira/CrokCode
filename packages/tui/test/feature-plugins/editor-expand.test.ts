import { expect, test } from "bun:test"
import { flattenFileTree } from "../../src/feature-plugins/system/file-tree-utils"
import { buildTree, expandedNodeIds, rowExpansionPath, togglePath } from "../../src/feature-plugins/system/editor/expand"

// The sequence a user actually performs: the root listing arrives as markers,
// they click a folder, its children load and the tree is REBUILT (node ids are
// positional, so they all move), then they click the same folder again to close
// it. The second click is the one that was broken.

const visible = (paths: readonly string[], expanded: ReadonlySet<string>) => {
  const tree = buildTree(paths)
  return flattenFileTree(tree, expandedNodeIds(tree, expanded)).map((row) => rowExpansionPath(tree, row.id))
}

// The server reports native separators. On Windows that is backslashes, and
// buildFileTree splits on "/" alone — so an unnormalised path is a single
// segment, every entry becomes a top-level leaf, no directory node is ever
// built, and the tree cannot nest or collapse. This is what shipped.
test("windows separators must be normalised or the tree is flat", () => {
  const raw = buildTree([".turbo\\", ".turbo\\turbo-typecheck.log"])
  expect(raw.nodes.every((node) => node.kind === "file")).toBe(true)
  expect(expandedNodeIds(raw, new Set([".turbo\\"])).size).toBe(0)

  const normalised = buildTree([".turbo/", ".turbo/turbo-typecheck.log"])
  expect(normalised.nodes.some((node) => node.kind === "directory")).toBe(true)
  expect(expandedNodeIds(normalised, new Set([".turbo"])).size).toBe(1)
})

test("a windows-shaped listing nests and collapses once normalised", () => {
  const paths = ["bin/", "bin/crokcode", "package.json"]
  const open = visible(paths, new Set(["bin"]))
  expect(open).toEqual(["bin", "bin/crokcode", "package.json"])
  const closed = visible(paths, new Set())
  expect(closed).toEqual(["bin", "package.json"])
})

test("an unlisted directory arrives as a marker and is still a leaf", () => {
  const tree = buildTree(["src/", "test/"])
  expect(tree.nodes.map((node) => node.kind)).toEqual(["file", "file"])
})

test("clicking an unlisted folder expands it, clicking again collapses it", () => {
  const paths = ["src/", "test/"]
  const tree = buildTree(paths)
  const row = flattenFileTree(tree, new Set()).find((item) => item.name === "src")!
  const path = rowExpansionPath(tree, row.id)

  const opened = togglePath(new Set(), path)
  expect(opened.has("src")).toBe(true)

  const closed = togglePath(opened, path)
  expect(closed.has("src")).toBe(false)
})

test("a folder still collapses after its children arrive and the tree is rebuilt", () => {
  // Click 1: expand "src", which is a marker leaf at this point.
  let expanded = togglePath(new Set<string>(), "src")

  // Its listing arrives; the marker is dropped and "src" becomes a real
  // directory node with different ids than before.
  const paths = ["src/a.ts", "src/nested/", "test/"]
  expect(visible(paths, expanded)).toEqual(["src", "src/a.ts", "src/nested", "test"])

  // Click 2 on the same row must close it.
  const tree = buildTree(paths)
  const row = flattenFileTree(tree, expandedNodeIds(tree, expanded)).find((item) => item.name === "src")!
  expanded = togglePath(expanded, rowExpansionPath(tree, row.id))
  expect(visible(paths, expanded)).toEqual(["src", "test"])
})

test("every node in a collapsed chain maps to the same row path — why toggling by node id cannot work", () => {
  const tree = buildTree(["a/b/c/leaf.ts", "z.ts"])
  const chain = tree.nodes.filter((node) => node.kind === "directory").map((node) => rowExpansionPath(tree, node.id))
  // a, b and c are three separate nodes that all control the one visible row.
  expect(chain).toEqual(["a/b/c", "a/b/c", "a/b/c"])
  // So removing ONE id from the expanded set and re-deriving the paths from the
  // survivors puts the path straight back: the collapse undoes itself.
  const ids = expandedNodeIds(tree, new Set(["a/b/c"]))
  expect(ids.size).toBe(3)
  const survivors = new Set([...ids].filter((id) => id !== [...ids][0]))
  expect(new Set([...survivors].map((id) => rowExpansionPath(tree, id)))).toContain("a/b/c")
})

test("a single-child chain collapses as one row and toggles by its deepest link", () => {
  const paths = ["a/b/c/leaf.ts", "z.ts"]
  const tree = buildTree(paths)
  const row = flattenFileTree(tree, new Set()).find((item) => item.name.startsWith("a"))!
  // The row renders as "a/b/c" and controls the expansion of that deepest link.
  expect(rowExpansionPath(tree, row.id)).toBe("a/b/c")
  const expanded = togglePath(new Set(), rowExpansionPath(tree, row.id))
  expect(visible(paths, expanded)).toEqual(["a/b/c", "a/b/c/leaf.ts", "z.ts"])
  const closed = togglePath(expanded, "a/b/c")
  expect(visible(paths, closed)).toEqual(["a/b/c", "z.ts"])
})
