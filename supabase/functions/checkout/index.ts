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

  // Plan change: if the customer already has a live subscription, swap its price
  // in place (with proration) instead of opening a second checkout — otherwise
  // Stripe creates a duplicate "incomplete" subscription and the plan never changes.
  if (selected.mode === "subscription") {
    const subs = await stripe.subscriptions.list({ customer: customerId, limit: 20 })
    const current = subs.data.find(
      (s) => s.status === "active" || s.status === "trialing" || s.status === "past_due",
    )
    if (current) {
      const item = current.items.data[0]
      if (item?.price?.id === selected.price) {
        return json({ error: "You're already on this plan." }, 400)
      }
      await stripe.subscriptions.update(current.id, {
        items: [{ id: item.id, price: selected.price }],
        proration_behavior: "create_prorations",
      })
      // Reflect the change immediately; the webhook will also sync it.
      await admin
        .from("subscriptions")
        .update({ plan: String(body.plan), stripe_price_id: selected.price, updated_at: new Date().toISOString() })
        .eq("stripe_subscription_id", current.id)
      return json({ updated: true })
    }
  }

  // Crok-as-you-go: let the console pass a custom credit amount ($5–$500).
  const amountCents = Math.round(Number(body.amount_cents))
  const customAmount = selected.mode === "payment" && Number.isFinite(amountCents) && amountCents > 0
  if (customAmount && (amountCents < 500 || amountCents > 50000)) {
    return json({ error: "Enter an amount between $5 and $500." }, 400)
  }
  const lineItem = customAmount
    ? {
        price_data: {
          currency: "usd",
          product_data: { name: "Crok-as-you-go credits" },
          unit_amount: amountCents,
        },
        quantity: 1,
      }
    : { price: selected.price, quantity: 1 }

  const origin = req.headers.get("origin") ?? "https://crokcode.tech"
  const session = await stripe.checkout.sessions.create({
    mode: selected.mode,
    customer: customerId,
    client_reference_id: user.id,
    line_items: [lineItem],
    ...(selected.coupon ? { discounts: [{ coupon: selected.coupon }] } : {}),
    success_url: (body.success_url as string) ?? `${origin}/billing?status=success`,
    cancel_url: (body.cancel_url as string) ?? `${origin}/billing?status=cancelled`,
  })

  return json({ url: session.url })
})
