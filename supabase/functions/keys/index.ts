// Issue, list and revoke CrokCode API keys for the signed-in user.
//
// The plaintext key is returned exactly once, at creation. Only its SHA-256
// hash is stored, so a database leak cannot be replayed against the gateway.
import { createClient } from "jsr:@supabase/supabase-js@2"

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  })
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  const auth = req.headers.get("authorization") ?? ""
  if (!auth.toLowerCase().startsWith("bearer ")) return json({ error: "Not signed in" }, 401)
  const token = auth.slice(7).trim()

  const url = Deno.env.get("SUPABASE_URL")!
  // Validate the caller's JWT explicitly; there is no browser session here.
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "")
  const { data: userData, error: userError } = await asUser.auth.getUser(token)
  if (userError || !userData?.user) return json({ error: "Not signed in" }, 401)
  const userId = userData.user.id

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)

  if (req.method === "GET") {
    const { data, error } = await admin
      .from("api_keys")
      .select("id, key_prefix, name, last_used_at, created_at, revoked_at")
      .eq("user_id", userId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
    if (error) return json({ error: error.message }, 500)
    return json({ keys: data })
  }

  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}) as Record<string, unknown>)
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim().slice(0, 64) : "default"

    const random = crypto.getRandomValues(new Uint8Array(24))
    const secret = Array.from(random)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
    const key = `crok_${secret}`

    const { error } = await admin.from("api_keys").insert({
      user_id: userId,
      key_hash: await sha256(key),
      key_prefix: key.slice(0, 12),
      name,
    })
    if (error) return json({ error: error.message }, 500)

    // Shown once. There is no way to recover it later.
    return json({ key, name }, 201)
  }

  if (req.method === "DELETE") {
    const id = new URL(req.url).searchParams.get("id")
    if (!id) return json({ error: "Missing id" }, 400)
    const { error } = await admin
      .from("api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", userId)
    if (error) return json({ error: error.message }, 500)
    return json({ revoked: id })
  }

  return json({ error: "Method not allowed" }, 405)
})
