import type { Argv } from "yargs"
import * as prompts from "@clack/prompts"
import { spawn } from "child_process"
import os from "os"
import path from "path"
import fs from "fs/promises"
import { xdgConfig } from "xdg-basedir"
import { UI } from "../ui"

// The CrokCode backend (Supabase). Override for a self-hosted gateway.
const BASE = process.env["CROKCODE_AUTH_URL"] ?? "https://zapkpyjeetjbufuuqwye.supabase.co"
const CLI_AUTH = `${BASE}/functions/v1/cli-auth`
const GATEWAY = `${BASE}/functions/v1/crokapi/v1`

// `image: true` = the model accepts image input (declared so the TUI sends
// attachments instead of stripping them). Based on the upstream OpenRouter
// modalities. GLM 5.2 and DeepSeek V4 are text-only.
const MODELS: Record<string, { name: string; image?: boolean; cost: { input: number; output: number } }> = {
  "deepseek/deepseek-v4-flash": { name: "DeepSeek V4 Flash", cost: { input: 0.14, output: 0.28 } },
  "z-ai/glm-4.7-flash": { name: "GLM 4.7 Flash", cost: { input: 0.08, output: 0.56 } },
  "xiaomi/mimo-v2.5": { name: "MiMo V2.5", image: true, cost: { input: 0.2, output: 0.39 } },
  "qwen/qwen3-coder-flash": { name: "Qwen3 Coder Flash", cost: { input: 0.28, output: 1.36 } },
  "deepseek/deepseek-v4-pro": { name: "DeepSeek V4 Pro", cost: { input: 0.6, output: 1.22 } },
  "xiaomi/mimo-v2.5-pro": { name: "MiMo V2.5 Pro", cost: { input: 0.6, output: 1.22 } },
  "minimax/minimax-m3": { name: "MiniMax M3", image: true, cost: { input: 0.42, output: 1.68 } },
  "qwen/qwen3.7-plus": { name: "Qwen3.7 Plus", image: true, cost: { input: 0.45, output: 1.79 } },
  "z-ai/glm-5.2": { name: "GLM 5.2", cost: { input: 1.11, output: 3.49 } },
  "moonshotai/kimi-k2.7-code": { name: "Kimi K2.7 Code", image: true, cost: { input: 1.15, output: 5.25 } },
  "anthropic/claude-haiku-4.5": { name: "Claude Haiku 4.5", image: true, cost: { input: 1.4, output: 7 } },
  "x-ai/grok-4.5": { name: "Grok 4.5", image: true, cost: { input: 2.8, output: 8.4 } },
  "google/gemini-3.6-flash": { name: "Gemini 3.6 Flash", image: true, cost: { input: 2.1, output: 10.5 } },
  "anthropic/claude-sonnet-5": { name: "Claude Sonnet 5", image: true, cost: { input: 2.8, output: 14 } },
  "google/gemini-3.1-pro-preview": { name: "Gemini 3.1 Pro", image: true, cost: { input: 2.8, output: 16.8 } },
  "openai/gpt-5.4": { name: "GPT-5.4", image: true, cost: { input: 3.5, output: 21 } },
  "openai/gpt-5.6-terra": { name: "GPT-5.6 Terra", image: true, cost: { input: 3.5, output: 21 } },
  "moonshotai/kimi-k3": { name: "Kimi K3", image: true, cost: { input: 4.2, output: 21 } },
  "anthropic/claude-opus-4.8": { name: "Claude Opus 4.8", image: true, cost: { input: 7, output: 35 } },
  "openai/gpt-5.6-sol": { name: "GPT-5.6 Sol", image: true, cost: { input: 7, output: 42 } },
  "anthropic/claude-fable-5": { name: "Fable 5", image: true, cost: { input: 14, output: 70 } },
}

// A config model entry with the capabilities opencode reads. `reasoning: true`
// enables the effort/variant switcher (/effort, /variants) so users can dial
// reasoning down to spend fewer tokens on small tasks.
function configModel(def: { name: string; image?: boolean; cost: { input: number; output: number } }) {
  return {
    name: def.name,
    reasoning: true,
    // Sell-side $/1M so the TUI status line shows real session cost.
    cost: { input: def.cost.input, output: def.cost.output },
    modalities: { input: def.image ? ["text", "image"] : ["text"], output: ["text"] },
  }
}

// The provider written per plan: named after the plan, exposing only its models.
// Must match CROKGO_MODELS in the gateway and the TUI connect dialog. Falls back
// to "crokapi" / all models when the account has no detectable plan.
const PLAN_NAME: Record<string, string> = {
  crokgo: "CrokGo",
  crokpro: "CrokPro",
  "crok-as-you-go": "Crok-as-you-go",
}
const PLAN_MODEL_IDS: Record<string, string[]> = {
  crokgo: ["deepseek/deepseek-v4-flash", "z-ai/glm-4.7-flash", "xiaomi/mimo-v2.5", "qwen/qwen3-coder-flash", "deepseek/deepseek-v4-pro", "xiaomi/mimo-v2.5-pro", "minimax/minimax-m3", "qwen/qwen3.7-plus", "z-ai/glm-5.2"],
  crokpro: Object.keys(MODELS),
  "crok-as-you-go": Object.keys(MODELS),
}
const CROK_PROVIDER_IDS = ["crokapi", "crokgo", "crokpro", "crok-as-you-go"]

async function cliAuth(body: Record<string, unknown>) {
  const response = await fetch(CLI_AUTH, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  return { ok: response.ok, body: (await response.json().catch(() => ({}))) as Record<string, any> }
}

function openBrowser(url: string) {
  if (process.env["CROKCODE_NO_BROWSER"]) return
  const cmd = process.platform === "win32" ? "cmd" : process.platform === "darwin" ? "open" : "xdg-open"
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url]
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref()
  } catch {
    // Falls back to the printed URL below.
  }
}

const configFile = () => {
  if (process.env["CROKCODE_CONFIG"]) return process.env["CROKCODE_CONFIG"]!
  const dir = xdgConfig ?? path.join(os.homedir(), ".config")
  return path.join(dir, "crokcode", "opencode.jsonc")
}

/** Write a plan-named, plan-scoped provider (with the new key) into the config. */
async function writeConfig(apiKey: string, plan: string | null) {
  const file = configFile()
  let config: Record<string, any> = {}
  const existing = await fs.readFile(file, "utf8").catch(() => "")
  if (existing.trim()) {
    try {
      config = JSON.parse(existing)
    } catch {
      // Tolerate // and /* */ comments in an existing .jsonc file.
      const stripped = existing.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1")
      try {
        config = JSON.parse(stripped)
      } catch {
        return { file, ok: false, providerID: "" }
      }
    }
  }
  const providerID = plan && PLAN_NAME[plan] ? plan : "crokapi"
  const modelIDs = PLAN_MODEL_IDS[providerID] ?? Object.keys(MODELS)
  const models: Record<string, ReturnType<typeof configModel>> = {}
  for (const id of modelIDs) if (MODELS[id]) models[id] = configModel(MODELS[id])

  config.$schema ??= "https://opencode.ai/config.json"
  config.provider ??= {}
  // Keep exactly one CrokCode provider so the picker shows just the current plan.
  for (const id of CROK_PROVIDER_IDS) delete config.provider[id]
  config.provider[providerID] = {
    npm: "@ai-sdk/openai-compatible",
    name: PLAN_NAME[providerID] ?? "CrokAPI",
    options: { baseURL: GATEWAY, apiKey },
    models,
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n")
  return { file, ok: true, providerID }
}

export const LoginCommand = {
  command: "login",
  describe: "sign in and connect this machine to your CrokCode account",
  builder: (yargs: Argv) => yargs,
  handler: async () => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("Connect CrokCode")

    const started = await cliAuth({ action: "start" })
    if (!started.ok || !started.body.device_code) {
      prompts.log.error("Could not reach the CrokCode login service.")
      return
    }
    const { device_code, user_code, verification_uri, interval, expires_in } = started.body as {
      device_code: string
      user_code: string
      verification_uri: string
      interval: number
      expires_in: number
    }

    prompts.note(`${user_code}\n\n${verification_uri}`, "Approve this code in your browser")
    openBrowser(verification_uri)

    const spin = prompts.spinner()
    spin.start("Waiting for approval in the browser…")

    const deadline = Date.now() + (expires_in ?? 600) * 1000
    let apiKey: string | undefined
    let plan: string | null = null
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.max(2, interval ?? 3) * 1000))
      const polled = await cliAuth({ action: "poll", device_code })
      if (polled.body.api_key) {
        apiKey = polled.body.api_key as string
        plan = (polled.body.plan as string | null) ?? null
        break
      }
      if (polled.body.status === "pending") continue
      // expired / invalid
      break
    }

    if (!apiKey) {
      spin.stop("Login did not complete. Run `crokcode login` again.")
      return
    }
    spin.stop("Approved.")

    const written = await writeConfig(apiKey, plan)
    if (!written.ok) {
      prompts.log.warn(
        `Could not update ${written.file} automatically. Add this to it manually:\n` +
          JSON.stringify({ provider: { crokapi: { options: { apiKey } } } }, null, 2),
      )
      return
    }

    const sample = written.providerID === "crokgo" ? "z-ai/glm-5.2" : "anthropic/claude-opus-4.8"
    const planLabel = PLAN_NAME[written.providerID] ?? "CrokAPI"
    prompts.outro(
      `Connected as ${planLabel}. Config saved to ${written.file}\n` +
        `Try:  crokcode run --model ${written.providerID}/${sample} "hello"`,
    )
  },
}
