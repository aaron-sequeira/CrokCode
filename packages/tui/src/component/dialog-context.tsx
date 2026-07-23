import { createMemo, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import type { AssistantMessage } from "@crokcode/sdk/v2"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import * as Locale from "../util/locale"

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 4 })

function bar(used: number, limit: number, width = 24) {
  const pct = limit > 0 ? Math.min(1, used / limit) : 0
  const filled = Math.round(pct * width)
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}

// /context — a detailed breakdown of what is filling the model's context
// window and what this session has cost so far.
export function DialogContext() {
  const dialog = useDialog()
  const { theme } = useTheme()
  const sync = useSync()
  const route = useRoute()

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const data = createMemo(() => {
    const id = sessionID()
    if (!id) return
    const messages = sync.data.message[id] ?? []
    const last = messages.findLast(
      (item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0,
    )
    if (!last) return
    const model = sync.data.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const tokens = last.tokens
    const used = tokens.input + tokens.output + tokens.reasoning + tokens.cache.read + tokens.cache.write
    const limit = model?.limit.context ?? 0
    const session = sync.session.get(id)
    const assistants = messages.filter((item): item is AssistantMessage => item.role === "assistant")
    return {
      model: model?.name ?? last.modelID,
      providerID: last.providerID,
      tokens,
      used,
      limit,
      pct: limit > 0 ? Math.round((used / limit) * 100) : 0,
      cost: session?.cost ?? 0,
      turns: assistants.length,
      price: model?.cost,
    }
  })

  const row = (label: string, value: string) => (
    <box flexDirection="row" justifyContent="space-between">
      <text fg={theme.textMuted}>{label}</text>
      <text fg={theme.text}>{value}</text>
    </box>
  )

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} width={54}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          Context
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={data()}
        fallback={<text fg={theme.textMuted}>No usage yet — send a message first.</text>}
      >
        {(d) => (
          <box gap={1}>
            <box flexDirection="row" gap={2}>
              <text fg={d().pct >= 90 ? theme.error : d().pct >= 75 ? theme.warning : theme.success}>
                {bar(d().used, d().limit)}
              </text>
              <text fg={theme.text} attributes={TextAttributes.BOLD}>
                {d().pct}%
              </text>
            </box>
            <text fg={theme.textMuted}>
              {Locale.number(d().used)} of {d().limit ? Locale.number(d().limit) : "?"} tokens · {d().model}
            </text>

            <box marginTop={1} gap={0}>
              {row("Input", Locale.number(d().tokens.input))}
              {row("Output", Locale.number(d().tokens.output))}
              {row("Reasoning", Locale.number(d().tokens.reasoning))}
              {row("Cache read", Locale.number(d().tokens.cache.read))}
              {row("Cache write", Locale.number(d().tokens.cache.write))}
            </box>

            <box marginTop={1} gap={0}>
              {row("Session cost", money.format(d().cost))}
              {row("Assistant turns", String(d().turns))}
              <Show when={d().price}>
                {(p) => row("Model price /1M", `${money.format(p().input)} in · ${money.format(p().output)} out`)}
              </Show>
            </box>

            <text fg={theme.textMuted} attributes={TextAttributes.DIM} marginTop={1}>
              Costs use CrokAPI sell-side prices. Check /usage for plan limits.
            </text>
          </box>
        )}
      </Show>
    </box>
  )
}
