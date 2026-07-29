import { afterAll, expect, test } from "bun:test"
import { CdpSession, BrowserError } from "../../src/tool/browser-cdp"

// A stand-in for Chrome's CDP endpoint: echoes a result for every command, and
// can push an unsolicited event. Lets us test message correlation and event
// waiting without launching a browser.
const server = Bun.serve({
  port: 0,
  fetch(req, srv) {
    if (srv.upgrade(req)) return
    return new Response("nope", { status: 400 })
  },
  websocket: {
    message(ws, raw) {
      const msg = JSON.parse(String(raw)) as { id: number; method: string; params: unknown }
      if (msg.method === "Boom") {
        ws.send(JSON.stringify({ id: msg.id, error: { message: "exploded" } }))
        return
      }
      if (msg.method === "FireEvent") {
        ws.send(JSON.stringify({ id: msg.id, result: {} }))
        ws.send(JSON.stringify({ method: "Page.loadEventFired", params: {} }))
        return
      }
      ws.send(JSON.stringify({ id: msg.id, result: { echoed: msg.method } }))
    },
  },
})
const wsUrl = `ws://127.0.0.1:${server.port}/`

afterAll(() => server.stop(true))

test("send() correlates each response to its request id", async () => {
  const session = await CdpSession.connect(wsUrl)
  try {
    const [a, b] = await Promise.all([session.send("Page.enable"), session.send("DOM.enable")])
    expect(a).toEqual({ echoed: "Page.enable" })
    expect(b).toEqual({ echoed: "DOM.enable" })
  } finally {
    session.close()
  }
})

test("a CDP error result rejects with a BrowserError", async () => {
  const session = await CdpSession.connect(wsUrl)
  try {
    let caught: unknown
    await session.send("Boom").catch((error) => (caught = error))
    expect(caught).toBeInstanceOf(BrowserError)
    expect((caught as Error).message).toBe("exploded")
  } finally {
    session.close()
  }
})

test("once() resolves when the awaited event fires", async () => {
  const session = await CdpSession.connect(wsUrl)
  try {
    const waited = session.once("Page.loadEventFired", 5_000)
    await session.send("FireEvent")
    await waited // resolves, does not time out
    expect(true).toBe(true)
  } finally {
    session.close()
  }
})

test("once() resolves (not rejects) on timeout, so a missed event never aborts", async () => {
  const session = await CdpSession.connect(wsUrl)
  try {
    const start = Date.now()
    await session.once("Never.fires", 100)
    expect(Date.now() - start).toBeGreaterThanOrEqual(90)
  } finally {
    session.close()
  }
})

test("connect() rejects on an unreachable endpoint", async () => {
  await expect(CdpSession.connect("ws://127.0.0.1:1/")).rejects.toBeInstanceOf(BrowserError)
})
