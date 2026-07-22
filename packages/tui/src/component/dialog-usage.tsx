import { createSignal, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"

type Usage = {
  plan: string | null
  status: string | null
  allowed: boolean
  reason: string
  daily_used_cents: number | null
  daily_limit_cents: number | null
  weekly_used_cents: number | null
  weekly_limit_cents: number | null
  balance_cents: number | null
}

const PLAN_LABEL: Record<string, string> = {
  crokgo: "CrokGo",
  crokpro: "CrokPro",
  crok_as_you_go: "Crok-as-you-go",
}

const money = (cents: number | null | undefined) => `$${((cents ?? 0) / 100).toFixed(2)}`

function bar(used: number, limit: number, width = 22) {
  const pct = limit > 0 ? Math.min(1, used / limit) : 0
  const filled = Math.round(pct * width)
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}

function untilLabel(target: Date) {
  const ms = target.getTime() - Date.now()
  if (ms <= 0) return "now"
  const days = Math.floor(ms / 86_400_000)
  const hours = Math.floor((ms % 86_400_000) / 3_600_000)
  const mins = Math.floor((ms % 3_600_000) / 60_000)
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${mins}m`
  return `${mins}m`
}

// Limits reset on UTC day / ISO-week (Monday) boundaries, matching date_trunc in the DB.
function nextMidnightUTC() {
  const n = new Date()
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1))
}
function nextMondayUTC() {
  const n = new Date()
  const daysUntil = (8 - n.getUTCDay()) % 7 || 7
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + daysUntil))
}

export function DialogUsage() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const [state, setState] = createSignal<"loading" | "ready" | "error">("loading")
  const [error, setError] = createSignal("")
  const [usage, setUsage] = createSignal<Usage>()

  onMount(async () => {
    // Find the connected CrokCode provider (crokgo/crokpro/crok-as-you-go/crokapi).
    const providers = (sync.data.config as { provider?: Record<string, { options?: any }> }).provider ?? {}
    const entry = Object.entries(providers).find(([id]) => id.startsWith("crok"))
    const options = entry?.[1]?.options as { baseURL?: string; apiKey?: string } | undefined
    if (!options?.baseURL || !options?.apiKey) {
      setError("No CrokAPI connection found. Run /connect or `crokcode login` first.")
      setState("error")
      return
    }
    try {
      const response = await fetch(`${options.baseURL.replace(/\/$/, "")}/usage`, {
        headers: { authorization: `Bearer ${options.apiKey}` },
      })
      const body = (await response.json().catch(() => ({}))) as Usage & { error?: { message?: string } }
      if (!response.ok) {
        setError((body as any)?.error?.message ?? "Could not load usage.")
        setState("error")
        return
      }
      setUsage(body)
      setState("ready")
    } catch {
      setError("Could not reach the CrokAPI usage service.")
      setState("error")
    }
  })

  const header = () => {
    const u = usage()
    const label = u?.plan ? (PLAN_LABEL[u.plan] ?? u.plan) : "Pay-as-you-go"
    return `Usage — ${label}`
  }

  const meter = (title: string, used: number, limit: number, reset: Date) => {
    const over = used >= limit
    const near = used / limit >= 0.75
    const color = over ? theme.error : near ? theme.warning : theme.success
    return (
      <box flexDirection="row" gap={2}>
        <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
          {title.padEnd(6, " ")}
        </text>
        <text fg={color}>{bar(used, limit)}</text>
        <text fg={theme.text}>
          {money(used)} / {money(limit)}
        </text>
        <text fg={theme.textMuted}>
          {over ? "reset in " : "resets in "}
          {untilLabel(reset)}
        </text>
      </box>
    )
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {header()}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={state() === "loading"}>
        <text fg={theme.textMuted}>Loading usage…</text>
      </Show>

      <Show when={state() === "error"}>
        <text fg={theme.error}>{error()}</text>
      </Show>

      <Show when={state() === "ready" && usage()?.daily_limit_cents != null}>
        <box gap={1}>
          {meter("Today", usage()!.daily_used_cents ?? 0, usage()!.daily_limit_cents!, nextMidnightUTC())}
          {meter("Week", usage()!.weekly_used_cents ?? 0, usage()!.weekly_limit_cents!, nextMondayUTC())}
          <Show when={!usage()!.allowed}>
            <text fg={theme.error}>
              {usage()!.reason === "weekly_limit" ? "Weekly" : "Daily"} limit reached — upgrade to CrokPro or use
              Crok-as-you-go for uncapped pay-per-use.
            </text>
          </Show>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            Limits reset on UTC day / Monday boundaries. Manage your plan at crokcode.tech.
          </text>
        </box>
      </Show>

      <Show when={state() === "ready" && usage()?.daily_limit_cents == null}>
        <box gap={1}>
          <box flexDirection="row" gap={2}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              Credit balance
            </text>
            <text fg={theme.text} attributes={TextAttributes.BOLD}>
              {money(usage()?.balance_cents)}
            </text>
          </box>
          <text fg={theme.textMuted}>Pay-as-you-go — drawn down per token. Top up at crokcode.tech.</text>
        </box>
      </Show>
    </box>
  )
}
