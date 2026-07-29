/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiRouteCurrent } from "@crokcode/plugin/tui"
import type { MouseEvent, TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { statSync } from "node:fs"
import path from "path"
import { createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useProject } from "../../../context/project"
import { useSDK } from "../../../context/sdk"
import { useBindings, useCommandShortcut } from "../../../keymap"
import { Locale } from "../../../util/locale"
import {
  buildFileTree,
  flattenFileTree,
  moveFileTreeSelection,
  toggleFileTreeDirectory,
  type FileTree,
  type FileTreeNode,
  type FileTreeRow,
} from "../file-tree-utils"
import { beforeSave, isDirty, onExternalChange, type BufferState } from "./buffer"
import { mergeEntries, treeItems, type DirectoryEntry } from "./tree-source"

const ROUTE = "editor"
const DIFF_ROUTE = "diff"
const TREE_WIDTH = 30
const GUTTER_MIN_WIDTH = 4
const DIRECTORY_MARK = "/"
/** Header row, footer row, and the two rows the pane borders take. */
const CHROME_ROWS = 4
const BANNER_ROWS = 3

type EditorFocus = "tree" | "editor"
type Conflict = { readonly file: string; readonly text: string; readonly mtime: number }

// ---------------------------------------------------------------------------
// Path helpers. `tree-source` marks a directory with a trailing slash so an
// empty one still gets a node; everything below turns those markers back into
// something the (diff-shaped) tree utilities can render.
// ---------------------------------------------------------------------------

function directoryMarkers(paths: readonly string[]) {
  return new Set(paths.filter((item) => item.endsWith(DIRECTORY_MARK)).map((item) => item.slice(0, -1)))
}

/**
 * A directory keeps its marker only until its children arrive. Left in place
 * afterwards, `treeItems` would strip the slash and `buildFileTree` would grow a
 * second, file-kind node sitting next to the real directory node.
 */
function withoutStaleMarkers(paths: readonly string[]) {
  const ancestors = new Set<string>()
  for (const item of paths) {
    const base = item.endsWith(DIRECTORY_MARK) ? item.slice(0, -1) : item
    const segments = base.split("/")
    for (let index = 1; index < segments.length; index++) ancestors.add(segments.slice(0, index).join("/"))
  }
  return paths.filter((item) => !(item.endsWith(DIRECTORY_MARK) && ancestors.has(item.slice(0, -1))))
}

function nodePath(tree: FileTree, id: number) {
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
function deepestCollapsed(tree: FileTree, id: number): number {
  const node = tree.nodes[id]
  if (!node || node.kind !== "directory" || node.children.length !== 1) return id
  const child = tree.nodes[node.children[0]!]
  return child?.kind === "directory" ? deepestCollapsed(tree, child.id) : id
}

/** 0 means "unknown", which compares equal to itself and so never blocks a save. */
function diskMtime(absolute: string | undefined) {
  if (!absolute) return 0
  try {
    return statSync(absolute).mtimeMs
  } catch {
    return 0
  }
}

function EditorRoute(props: { api: TuiPluginApi }) {
  const sdk = useSDK()
  const project = useProject()
  const dimensions = useTerminalDimensions()
  const theme = () => props.api.theme.current
  const workspace = () => project.workspace.current()
  const params = () =>
    ("params" in props.api.route.current ? props.api.route.current.params : undefined) as
      | { file?: string; returnRoute?: TuiRouteCurrent }
      | undefined

  const [paths, setPaths] = createSignal<readonly string[]>([])
  const [expandedPaths, setExpandedPaths] = createSignal<ReadonlySet<string>>(new Set())
  const [pending, setPending] = createSignal<ReadonlySet<string>>(new Set())
  const [selectedPath, setSelectedPath] = createSignal<string | undefined>()
  const [openFiles, setOpenFiles] = createSignal<readonly string[]>([])
  const [activeFile, setActiveFile] = createSignal<string | undefined>()
  const [focus, setFocus] = createSignal<EditorFocus>("tree")
  const [conflict, setConflict] = createSignal<Conflict | undefined>()
  const [states, setStates] = createSignal<ReadonlyMap<string, BufferState>>(new Map())
  // Text is native-side state, so nothing reactive changes when the user types.
  // The dirty dot listens to this instead.
  const [revision, setRevision] = createSignal(0)

  // Native handles. Every renderable here owns one EditBuffer and one EditorView.
  const renderables = new Map<string, TextareaRenderable>()
  const initialText = new Map<string, string>()
  const absolutePaths = new Map<string, string>()
  const listed = new Set<string>()

  onCleanup(() => {
    for (const renderable of renderables.values()) {
      if (!renderable.isDestroyed) renderable.destroy()
    }
    renderables.clear()
  })

  const items = createMemo(() => treeItems(withoutStaleMarkers(paths())))
  const markers = createMemo(() => directoryMarkers(paths()))
  const tree = createMemo(() => buildFileTree(items()))
  const expandedNodes = createMemo(() => {
    const wanted = expandedPaths()
    const current = tree()
    const result = new Set<number>()
    for (const node of current.nodes) {
      if (node.kind !== "directory") continue
      if (wanted.has(nodePath(current, deepestCollapsed(current, node.id)))) result.add(node.id)
    }
    return result
  })
  const rows = createMemo(() => flattenFileTree(tree(), expandedNodes()))

  const rowPath = (row: FileTreeRow) =>
    row.fileIndex !== undefined
      ? (items()[row.fileIndex]?.file ?? row.name)
      : nodePath(tree(), deepestCollapsed(tree(), row.id))
  // A directory nobody has listed yet arrives as a marker, so it builds a
  // file-kind node. The marker set is the authority on what is a directory.
  const rowIsDirectory = (row: FileTreeRow) => row.kind === "directory" || markers().has(rowPath(row))
  const selectedRow = createMemo(() => rows().find((row) => rowPath(row) === selectedPath()))

  const absoluteOf = (file: string) =>
    absolutePaths.get(file) ?? path.resolve(props.api.state.path.directory ?? ".", file)

  const dirty = createMemo(() => {
    revision()
    const file = activeFile()
    if (!file) return false
    const state = states().get(file)
    const renderable = renderables.get(file)
    if (!state || !renderable || renderable.isDestroyed) return false
    return isDirty(state, renderable.plainText)
  })

  const setState = (file: string, state: BufferState) =>
    setStates((current) => {
      const next = new Map(current)
      next.set(file, state)
      return next
    })

  const markPending = (directory: string, value: boolean) =>
    setPending((current) => {
      const next = new Set(current)
      if (value) next.add(directory)
      else next.delete(directory)
      return next
    })

  // -------------------------------------------------------------------------
  // Tree
  // -------------------------------------------------------------------------

  const listDirectory = async (directory: string) => {
    if (listed.has(directory) || pending().has(directory)) return
    markPending(directory, true)
    try {
      const result = await sdk.client.file.list({ path: directory || ".", workspace: workspace() })
      if (result.error) return
      const nodes = result.data ?? []
      for (const node of nodes) absolutePaths.set(node.path, node.absolute)
      const entries: DirectoryEntry[] = nodes.map((node) => ({ path: node.path, type: node.type }))
      setPaths((current) => mergeEntries(current, entries))
      listed.add(directory)
    } catch {
      props.api.ui.toast({ variant: "error", message: `Could not list ${directory || "."}` })
    } finally {
      markPending(directory, false)
    }
  }

  const toggleDirectory = (row: FileTreeRow) => {
    const file = rowPath(row)
    const node = tree().nodes[row.id]
    if (node?.kind === "directory") {
      const next = toggleFileTreeDirectory(tree(), expandedNodes(), row.id)
      setExpandedPaths(new Set([...next].map((id) => nodePath(tree(), deepestCollapsed(tree(), id)))))
    } else {
      setExpandedPaths((current) => new Set(current).add(file))
    }
    if (!listed.has(file)) void listDirectory(file)
  }

  const moveSelection = (offset: number) => {
    const next = moveFileTreeSelection(rows(), selectedRow()?.id, offset)
    const row = rows().find((item) => item.id === next)
    setSelectedPath(row ? rowPath(row) : undefined)
  }

  // -------------------------------------------------------------------------
  // Buffers
  // -------------------------------------------------------------------------

  const readFromDisk = async (file: string) => {
    const result = await sdk.client.file.read({ path: file, raw: "true", workspace: workspace() })
    if (result.error || !result.data) return undefined
    if (result.data.type !== "text") return undefined
    return { text: result.data.content, mtime: diskMtime(absoluteOf(file)) }
  }

  const openFile = async (file: string) => {
    setActiveFile(file)
    setFocus("editor")
    if (openFiles().includes(file)) return
    const disk = await readFromDisk(file)
    if (!disk) {
      props.api.ui.toast({ variant: "error", message: `Could not open ${file}` })
      setActiveFile(undefined)
      return
    }
    initialText.set(file, disk.text)
    setState(file, { savedText: disk.text, mtime: disk.mtime })
    setOpenFiles((current) => [...current, file])
  }

  const activate = (row: FileTreeRow) => {
    setSelectedPath(rowPath(row))
    if (rowIsDirectory(row)) {
      toggleDirectory(row)
      return
    }
    void openFile(rowPath(row))
  }

  const save = async () => {
    const file = activeFile()
    const renderable = file ? renderables.get(file) : undefined
    const state = file ? states().get(file) : undefined
    if (!file || !renderable || !state || renderable.isDestroyed) return
    if (beforeSave(state, { mtime: diskMtime(absoluteOf(file)) }).action === "conflict") {
      await raiseConflict(file)
      return
    }
    const content = renderable.plainText
    const result = await sdk.client.file.write({ path: file, content, workspace: workspace() })
    if (result.error || !result.data) {
      props.api.ui.toast({ variant: "error", message: `Could not save ${file}` })
      return
    }
    setState(file, { savedText: content, mtime: result.data.mtime })
    setRevision((value) => value + 1)
  }

  const raiseConflict = async (file: string) => {
    const disk = await readFromDisk(file)
    if (!disk) return
    setConflict({ file, text: disk.text, mtime: disk.mtime })
  }

  const applyExternalChange = async (file: string) => {
    const renderable = renderables.get(file)
    const state = states().get(file)
    if (!renderable || !state || renderable.isDestroyed) return
    const disk = await readFromDisk(file)
    if (!disk) return
    const decision = onExternalChange(state, renderable.plainText, disk)
    if (decision.action === "none") {
      // The bytes did not move but the timestamp did — a `touch`, or a formatter
      // that rewrote the file to identical content. `onExternalChange` leaves the
      // known mtime alone on this branch, so without this refresh every later
      // save would fail `beforeSave` and report a conflict that does not exist.
      setState(file, { savedText: state.savedText, mtime: disk.mtime })
      return
    }
    if (decision.action === "conflict") {
      setConflict({ file, text: disk.text, mtime: disk.mtime })
      return
    }
    const offset = renderable.cursorOffset
    renderable.replaceText(decision.text)
    renderable.cursorOffset = Math.min(offset, decision.text.length)
    setState(file, { savedText: decision.text, mtime: decision.mtime })
    setRevision((value) => value + 1)
  }

  const resolveConflict = (choice: "mine" | "theirs" | "diff") => {
    const current = conflict()
    if (!current) return
    if (choice === "diff") {
      setConflict(undefined)
      props.api.route.navigate(DIFF_ROUTE, { mode: "git", returnRoute: props.api.route.current })
      return
    }
    if (choice === "theirs") {
      const renderable = renderables.get(current.file)
      if (renderable && !renderable.isDestroyed) {
        const offset = renderable.cursorOffset
        renderable.replaceText(current.text)
        renderable.cursorOffset = Math.min(offset, current.text.length)
      }
      setState(current.file, { savedText: current.text, mtime: current.mtime })
      setRevision((value) => value + 1)
    }
    setConflict(undefined)
  }

  onMount(() => {
    void listDirectory("")
    const file = params()?.file
    if (typeof file === "string" && file) void openFile(file)
  })

  onCleanup(
    props.api.event.on("file.watcher.updated", (event) => {
      const changed = event.properties.file
      for (const file of openFiles()) {
        if (changed === file || changed.endsWith(`/${file}`) || changed === absolutePaths.get(file)) {
          void applyExternalChange(file)
        }
      }
    }),
  )

  // -------------------------------------------------------------------------
  // Keymap
  // -------------------------------------------------------------------------

  const commands = [
    {
      name: "editor.close",
      title: "Close the editor",
      category: "Editor",
      run() {
        const returnRoute = params()?.returnRoute
        props.api.route.navigate(
          returnRoute?.name ?? "home",
          returnRoute && "params" in returnRoute ? returnRoute.params : undefined,
        )
      },
    },
    {
      name: "editor.save",
      title: "Save the open file",
      category: "Editor",
      run() {
        void save()
      },
    },
    {
      name: "editor.focus.next",
      title: "Switch editor focus",
      category: "Editor",
      run() {
        setFocus((current) => (current === "tree" ? "editor" : "tree"))
      },
    },
    {
      name: "editor.down",
      title: "Move down in the editor file tree",
      category: "Editor",
      run() {
        moveSelection(1)
      },
    },
    {
      name: "editor.up",
      title: "Move up in the editor file tree",
      category: "Editor",
      run() {
        moveSelection(-1)
      },
    },
    {
      name: "editor.toggle",
      title: "Open the selected file or folder",
      category: "Editor",
      run() {
        const row = selectedRow()
        if (row) activate(row)
      },
    },
    {
      name: "editor.conflict.keep",
      title: "Keep the buffer as it is",
      category: "Editor",
      run() {
        resolveConflict("mine")
      },
    },
    {
      name: "editor.conflict.take",
      title: "Take the version on disk",
      category: "Editor",
      run() {
        resolveConflict("theirs")
      },
    },
    {
      name: "editor.conflict.diff",
      title: "Diff the file that changed",
      category: "Editor",
      run() {
        resolveConflict("diff")
      },
    },
  ]

  useBindings(() => ({
    commands,
    bindings: [
      // Single-letter defaults are only offered while the text buffer does not
      // have focus, otherwise they would eat the user's typing.
      ...(focus() === "tree" && !conflict()
        ? [
            { key: "j,down", cmd: "editor.down", desc: "Move down in the file tree" },
            { key: "k,up", cmd: "editor.up", desc: "Move up in the file tree" },
            { key: "enter,space", cmd: "editor.toggle", desc: "Open the selected file or folder" },
          ]
        : []),
      ...(conflict()
        ? [
            { key: "k", cmd: "editor.conflict.keep", desc: "Keep mine" },
            { key: "t", cmd: "editor.conflict.take", desc: "Take theirs" },
            { key: "d", cmd: "editor.conflict.diff", desc: "Diff" },
          ]
        : []),
      { key: "ctrl+s", cmd: "editor.save", desc: "Save the open file" },
      { key: "ctrl+w", cmd: "editor.focus.next", desc: "Switch editor focus" },
      { key: "escape", cmd: "editor.close", desc: "Close the editor" },
      ...props.api.tuiConfig.keybinds.gather(
        "editor",
        commands.map((command) => command.name),
      ),
    ],
  }))

  const saveShortcut = useCommandShortcut("editor.save")
  const focusShortcut = useCommandShortcut("editor.focus.next")
  const closeShortcut = useCommandShortcut("editor.close")
  const toggleShortcut = useCommandShortcut("editor.toggle")

  const hints = createMemo(() =>
    focus() === "tree"
      ? [
          { shortcut: toggleShortcut(), label: "open" },
          { shortcut: focusShortcut(), label: "focus editor" },
          { shortcut: closeShortcut(), label: "close" },
        ]
      : [
          { shortcut: saveShortcut(), label: "save" },
          { shortcut: focusShortcut(), label: "focus tree" },
          { shortcut: closeShortcut(), label: "close" },
        ],
  )

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  const paneHeight = () =>
    Math.max(1, dimensions().height - CHROME_ROWS - (conflict() ? BANNER_ROWS : 0))
  const bufferWidth = () => Math.max(8, dimensions().width - TREE_WIDTH - GUTTER_MIN_WIDTH - 5)
  const borderColor = (pane: EditorFocus) => (focus() === pane ? theme().text : theme().textMuted)

  return (
    <box
      position="absolute"
      zIndex={2500}
      left={0}
      top={0}
      width={dimensions().width}
      height={dimensions().height}
      backgroundColor={theme().background}
    >
      <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} gap={1}>
        <text fg={theme().text} wrapMode="none">
          {activeFile() ? Locale.truncateLeft(activeFile()!, Math.max(4, dimensions().width - 12)) : "Editor"}
        </text>
        <Show when={dirty()}>
          <text fg={theme().warning}>●</text>
        </Show>
      </box>

      <Show when={conflict()}>
        {(current) => (
          <box
            flexShrink={0}
            height={BANNER_ROWS}
            paddingLeft={1}
            paddingRight={1}
            border={["top", "bottom"]}
            borderColor={theme().warning}
          >
            <text fg={theme().warning} wrapMode="none">
              {path.basename(current().file)} changed on disk
            </text>
            <box flexDirection="row" gap={2}>
              <text fg={theme().text} onMouseDown={() => resolveConflict("mine")}>
                [k]eep mine
              </text>
              <text fg={theme().text} onMouseDown={() => resolveConflict("theirs")}>
                [t]ake theirs
              </text>
              <text fg={theme().text} onMouseDown={() => resolveConflict("diff")}>
                [d]iff
              </text>
            </box>
          </box>
        )}
      </Show>

      <box flexDirection="row" flexGrow={1} minHeight={0}>
        <box
          width={TREE_WIDTH}
          flexShrink={0}
          minHeight={0}
          border={true}
          borderColor={borderColor("tree")}
          onMouseDown={() => setFocus("tree")}
        >
          <scrollbox
            verticalScrollbarOptions={{ visible: false }}
            horizontalScrollbarOptions={{ visible: false }}
          >
            <Show
              when={rows().length > 0}
              fallback={<text fg={theme().textMuted}>{pending().size > 0 ? "loading…" : "No files"}</text>}
            >
              <For each={rows()}>
                {(row) => {
                  const file = () => rowPath(row)
                  const selected = () => selectedPath() === file()
                  const marker = () =>
                    rowIsDirectory(row) ? (expandedNodes().has(row.id) ? "▾ " : "▸ ") : "  "
                  const label = () =>
                    Locale.truncate(row.name, Math.max(1, TREE_WIDTH - 4 - row.depth * 2 - marker().length))
                  return (
                    <>
                      <box
                        flexDirection="row"
                        width="100%"
                        backgroundColor={selected() && focus() === "tree" ? theme().primary : undefined}
                        onMouseDown={() => activate(row)}
                      >
                        <text fg={theme().textMuted} wrapMode="none" flexShrink={0}>
                          {" ".repeat(row.depth * 2)}
                          {marker()}
                        </text>
                        <text
                          fg={
                            selected() && focus() === "tree"
                              ? theme().background
                              : rowIsDirectory(row)
                                ? theme().textMuted
                                : theme().text
                          }
                          wrapMode="none"
                        >
                          {label()}
                        </text>
                      </box>
                      <Show when={pending().has(file())}>
                        <text fg={theme().textMuted} wrapMode="none">
                          {" ".repeat(row.depth * 2 + 2)}loading…
                        </text>
                      </Show>
                    </>
                  )
                }}
              </For>
            </Show>
          </scrollbox>
        </box>

        <box
          flexGrow={1}
          minWidth={0}
          minHeight={0}
          border={true}
          borderColor={borderColor("editor")}
          onMouseDown={() => setFocus("editor")}
        >
          <Show
            when={openFiles().length > 0}
            fallback={<text fg={theme().textMuted}>Select a file to start editing.</text>}
          >
            {/* Every open file keeps its own renderable, and so its own undo
                history, for as long as the route lives. Only the active one is
                laid out and drawn. */}
            <For each={openFiles()}>
              {(file) => {
                const active = () => activeFile() === file
                return (
                  <box
                    minHeight={0}
                    flexGrow={active() ? 1 : 0}
                    height={active() ? undefined : 0}
                    visible={active()}
                  >
                    <line_number
                      fg={theme().textMuted}
                      bg={theme().background}
                      minWidth={GUTTER_MIN_WIDTH}
                      paddingRight={1}
                    >
                      <textarea
                        width={bufferWidth()}
                        height={paneHeight()}
                        textColor={theme().text}
                        focusedTextColor={theme().text}
                        backgroundColor={theme().background}
                        focusedBackgroundColor={theme().background}
                        cursorColor={theme().text}
                        selectionBg={theme().backgroundElement}
                        selectionFg={theme().text}
                        wrapMode="none"
                        onContentChange={() => setRevision((value) => value + 1)}
                        onCursorChange={(event: { line: number }) => {
                          setRevision((value) => value + 1)
                          highlightCursorLine(file, event.line)
                        }}
                        onMouseDown={(event: MouseEvent) => {
                          setFocus("editor")
                          event.target?.focus()
                        }}
                        ref={(renderable: TextareaRenderable) => {
                          renderables.set(file, renderable)
                          renderable.setText(initialText.get(file) ?? "")
                          initialText.delete(file)
                          setRevision((value) => value + 1)
                        }}
                      />
                    </line_number>
                  </box>
                )
              }}
            </For>
          </Show>
        </box>
      </box>

      <box flexDirection="row" flexShrink={0} height={1} paddingLeft={1} gap={2}>
        <For each={hints()}>
          {(hint) => (
            <Show when={hint.shortcut}>
              <text fg={theme().text} wrapMode="none">
                {hint.shortcut} <span style={{ fg: theme().textMuted }}>{hint.label}</span>
              </text>
            </Show>
          )}
        </For>
      </box>
    </box>
  )

  function highlightCursorLine(file: string, line: number) {
    const renderable = renderables.get(file)
    const gutter = renderable?.parent
    if (!gutter || typeof (gutter as { clearAllLineColors?: unknown }).clearAllLineColors !== "function") return
    const target = gutter as unknown as {
      clearAllLineColors: () => void
      setLineColor: (line: number, color: { gutter: unknown; content: unknown }) => void
    }
    target.clearAllLineColors()
    target.setLineColor(line, { gutter: theme().text, content: theme().text })
  }
}

const tui: TuiPlugin = async (api) => {
  api.route.register([
    {
      name: ROUTE,
      render: () => <EditorRoute api={api} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "editor.open",
        title: "Open the file editor",
        slashName: "editor",
        category: "Editor",
        namespace: "palette",
        run() {
          api.route.navigate(ROUTE, { returnRoute: api.route.current })
          api.ui.dialog.clear()
        },
      },
    ],
  })
}

export default {
  id: "editor",
  tui,
}
