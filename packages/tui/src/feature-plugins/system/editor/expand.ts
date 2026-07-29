import { buildFileTree, type FileTree, type FileTreeNode } from "../file-tree-utils"
import { treeItems } from "./tree-source"

export const DIRECTORY_MARK = "/"

export function directoryMarkers(paths: readonly string[]) {
  return new Set(paths.filter((item) => item.endsWith(DIRECTORY_MARK)).map((item) => item.slice(0, -1)))
}

/**
 * A directory keeps its marker only until its children arrive. Left in place
 * afterwards, `treeItems` would strip the slash and `buildFileTree` would grow a
 * second, file-kind node sitting next to the real directory node.
 */
export function withoutStaleMarkers(paths: readonly string[]) {
  const ancestors = new Set<string>()
  for (const item of paths) {
    const base = item.endsWith(DIRECTORY_MARK) ? item.slice(0, -1) : item
    const segments = base.split("/")
    for (let index = 1; index < segments.length; index++) ancestors.add(segments.slice(0, index).join("/"))
  }
  return paths.filter((item) => !(item.endsWith(DIRECTORY_MARK) && ancestors.has(item.slice(0, -1))))
}

export function nodePath(tree: FileTree, id: number) {
  const segments: string[] = []
  let current: number | undefined = id
  while (current !== undefined) {
    const node: FileTreeNode | undefined = tree.nodes[current]
    if (!node) break
    segments.unshift(node.name)
    current = node.parent
  }
  return segments.join("/")
}

/**
 * `flattenFileTree` collapses `a/b/c` into a single row keyed by `a`, and shows
 * the children of `c`. The path to list, and the path whose expansion the row
 * controls, is that deepest link.
 */
export function deepestCollapsed(tree: FileTree, id: number): number {
  const node = tree.nodes[id]
  if (!node || node.kind !== "directory" || node.children.length !== 1) return id
  const child = tree.nodes[node.children[0]!]
  return child?.kind === "directory" ? deepestCollapsed(tree, child.id) : id
}

export function buildTree(paths: readonly string[]) {
  return buildFileTree(treeItems(withoutStaleMarkers(paths)))
}

/**
 * Expansion is tracked by PATH, not by node id, because ids are positional and
 * every listing rebuilds the tree. Toggling therefore has to work the same
 * whether the row is a real directory node or a directory nobody has listed yet
 * — the latter is still a leaf, so it builds a file-kind node.
 */
export function togglePath(expanded: ReadonlySet<string>, path: string): Set<string> {
  const next = new Set(expanded)
  if (!next.delete(path)) next.add(path)
  return next
}

/** The path a row controls the expansion of. */
export function rowExpansionPath(tree: FileTree, id: number) {
  return nodePath(tree, deepestCollapsed(tree, id))
}

export function expandedNodeIds(tree: FileTree, expanded: ReadonlySet<string>) {
  const result = new Set<number>()
  for (const node of tree.nodes) {
    if (node.kind !== "directory") continue
    if (expanded.has(rowExpansionPath(tree, node.id))) result.add(node.id)
  }
  return result
}
