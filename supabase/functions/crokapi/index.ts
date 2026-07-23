// CrokAPI - CrokCode's hosted, OpenAI-compatible gateway.
//
// Authenticates a CrokCode API key, checks the caller's entitlement
// (active subscription or remaining pay-as-you-go credits), proxies the request
// to OpenRouter using the platform key, then records token usage and bills it.
//
// Required secrets:
//   OPENROUTER_API_KEY          upstream key (never leaves this function)
//   SUPABASE_URL                provided by the platform
//   SUPABASE_SERVICE_ROLE_KEY   provided by the platform
import { createClient } from "jsr:@supabase/supabase-js@2"

const OPENROUTER_URL = "https://openrouter.ai/api/v1"

// Sell-side pricing, USD per 1M tokens. Must stay in sync with
// packages/core/src/plugin/provider/crokapi.ts.
const PRICING: Record<string, { input: number; output: number }> = {
  "deepseek/deepseek-v4-flash": { input: 0.14, output: 0.28 },
  "z-ai/glm-4.7-flash": { input: 0.08, output: 0.56 },
  "xiaomi/mimo-v2.5": { input: 0.2, output: 0.39 },
  "qwen/qwen3-coder-flash": { input: 0.28, output: 1.36 },
  "deepseek/deepseek-v4-pro": { input: 0.6, output: 1.22 },
  "xiaomi/mimo-v2.5-pro": { input: 0.6, output: 1.22 },
  "minimax/minimax-m3": { input: 0.42, output: 1.68 },
  "qwen/qwen3.7-plus": { input: 0.45, output: 1.79 },
  "z-ai/glm-5.2": { input: 1.11, output: 3.49 },
  "moonshotai/kimi-k2.7-code": { input: 1.15, output: 5.25 },
  "anthropic/claude-haiku-4.5": { input: 1.4, output: 7 },
  "x-ai/grok-4.5": { input: 2.8, output: 8.4 },
  "google/gemini-3.6-flash": { input: 2.1, output: 10.5 },
  "anthropic/claude-sonnet-5": { input: 2.8, output: 14 },
  "google/gemini-3.1-pro-preview": { input: 2.8, output: 16.8 },
  "openai/gpt-5.4": { input: 3.5, output: 21 },
  "openai/gpt-5.6-terra": { input: 3.5, output: 21 },
  "moonshotai/kimi-k3": { input: 4.2, output: 21 },
  "anthropic/claude-opus-4.8": { input: 7, output: 35 },
  "openai/gpt-5.6-sol": { input: 7, output: 42 },
  "anthropic/claude-fable-5": { input: 14, output: 70 },
}
// ponytail: unlisted models bill at a flat default until the catalog is dynamic.
const FALLBACK_PRICE = { input: 2, output: 8 }

// Plan -> models. CrokGo is limited to budget models so a $5 plan can never
// run a premium model (protects margin). CrokPro and Crok-as-you-go get all
// models; usage is still capped by each account's credit balance/allowance.
// Keep in sync with the plan model lists in the TUI and login command.
const CROKGO_MODELS = new Set([
  "deepseek/deepseek-v4-flash",
  "z-ai/glm-4.7-flash",
  "xiaomi/mimo-v2.5",
  "qwen/qwen3-coder-flash",
  "deepseek/deepseek-v4-pro",
  "xiaomi/mimo-v2.5-pro",
  "minimax/minimax-m3",
  "qwen/qwen3.7-plus",
  "z-ai/glm-5.2",
])

const PLAN_LABEL: Record<string, string> = {
  crokgo: "CrokGo",
  crokpro: "CrokPro",
  crok_as_you_go: "Crok-as-you-go",
}

// Which model ids a plan may call. null = all models.
function modelsForPlan(plan: string | null | undefined): Set<string> | null {
  return plan === "crokgo" ? CROKGO_MODELS : null
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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

function costCents(model: string, input: number, output: number) {
  const price = PRICING[model] ?? FALLBACK_PRICE
  return ((input / 1_000_000) * price.input + (output / 1_000_000) * price.output) * 100
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS })

  const url = new URL(req.url)
  // Strip the function mount prefix so /crokapi/v1/... and /v1/... both work.
  const path = url.pathname.replace(/^\/crokapi/, "") || "/"

  const auth = req.headers.get("authorization") ?? ""
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : ""
  if (!token) return json({ error: { message: "Missing API key", type: "authentication_error" } }, 401)

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  const { data, error } = await supabase.rpc("check_api_key", { p_key_hash: await sha256(token) })
  if (error) return json({ error: { message: "Key lookup failed", type: "server_error" } }, 500)

  const account = Array.isArray(data) ? data[0] : data
  if (!account || account.reason === "invalid_key") {
    return json({ error: { message: "Invalid API key", type: "authentication_error" } }, 401)
  }

  // Usage + limits for this key. Answers even when over the limit (that's when
  // you most want to check it). Used by the `crokcode` TUI /usage command.
  if (req.method === "GET" && path.endsWith("/usage")) {
    return json({
      plan: account.plan,
      status: account.status,
      allowed: account.allowed,
      reason: account.reason,
      daily_used_cents: account.daily_used,
      daily_limit_cents: account.daily_limit,
      weekly_used_cents: account.weekly_used,
      weekly_limit_cents: account.weekly_limit,
      balance_cents: account.balance_cents,
    })
  }

  if (!account.allowed) {
    const dollars = (cents: number | null) => `$${((cents ?? 0) / 100).toFixed(2)}`
    const planLabel = PLAN_LABEL[account.plan as string] ?? "your plan"
    const message =
      account.reason === "weekly_limit"
        ? `Weekly usage limit reached for ${planLabel} (${dollars(account.weekly_limit)}/week). Resets Monday (UTC). Upgrade to CrokPro or use Crok-as-you-go for uncapped pay-per-use.`
        : account.reason === "daily_limit"
          ? `Daily usage limit reached for ${planLabel} (${dollars(account.daily_limit)}/day). Resets at midnight (UTC). Upgrade to CrokPro or use Crok-as-you-go.`
          : "No active CrokCode plan and no remaining Crok-as-you-go credits. Subscribe to CrokGo or CrokPro, or top up Crok-as-you-go."
    return json({ error: { message, type: "insufficient_quota" } }, 429)
  }

  const planModels = modelsForPlan(account.plan)

  // Model listing reflects what the caller's plan can actually use.
  if (req.method === "GET" && path.endsWith("/models")) {
    return json({
      object: "list",
      data: Object.keys(PRICING)
        .filter((id) => !planModels || planModels.has(id))
        .map((id) => ({ id, object: "model", owned_by: "crokapi" })),
    })
  }

  if (req.method !== "POST") return json({ error: { message: "Not found", type: "invalid_request_error" } }, 404)

  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400)
  }

  const upstreamKey = Deno.env.get("OPENROUTER_API_KEY")
  if (!upstreamKey) return json({ error: { message: "Gateway not configured", type: "server_error" } }, 500)

  const model = typeof body.model === "string" ? body.model : "unknown"

  // Enforce plan scope: a key only works with its plan's models.
  if (planModels && !planModels.has(model)) {
    return json(
      {
        error: {
          message: `Your CrokGo plan does not include ${model}. It includes ${[...planModels].join(", ")}. Upgrade to CrokPro for every model, or use Crok-as-you-go.`,
          type: "model_not_permitted",
        },
      },
      403,
    )
  }

  const streaming = body.stream === true
  // Ask OpenRouter to emit a final usage chunk so streamed calls can still be billed.
  if (streaming) body.stream_options = { include_usage: true }

  const upstream = await fetch(`${OPENROUTER_URL}${path.startsWith("/v1") ? path.slice(3) : path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${upstreamKey}`,
      "content-type": "application/json",
      "HTTP-Referer": "https://crokcode.tech/",
      "X-Title": "crokcode",
    },
    body: JSON.stringify(body),
  })

  const bill = async (input: number, output: number) => {
    if (input <= 0 && output <= 0) return
    await supabase.rpc("record_usage", {
      p_user_id: account.user_id,
      p_api_key_id: account.api_key_id,
      p_model: model,
      p_input_tokens: input,
      p_output_tokens: output,
      p_cost_cents: costCents(model, input, output),
    })
  }

  if (!upstream.ok || !streaming) {
    const text = await upstream.text()
    if (upstream.ok) {
      try {
        const parsed = JSON.parse(text)
        await bill(parsed?.usage?.prompt_tokens ?? 0, parsed?.usage?.completion_tokens ?? 0)
      } catch {
        // Non-JSON success bodies are passed through unbilled rather than failing the call.
      }
    }
    return new Response(text, {
      status: upstream.status,
      headers: { ...CORS, "content-type": upstream.headers.get("content-type") ?? "application/json" },
    })
  }

  // Stream through to the client while watching for the usage chunk.
  let prompt = 0
  let completion = 0
  let buffer = ""
  const meter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      buffer += new TextDecoder().decode(chunk, { stream: true })
      let index: number
      while ((index = buffer.indexOf("\n")) !== -1) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (!line.startsWith("data:")) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === "[DONE]") continue
        try {
          const usage = JSON.parse(payload)?.usage
          if (usage) {
            prompt = usage.prompt_tokens ?? prompt
            completion = usage.completion_tokens ?? completion
          }
        } catch {
          // Partial or non-JSON SSE payloads are ignored.
        }
      }
    },
    flush() {
      // Bill after the stream completes; don't block the client on it.
      void bill(prompt, completion)
    },
  })

  return new Response(upstream.body?.pipeThrough(meter), {
    status: upstream.status,
    headers: {
      ...CORS,
      "content-type": upstream.headers.get("content-type") ?? "text/event-stream",
      "cache-control": "no-cache",
    },
  })
})
