import { expect, test } from "bun:test"
import { mergeEntries, treeItems } from "../../src/feature-plugins/system/editor/tree-source"

test("merging keeps paths unique and sorted", () => {
  const merged = mergeEntries(["src/b.ts"], [
    { path: "src/a.ts", type: "file" },
    { path: "src/b.ts", type: "file" },
  ])
  expect(merged).toEqual(["src/a.ts", "src/b.ts"])
})

test("a directory contributes a trailing-slash marker so empty directories still show", () => {
  const merged = mergeEntries([], [{ path: "src/empty", type: "directory" }])
  expect(merged).toEqual(["src/empty/"])
})

test("expanding a second directory does not drop the first one's files", () => {
  const first = mergeEntries([], [{ path: "src/a.ts", type: "file" }])
  const second = mergeEntries(first, [{ path: "test/b.ts", type: "file" }])
  expect(second).toEqual(["src/a.ts", "test/b.ts"])
})

test("tree items strip the directory marker", () => {
  expect(treeItems(["src/empty/", "src/a.ts"])).toEqual([{ file: "src/empty" }, { file: "src/a.ts" }])
})
