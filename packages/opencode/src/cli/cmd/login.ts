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

const MODELS: Record<string, { name: string }> = {
  "openai/gpt-5.6-sol": { name: "GPT-5.6 Sol" },
  "anthropic/claude-fable-5": { name: "Fable 5" },
  "anthropic/claude-opus-4.8": { name: "Claude Opus 4.8" },
  "moonshotai/kimi-k3": { name: "Kimi K3" },
  "z-ai/glm-5.2": { name: "GLM 5.2" },
  "google/gemini-3.5-pro": { name: "Gemini 3.5 Pro" },
  "deepseek/deepseek-v4": { name: "DeepSeek V4" },
  "x-ai/grok-5": { name: "Grok 5" },
}

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

/** Merge the crokapi provider (with the new key) into the user's global config. */
async function writeConfig(apiKey: string) {
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
        return { file, ok: false }
      }
    }
  }
  config.$schema ??= "https://opencode.ai/config.json"
  config.provider ??= {}
  config.provider.crokapi = {
    npm: "@ai-sdk/openai-compatible",
    name: "CrokAPI",
    options: { baseURL: GATEWAY, apiKey },
    models: MODELS,
  }
  await fs.mkdir(path.dirname(file), { recursive: true })
  await fs.writeFile(file, JSON.stringify(config, null, 2) + "\n")
  return { file, ok: true }
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
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, Math.max(2, interval ?? 3) * 1000))
      const polled = await cliAuth({ action: "poll", device_code })
      if (polled.body.api_key) {
        apiKey = polled.body.api_key as string
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

    const written = await writeConfig(apiKey)
    if (!written.ok) {
      prompts.log.warn(
        `Could not update ${written.file} automatically. Add this to it manually:\n` +
          JSON.stringify({ provider: { crokapi: { options: { apiKey } } } }, null, 2),
      )
      return
    }

    prompts.outro(
      `Connected. Config saved to ${written.file}\n` +
        `Try:  crokcode run --model crokapi/z-ai/glm-5.2 "hello"`,
    )
  },
}
