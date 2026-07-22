import { Effect } from "effect"
import { ModelV2 } from "../../model"
import { ProviderV2 } from "../../provider"
import { define } from "../internal"

// CrokAPI is CrokCode's own hosted gateway. It is OpenAI-compatible and is
// backed by OpenRouter upstream, so model ids follow OpenRouter's
// "<vendor>/<model>" convention.
//
// Billing plans (see the CrokCode console): crokgo, crokpro, crok-as-you-go.
//
// NOTE: this registers CrokAPI in the v2 catalog. Model *resolution* still runs
// through the v1 provider state in packages/opencode/src/provider/provider.ts,
// which builds custom providers from config. So a `provider.crokapi` block in
// the user's config is what actually makes these models selectable today; this
// plugin keeps the v2 catalog in sync for consumers that read it. Keep the two
// model lists in agreement.
// Live CrokAPI gateway (Supabase Edge Function). Point this at your own domain
// once it fronts the gateway, or override with CROKCODE_API_BASE_URL.
const DEFAULT_BASE_URL = "https://zapkpyjeetjbufuuqwye.supabase.co/functions/v1/crokapi/v1"

// ponytail: static catalog for v1 so models render before the gateway is live.
// Once CrokAPI serves GET /v1/models, fetch it here and drop this table.
const MODELS = [
  {
    id: "openai/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    family: "gpt",
    context: 400_000,
    output: 128_000,
    cost: { input: 1.25, output: 10 },
    reasoning: true,
    image: true,
  },
  {
    id: "anthropic/claude-fable-5",
    name: "Fable 5",
    family: "claude",
    context: 500_000,
    output: 64_000,
    cost: { input: 3, output: 15 },
    reasoning: true,
    image: true,
  },
  {
    id: "anthropic/claude-opus-4.8",
    name: "Claude Opus 4.8",
    family: "claude",
    context: 200_000,
    output: 64_000,
    cost: { input: 5, output: 25 },
    reasoning: true,
    image: true,
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    family: "kimi",
    context: 256_000,
    output: 32_000,
    cost: { input: 0.6, output: 2.5 },
    reasoning: true,
    image: true,
  },
  {
    id: "z-ai/glm-5.2",
    name: "GLM 5.2",
    family: "glm",
    context: 200_000,
    output: 32_000,
    cost: { input: 0.4, output: 1.6 },
    reasoning: true,
  },
  {
    id: "google/gemini-3.5-pro",
    name: "Gemini 3.5 Pro",
    family: "gemini",
    context: 1_000_000,
    output: 64_000,
    cost: { input: 1.25, output: 10 },
    reasoning: true,
    image: true,
  },
  {
    id: "deepseek/deepseek-v4",
    name: "DeepSeek V4",
    family: "deepseek",
    context: 164_000,
    output: 32_000,
    cost: { input: 0.28, output: 1.1 },
    reasoning: true,
  },
  {
    id: "x-ai/grok-5",
    name: "Grok 5",
    family: "grok",
    context: 256_000,
    output: 32_000,
    cost: { input: 3, output: 15 },
    reasoning: true,
    image: true,
  },
] as const

export const CrokApiPlugin = define({
  id: "crokapi",
  effect: Effect.fn(function* (ctx) {
    const providerID = ProviderV2.ID.make("crokapi")
    const baseURL = process.env["CROKCODE_API_BASE_URL"] ?? DEFAULT_BASE_URL
    const apiKey = process.env["CROKCODE_API_KEY"]

    yield* ctx.catalog.transform((catalog) => {
      catalog.provider.update(providerID, (provider) => {
        provider.name = "CrokAPI"
        provider.api = {
          type: "aisdk",
          package: "@ai-sdk/openai-compatible",
          url: baseURL,
        }
        provider.request.headers["HTTP-Referer"] = "https://crokcode.tech/"
        provider.request.headers["X-Title"] = "crokcode"
        if (apiKey) provider.request.body.apiKey = apiKey
      })

      for (const item of MODELS) {
        catalog.model.update(providerID, ModelV2.ID.make(item.id), (model) => {
          model.name = item.name
          model.family = item.family
          model.api.id = item.id
          model.capabilities.tools = true
          model.capabilities.input = "image" in item && item.image ? ["text", "image"] : ["text"]
          model.capabilities.output = ["text"]
          model.limit = { context: item.context, output: item.output }
          model.cost = [{ input: item.cost.input, output: item.cost.output, cache: { read: 0, write: 0 } }]
          model.status = "active"
          model.enabled = true
        })
      }
    })
  }),
})
