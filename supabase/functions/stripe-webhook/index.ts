// Stripe webhook handler for CrokCode billing.
//
// Keeps public.subscriptions in sync with Stripe and credits
// Crok-as-you-go top-ups via public.add_credits (idempotent per payment intent).
//
// Required secrets:
//   STRIPE_SECRET_KEY
//   STRIPE_WEBHOOK_SECRET
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (provided by the platform)
import Stripe from "npm:stripe@17"
import { createClient } from "jsr:@supabase/supabase-js@2"

// Built lazily: constructing Stripe at module scope crashes the whole worker
// (WORKER_ERROR) when STRIPE_SECRET_KEY is not set yet.
let stripeClient: Stripe | undefined
function getStripe() {
  const key = Deno.env.get("STRIPE_SECRET_KEY")
  if (!key) return undefined
  stripeClient ??= new Stripe(key, {
    // Deno has no synchronous crypto, so Stripe needs the async provider.
    httpClient: Stripe.createFetchHttpClient(),
  })
  return stripeClient
}
const cryptoProvider = Stripe.createSubtleCryptoProvider()

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
)

// Maps a Stripe price to one of our plans. Falls back to price metadata.
const PLAN_BY_PRICE: Record<string, string> = {
  price_1TvhxRFqcQDpQanaev7w9EKu: "crokgo",
  price_1TvhxiFqcQDpQanaxdA1phYl: "crokpro",
}

function planFor(price: Stripe.Price | null | undefined) {
  if (!price) return undefined
  return PLAN_BY_PRICE[price.id] ?? (price.metadata?.plan as string | undefined)?.replace(/-/g, "_")
}

/** Resolve the CrokCode user for a Stripe customer, linking the id on first sight. */
async function userForCustomer(customerId: string, email?: string | null) {
  const existing = await supabase
    .from("profiles")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle()
  if (existing.data?.id) return existing.data.id as string

  if (!email) return undefined
  const byEmail = await supabase.from("profiles").select("id").eq("email", email).maybeSingle()
  if (!byEmail.data?.id) return undefined

  await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", byEmail.data.id)
  return byEmail.data.id as string
}

async function syncSubscription(subscription: Stripe.Subscription) {
  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id
  const userId = await userForCustomer(customerId)
  if (!userId) return

  const item = subscription.items.data[0]
  const plan = planFor(item?.price)
  if (!plan) return

  const periodEnd = (item as unknown as { current_period_end?: number })?.current_period_end
  await supabase.from("subscriptions").upsert(
    {
      user_id: userId,
      stripe_subscription_id: subscription.id,
      stripe_price_id: item?.price?.id ?? null,
      plan,
      status: subscription.status,
      cancel_at_period_end: subscription.cancel_at_period_end ?? false,
      current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "stripe_subscription_id" },
  )
}

Deno.serve(async (req) => {
  const stripe = getStripe()
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")
  if (!stripe || !webhookSecret) {
    return new Response("Stripe is not configured (set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET)", {
      status: 500,
    })
  }

  const signature = req.headers.get("stripe-signature")
  if (!signature) return new Response("Missing stripe-signature", { status: 400 })

  const payload = await req.text()
  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      webhookSecret,
      undefined,
      cryptoProvider,
    )
  } catch (err) {
    return new Response(`Invalid signature: ${(err as Error).message}`, { status: 400 })
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const customerId = typeof session.customer === "string" ? session.customer : session.customer?.id
        if (!customerId) break

        // Link the Stripe customer to the signed-up user on first checkout.
        const userId =
          (session.client_reference_id as string | null) ??
          (await userForCustomer(customerId, session.customer_details?.email))
        if (!userId) break
        await supabase.from("profiles").update({ stripe_customer_id: customerId }).eq("id", userId)

        if (session.mode === "payment" && session.amount_total) {
          // Crok-as-you-go top-up.
          const intent =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : (session.payment_intent?.id ?? session.id)
          await supabase.rpc("add_credits", {
            p_user_id: userId,
            p_amount_cents: session.amount_total,
            p_payment_intent_id: intent,
          })
        }

        if (session.mode === "subscription" && session.subscription) {
          const id = typeof session.subscription === "string" ? session.subscription : session.subscription.id
          await syncSubscription(await stripe.subscriptions.retrieve(id))
        }
        break
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await syncSubscription(event.data.object as Stripe.Subscription)
        break
      }

      default:
        break
    }
  } catch (err) {
    // Return 500 so Stripe retries rather than silently dropping the event.
    return new Response(`Handler error: ${(err as Error).message}`, { status: 500 })
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "content-type": "application/json" },
  })
})
