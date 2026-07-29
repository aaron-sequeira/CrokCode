/** @jsxImportSource @opentui/solid */
import type { TuiPlugin, TuiPluginApi, TuiRouteCurrent } from "@crokcode/plugin/tui"
import type { MouseEvent, ScrollBoxRenderable, TextareaRenderable } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import path from "path"
import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show } from "solid-js"
import { useProject } from "../../../context/project"
import { useSDK } from "../../../context/sdk"
import { useBindings, useCommandShortcut } from "../../../keymap"
import { Locale } from "../../../util/locale"
import { flattenFileTree, moveFileTreeSelection, type FileTreeRow } from "../file-tree-utils"
import { beforeSave, isDirty, onExternalChange, type BufferState } from "./buffer"
import {
  buildTree,
  directoryMarkers,
  expandedNodeIds,
  rowExpansionPath,
  togglePath,
  withoutStaleMarkers,
  DIRECTORY_MARK,
} from "./expand"
import { mergeEntries, treeItems, type DirectoryEntry } from "./tree-source"

const ROUTE = "editor"
const DIFF_ROUTE = "diff"
const TREE_WIDTH = 30
const GUTTER_MIN_WIDTH = 4
/** Header row, footer row, and the two rows the pane borders take. */
const CHROME_ROWS = 4
/** Top border, headline, the row of choices, bottom border. */
const BANNER_ROWS = 4
/**
 * A server that does not report `mtime` leaves the timestamp unknown. NaN never
 * compares equal, not even to itself, so an unknown timestamp can never be
 * mistaken for a match and silently wave a stale write through.
 */
const UNKNOWN_MTIME = Number.NaN

type EditorFocus = "tree" | "editor"
type Conflict = { readonly file: string; readonly text: string; readonly mtime: number }

/**
 * Everything the route must not lose when it is left and re-entered.
 *
 * The spec requires that leaving with unsaved changes "keeps the buffer, so
 * returning finds your work intact". The renderables themselves cannot survive:
 * the Solid reconciler calls `destroyRecursively()` on every node it removes,
 * so a handle held past unmount is a dead handle. What survives is the text, the
 * saved-state map and the tree's shape, captured on the way out and replayed on
 * the way back in. This lives in plugin scope, so it outlives the route and dies
 * only with the plugin.
 */
type EditorSession = {
  paths: readonly string[]
  expandedPaths: ReadonlySet<string>
  selectedPath: string | undefined
  openFiles: readonly string[]
  activeFile: string | undefined
  focus: EditorFocus
  states: ReadonlyMap<string, BufferState>
  /** Buffer text per open file, as of the last time the route unmounted. */
  readonly text: Map<string, string>
  readonly cursors: Map<string, number>
  readonly absolutePaths: Map<string, string>
  readonly listed: Set<string>
  /** Workspace root, inferred from the first listing that reports one. */
  root: string | undefined
}

function createEditorSession(): EditorSession {
  return {
    paths: [],
    expandedPaths: new Set(),
    selectedPath: undefined,
    openFiles: [],
    activeFile: undefined,
    focus: "tree",
    states: new Map(),
    text: new Map(),
    cursors: new Map(),
    absolutePaths: new Map(),
    listed: new Set(),
    root: undefined,
  }
}

/** Watchers report native separators; comparisons here are done in one form. */
function normalizeSeparators(value: string) {
  return value.replaceAll("\\", "/")
}

function scrollRowIntoView(scroll: ScrollBoxRenderable | undefined, index: number) {
  if (!scroll) return
  if (index < scroll.scrollTop) {
    scroll.scrollTo(index)
    return
  }
  if (index >= scroll.scrollTop + scroll.viewport.height) {
    scroll.scrollTo(index - scroll.viewport.height + 1)
  }
}

// ---------------------------------------------------------------------------
// Path helpers. `tree-source` marks a directory with a trailing slash so an
// empty one still gets a node; everything below turns those markers back into
// something the (diff-shaped) tree utilities can render.
// ---------------------------------------------------------------------------





function EditorRoute(props: { api: TuiPluginApi; session: EditorSession }) {
  const sdk = useSDK()
  const project = useProject()
  const dimensions = useTerminalDimensions()
  const theme = () => props.api.theme.current
  const workspace = () => project.workspace.current()
  const params = () =>
    ("params" in props.api.route.current ? props.api.route.current.params : undefined) as
      | { file?: string; returnRoute?: TuiRouteCurrent }
      | undefined

  const session = props.session

  const [paths, setPaths] = createSignal<readonly string[]>(session.paths)
  const [expandedPaths, setExpandedPaths] = createSignal<ReadonlySet<string>>(session.expandedPaths)
  const [pending, setPending] = createSignal<ReadonlySet<string>>(new Set())
  const [selectedPath, setSelectedPath] = createSignal<string | undefined>(session.selectedPath)
  const [openFiles, setOpenFiles] = createSignal<readonly string[]>(session.openFiles)
  const [activeFile, setActiveFile] = createSignal<string | undefined>(session.activeFile)
  const [focus, setFocus] = createSignal<EditorFocus>(session.focus)
  const [conflict, setConflict] = createSignal<Conflict | undefined>()
  const [states, setStates] = createSignal<ReadonlyMap<string, BufferState>>(session.states)
  // Text is native-side state, so nothing reactive changes when the user types.
  // The dirty dot listens to this instead.
  const [revision, setRevision] = createSignal(0)
  // Bumped only when a renderable is attached, so the focus effect can re-run
  // for a buffer that did not exist when the effect last ran.
  const [attached, setAttached] = createSignal(0)

  // Native handles. Every renderable here owns one EditBuffer and one EditorView.
  const renderables = new Map<string, TextareaRenderable>()
  // Seeded from the session so a buffer left open on the way out comes back with
  // its unsaved text, not with whatever is on disk.
  const initialText = new Map(session.text)
  const absolutePaths = session.absolutePaths
  const listed = session.listed

  /**
   * The text only exists inside the renderable, so it has to be read out before
   * the renderable goes. Called from the buffer's own cleanup and again from the
   * route's, so it does not depend on which of the two disposal orders Solid
   * happens to use.
   */
  const captureBuffer = (file: string) => {
    const renderable = renderables.get(file)
    if (!renderable || renderable.isDestroyed) return
    session.text.set(file, renderable.plainText)
    session.cursors.set(file, renderable.cursorOffset)
    renderable.blur()
  }

  onCleanup(() => {
    // Capture before destroying: this is the last moment the unsaved text still
    // exists anywhere, and the spec says leaving must not discard it.
    for (const file of renderables.keys()) captureBuffer(file)
    session.paths = paths()
    session.expandedPaths = expandedPaths()
    session.selectedPath = selectedPath()
    session.openFiles = openFiles()
    session.activeFile = activeFile()
    session.focus = focus()
    session.states = states()
    for (const renderable of renderables.values()) {
      if (!renderable.isDestroyed) renderable.destroy()
    }
    renderables.clear()
  })

  
  const markers = createMemo(() => directoryMarkers(paths()))
  const items = createMemo(() => treeItems(withoutStaleMarkers(paths())))
  const tree = createMemo(() => buildTree(paths()))
  const expandedNodes = createMemo(() => expandedNodeIds(tree(), expandedPaths()))
  const rows = createMemo(() => flattenFileTree(tree(), expandedNodes()))

  const rowPath = (row: FileTreeRow) =>
    row.fileIndex !== undefined ? (items()[row.fileIndex]?.file ?? row.name) : rowExpansionPath(tree(), row.id)
  // A directory nobody has listed yet arrives as a marker, so it builds a
  // file-kind node. The marker set is the authority on what is a directory.
  const rowIsDirectory = (row: FileTreeRow) => row.kind === "directory" || markers().has(rowPath(row))
  const selectedRow = createMemo(() => rows().find((row) => rowPath(row) === selectedPath()))

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

  /**
   * Every listing reports a path and its absolute form, and the difference
   * between them is the workspace root. Knowing it turns watcher matching from a
   * suffix guess into an exact comparison.
   */
  const rememberRoot = (node: { path: string; absolute: string }) => {
    if (session.root !== undefined) return
    const absolute = normalizeSeparators(node.absolute)
    const relative = normalizeSeparators(node.path)
    if (!relative || !absolute.endsWith(`/${relative}`)) return
    session.root = absolute.slice(0, absolute.length - relative.length - 1)
  }

  const listDirectory = async (directory: string) => {
    if (listed.has(directory) || pending().has(directory)) return
    markPending(directory, true)
    try {
      const result = await sdk.client.file.list({ path: directory || ".", workspace: workspace() })
      if (result.error) return
      const nodes = result.data ?? []
      for (const node of nodes) {
        absolutePaths.set(node.path, node.absolute)
        rememberRoot(node)
      }
      const entries: DirectoryEntry[] = nodes.map((node) => ({ path: node.path, type: node.type }))
      setPaths((current) => mergeEntries(current, entries))
      listed.add(directory)
    } catch {
      props.api.ui.toast({ variant: "error", message: `Could not list ${directory || "."}` })
    } finally {
      markPending(directory, false)
    }
  }

  // Expansion is tracked by path, so toggle by path. The old code toggled a node
  // id and then re-derived the whole set from the survivors, which cannot work:
  // flattenFileTree collapses a/b/c into one row, so nodes a, b and c all map to
  // that single row path. Dropping one id left the other two to put the path
  // straight back, and the folder reopened the instant it closed.
  const toggleDirectory = (row: FileTreeRow) => {
    const file = rowPath(row)
    setExpandedPaths((current) => togglePath(current, file))
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

  /**
   * The read endpoint stamps `mtime` from the same clock the write endpoint
   * reports, so the two can be compared. A server that omits it leaves the
   * timestamp unknown, which `UNKNOWN_MTIME` records honestly instead of
   * inventing a `0` that would compare equal to itself and quietly turn the
   * stale-write guard off.
   */
  const readFromDisk = async (file: string) => {
    const result = await sdk.client.file.read({ path: file, raw: "true", workspace: workspace() })
    if (result.error || !result.data) return undefined
    if (result.data.type !== "text") return undefined
    return { text: result.data.content, mtime: result.data.mtime ?? UNKNOWN_MTIME }
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
    // The mtime to compare against only exists on disk, so read before writing.
    // The same snapshot then feeds the banner, so a conflict costs no extra read.
    const disk = await readFromDisk(file)
    if (!disk) {
      props.api.ui.toast({ variant: "error", message: `Could not save ${file}` })
      return
    }
    // With both timestamps known the cheap mtime guard answers it. With either
    // one unknown there is nothing to compare, so fall back to the question the
    // guard is really asking — did the bytes move since we last read them — and
    // conflict if they did, rather than clobbering on an unanswerable check.
    const guarded = !Number.isNaN(disk.mtime) && !Number.isNaN(state.mtime)
    const conflicted = guarded
      ? beforeSave(state, { mtime: disk.mtime }).action === "conflict"
      : disk.text !== state.savedText
    if (conflicted) {
      setConflict({ file, text: disk.text, mtime: disk.mtime })
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
    }
    // Both choices leave the buffer's own text alone or replace it outright, but
    // either way the disk version just became known. Recording it — timestamp
    // and content — is what lets the next save through; leaving the old state in
    // place means every later ctrl+s re-conflicts against a change already
    // answered, with no way to ever persist your own version.
    setState(current.file, { savedText: current.text, mtime: current.mtime })
    setRevision((value) => value + 1)
    setConflict(undefined)
  }

  onMount(() => {
    void listDirectory("")
    const file = params()?.file
    if (typeof file === "string" && file) void openFile(file)
  })

  /**
   * The watcher reports whatever the platform gives it: a relative path, an
   * absolute one, and on Windows one with backslashes. A `endsWith("/" + file)`
   * test matches none of those on Windows, and on posix it also matches
   * `unrelated/root/src/index.ts` for an open `src/index.ts`. Comparing whole
   * paths against the known root is both separator-agnostic and exact.
   */
  const matchesOpenFile = (changed: string, file: string) => {
    const target = normalizeSeparators(changed)
    const relative = normalizeSeparators(file)
    if (target === relative) return true
    const absolute = absolutePaths.get(file)
    if (absolute !== undefined && normalizeSeparators(absolute) === target) return true
    return session.root !== undefined && target === `${session.root}/${relative}`
  }

  onCleanup(
    props.api.event.on("file.watcher.updated", (event) => {
      const changed = event.properties.file
      for (const file of openFiles()) {
        if (matchesOpenFile(changed, file)) void applyExternalChange(file)
      }
    }),
  )

  // -------------------------------------------------------------------------
  // Keymap
  // -------------------------------------------------------------------------

  const leave = () => {
    const returnRoute = params()?.returnRoute
    // Opening the editor from inside the editor stores the editor as its own
    // return route, which would navigate right back here and trap the user.
    const name = returnRoute && returnRoute.name !== ROUTE ? returnRoute.name : "home"
    const routeParams = returnRoute && name === returnRoute.name && "params" in returnRoute
      ? returnRoute.params
      : undefined
    // ponytail: diagnostic — the exit path is reported as not working and
    // nothing in the code explains it, so say out loud what we are doing.
    // Remove once a real run confirms which half is at fault.
    props.api.ui.toast({ variant: "info", message: `Leaving editor → ${name}` })
    props.api.route.navigate(name, routeParams)
  }

  const commands = [
    {
      name: "editor.close",
      title: "Close the editor",
      category: "Editor",
      run: leave,
    },
    {
      name: "editor.back",
      title: "Go back one step in the editor",
      category: "Editor",
      // Exactly one step at a time: editor pane → tree → chat. Leaving never
      // discards the buffer, the session store holds it until the plugin dies.
      run() {
        if (conflict()) {
          resolveConflict("mine")
          return
        }
        if (focus() === "editor") {
          setFocus("tree")
          return
        }
        leave()
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
      name: "editor.newline",
      title: "Insert a newline",
      category: "Editor",
      run() {
        const file = activeFile()
        const renderable = file ? renderables.get(file) : undefined
        if (!renderable || renderable.isDestroyed) return
        renderable.insertText("\n")
        setRevision((value) => value + 1)
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

  // Every key here comes from the keymap layer — no component ever spells one
  // out. Which group is live is still a component decision: the single-letter
  // tree and banner keys are only offered when the text buffer does not hold
  // focus, otherwise they would eat the user's typing.
  // gather MEMOISES BY NAME: the first call for a name wins and every later call
  // with that name gets the same array back, whatever commands it asked for. So
  // each group needs its own name. Sharing one name silently dropped the chrome
  // keys — no escape, no ctrl+q, no save — and pinned the tree keys on, so space
  // toggled a folder instead of typing a space.
  const gather = (name: string, names: readonly string[]) => props.api.tuiConfig.keybinds.gather(name, names)

  useBindings(() => ({
    commands,
    // The editor's own verbs must win over the global managed-textarea layer,
    // the same reason the dialog prompt raises its priority.
    priority: 1,
    bindings: [
      ...(focus() === "tree" && !conflict()
        ? gather("editor.tree", ["editor.down", "editor.up", "editor.toggle"])
        : []),
      ...(conflict()
        ? gather("editor.conflict", ["editor.conflict.keep", "editor.conflict.take", "editor.conflict.diff"])
        : []),
      // Only while the buffer has focus, so the tree's own enter still opens a
      // file rather than typing into whatever was last open.
      ...(focus() === "editor" && !conflict() ? gather("editor.buffer", ["editor.newline"]) : []),
      ...gather("editor", ["editor.save", "editor.focus.next", "editor.back", "editor.close"]),
    ],
  }))

  const saveShortcut = useCommandShortcut("editor.save")
  const focusShortcut = useCommandShortcut("editor.focus.next")
  const closeShortcut = useCommandShortcut("editor.close")
  const toggleShortcut = useCommandShortcut("editor.toggle")

  const backShortcut = useCommandShortcut("editor.back")

  const hints = createMemo(() =>
    focus() === "tree"
      ? [
          { shortcut: toggleShortcut(), label: "open" },
          { shortcut: focusShortcut(), label: "focus editor" },
          { shortcut: backShortcut(), label: "back" },
          { shortcut: closeShortcut(), label: "close" },
        ]
      : [
          { shortcut: saveShortcut(), label: "save" },
          { shortcut: focusShortcut(), label: "focus tree" },
          { shortcut: backShortcut(), label: "tree" },
          { shortcut: closeShortcut(), label: "close" },
        ],
  )

  // -------------------------------------------------------------------------
  // Focus
  // -------------------------------------------------------------------------

  /**
   * Nothing else focuses this textarea. With a plugin route active the prompt
   * input is unmounted, so unless the active buffer is focused here the renderer
   * has no focused editor at all: `handleKeyPress` never runs, the managed
   * `input.*` layer stays disabled, and typing goes nowhere. A mouse click used
   * to be the only way in.
   */
  const applyFocus = () => {
    const file = activeFile()
    // While the banner is up its single-letter choices have to reach the keymap,
    // so the buffer gives up focus until the conflict is answered.
    const wanted = focus() === "editor" && !conflict() ? file : undefined
    for (const [name, renderable] of renderables) {
      if (renderable.isDestroyed) continue
      if (name === wanted) renderable.focus()
      else renderable.blur()
    }
  }

  createEffect(() => {
    attached()
    activeFile()
    focus()
    conflict()
    applyFocus()
  })

  onMount(() => {
    // The renderable is not attached on the first tick; the dialog prompt waits
    // the same way before claiming focus.
    setTimeout(applyFocus, 1)
  })

  // -------------------------------------------------------------------------
  // Layout
  // -------------------------------------------------------------------------

  let treeScroll: ScrollBoxRenderable | undefined

  /**
   * A row that is listing its children renders a second "loading…" line, so a
   * row's index is not its line in the scrollbox.
   */
  const treeRowLines = createMemo(() => {
    const lines: number[] = []
    let line = 0
    for (const row of rows()) {
      lines.push(line)
      line += pending().has(rowPath(row)) ? 2 : 1
    }
    return lines
  })

  // Without this, j/k in a directory taller than the pane moves a selection the
  // user cannot see. Same treatment the diff viewer's tree gets.
  createEffect(() => {
    const selected = selectedPath()
    if (selected === undefined) return
    const index = rows().findIndex((row) => rowPath(row) === selected)
    if (index === -1) return
    const line = treeRowLines()[index] ?? index
    const bring = () => scrollRowIntoView(treeScroll, line)
    bring()
    requestAnimationFrame(bring)
  })

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
          <text fg={theme().accent}>●</text>
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
            ref={(element: ScrollBoxRenderable) => (treeScroll = element)}
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
                onCleanup(() => captureBuffer(file))
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
                          const text = initialText.get(file) ?? ""
                          renderable.setText(text)
                          initialText.delete(file)
                          const cursor = session.cursors.get(file)
                          if (cursor !== undefined) {
                            renderable.cursorOffset = Math.min(cursor, text.length)
                            session.cursors.delete(file)
                          }
                          setRevision((value) => value + 1)
                          setAttached((value) => value + 1)
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
  // Plugin scope, not route scope. The route is unmounted every time the user
  // leaves, and everything declared inside it dies with it; this is what carries
  // unsaved buffers across that boundary.
  const session = createEditorSession()

  api.route.register([
    {
      name: ROUTE,
      render: () => <EditorRoute api={api} session={session} />,
    },
  ])

  api.keymap.registerLayer({
    commands: [
      {
        name: "editor.open",
        title: "Open the file editor",
        // Not "editor" — prompt.editor already owns that slash name for the
        // external $EDITOR, and two commands answering /editor is a coin toss.
        slashName: "files",
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
