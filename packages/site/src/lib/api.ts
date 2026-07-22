import { createClient } from "@supabase/supabase-js"

export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? "https://zapkpyjeetjbufuuqwye.supabase.co"
export const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? "sb_publishable_t4_VNC0bivZcVQVW_V7UUQ_A2BUuTab"

export const GATEWAY_URL = `${SUPABASE_URL}/functions/v1/crokapi/v1`

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

/** Call an Edge Function as the signed-in user. */
async function call(fn: string, init: RequestInit = {}) {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error("You are signed out. Sign in again to continue.")

  const response = await fetch(`${SUPABASE_URL}/functions/v1/${fn}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(body?.error ?? `Request failed (${response.status})`)
  return body
}

export type ApiKey = {
  id: string
  key_prefix: string
  name: string | null
  last_used_at: string | null
  created_at: string
}

export const api = {
  listKeys: () => call("keys").then((r) => (r.keys ?? []) as ApiKey[]),
  createKey: (name: string) =>
    call("keys", { method: "POST", body: JSON.stringify({ name }) }).then((r) => r.key as string),
  revokeKey: (id: string) => call(`keys?id=${encodeURIComponent(id)}`, { method: "DELETE" }),
  checkout: (plan: string) =>
    call("checkout", {
      method: "POST",
      body: JSON.stringify({
        plan,
        success_url: `${location.origin}/app?status=success`,
        cancel_url: `${location.origin}/app?status=cancelled`,
      }),
    }).then((r) => r.url as string),
}

export type Account = {
  plan: string | null
  status: string | null
  balanceCents: number
  usage: { model: string; input_tokens: number; output_tokens: number; cost_cents: string; created_at: string }[]
  spentCents: number
}

/** Read the signed-in user's plan, balance and recent usage. RLS scopes every row. */
export async function loadAccount(userId: string): Promise<Account> {
  const [subscription, balance, usage] = await Promise.all([
    supabase
      .from("subscriptions")
      .select("plan,status")
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"])
      .maybeSingle(),
    supabase.from("credit_balances").select("balance_cents").eq("user_id", userId).maybeSingle(),
    supabase
      .from("usage_events")
      .select("model,input_tokens,output_tokens,cost_cents,created_at")
      .order("created_at", { ascending: false })
      .limit(25),
  ])

  const rows = usage.data ?? []
  return {
    plan: subscription.data?.plan ?? null,
    status: subscription.data?.status ?? null,
    balanceCents: balance.data?.balance_cents ?? 0,
    usage: rows,
    spentCents: rows.reduce((total, row) => total + Number(row.cost_cents ?? 0), 0),
  }
}

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`
