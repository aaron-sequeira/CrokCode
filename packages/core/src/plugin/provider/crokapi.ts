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
    id: "deepseek/deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    family: "deepseek",
    context: 1048000,
    output: 32000,
    cost: { input: 0.14, output: 0.28 },
    reasoning: true,
  },
  {
    id: "z-ai/glm-4.7-flash",
    name: "GLM 4.7 Flash",
    family: "glm",
    context: 202000,
    output: 32000,
    cost: { input: 0.08, output: 0.56 },
    reasoning: true,
  },
  {
    id: "xiaomi/mimo-v2.5",
    name: "MiMo V2.5",
    family: "mimo",
    context: 1050000,
    output: 32000,
    cost: { input: 0.2, output: 0.39 },
    reasoning: true,
    image: true,
  },
  {
    id: "qwen/qwen3-coder-flash",
    name: "Qwen3 Coder Flash",
    family: "qwen",
    context: 1000000,
    output: 32000,
    cost: { input: 0.28, output: 1.36 },
    reasoning: true,
  },
  {
    id: "deepseek/deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    family: "deepseek",
    context: 1048000,
    output: 32000,
    cost: { input: 0.6, output: 1.22 },
    reasoning: true,
  },
  {
    id: "xiaomi/mimo-v2.5-pro",
    name: "MiMo V2.5 Pro",
    family: "mimo",
    context: 1050000,
    output: 32000,
    cost: { input: 0.6, output: 1.22 },
    reasoning: true,
  },
  {
    id: "minimax/minimax-m3",
    name: "MiniMax M3",
    family: "minimax",
    context: 1048000,
    output: 32000,
    cost: { input: 0.42, output: 1.68 },
    reasoning: true,
    image: true,
  },
  {
    id: "qwen/qwen3.7-plus",
    name: "Qwen3.7 Plus",
    family: "qwen",
    context: 1000000,
    output: 32000,
    cost: { input: 0.45, output: 1.79 },
    reasoning: true,
    image: true,
  },
  {
    id: "z-ai/glm-5.2",
    name: "GLM 5.2",
    family: "glm",
    context: 1048000,
    output: 32000,
    cost: { input: 1.11, output: 3.49 },
    reasoning: true,
  },
  {
    id: "moonshotai/kimi-k2.7-code",
    name: "Kimi K2.7 Code",
    family: "kimi",
    context: 262000,
    output: 32000,
    cost: { input: 1.15, output: 5.25 },
    reasoning: true,
    image: true,
  },
  {
    id: "anthropic/claude-haiku-4.5",
    name: "Claude Haiku 4.5",
    family: "claude",
    context: 200000,
    output: 32000,
    cost: { input: 1.4, output: 7 },
    reasoning: true,
    image: true,
  },
  {
    id: "x-ai/grok-4.5",
    name: "Grok 4.5",
    family: "grok",
    context: 500000,
    output: 32000,
    cost: { input: 2.8, output: 8.4 },
    reasoning: true,
    image: true,
  },
  {
    id: "google/gemini-3.6-flash",
    name: "Gemini 3.6 Flash",
    family: "gemini",
    context: 1048000,
    output: 32000,
    cost: { input: 2.1, output: 10.5 },
    reasoning: true,
    image: true,
  },
  {
    id: "anthropic/claude-sonnet-5",
    name: "Claude Sonnet 5",
    family: "claude",
    context: 1000000,
    output: 64000,
    cost: { input: 2.8, output: 14 },
    reasoning: true,
    image: true,
  },
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    family: "gemini",
    context: 1048000,
    output: 64000,
    cost: { input: 2.8, output: 16.8 },
    reasoning: true,
    image: true,
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    family: "gpt",
    context: 1050000,
    output: 64000,
    cost: { input: 3.5, output: 21 },
    reasoning: true,
    image: true,
  },
  {
    id: "openai/gpt-5.6-terra",
    name: "GPT-5.6 Terra",
    family: "gpt",
    context: 1050000,
    output: 64000,
    cost: { input: 3.5, output: 21 },
    reasoning: true,
    image: true,
  },
  {
    id: "moonshotai/kimi-k3",
    name: "Kimi K3",
    family: "kimi",
    context: 1048000,
    output: 64000,
    cost: { input: 4.2, output: 21 },
    reasoning: true,
    image: true,
  },
  {
    id: "anthropic/claude-opus-4.8",
    name: "Claude Opus 4.8",
    family: "claude",
    context: 1000000,
    output: 64000,
    cost: { input: 7, output: 35 },
    reasoning: true,
    image: true,
  },
  {
    id: "openai/gpt-5.6-sol",
    name: "GPT-5.6 Sol",
    family: "gpt",
    context: 1050000,
    output: 64000,
    cost: { input: 7, output: 42 },
    reasoning: true,
    image: true,
  },
  {
    id: "anthropic/claude-fable-5",
    name: "Fable 5",
    family: "claude",
    context: 1000000,
    output: 64000,
    cost: { input: 14, output: 70 },
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
