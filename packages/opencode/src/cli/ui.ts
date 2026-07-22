import { EOL } from "os"
import { Schema } from "effect"
import { croc, logo as glyphs } from "./logo"

const CROC_GREEN = "\x1b[38;2;167;209;41m"
const CROC_CREAM = "\x1b[38;2;247;240;208m"

/** Render the Pixel Croc mascot, optionally in brand colour. */
function crocRows(color: boolean) {
  const reset = "\x1b[0m"
  return croc.map((row) => {
    let out = ""
    for (const char of row) {
      if (char === "#") out += color ? CROC_GREEN + "█" + reset : "█"
      else if (char === "*") out += color ? CROC_CREAM + "█" + reset : "█"
      else out += " "
    }
    return out.trimEnd()
  })
}

const wordmark = [
  `⠀                               ▄`,
  `█▀▀▀ █▀▀▄ █▀▀█ █ ▄▀ █▀▀▀ █▀▀█ █▀▀█ █▀▀█`,
  `█    █▀█  █  █ █▀▄  █    █  █ █  █ █▀▀▀`,
  `▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀  ▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀ ▀▀▀▀`,
]

export class CancelledError extends Schema.TaggedErrorClass<CancelledError>()("UICancelledError", {}) {}

export const Style = {
  TEXT_HIGHLIGHT: "\x1b[96m",
  TEXT_HIGHLIGHT_BOLD: "\x1b[96m\x1b[1m",
  TEXT_DIM: "\x1b[90m",
  TEXT_DIM_BOLD: "\x1b[90m\x1b[1m",
  TEXT_NORMAL: "\x1b[0m",
  TEXT_NORMAL_BOLD: "\x1b[1m",
  TEXT_WARNING: "\x1b[93m",
  TEXT_WARNING_BOLD: "\x1b[93m\x1b[1m",
  TEXT_DANGER: "\x1b[91m",
  TEXT_DANGER_BOLD: "\x1b[91m\x1b[1m",
  TEXT_SUCCESS: "\x1b[92m",
  TEXT_SUCCESS_BOLD: "\x1b[92m\x1b[1m",
  TEXT_INFO: "\x1b[94m",
  TEXT_INFO_BOLD: "\x1b[94m\x1b[1m",
}

export function println(...message: string[]) {
  print(...message)
  process.stderr.write(EOL)
}

export function print(...message: string[]) {
  blank = false
  process.stderr.write(message.join(" "))
}

let blank = false
export function empty() {
  if (blank) return
  println("" + Style.TEXT_NORMAL)
  blank = true
}

export function logo(pad?: string) {
  if (!process.stdout.isTTY && !process.stderr.isTTY) {
    const result = []
    for (const row of [...crocRows(false), "", ...wordmark]) {
      if (pad) result.push(pad)
      result.push(row)
      result.push(EOL)
    }
    return result.join("").trimEnd()
  }

  const result: string[] = []
  for (const row of crocRows(true)) {
    if (pad) result.push(pad)
    result.push(row)
    result.push(EOL)
  }
  result.push(EOL)
  const reset = "\x1b[0m"
  const left = {
    fg: "\x1b[38;5;148m", // brand green — "crok" half (matches the Pixel Croc)
    shadow: "\x1b[38;5;100m",
    bg: "\x1b[48;5;22m",
  }
  const right = {
    fg: reset,
    shadow: "\x1b[38;5;238m",
    bg: "\x1b[48;5;238m",
  }
  const gap = " "
  const draw = (line: string, fg: string, shadow: string, bg: string) => {
    const parts: string[] = []
    for (const char of line) {
      if (char === "_") {
        parts.push(bg, " ", reset)
        continue
      }
      if (char === "^") {
        parts.push(fg, bg, "▀", reset)
        continue
      }
      if (char === "~") {
        parts.push(shadow, "▀", reset)
        continue
      }
      if (char === " ") {
        parts.push(" ")
        continue
      }
      parts.push(fg, char, reset)
    }
    return parts.join("")
  }
  glyphs.left.forEach((row, index) => {
    if (pad) result.push(pad)
    result.push(draw(row, left.fg, left.shadow, left.bg))
    result.push(gap)
    const other = glyphs.right[index] ?? ""
    result.push(draw(other, right.fg, right.shadow, right.bg))
    result.push(EOL)
  })
  return result.join("").trimEnd()
}

export async function input(prompt: string): Promise<string> {
  const readline = require("readline")
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(prompt, (answer: string) => {
      rl.close()
      resolve(answer.trim())
    })
  })
}

export function error(message: string) {
  if (message.startsWith("Error: ")) {
    message = message.slice("Error: ".length)
  }
  println(Style.TEXT_DANGER_BOLD + "Error: " + Style.TEXT_NORMAL + message)
}

export function markdown(text: string): string {
  return text
}

export * as UI from "./ui"
