import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./browser.txt"
import * as Cdp from "./browser-cdp"

// Per-session ref map: the numbers the agent sees in a snapshot resolve to the
// backend DOM node ids it acts on. Kept out of the model's context — it only
// ever handles the small integer ref.
const sessionRefs = new Map<string, Map<number, number>>()
const confirmedOrigins = new Map<string, Set<string>>()

const Action = Schema.Literals(["navigate", "snapshot", "click", "type", "key", "screenshot", "close"])

export const Parameters = Schema.Struct({
  action: Action.annotate({
    description:
      "navigate (open a url), snapshot (list interactive elements with refs), click (a ref), type (text into a ref), key (a keyboard key like Enter), screenshot (png of the page), close (end the session).",
  }),
  url: Schema.optional(Schema.String).annotate({
    description: "For navigate: the full http(s) URL to open.",
  }),
  ref: Schema.optional(Schema.Number).annotate({
    description: "For click/type: the element ref from the most recent snapshot.",
  }),
  text: Schema.optional(Schema.String).annotate({
    description: "For type: the text to enter. For key: ignored.",
  }),
  key: Schema.optional(Schema.String).annotate({
    description: 'For key: a key name such as "Enter", "Tab", "ArrowDown", "Escape".',
  }),
})

type Params = Schema.Schema.Type<typeof Parameters>

type BrowserMeta = { action: string; url?: string; ref?: number; truncated?: boolean }
const meta = (value: BrowserMeta): BrowserMeta => value

function renderSnapshot(nodes: Cdp.SnapshotNode[]): string {
  if (nodes.length === 0) return "No interactive elements found on the page."
  return nodes.map((node) => `[${node.ref}] ${node.role}${node.name ? ` "${node.name}"` : ""}`).join("\n")
}

export const BrowserTool = Tool.define(
  "browser",
  Effect.sync(() => ({
    description: DESCRIPTION,
    parameters: Parameters,
    execute: (params: Params, ctx: Tool.Context) =>
      Effect.gen(function* () {
        if (params.action === "close") {
          Cdp.shutdown()
          sessionRefs.delete(ctx.sessionID)
          confirmedOrigins.delete(ctx.sessionID)
          return { title: "browser closed", output: "Browser session closed.", metadata: meta({ action: "close" }) }
        }

        // navigate is the only action that reaches a new origin, so that's where
        // the confirmation gate lives. Every later click/type stays on a page the
        // user already approved this session — same shape as the pentest gate.
        if (params.action === "navigate") {
          if (!params.url) throw new Error("navigate requires a url.")
          let origin: string
          try {
            const parsed = new URL(params.url)
            if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("protocol")
            origin = parsed.origin
          } catch {
            throw new Error(`Invalid url: "${params.url}" must be an http(s) URL.`)
          }
          yield* ctx.ask({
            permission: "browser",
            patterns: [origin],
            always: ["*"],
            metadata: {
              origin,
              url: params.url,
              warning:
                "CrokCode will drive a real Chrome browser — moving the cursor, clicking, and typing on this site. It runs in a separate automation profile (logged out) unless you configured otherwise.",
            },
          })
          const confirmed = confirmedOrigins.get(ctx.sessionID) ?? new Set<string>()
          confirmed.add(origin)
          confirmedOrigins.set(ctx.sessionID, confirmed)

          const { session } = yield* Effect.tryPromise({
            try: () => Cdp.launch(),
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
          yield* Effect.tryPromise({
            try: async () => {
              const loaded = session.once("Page.loadEventFired", 20_000)
              await session.send("Page.navigate", { url: params.url })
              await loaded
            },
            catch: (error) => (error instanceof Error ? error : new Error(String(error))),
          })
          const snap = yield* Effect.promise(() => Cdp.snapshot(session))
          sessionRefs.set(ctx.sessionID, snap.refs)
          const here = yield* Effect.promise(() => Cdp.currentUrl(session))
          return {
            title: `navigated to ${here || params.url}`,
            output: `Loaded ${here || params.url}\n\n${renderSnapshot(snap.nodes)}`,
            metadata: meta({ action: "navigate", url: here }),
          }
        }

        // Everything below needs a live browser on an approved origin.
        const browser = yield* Effect.tryPromise({
          try: () => Cdp.launch(),
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        })
        const session = browser.session
        const here = yield* Effect.promise(() => Cdp.currentUrl(session))
        const origin = safeOrigin(here)
        if (origin && !(confirmedOrigins.get(ctx.sessionID)?.has(origin))) {
          throw new Error(`The page is on ${origin}, which you have not confirmed this session. Use navigate to approve it first.`)
        }

        switch (params.action) {
          case "snapshot": {
            const snap = yield* Effect.promise(() => Cdp.snapshot(session))
            sessionRefs.set(ctx.sessionID, snap.refs)
            return {
              title: `snapshot (${snap.nodes.length} elements)`,
              output: `${here}\n\n${renderSnapshot(snap.nodes)}`,
              metadata: meta({ action: "snapshot", url: here }),
            }
          }
          case "click":
          case "type": {
            if (params.ref === undefined) throw new Error(`${params.action} requires a ref from a snapshot.`)
            const backendNodeId = sessionRefs.get(ctx.sessionID)?.get(params.ref)
            if (backendNodeId === undefined) throw new Error(`Unknown ref ${params.ref}. Take a fresh snapshot.`)
            const point = yield* Effect.promise(() => Cdp.centerOf(session, backendNodeId))
            if (!point) throw new Error(`Element [${params.ref}] is not visible on the page.`)
            yield* Effect.promise(() => Cdp.clickAt(session, point.x, point.y))
            if (params.action === "type") {
              if (!params.text) throw new Error("type requires text.")
              yield* Effect.promise(() => Cdp.typeText(session, params.text!))
            }
            // The action likely changed the page; a fresh snapshot keeps the
            // agent's refs valid and shows the result in one round-trip.
            const snap = yield* Effect.promise(() => Cdp.snapshot(session))
            sessionRefs.set(ctx.sessionID, snap.refs)
            const nowUrl = yield* Effect.promise(() => Cdp.currentUrl(session))
            const verb = params.action === "type" ? `typed into [${params.ref}]` : `clicked [${params.ref}]`
            return {
              title: verb,
              output: `${verb}\n${nowUrl}\n\n${renderSnapshot(snap.nodes)}`,
              metadata: meta({ action: params.action, ref: params.ref, url: nowUrl }),
            }
          }
          case "key": {
            if (!params.key) throw new Error("key requires a key name.")
            yield* Effect.promise(() => Cdp.pressKey(session, params.key!))
            const snap = yield* Effect.promise(() => Cdp.snapshot(session))
            sessionRefs.set(ctx.sessionID, snap.refs)
            const nowUrl = yield* Effect.promise(() => Cdp.currentUrl(session))
            return {
              title: `pressed ${params.key}`,
              output: `pressed ${params.key}\n${nowUrl}\n\n${renderSnapshot(snap.nodes)}`,
              metadata: meta({ action: "key", url: nowUrl }),
            }
          }
          case "screenshot": {
            const { data } = yield* Effect.tryPromise({
              try: () => session.send<{ data: string }>("Page.captureScreenshot", { format: "png" }),
              catch: (error) => (error instanceof Error ? error : new Error(String(error))),
            })
            return {
              title: "screenshot",
              output: `Screenshot of ${here}`,
              metadata: meta({ action: "screenshot", url: here, truncated: false }),
              attachments: [{ type: "file" as const, mime: "image/png", url: `data:image/png;base64,${data}` }],
            }
          }
        }
        throw new Error(`Unhandled browser action: ${params.action}`)
      }).pipe(Effect.orDie),
  })),
)

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    return undefined
  }
}
