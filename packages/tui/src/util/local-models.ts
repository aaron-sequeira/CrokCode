// Local models via Ollama — CrokCode's on-device provider. Ollama handles the
// download + serving and exposes an OpenAI-compatible endpoint, so a pulled
// model becomes a normal `ollama` config provider.
import os from "os"
import { spawn } from "child_process"

export const OLLAMA_URL = (process.env["OLLAMA_HOST"] || "http://localhost:11434").replace(/\/$/, "")

export type LocalModel = {
  id: string // ollama tag, e.g. "qwen2.5-coder:7b"
  name: string
  params: string
  sizeGb: number // download size
  minRamGb: number // recommended system memory
  note: string
  agent?: boolean // emits parseable tool calls, so the agent loop works
}

export type OllamaModel = {
  name: string
  size?: number
}

// Curated, coding-first catalog spanning tiny -> workstation sizes.
//
// `agent` marks models that emit parseable tool calls, which crokcode's loop
// requires. Coder-tuned models are built for completion and mostly return bare
// JSON instead of a real tool call, so they can chat about code but cannot act
// on it. Verified here: llama3.1:8b calls tools 5/5; qwen2.5-coder:7b 0/5.
// modelInfo() re-checks for real at connect time; this is only for the picker.
export const LOCAL_MODELS: LocalModel[] = [
  { id: "qwen2.5-coder:1.5b", name: "Qwen2.5 Coder", params: "1.5B", sizeGb: 1.0, minRamGb: 4, note: "Tiny, fast" },
  { id: "gemma2:2b", name: "Gemma 2", params: "2B", sizeGb: 1.6, minRamGb: 4, note: "Tiny general model" },
  { id: "qwen2.5-coder:3b", name: "Qwen2.5 Coder", params: "3B", sizeGb: 1.9, minRamGb: 6, note: "Small, quick edits" },
  { id: "phi3:mini", name: "Phi-3 Mini", params: "3.8B", sizeGb: 2.2, minRamGb: 6, note: "Compact reasoning" },
  { id: "codellama:7b", name: "Code Llama", params: "7B", sizeGb: 3.8, minRamGb: 8, note: "Classic coding model" },
  { id: "qwen2.5-coder:7b", name: "Qwen2.5 Coder", params: "7B", sizeGb: 4.7, minRamGb: 8, note: "Chat about code" },
  {
    id: "llama3.1:8b",
    name: "Llama 3.1",
    params: "8B",
    sizeGb: 4.9,
    minRamGb: 8,
    note: "Best for agent tasks",
    agent: true,
  },
  { id: "deepseek-coder-v2:16b", name: "DeepSeek Coder V2", params: "16B", sizeGb: 8.9, minRamGb: 16, note: "MoE, fast for size" },
  { id: "qwen2.5-coder:14b", name: "Qwen2.5 Coder", params: "14B", sizeGb: 9.0, minRamGb: 16, note: "Strong" },
  { id: "qwen2.5-coder:32b", name: "Qwen2.5 Coder", params: "32B", sizeGb: 20, minRamGb: 32, note: "Best local coder" },
]

export function mergeLocalModels(models: OllamaModel[]) {
  const curated = new Map(LOCAL_MODELS.map((model) => [model.id, model]))
  const installed = new Set(models.map((model) => model.name))
  return [
    ...models.map(
      (model): LocalModel =>
        curated.get(model.name) ?? {
          id: model.name,
          name: model.name,
          params: "",
          sizeGb: (model.size ?? 0) / 1024 ** 3,
          minRamGb: 0,
          note: "Installed in Ollama",
        },
    ),
    ...LOCAL_MODELS.filter((model) => !installed.has(model.id)),
  ]
}

export type DeviceSpecs = { ramGb: number; vramGb?: number; platform: string; cpus: number }

// System RAM is the floor for Ollama (it falls back to CPU); VRAM (NVIDIA) is a
// best-effort bonus shown when detectable. Apple Silicon uses unified memory, so
// RAM is already the right number there.
export function deviceSpecs(): Promise<DeviceSpecs> {
  const base: DeviceSpecs = {
    ramGb: os.totalmem() / 1024 ** 3,
    platform: process.platform,
    cpus: os.cpus().length,
  }
  return new Promise((resolve) => {
    try {
      const proc = spawn("nvidia-smi", ["--query-gpu=memory.total", "--format=csv,noheader,nounits"], {
        stdio: ["ignore", "pipe", "ignore"],
      })
      let out = ""
      const done = (specs: DeviceSpecs) => resolve(specs)
      proc.stdout.on("data", (d) => (out += d))
      proc.on("error", () => done(base))
      proc.on("close", () => {
        const mb = parseInt(out.trim().split("\n")[0] || "", 10)
        done(Number.isFinite(mb) && mb > 0 ? { ...base, vramGb: mb / 1024 } : base)
      })
      setTimeout(() => {
        try {
          proc.kill()
        } catch {
          // already exited
        }
        done(base)
      }, 1500)
    } catch {
      resolve(base)
    }
  })
}

// A model runs if the machine has at least its recommended memory (with a little
// slack, since minRamGb already includes overhead).
export function canRun(model: LocalModel, specs: DeviceSpecs): boolean {
  return specs.ramGb + 0.5 >= model.minRamGb
}

export async function ollamaStatus(): Promise<{
  running: boolean
  installed: Set<string>
  models: OllamaModel[]
}> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return { running: false, installed: new Set(), models: [] }
    const body = (await res.json()) as { models?: OllamaModel[] }
    const models = body.models ?? []
    return { running: true, installed: new Set(models.map((model) => model.name)), models }
  } catch {
    return { running: false, installed: new Set(), models: [] }
  }
}

// Sane cap for a local model's reply; leaves most of the window for context.
export const OUTPUT_LIMIT = 4096

// Ollama's advertised "tools" capability only means the chat template renders
// tools — not that the model emits a parseable call. qwen2.5-coder:7b advertises
// tools yet returns bare JSON instead of the required <tool_call> tags, so the
// call never parses and the agent loop stalls. Probing once is the only honest
// signal. Costs one short request (plus model load on a cold start).
async function probeToolCall(id: string): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: id,
        messages: [{ role: "user", content: "What is the weather in Paris?" }],
        tools: [
          {
            type: "function",
            function: {
              name: "get_weather",
              description: "Get the current weather for a city",
              parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] },
            },
          },
        ],
        stream: false,
        options: { temperature: 0 },
      }),
      signal: AbortSignal.timeout(90_000),
    })
    if (!res.ok) return false
    const body = (await res.json()) as { message?: { tool_calls?: unknown[] } }
    return (body.message?.tool_calls?.length ?? 0) > 0
  } catch {
    return false
  }
}

// Ollama knows the model's real context window; without it compaction never
// runs (see session/overflow.ts) and the prompt gets silently truncated.
// Tool support is probed rather than trusted, per above.
export async function modelInfo(id: string): Promise<{ context?: number; tools: boolean }> {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/show`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: id }),
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return { tools: false }
    const body = (await res.json()) as { capabilities?: string[]; model_info?: Record<string, unknown> }
    // Key is architecture-prefixed, e.g. "qwen2.context_length".
    const context = Object.entries(body.model_info ?? {}).find(([key]) => key.endsWith(".context_length"))?.[1]
    return {
      context: typeof context === "number" && context > 0 ? context : undefined,
      // Skip the probe when the template can't do tools at all.
      tools: (body.capabilities ?? []).includes("tools") ? await probeToolCall(id) : false,
    }
  } catch {
    return { tools: false }
  }
}

// Stream a pull; onProgress(pct 0..1 or -1 for indeterminate, status text).
export async function pullModel(
  id: string,
  onProgress: (pct: number, status: string) => void,
  signal?: AbortSignal,
): Promise<boolean> {
  const res = await fetch(`${OLLAMA_URL}/api/pull`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: id, stream: true }),
    signal,
  })
  if (!res.ok || !res.body) return false
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let nl: number
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      try {
        const event = JSON.parse(line) as { error?: string; status?: string; total?: number; completed?: number }
        if (event.error) return false
        if (event.total && event.completed) onProgress(Math.min(1, event.completed / event.total), event.status ?? "")
        else if (event.status) onProgress(-1, event.status)
      } catch {
        // ignore partial/non-json lines
      }
    }
  }
  return true
}

export const gb = (n: number) => `${n >= 10 ? Math.round(n) : n.toFixed(1)} GB`
