import { createMemo, createSignal, onCleanup, onMount, Show } from "solid-js"
import { useSync } from "../context/sync"
import { map, pipe, sortBy } from "remeda"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { DialogPrompt } from "../ui/dialog-prompt"
import { Link } from "../ui/link"
import { useTheme } from "../context/theme"
import { TextAttributes } from "@opentui/core"
import type { ProviderAuthAuthorization, ProviderAuthMethod } from "@crokcode/sdk/v2"
import { DialogModel } from "./dialog-model"
import { DialogLocal } from "./dialog-local"
import { useToast } from "../ui/toast"
import { isConsoleManagedProvider } from "../util/provider-origin"
import { useConnected } from "./use-connected"
import { useBindings } from "../keymap"
import { useClipboard } from "../context/clipboard"

// Server providers that still belong in "Popular". OpenCode Zen (opencode) and
// OpenCode Go (opencode-go) were removed so CrokCode's own plans lead instead.
const PROVIDER_PRIORITY: Record<string, number> = {
  openai: 0,
  "github-copilot": 1,
  anthropic: 2,
  google: 3,
}

// CrokCode plans, shown at the top of "Popular". All three browser-pair and
// connect the same `crokapi` gateway provider; the gateway enforces the
// account's real plan (so a key only works with the plan the user has).
const CROK_PLANS = [
  { id: "crokgo", title: "CrokGo", description: "$5 first month, then $10/mo — 9 efficient models" },
  { id: "crokpro", title: "CrokPro", description: "$20/mo — all 21 models (Recommended)" },
  { id: "crok-as-you-go", title: "Crok-as-you-go", description: "Pay as you go — all 21 models, no caps" },
] as const

const CUSTOM_PROVIDER_OPTION_VALUE = "__opencode_custom_provider__"
const CUSTOM_PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

type ProviderOptionBase = {
  title: string
  value: string
  description?: string
  category: string
}

type ProviderOption =
  | (ProviderOptionBase & {
      type: "provider"
      providerID: string
    })
  | (ProviderOptionBase & {
      type: "custom"
    })
  | (ProviderOptionBase & {
      type: "plan"
      planID: string
    })
  | (ProviderOptionBase & {
      type: "local"
    })

export function providerOptions(list: { id: string; name: string }[]): ProviderOption[] {
  return [
    // CrokCode plans lead the "Popular" section.
    ...CROK_PLANS.map((plan) => ({
      type: "plan" as const,
      title: plan.title,
      value: `__crok_plan_${plan.id}`,
      description: plan.description,
      category: "Popular",
      planID: plan.id,
    })),
    {
      type: "local" as const,
      title: "Local models",
      value: "__crok_local__",
      description: "Download & run on-device (Ollama)",
      category: "Popular",
    },
    ...pipe(
      list,
      sortBy(
        (x) => PROVIDER_PRIORITY[x.id] ?? 99,
        (x) => x.name.toLowerCase(),
        (x) => x.id,
      ),
      map((provider) => ({
        type: "provider" as const,
        title: provider.name,
        value: provider.id,
        providerID: provider.id,
        description: {
          opencode: "(Recommended)",
          anthropic: "(API key)",
          openai: "(ChatGPT Plus/Pro or API key)",
          "opencode-go": "Low cost subscription for everyone",
        }[provider.id],
        category: provider.id in PROVIDER_PRIORITY ? "Popular" : "Providers",
      })),
    ),
    {
      type: "custom",
      title: "Other",
      value: CUSTOM_PROVIDER_OPTION_VALUE,
      description: "Custom provider",
      category: "Providers",
    },
  ]
}

export function normalizeCustomProviderID(value: string) {
  const providerID = value.trim().replace(/^@ai-sdk\//, "")
  if (!CUSTOM_PROVIDER_ID.test(providerID)) return
  return providerID
}

export function createDialogProviderOptions() {
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()
  const { theme } = useTheme()
  const onboarded = useConnected()

  async function promptCustomProviderID(): Promise<string | undefined> {
    const value = await DialogPrompt.show(dialog, "Other", {
      placeholder: "Provider id",
      description: () => (
        <text fg={theme.textMuted}>
          This only stores a credential. Configure the provider in opencode.json to use it.
        </text>
      ),
    })
    if (value === null) return

    const providerID = normalizeCustomProviderID(value)
    if (providerID) return providerID

    toast.show({
      variant: "error",
      message:
        "Provider ids must start with a lowercase letter or number and only use lowercase letters, numbers, hyphens, and underscores",
    })
    return promptCustomProviderID()
  }

  const options = createMemo(() => {
    return pipe(
      providerOptions(sync.data.provider_next.all),
      map((provider) => {
        if (provider.type === "custom") {
          return {
            title: provider.title,
            value: provider.value,
            description: provider.description,
            category: provider.category,
            async onSelect() {
              const providerID = await promptCustomProviderID()
              if (!providerID) return
              return dialog.replace(() => <ApiMethod providerID={providerID} title="API key" custom />)
            },
          }
        }

        if (provider.type === "plan") {
          return {
            title: provider.title,
            value: provider.value,
            description: provider.description,
            category: provider.category,
            async onSelect() {
              return dialog.replace(() => <PlanConnect planID={provider.planID} title={provider.title} />)
            },
          }
        }

        if (provider.type === "local") {
          return {
            title: provider.title,
            value: provider.value,
            description: provider.description,
            category: provider.category,
            async onSelect() {
              return dialog.replace(() => <DialogLocal />)
            },
          }
        }

        const providerID = provider.providerID
        const consoleManaged = isConsoleManagedProvider(sync.data.console_state.consoleManagedProviders, providerID)
        const connected = sync.data.provider_next.connected.includes(providerID)

        return {
          title: provider.title,
          value: provider.value,
          description: provider.description,
          footer: consoleManaged ? sync.data.console_state.activeOrgName : undefined,
          category: provider.category,
          gutter: connected && onboarded() ? () => <text fg={theme.success}>✓</text> : undefined,
          async onSelect() {
            if (consoleManaged) return

            const methods = sync.data.provider_auth[providerID] ?? [
              {
                type: "api",
                label: "API key",
              },
            ]
            let index: number | null = 0
            if (methods.length > 1) {
              index = await new Promise<number | null>((resolve) => {
                dialog.replace(
                  () => (
                    <DialogSelect
                      title="Select auth method"
                      options={methods.map((x, index) => ({
                        title: x.label,
                        value: index,
                      }))}
                      onSelect={(option) => resolve(option.value)}
                    />
                  ),
                  () => resolve(null),
                )
              })
            }
            if (index == null) return
            const method = methods[index]
            if (method.type === "oauth") {
              let inputs: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({
                  dialog,
                  prompts: method.prompts,
                })
                if (!value) return
                inputs = value
              }

              const result = await sdk.client.provider.oauth.authorize({
                providerID,
                method: index,
                inputs,
              })
              if (result.error) {
                toast.show({
                  variant: "error",
                  message: JSON.stringify(result.error),
                })
                dialog.clear()
                return
              }
              if (result.data?.method === "code") {
                dialog.replace(() => (
                  <CodeMethod providerID={providerID} title={method.label} index={index} authorization={result.data!} />
                ))
              }
              if (result.data?.method === "auto") {
                dialog.replace(() => (
                  <AutoMethod providerID={providerID} title={method.label} index={index} authorization={result.data!} />
                ))
              }
            }
            if (method.type === "api") {
              let metadata: Record<string, string> | undefined
              if (method.prompts?.length) {
                const value = await PromptsMethod({ dialog, prompts: method.prompts })
                if (!value) return
                metadata = value
              }
              return dialog.replace(() => (
                <ApiMethod providerID={providerID} title={method.label} metadata={metadata} />
              ))
            }
          },
        }
      }),
    )
  })
  return options
}

export function DialogProvider() {
  const options = createDialogProviderOptions()
  return <DialogSelect title="Connect a provider" options={options()} />
}

interface AutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
}
function AutoMethod(props: AutoMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const clipboard = useClipboard()

  useBindings(() => ({
    bindings: [
      {
        key: "c",
        desc: "Copy provider code",
        group: "Dialog",
        cmd: () => {
          const code =
            props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4,5}/)?.[0] ?? props.authorization.url
          clipboard
            .write?.(code)
            .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
            .catch(toast.error)
        },
      },
    ],
  }))

  onMount(async () => {
    const result = await sdk.client.provider.oauth.callback({
      providerID: props.providerID,
      method: props.index,
    })
    if (result.error) {
      toast.show({
        variant: "error",
        message:
          "name" in result.error && result.error.name === "ProviderAuthOauthCallbackFailed"
            ? "OAuth authorization failed. Try /connect again."
            : JSON.stringify(result.error),
      })
      dialog.clear()
      return
    }
    await sdk.client.instance.dispose()
    await sync.bootstrap()
    dialog.replace(() => <DialogModel providerID={props.providerID} />)
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>
      <text fg={theme.textMuted}>Waiting for authorization...</text>
      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}

interface CodeMethodProps {
  index: number
  title: string
  providerID: string
  authorization: ProviderAuthAuthorization
}
function CodeMethod(props: CodeMethodProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const [error, setError] = createSignal(false)

  return (
    <DialogPrompt
      title={props.title}
      placeholder="Authorization code"
      onConfirm={async (value) => {
        const { error } = await sdk.client.provider.oauth.callback({
          providerID: props.providerID,
          method: props.index,
          code: value,
        })
        if (!error) {
          await sdk.client.instance.dispose()
          await sync.bootstrap()
          dialog.replace(() => <DialogModel providerID={props.providerID} />)
          return
        }
        setError(true)
      }}
      description={() => (
        <box gap={1}>
          <text fg={theme.textMuted}>{props.authorization.instructions}</text>
          <Link href={props.authorization.url} fg={theme.primary} />
          <Show when={error()}>
            <text fg={theme.error}>Invalid code</text>
          </Show>
        </box>
      )}
    />
  )
}

interface ApiMethodProps {
  providerID: string
  title: string
  metadata?: Record<string, string>
  custom?: boolean
}
function ApiMethod(props: ApiMethodProps) {
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()
  const { theme } = useTheme()

  return (
    <DialogPrompt
      title={props.title}
      placeholder="API key"
      description={() =>
        ({
          opencode: (
            <box gap={1}>
              <text fg={theme.textMuted}>
                OpenCode Zen gives you access to all the best coding models at the cheapest prices with a single API
                key.
              </text>
              <text fg={theme.text}>
                Go to <span style={{ fg: theme.primary }}>https://opencode.ai/zen</span> to get a key
              </text>
            </box>
          ),
          "opencode-go": (
            <box gap={1}>
              <text fg={theme.textMuted}>
                OpenCode Go is a $10 per month subscription that provides reliable access to popular open coding models
                with generous usage limits.
              </text>
              <text fg={theme.text}>
                Go to <span style={{ fg: theme.primary }}>https://opencode.ai/go</span> and enable OpenCode Go
              </text>
            </box>
          ),
        })[props.providerID] ?? undefined
      }
      onConfirm={async (value) => {
        if (!value) return
        await sdk.client.auth.set({
          providerID: props.providerID,
          auth: {
            type: "api",
            key: value,
            ...(props.metadata ? { metadata: props.metadata } : {}),
          },
        })
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        if (props.custom && !sync.data.provider_next.all.some((provider) => provider.id === props.providerID)) {
          toast.show({
            variant: "info",
            message: `Saved credential for ${props.providerID}. Configure it in opencode.json to use it.`,
          })
          dialog.clear()
          return
        }
        dialog.replace(() => <DialogModel providerID={props.providerID} />)
      }}
    />
  )
}

interface PromptsMethodProps {
  dialog: ReturnType<typeof useDialog>
  prompts: NonNullable<ProviderAuthMethod["prompts"]>[number][]
}
async function PromptsMethod(props: PromptsMethodProps) {
  const inputs: Record<string, string> = {}
  for (const prompt of props.prompts) {
    if (prompt.when) {
      const value = inputs[prompt.when.key]
      if (value === undefined) continue
      const matches = prompt.when.op === "eq" ? value === prompt.when.value : value !== prompt.when.value
      if (!matches) continue
    }

    if (prompt.type === "select") {
      const value = await new Promise<string | null>((resolve) => {
        props.dialog.replace(
          () => (
            <DialogSelect
              title={prompt.message}
              options={prompt.options.map((x) => ({
                title: x.label,
                value: x.value,
                description: x.hint,
              }))}
              onSelect={(option) => resolve(option.value)}
            />
          ),
          () => resolve(null),
        )
      })
      if (value === null) return null
      inputs[prompt.key] = value
      continue
    }

    const value = await new Promise<string | null>((resolve) => {
      props.dialog.replace(
        () => (
          <DialogPrompt title={prompt.message} placeholder={prompt.placeholder} onConfirm={(value) => resolve(value)} />
        ),
        () => resolve(null),
      )
    })
    if (value === null) return null
    inputs[prompt.key] = value
  }
  return inputs
}

// --- CrokCode plan connect (browser device-pairing) ---------------------------
// Mirrors packages/opencode/src/cli/cmd/login.ts. All plans connect the same
// `crokapi` gateway provider; the gateway enforces the account's real plan.
// ponytail: the model list + config write are duplicated from login.ts. If this
// diverges, extract a shared helper both the CLI and TUI import.
const CROK_AUTH_BASE = "https://zapkpyjeetjbufuuqwye.supabase.co"
const CROK_CLI_AUTH = `${CROK_AUTH_BASE}/functions/v1/cli-auth`
const CROK_GATEWAY = `${CROK_AUTH_BASE}/functions/v1/crokapi/v1`

// `image: true` = accepts image input (from upstream OpenRouter modalities), so
// the TUI sends attachments instead of stripping them. GLM/DeepSeek are text-only.
const CROK_MODELS: Record<string, { name: string; image?: boolean; cost: { input: number; output: number } }> = {
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

// Display name + model subset per plan. CrokGo is budget-only; the gateway
// enforces this too, so these lists must match CROKGO_MODELS in the gateway.
const CROK_PLAN_NAME: Record<string, string> = {
  crokgo: "CrokGo",
  crokpro: "CrokPro",
  "crok-as-you-go": "Crok-as-you-go",
}
const CROK_PLAN_MODEL_IDS: Record<string, string[]> = {
  crokgo: ["deepseek/deepseek-v4-flash", "z-ai/glm-4.7-flash", "xiaomi/mimo-v2.5", "qwen/qwen3-coder-flash", "deepseek/deepseek-v4-pro", "xiaomi/mimo-v2.5-pro", "minimax/minimax-m3", "qwen/qwen3.7-plus", "z-ai/glm-5.2"],
  crokpro: Object.keys(CROK_MODELS),
  "crok-as-you-go": Object.keys(CROK_MODELS),
}
// Builds the provider block for a plan: named after the plan, exposing only
// that plan's models.
function crokProviderBlock(planID: string, apiKey: string) {
  const modelIDs = CROK_PLAN_MODEL_IDS[planID] ?? Object.keys(CROK_MODELS)
  const models: Record<
    string,
    {
      name: string
      reasoning: boolean
      cost: { input: number; output: number }
      modalities: { input: string[]; output: string[] }
    }
  > = {}
  for (const id of modelIDs) {
    const def = CROK_MODELS[id]
    // reasoning enables /effort; cost makes the status line show real dollars.
    if (def)
      models[id] = {
        name: def.name,
        reasoning: true,
        cost: { input: def.cost.input, output: def.cost.output },
        modalities: { input: def.image ? ["text", "image"] : ["text"], output: ["text"] },
      }
  }
  return {
    npm: "@ai-sdk/openai-compatible",
    name: CROK_PLAN_NAME[planID] ?? "CrokCode",
    options: { baseURL: CROK_GATEWAY, apiKey },
    models,
  }
}

interface PlanConnectProps {
  planID: string
  title: string
}
function PlanConnect(props: PlanConnectProps) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const toast = useToast()
  const [url, setUrl] = createSignal<string>()
  const [code, setCode] = createSignal<string>()
  const [status, setStatus] = createSignal("Starting…")
  let cancelled = false
  onCleanup(() => {
    cancelled = true
  })

  async function cliAuth(body: Record<string, unknown>) {
    const res = await fetch(CROK_CLI_AUTH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
    return (await res.json().catch(() => ({}))) as Record<string, any>
  }

  onMount(async () => {
    const started = await cliAuth({ action: "start" }).catch(() => ({}) as Record<string, any>)
    if (cancelled) return
    if (!started.device_code) {
      toast.show({ variant: "error", message: "Could not reach the CrokCode login service." })
      dialog.clear()
      return
    }
    setUrl(started.verification_uri)
    setCode(started.user_code)
    setStatus("Waiting for approval in your browser…")

    const interval = Math.max(2, Number(started.interval) || 3) * 1000
    const deadline = Date.now() + (Number(started.expires_in) || 600) * 1000
    while (!cancelled && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, interval))
      if (cancelled) return
      const polled = await cliAuth({ action: "poll", device_code: started.device_code }).catch(
        () => ({}) as Record<string, any>,
      )
      if (polled.api_key) {
        setStatus("Approved. Connecting…")
        try {
          // Persist through the API so the global config cache is invalidated and
          // the provider loads immediately (a raw file write is not picked up
          // mid-session). A fresh key each pairing keeps `changed` true.
          await sdk.client.global.config.update({
            config: { provider: { [props.planID]: crokProviderBlock(props.planID, polled.api_key as string) } } as any,
          })
        } catch {
          toast.show({ variant: "error", message: "Connected, but could not save the provider." })
          dialog.clear()
          return
        }
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        if (cancelled) return
        dialog.replace(() => <DialogModel providerID={props.planID} />)
        return
      }
      if (polled.status === "pending") continue
      break
    }
    if (!cancelled) {
      toast.show({ variant: "error", message: "Login did not complete. Try again." })
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Connect {props.title}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show when={code()}>
        <box gap={1}>
          <text fg={theme.textMuted}>Open this link in your browser and approve the code:</text>
          <Link href={url()!} fg={theme.primary} />
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            {code()}
          </text>
        </box>
      </Show>
      <text fg={theme.textMuted}>{status()}</text>
    </box>
  )
}
