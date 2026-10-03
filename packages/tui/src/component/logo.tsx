import { RGBA, TextAttributes } from "@opentui/core"
import { createSignal, For, onCleanup, onMount, Show, type JSX } from "solid-js"
import { tint, useTheme } from "../context/theme"
import { croc, logo } from "../logo"

const GREEN = RGBA.fromHex("#a7d129")
const CREAM = RGBA.fromHex("#f7f0d0")

// Column-major order so the croc paints in from the snout (left) to the tail.
const CROC_ROWS = croc.length
const CROC_COLS = Math.max(...croc.map((line) => line.length))
const CROC_CELLS = CROC_COLS * CROC_ROWS

export function Logo() {
  const { theme } = useTheme()

  // Paint the mascot in on startup, like the TUI drawing a frame. Starts empty
  // and fills over ~0.6s; Solid's reactive text children drive the redraw.
  const [revealed, setRevealed] = createSignal(0)
  onMount(() => {
    const timer = setInterval(() => {
      setRevealed((value) => {
        const next = value + 6
        if (next >= CROC_CELLS) {
          clearInterval(timer)
          return CROC_CELLS
        }
        return next
      })
    }, 16)
    onCleanup(() => clearInterval(timer))
  })

  const renderLine = (line: string, fg: RGBA, bold: boolean): JSX.Element[] => {
    const shadow = tint(theme.background, fg, 0.25)
    const attrs = bold ? TextAttributes.BOLD : undefined
    return Array.from(line).map((char) => {
      if (char === "_") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            {" "}
          </text>
        )
      }
      if (char === "^") {
        return (
          <text fg={fg} bg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === "~") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▀
          </text>
        )
      }
      if (char === ",") {
        return (
          <text fg={shadow} attributes={attrs} selectable={false}>
            ▄
          </text>
        )
      }
      return (
        <text fg={fg} attributes={attrs} selectable={false}>
          {char}
        </text>
      )
    })
  }

  const renderCroc = (line: string, row: number): JSX.Element[] =>
    Array.from(line).map((char, col) => {
      if (char !== "#" && char !== "*") return <text selectable={false}> </text>
      const order = col * CROC_ROWS + row
      const fg = char === "*" ? CREAM : GREEN
      return (
        <Show when={order < revealed()} fallback={<text selectable={false}> </text>}>
          <text fg={fg} selectable={false}>█</text>
        </Show>
      )
    })

  return (
    <box alignItems="center">
      <box>
        <For each={croc}>{(line, row) => <box flexDirection="row">{renderCroc(line, row())}</box>}</For>
      </box>
      <box paddingTop={1}>
        <For each={logo.left}>
          {(line, index) => (
            <box flexDirection="row" gap={1}>
              <box flexDirection="row">{renderLine(line, GREEN, true)}</box>
              <box flexDirection="row">{renderLine(logo.right[index()], theme.text, true)}</box>
            </box>
          )}
        </For>
      </box>
    </box>
  )
}
