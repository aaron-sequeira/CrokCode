// Minimal Chrome DevTools Protocol client for the browser tool.
//
// No puppeteer/playwright dependency — CrokCode launches Chrome with a remote
// debugging port and speaks CDP JSON over a raw WebSocket (Bun ships one).
// CDP mouse/keyboard events enter the page at the same layer a real device
// does, so page JS cannot tell an agent click from a human one — which is the
// whole point of driving the cursor rather than faking DOM events.
import { spawn, type ChildProcess } from "child_process"
import { existsSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"

export class BrowserError extends Error {}

// A dedicated automation profile, kept out of the user's real Chrome profile so
// the agent starts logged out and a stray click can never act as the user on
// their live sessions. CROKCODE_BROWSER_USER_DATA_DIR overrides for the (opt-in,
// riskier) "drive my real logins" case.
function profileDir() {
  return (
    process.env["CROKCODE_BROWSER_USER_DATA_DIR"] ||
    path.join(os.homedir(), ".cache", "crokcode", "browser-profile")
  )
}

// Order matters: prefer stable Chrome, then Edge (Chromium, ships on Windows),
// then Chromium. Env override wins for anything exotic.
function chromePath(): string | undefined {
  const override = process.env["CROKCODE_BROWSER_BIN"]
  if (override && existsSync(override)) return override
  const candidates: string[] =
    process.platform === "win32"
      ? [
          `${process.env["ProgramFiles"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["ProgramFiles(x86)"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["LocalAppData"]}\\Google\\Chrome\\Application\\chrome.exe`,
          `${process.env["ProgramFiles(x86)"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
          `${process.env["ProgramFiles"]}\\Microsoft\\Edge\\Application\\msedge.exe`,
        ]
      : process.platform === "darwin"
        ? [
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
          ]
        : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/microsoft-edge"]
  return candidates.find((candidate) => candidate && existsSync(candidate))
}

export const CHROME_HINT =
  "Google Chrome (or Chromium/Edge) is required for the browser tool but was not found. Install Chrome, or set CROKCODE_BROWSER_BIN to its path."

type CdpMessage = { id?: number; method?: string; params?: unknown; result?: unknown; error?: { message: string } }

/** One CDP connection to a single page target. */
export class CdpSession {
  private nextId = 1
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private listeners = new Map<string, ((params: unknown) => void)[]>()

  private constructor(private ws: WebSocket) {
    ws.addEventListener("message", (event) => this.onMessage(String(event.data)))
    ws.addEventListener("close", () => this.failAll(new BrowserError("Browser connection closed.")))
  }

  static connect(wsUrl: string): Promise<CdpSession> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl)
      const timer = setTimeout(() => reject(new BrowserError("Timed out connecting to Chrome.")), 10_000)
      ws.addEventListener("open", () => {
        clearTimeout(timer)
        resolve(new CdpSession(ws))
      })
      ws.addEventListener("error", () => {
        clearTimeout(timer)
        reject(new BrowserError("Could not connect to Chrome's debugging endpoint."))
      })
    })
  }

  private onMessage(data: string) {
    let msg: CdpMessage
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (typeof msg.id === "number") {
      const waiter = this.pending.get(msg.id)
      if (!waiter) return
      this.pending.delete(msg.id)
      if (msg.error) waiter.reject(new BrowserError(msg.error.message))
      else waiter.resolve(msg.result)
      return
    }
    if (msg.method) for (const fn of this.listeners.get(msg.method) ?? []) fn(msg.params)
  }

  private failAll(error: Error) {
    for (const waiter of this.pending.values()) waiter.reject(error)
    this.pending.clear()
  }

  send<T = any>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      // Clear the watchdog the moment the call settles, so a completed command
      // never leaves a 30s timer dangling on the loop.
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        reject(new BrowserError(`Browser command ${method} timed out.`))
      }, 30_000)
      timer.unref?.()
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer)
          resolve(value as T)
        },
        reject: (error) => {
          clearTimeout(timer)
          reject(error)
        },
      })
      try {
        this.ws.send(JSON.stringify({ id, method, params }))
      } catch {
        this.pending.delete(id)
        clearTimeout(timer)
        reject(new BrowserError("Browser connection is not open."))
      }
    })
  }

  /** Resolve once `method` fires, or after `timeoutMs` (resolve, don't reject — a
   * missed load event shouldn't abort an otherwise-fine navigation). */
  once(method: string, timeoutMs: number): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        const list = this.listeners.get(method)
        if (list) this.listeners.set(method, list.filter((fn) => fn !== handler))
        resolve()
      }
      const handler = () => done()
      this.listeners.set(method, [...(this.listeners.get(method) ?? []), handler])
      setTimeout(done, timeoutMs).unref?.()
    })
  }

  close() {
    try {
      this.ws.close()
    } catch {
      // already gone
    }
  }
}

export type Browser = {
  session: CdpSession
  stop(): void
}

async function fetchJson(url: string, tries = 40): Promise<any> {
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      const res = await fetch(url)
      if (res.ok) return await res.json()
    } catch {
      // Chrome not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new BrowserError("Chrome did not expose its debugging endpoint in time.")
}

// One Chrome per process, reused across tool calls in a session.
let current: Browser | undefined

export async function launch(): Promise<Browser> {
  if (current) return current
  const bin = chromePath()
  if (!bin) throw new BrowserError(CHROME_HINT)
  const dir = profileDir()
  await fs.mkdir(dir, { recursive: true })

  // Port 0 = let Chrome pick a free port; it writes the real one to
  // DevToolsActivePort. A fixed port would collide across concurrent sessions.
  const portFile = path.join(dir, "DevToolsActivePort")
  await fs.rm(portFile, { force: true }).catch(() => {})
  const proc: ChildProcess = spawn(
    bin,
    [
      "--remote-debugging-port=0",
      `--user-data-dir=${dir}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-features=Translate,MediaRouter",
      "--new-window",
      "about:blank",
    ],
    { stdio: "ignore", detached: false },
  )
  proc.on("error", () => {})

  let port: number | undefined
  for (let attempt = 0; attempt < 40 && port === undefined; attempt++) {
    try {
      const line = (await fs.readFile(portFile, "utf8")).split("\n")[0]?.trim()
      if (line) port = Number(line)
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
  }
  if (!port) {
    proc.kill()
    throw new BrowserError("Chrome started but never reported its debugging port.")
  }

  const targets = (await fetchJson(`http://127.0.0.1:${port}/json/list`)) as {
    type: string
    webSocketDebuggerUrl?: string
  }[]
  const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
  if (!page?.webSocketDebuggerUrl) {
    proc.kill()
    throw new BrowserError("Chrome exposed no page to control.")
  }

  const session = await CdpSession.connect(page.webSocketDebuggerUrl)
  await session.send("Page.enable")
  await session.send("Runtime.enable")
  await session.send("DOM.enable")

  const browser: Browser = {
    session,
    stop() {
      session.close()
      try {
        proc.kill()
      } catch {
        // already gone
      }
      if (current === browser) current = undefined
    },
  }
  current = browser
  return browser
}

export function shutdown() {
  current?.stop()
  current = undefined
}

/* --------------------------------------------------------------- snapshot */

export type SnapshotNode = { ref: number; role: string; name: string; backendNodeId: number }

// The accessibility tree is a far smaller, more stable handle than raw HTML:
// interactive nodes carry a role and an accessible name, which is what a person
// reads to decide where to click. Each interactive node gets a stable ref the
// agent uses to act.
export async function snapshot(session: CdpSession): Promise<{ nodes: SnapshotNode[]; refs: Map<number, number> }> {
  const { nodes } = await session.send<{ nodes: any[] }>("Accessibility.getFullAXTree")
  const interactive = new Set([
    "button",
    "link",
    "textbox",
    "searchbox",
    "combobox",
    "checkbox",
    "radio",
    "menuitem",
    "tab",
    "switch",
    "slider",
    "option",
    "listbox",
  ])
  const out: SnapshotNode[] = []
  const refs = new Map<number, number>()
  let ref = 1
  for (const node of nodes) {
    const role = node.role?.value ?? ""
    const name = node.name?.value ?? ""
    if (node.ignored) continue
    const clickable = interactive.has(role) || (role === "generic" && name && node.properties?.some((p: any) => p.name === "focusable" && p.value?.value))
    if (!clickable) continue
    if (node.backendDOMNodeId === undefined) continue
    refs.set(ref, node.backendDOMNodeId)
    out.push({ ref, role, name: name.slice(0, 120), backendNodeId: node.backendDOMNodeId })
    ref++
    if (out.length >= 200) break
  }
  return { nodes: out, refs }
}

/** Center point of a node, in CSS pixels, or undefined if it has no box (hidden). */
export async function centerOf(session: CdpSession, backendNodeId: number): Promise<{ x: number; y: number } | undefined> {
  try {
    const { model } = await session.send<{ model: { content: number[] } }>("DOM.getBoxModel", { backendNodeId })
    const [x1, y1, , , x3, y3] = model.content
    return { x: Math.round((x1! + x3!) / 2), y: Math.round((y1! + y3!) / 2) }
  } catch {
    return undefined
  }
}

export async function clickAt(session: CdpSession, x: number, y: number) {
  await session.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y })
  await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 })
  await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 })
}

export async function typeText(session: CdpSession, text: string) {
  // insertText delivers the string as if typed via IME — one call, correct for
  // ordinary text entry. Individual keystrokes are only needed for shortcuts.
  await session.send("Input.insertText", { text })
}

export async function pressKey(session: CdpSession, key: string) {
  await session.send("Input.dispatchKeyEvent", { type: "keyDown", key })
  await session.send("Input.dispatchKeyEvent", { type: "keyUp", key })
}

export async function currentUrl(session: CdpSession): Promise<string> {
  try {
    const { result } = await session.send<{ result: { value?: string } }>("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    })
    return result.value ?? ""
  } catch {
    return ""
  }
}
