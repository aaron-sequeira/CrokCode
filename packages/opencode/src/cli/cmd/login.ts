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
const MODELS: Record<string, { name: string; image?: boolean }> = {
  "openai/gpt-5.6-sol": { name: "GPT-5.6 Sol", image: true },
  "anthropic/claude-fable-5": { name: "Fable 5", image: true },
  "anthropic/claude-opus-4.8": { name: "Claude Opus 4.8", image: true },
  "moonshotai/kimi-k3": { name: "Kimi K3", image: true },
  "z-ai/glm-5.2": { name: "GLM 5.2" },
  "google/gemini-3.5-pro": { name: "Gemini 3.5 Pro", image: true },
  "deepseek/deepseek-v4": { name: "DeepSeek V4" },
  "x-ai/grok-5": { name: "Grok 5", image: true },
}

// A config model entry with the capabilities opencode reads. `reasoning: true`
// enables the effort/variant switcher (/effort, /variants) so users can dial
// reasoning down to spend fewer tokens on small tasks.
function configModel(def: { name: string; image?: boolean }) {
  return {
    name: def.name,
    reasoning: true,
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
  crokgo: ["z-ai/glm-5.2", "deepseek/deepseek-v4", "moonshotai/kimi-k3"],
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
