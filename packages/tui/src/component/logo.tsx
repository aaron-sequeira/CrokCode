import { RGBA, TextAttributes } from "@opentui/core"
import { For, type JSX } from "solid-js"
import { tint, useTheme } from "../context/theme"
import { croc, logo } from "../logo"

const GREEN = RGBA.fromHex("#a7d129")
const CREAM = RGBA.fromHex("#f7f0d0")

export function Logo() {
  const { theme } = useTheme()

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

  const renderCroc = (line: string): JSX.Element[] =>
    Array.from(line).map((char) => {
      if (char === "#") return <text fg={GREEN} selectable={false}>█</text>
      if (char === "*") return <text fg={CREAM} selectable={false}>█</text>
      return <text selectable={false}> </text>
    })

  return (
    <box alignItems="center">
      <box>
        <For each={croc}>{(line) => <box flexDirection="row">{renderCroc(line)}</box>}</For>
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
