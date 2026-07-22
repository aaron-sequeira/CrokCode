// Reuse the shared CrokCode art so branding stays in one place.
import { croc, logo } from "../logo"

const reset = "\x1b[0m"
const bold = "\x1b[1m"
const dim = "\x1b[90m"
const GREEN = "\x1b[38;2;167;209;41m" // brand green (Pixel Croc)
const CREAM = "\x1b[38;2;247;240;208m"

// Pixel Croc mascot: # = green body, * = cream teeth.
function crocRows(pad = "") {
  return croc.map((row) => {
    let out = ""
    for (const char of row) {
      if (char === "#") out += `${GREEN}█${reset}`
      else if (char === "*") out += `${CREAM}█${reset}`
      else out += " "
    }
    return `${pad}${out.trimEnd()}`
  })
}

function wordmark(pad = "") {
  const draw = (line: string, fg: string, shadow: string, bg: string) =>
    [...line]
      .map((char) => {
        if (char === "_") return `${bg} ${reset}`
        if (char === "^") return `${fg}${bg}▀${reset}`
        if (char === "~") return `${shadow}▀${reset}`
        if (char === " ") return " "
        return `${fg}${char}${reset}`
      })
      .join("")

  return logo.left.map((line, index) => {
    // "crok" in brand green, "code" in the bright foreground.
    const left = draw(line, GREEN, "\x1b[38;2;100;140;30m", "\x1b[48;2;35;50;12m")
    const right = draw(logo.right[index] ?? "", reset, "\x1b[38;5;238m", "\x1b[48;5;238m")
    return `${pad}${left} ${right}`
  })
}

export function sessionEpilogue(input: { title: string; sessionID?: string }) {
  const weak = (text: string) => `${dim}${text.padEnd(10, " ")}${reset}`
  return [
    ...crocRows("  "),
    "",
    ...wordmark("  "),
    "",
    `  ${weak("Session")}${bold}${input.title}${reset}`,
    `  ${weak("Continue")}${bold}crokcode -s ${input.sessionID}${reset}`,
    "",
  ].join("\n")
}
