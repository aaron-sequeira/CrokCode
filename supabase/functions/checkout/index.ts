// Create a Stripe Checkout session for a CrokCode plan.
//
// POST { plan: "crokgo" | "crokpro" | "crok-as-you-go", success_url?, cancel_url? }
// -> { url }
import Stripe from "npm:stripe@17"
import { createClient } from "jsr:@supabase/supabase-js@2"

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  httpClient: Stripe.createFetchHttpClient(),
})

// coupon: first-invoice-only discount (Stripe duration: "once"). CrokGo is
// $10/mo with 50% off the first month = $5 first month, $10 thereafter.
const PRICES: Record<string, { price: string; mode: "subscription" | "payment"; coupon?: string }> = {
  crokgo: { price: "price_1Tw8nNFqcQDpQanawhK8CWrq", mode: "subscription", coupon: "sGlKPqwr" },
  crokpro: { price: "price_1TvhxiFqcQDpQanaxdA1phYl", mode: "subscription" },
  "crok-as-you-go": { price: "price_1TvhyNFqcQDpQanaCDRnJsQS", mode: "payment" },
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "content-type": "application/json" },
  })
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const auth = req.headers.get("authorization") ?? ""
  if (!auth.toLowerCase().startsWith("bearer ")) return json({ error: "Not signed in" }, 401)
  const token = auth.slice(7).trim()

  const url = Deno.env.get("SUPABASE_URL")!
  const asUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY") ?? "")
  const { data: userData, error: userError } = await asUser.auth.getUser(token)
  if (userError || !userData?.user) return json({ error: "Not signed in" }, 401)
  const user = userData.user

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const selected = PRICES[String(body.plan)]
  if (!selected) return json({ error: "Unknown plan" }, 400)

  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  const profile = await admin.from("profiles").select("stripe_customer_id").eq("id", user.id).maybeSingle()

  // Reuse the customer so subscriptions and top-ups land on one account.
  let customerId = profile.data?.stripe_customer_id as string | undefined
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { supabase_user_id: user.id },
    })
    customerId = customer.id
    await admin.from("profiles").update({ stripe_customer_id: customerId }).eq("id", user.id)
  }

  const origin = req.headers.get("origin") ?? "https://crokcode.tech"
  const session = await stripe.checkout.sessions.create({
    mode: selected.mode,
    customer: customerId,
    client_reference_id: user.id,
    line_items: [{ price: selected.price, quantity: 1 }],
    ...(selected.coupon ? { discounts: [{ coupon: selected.coupon }] } : {}),
    success_url: (body.success_url as string) ?? `${origin}/billing?status=success`,
    cancel_url: (body.cancel_url as string) ?? `${origin}/billing?status=cancelled`,
  })

  return json({ url: session.url })
})
