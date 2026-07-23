// Auto top-up for Crok-as-you-go.
//
// Called internally by the crokapi gateway (fire-and-forget) after billing a
// PAYG request. claim_auto_topup atomically decides whether a charge is due
// (enabled + balance below threshold + 10-minute dedupe), then we charge the
// customer's saved card off-session and credit the balance idempotently.
//
// Auth: internal only — callers must present the service-role key.
import Stripe from "npm:stripe@17"
import { createClient } from "jsr:@supabase/supabase-js@2"

let stripeClient: Stripe | undefined
function getStripe() {
  const key = Deno.env.get("STRIPE_SECRET_KEY")
  if (!key) return undefined
  stripeClient ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() })
  return stripeClient
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405)

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  if (req.headers.get("x-internal-key") !== serviceKey) return json({ error: "Forbidden" }, 403)

  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const userId = String(body.user_id ?? "")
  if (!userId) return json({ error: "Missing user_id" }, 400)

  const db = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey)
  const { data, error } = await db.rpc("claim_auto_topup", { p_user_id: userId })
  if (error) return json({ error: "Claim failed" }, 500)
  const claim = Array.isArray(data) ? data[0] : data
  if (!claim?.amount_cents) return json({ skipped: true })

  const stripe = getStripe()
  if (!stripe || !claim.stripe_customer_id) return json({ skipped: true, reason: "no stripe customer" })

  try {
    // Saved card: prefer the customer's default, else the newest attached card.
    const customer = (await stripe.customers.retrieve(claim.stripe_customer_id)) as Stripe.Customer
    let paymentMethod =
      typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id
    if (!paymentMethod) {
      const cards = await stripe.paymentMethods.list({ customer: claim.stripe_customer_id, type: "card", limit: 1 })
      paymentMethod = cards.data[0]?.id
    }
    if (!paymentMethod) return json({ skipped: true, reason: "no saved card" })

    const intent = await stripe.paymentIntents.create({
      amount: Number(claim.amount_cents),
      currency: "usd",
      customer: claim.stripe_customer_id,
      payment_method: paymentMethod,
      off_session: true,
      confirm: true,
      description: "Crok-as-you-go auto top-up",
    })

    // Idempotent per intent id, same as checkout top-ups.
    await db.rpc("add_credits", {
      p_user_id: userId,
      p_amount_cents: Number(claim.amount_cents),
      p_payment_intent_id: intent.id,
    })
    return json({ ok: true, amount_cents: claim.amount_cents })
  } catch (err) {
    // Card declined / requires action: the 10-minute claim window prevents
    // retry spam; the user keeps control from the console.
    return json({ failed: true, reason: (err as Error).message }, 200)
  }
})
