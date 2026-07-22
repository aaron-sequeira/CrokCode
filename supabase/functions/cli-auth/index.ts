// Device-pairing for `crokcode login`.
//
//   start   (public)  -> { device_code, user_code, verification_uri, interval, expires_in }
//   poll    (public)  -> { status: "pending" } | { api_key } | 400 expired/invalid
//   approve (JWT)     -> mints an API key for the signed-in user and links it to the code
//
// Own auth: start/poll are gated by unguessable codes; approve validates the
// caller's Supabase JWT. Deployed with verify_jwt disabled.
import { createClient } from "jsr:@supabase/supabase-js@2"

const SITE = "https://crokcode.tech"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } })
}

function hex(bytes: number) {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

const admin = () =>
  createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const action = String(body.action ?? "")
  const db = admin()

  if (action === "start") {
    const device_code = hex(24)
    // Short, human-typed-friendly code shown in the terminal (e.g. 9F3A-1C7E).
    const raw = hex(4).toUpperCase()
    const user_code = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`
    const { error } = await db.from("cli_auth").insert({ device_code, user_code })
    if (error) return json({ error: "Could not start login" }, 500)
    return json({
      device_code,
      user_code,
      verification_uri: `${SITE}/link?code=${user_code}`,
      interval: 3,
      expires_in: 600,
    })
  }

  if (action === "poll") {
    const device_code = String(body.device_code ?? "")
    if (!device_code) return json({ error: "invalid_request" }, 400)
    const { data } = await db
      .from("cli_auth")
      .select("approved, api_key, expires_at")
      .eq("device_code", device_code)
      .maybeSingle()
    if (!data) return json({ error: "invalid_code" }, 400)
    if (new Date(data.expires_at) < new Date()) {
      await db.from("cli_auth").delete().eq("device_code", device_code)
      return json({ error: "expired_token" }, 400)
    }
    if (!data.approved || !data.api_key) return json({ status: "pending" })
    // Hand the key over exactly once, then destroy the pairing row.
    const key = data.api_key as string
    await db.from("cli_auth").delete().eq("device_code", device_code)
    return json({ api_key: key })
  }

  if (action === "approve") {
    const auth = req.headers.get("authorization") ?? ""
    if (!auth.toLowerCase().startsWith("bearer ")) return json({ error: "Not signed in" }, 401)
    const token = auth.slice(7).trim()
    const asUser = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY") ?? "")
    const { data: userData, error: userError } = await asUser.auth.getUser(token)
    if (userError || !userData?.user) return json({ error: "Not signed in" }, 401)
    const user = userData.user

    const user_code = String(body.user_code ?? "").toUpperCase().trim()
    if (!user_code) return json({ error: "Missing code" }, 400)

    const { data: pending } = await db
      .from("cli_auth")
      .select("device_code, approved, expires_at")
      .eq("user_code", user_code)
      .maybeSingle()
    if (!pending) return json({ error: "That code was not found. Check the terminal and try again." }, 404)
    if (new Date(pending.expires_at) < new Date()) return json({ error: "That code has expired." }, 400)
    if (pending.approved) return json({ error: "That code was already used." }, 400)

    // Mint an API key for this user (same shape as the keys function).
    const key = `crok_${hex(24)}`
    const insertKey = await db.from("api_keys").insert({
      user_id: user.id,
      key_hash: await sha256(key),
      key_prefix: key.slice(0, 12),
      name: "crokcode login",
    })
    if (insertKey.error) return json({ error: "Could not create a key" }, 500)

    const linked = await db
      .from("cli_auth")
      .update({ approved: true, user_id: user.id, api_key: key })
      .eq("user_code", user_code)
      .eq("approved", false)
    if (linked.error) return json({ error: "Could not link the CLI" }, 500)

    return json({ ok: true })
  }

  return json({ error: "Unknown action" }, 400)
})
