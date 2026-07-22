import { BoxRenderable, RenderableEvents, TextAttributes } from "@opentui/core"
import { useRenderer } from "@opentui/solid"
import { createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import type { ToolPart } from "@crokcode/sdk/v2"
import { useTheme } from "../../context/theme"
import { useSDK } from "../../context/sdk"
import { useLocal } from "../../context/local"
import { useDialog } from "../../ui/dialog"
import { DialogAlert } from "../../ui/dialog-alert"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { useToast } from "../../ui/toast"
import { useBindings } from "../../keymap"
import { usePromptRef } from "../../context/prompt"
import { usePathFormatter } from "../../context/path-format"
import {
  guardActionsEnabled,
  guardCheckUnavailable,
  guardDependencyUnavailable,
  guardDialogText,
  guardResult,
  guardResolveAction,
  guardShouldResume,
  guardSummary,
  resolveGuardFinding,
  runGuardAction,
  submitGuardFix,
  type GuardFinding,
} from "./guard"
import { errorMessage } from "../../util/error"

export function GuardCards(props: {
  metadata: unknown
  part: ToolPart
  file?: string
  findings?: GuardFinding[]
  additional?: GuardFinding[]
  showStatus?: boolean
}) {
  const { theme } = useTheme()
  const sdk = useSDK()
  const local = useLocal()
  const dialog = useDialog()
  const toast = useToast()
  const result = createMemo(() => guardResult(props.metadata))
  const summary = createMemo(() =>
    props.findings
      ? { inline: props.findings, additional: props.additional ?? [] }
      : guardSummary(props.metadata, props.file),
  )

  function action(name: string, run: () => unknown) {
    void runGuardAction(run, (error) =>
      toast.show({ variant: "error", message: `Guard ${name} failed: ${errorMessage(error)}` }),
    )
  }

  async function sendPrompt(text: string) {
    const agent = local.agent.current()
    const model = local.model.current()
    if (!agent || !model) {
      toast.show({ variant: "warning", message: "Connect a model before using Guard Fix." })
      return
    }
    await sdk.client.session.prompt(
      {
        sessionID: props.part.sessionID,
        ...model,
        agent: agent.name,
        model,
        variant: local.model.variant.current(),
        parts: [{ type: "text", text }],
      },
      { throwOnError: true },
    )
  }

  async function resolve(finding: GuardFinding) {
    const scan = result()
    if (!scan) return
    await resolveGuardFinding({ phase: scan.phase, finding }, (action) =>
      sdk.client.session.guard.resolve(
        {
          sessionID: props.part.sessionID,
          messageID: props.part.messageID,
          partID: props.part.id,
          findingID: finding.id,
          action,
        },
        { throwOnError: true },
      ),
    )
  }

  async function accept(finding: GuardFinding) {
    dialog.clear()
    const reason = await DialogPrompt.show(dialog, "Accept Guard risk", {
      placeholder: "Short reason (required)",
    })
    dialog.clear()
    if (!reason?.trim()) {
      toast.show({ variant: "warning", message: "Accept risk requires a reason." })
      return
    }
    const response = await sdk.client.session.guard.resolve(
      {
        sessionID: props.part.sessionID,
        messageID: props.part.messageID,
        partID: props.part.id,
        findingID: finding.id,
        action: "accept",
        reason: reason.trim(),
      },
      { throwOnError: true },
    )
    if (guardShouldResume(response.data)) await sendPrompt(`Continue after accepted Guard finding ${finding.rule_id}.`)
  }

  function explain(finding: GuardFinding) {
    const scan = result()
    if (!scan) return
    dialog.replace(() => (
      <GuardExplanation
        finding={finding}
        canAccept={scan.phase === "post-shell"}
        onAccept={() => action("accept", () => accept(finding))}
      />
    ))
  }

  async function showAdditional() {
    const scan = result()
    if (!scan) return
    await DialogAlert.show(dialog, "More Guard findings", guardDialogText({ ...scan, findings: summary().additional }))
  }

  return (
    <Show
      when={
        summary().inline.length > 0 ||
        summary().additional.length > 0 ||
        (props.showStatus !== false &&
          (guardCheckUnavailable(props.metadata) || guardDependencyUnavailable(props.metadata)))
      }
    >
      <box flexDirection="column" gap={1} marginTop={1}>
        <For each={summary().inline}>
          {(finding) => (
            <GuardCard
              finding={finding}
              onFix={() => {
                const scan = result()
                if (scan) action("fix", () => submitGuardFix(finding, scan, sendPrompt))
              }}
              onExplain={() => explain(finding)}
              onRevert={
                guardResolveAction(result()?.phase ?? "manual", finding.status)
                  ? () => action("revert", () => resolve(finding))
                  : undefined
              }
            />
          )}
        </For>
        <Show when={summary().additional.length > 0}>
          <text fg={theme.textMuted} onMouseUp={() => action("details", showAdditional)}>
            +{summary().additional.length} more findings · open
          </text>
        </Show>
        <Show when={props.showStatus !== false && guardCheckUnavailable(props.metadata)}>
          <text fg={theme.error}>Guard check unavailable</text>
        </Show>
        <Show when={props.showStatus !== false && guardDependencyUnavailable(props.metadata)}>
          <text fg={theme.warning}>Dependency check: check unavailable</text>
        </Show>
      </box>
    </Show>
  )
}

function GuardCard(props: { finding: GuardFinding; onFix: () => void; onExplain: () => void; onRevert?: () => void }) {
  const { theme } = useTheme()
  const renderer = useRenderer()
  const promptRef = usePromptRef()
  const pathFormatter = usePathFormatter()
  const [focused, setFocused] = createSignal(false)
  let card: BoxRenderable
  const onFocus = () => setFocused(true)
  const onBlur = () => setFocused(false)

  const focus = () => {
    promptRef.current?.blur()
    card.focus()
  }

  useBindings(() => ({
    enabled: () =>
      guardActionsEnabled({
        cardFocused: focused(),
        promptFocused: promptRef.current?.focused ?? false,
        editorFocused: renderer.currentFocusedEditor !== null,
      }),
    bindings: [
      { key: "f", desc: "Fix Guard finding", group: "Guard", cmd: props.onFix },
      { key: "e", desc: "Explain Guard finding", group: "Guard", cmd: props.onExplain },
      ...(props.onRevert ? [{ key: "r", desc: "Revert Guard finding", group: "Guard", cmd: props.onRevert }] : []),
      { key: "return", desc: "Explain Guard finding", group: "Guard", cmd: props.onExplain },
    ],
  }))

  onCleanup(() => {
    card?.off(RenderableEvents.FOCUSED, onFocus)
    card?.off(RenderableEvents.BLURRED, onBlur)
  })

  const location = () =>
    `${pathFormatter.format(props.finding.file)}${props.finding.line ? `:${props.finding.line}` : ""}`

  return (
    <box
      ref={(value: BoxRenderable) => {
        card = value
        card.on(RenderableEvents.FOCUSED, onFocus)
        card.on(RenderableEvents.BLURRED, onBlur)
      }}
      focusable={true}
      border={["left"]}
      borderColor={props.finding.severity === "critical" ? theme.error : theme.warning}
      backgroundColor={focused() ? theme.backgroundMenu : theme.backgroundPanel}
      paddingLeft={2}
      paddingRight={1}
      paddingTop={1}
      paddingBottom={1}
      gap={1}
      onMouseDown={focus}
    >
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.primary}>
          ▰ CROK GUARD
        </text>
        <text fg={props.finding.severity === "critical" ? theme.error : theme.warning}>
          {props.finding.severity.toUpperCase()} · {props.finding.confidence}
        </text>
      </box>
      <text fg={theme.text}>{props.finding.rule_id}</text>
      <text fg={theme.text}>{props.finding.evidence}</text>
      <text fg={theme.textMuted}>{location()}</text>
      <box flexDirection="row" gap={2}>
        <text fg={theme.primary} onMouseUp={props.onFix}>
          [F] Fix
        </text>
        <text fg={theme.text} onMouseUp={props.onExplain}>
          [E] Explain
        </text>
        <Show when={props.onRevert}>
          <text fg={theme.text} onMouseUp={props.onRevert}>
            [R] Revert
          </text>
        </Show>
      </box>
    </box>
  )
}

function GuardExplanation(props: { finding: GuardFinding; canAccept: boolean; onAccept: () => void }) {
  const { theme } = useTheme()
  const dialog = useDialog()

  useBindings(() => ({
    bindings: [
      { key: "return", desc: "Close Guard explanation", group: "Dialog", cmd: () => dialog.clear() },
      ...(props.canAccept ? [{ key: "a", desc: "Accept Guard risk", group: "Dialog", cmd: props.onAccept }] : []),
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.primary}>
          CROK GUARD · {props.finding.rule_id}
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={theme.text}>{props.finding.evidence}</text>
      <text fg={theme.textMuted}>{props.finding.remediation}</text>
      <box flexDirection="row" justifyContent="flex-end" gap={2}>
        <Show when={props.canAccept}>
          <text fg={theme.textMuted} onMouseUp={props.onAccept}>
            [A] Accept risk
          </text>
        </Show>
        <text fg={theme.primary} onMouseUp={() => dialog.clear()}>
          Enter Close
        </text>
      </box>
    </box>
  )
}
