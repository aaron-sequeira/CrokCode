import { createMemo, createSignal, onCleanup, onMount, Show, Switch, Match } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { DialogSelect } from "../ui/dialog-select"
import { useDialog } from "../ui/dialog"
import { useTheme } from "../context/theme"
import { useSDK } from "../context/sdk"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { Link } from "../ui/link"
import { DialogModel } from "./dialog-model"
import {
  canRun,
  deviceSpecs,
  gb,
  LOCAL_MODELS,
  OLLAMA_URL,
  ollamaStatus,
  pullModel,
  type DeviceSpecs,
  type LocalModel,
} from "../util/local-models"

function bar(pct: number, width = 26) {
  const filled = Math.round(Math.max(0, Math.min(1, pct)) * width)
  return "█".repeat(filled) + "░".repeat(Math.max(0, width - filled))
}

export function DialogLocal() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const sync = useSync()
  const toast = useToast()

  const [phase, setPhase] = createSignal<"checking" | "install" | "list" | "pulling" | "connecting">("checking")
  const [specs, setSpecs] = createSignal<DeviceSpecs>()
  const [installed, setInstalled] = createSignal<Set<string>>(new Set())
  const [pull, setPull] = createSignal<{ model: LocalModel; pct: number; status: string }>()
  let aborter: AbortController | undefined
  onCleanup(() => aborter?.abort())

  onMount(async () => {
    const [status, machine] = await Promise.all([ollamaStatus(), deviceSpecs()])
    setSpecs(machine)
    if (!status.running) {
      setPhase("install")
      return
    }
    setInstalled(status.installed)
    setPhase("list")
  })

  const isInstalled = (id: string) => installed().has(id) || installed().has(`${id}:latest`)

  async function connect(model: LocalModel) {
    setPhase("connecting")
    try {
      await sdk.client.global.config.update({
        config: {
          provider: {
            ollama: {
              npm: "@ai-sdk/openai-compatible",
              name: "Ollama (local)",
              options: { baseURL: `${OLLAMA_URL}/v1`, apiKey: "ollama" },
              // Deep-merged, so each connected model is added, not replaced.
              models: { [model.id]: { name: `${model.name} ${model.params}`, tool_call: true } },
            },
          },
        } as any,
      })
      await sdk.client.instance.dispose()
      await sync.bootstrap()
      dialog.replace(() => <DialogModel providerID="ollama" />)
    } catch {
      toast.show({ variant: "error", message: "Connected the model, but could not update the config." })
      dialog.clear()
    }
  }

  async function download(model: LocalModel) {
    setPull({ model, pct: -1, status: "starting…" })
    setPhase("pulling")
    aborter = new AbortController()
    const ok = await pullModel(
      model.id,
      (pct, status) => setPull((p) => (p ? { ...p, pct, status } : p)),
      aborter.signal,
    ).catch(() => false)
    if (!ok) {
      if (aborter?.signal.aborted) return
      toast.show({ variant: "error", message: `Could not download ${model.name}. Is Ollama running?` })
      setPhase("list")
      return
    }
    await connect(model)
  }

  const options = createMemo(() =>
    LOCAL_MODELS.map((model) => {
      const machine = specs()
      const has = isInstalled(model.id)
      const runnable = machine ? canRun(model, machine) : true
      return {
        title: `${model.name} ${model.params}`,
        value: model.id,
        description: `${gb(model.sizeGb)} · ${model.note}`,
        disabled: !has && !runnable,
        // DialogSelect wraps option.footer in a <text>, so use <span> (a valid
        // text child) — a nested <text> would crash the renderer.
        footer: has ? (
          <span style={{ fg: theme.success }}>✓ downloaded</span>
        ) : runnable ? (
          <span style={{ fg: theme.textMuted }}>runs on your machine</span>
        ) : (
          <span style={{ fg: theme.error }}>needs {model.minRamGb} GB RAM</span>
        ),
        async onSelect() {
          if (has) return connect(model)
          if (!runnable) {
            toast.show({ variant: "warning", message: `${model.name} needs ~${model.minRamGb} GB of memory.` })
            return
          }
          return download(model)
        },
      }
    }),
  )

  const machineLine = () => {
    const m = specs()
    if (!m) return ""
    return `Your machine: ${gb(m.ramGb)} RAM · ${m.cpus} cores${m.vramGb ? ` · ${gb(m.vramGb)} GPU` : ""}`
  }

  return (
    <Switch>
      <Match when={phase() === "checking"}>
        <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Local models
          </text>
          <text fg={theme.textMuted}>Looking for Ollama…</text>
        </box>
      </Match>

      <Match when={phase() === "install"}>
        <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} width={58}>
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              Local models
            </text>
            <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
              esc
            </text>
          </box>
          <text fg={theme.textMuted}>
            CrokCode runs on-device models through Ollama, which handles the download and serving. It doesn't look
            installed (or isn't running) yet.
          </text>
          <box gap={1} marginTop={1}>
            <text fg={theme.text}>1. Install Ollama:</text>
            <Link href="https://ollama.com/download" fg={theme.primary} />
            <text fg={theme.text}>2. Make sure it's running, then reopen /local.</text>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
              Tip: if it's installed, run `ollama serve` in a terminal.
            </text>
          </box>
          <Show when={machineLine()}>
            <text fg={theme.textMuted} attributes={TextAttributes.DIM} marginTop={1}>
              {machineLine()}
            </text>
          </Show>
        </box>
      </Match>

      <Match when={phase() === "connecting"}>
        <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
          <text attributes={TextAttributes.BOLD} fg={theme.text}>
            Local models
          </text>
          <text fg={theme.success}>Connecting…</text>
        </box>
      </Match>

      <Match when={phase() === "pulling"}>
        <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1} width={54}>
          <box flexDirection="row" justifyContent="space-between">
            <text attributes={TextAttributes.BOLD} fg={theme.text}>
              Downloading {pull()?.model.name} {pull()?.model.params}
            </text>
            <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
              esc
            </text>
          </box>
          <Show
            when={(pull()?.pct ?? -1) >= 0}
            fallback={
              <text fg={theme.textMuted}>
                {pull()?.status || "starting…"}
                <span style={{ fg: theme.textMuted }}> …</span>
              </text>
            }
          >
            <box flexDirection="row" gap={2}>
              <text fg={theme.success}>{bar(pull()!.pct)}</text>
              <text fg={theme.text}>{Math.round(pull()!.pct * 100)}%</text>
            </box>
            <text fg={theme.textMuted}>
              {pull()?.status} · {gb(pull()!.pct * pull()!.model.sizeGb)} / {gb(pull()!.model.sizeGb)}
            </text>
          </Show>
          <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
            Downloads once, then runs fully offline. Press esc to cancel.
          </text>
        </box>
      </Match>

      <Match when={phase() === "list"}>
        <DialogSelect
          title="Local models"
          options={options()}
          footer={<text fg={theme.textMuted}>{machineLine()} · downloads via Ollama, then runs offline</text>}
        />
      </Match>
    </Switch>
  )
}
