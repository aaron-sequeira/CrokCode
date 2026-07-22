import { describe, expect, test } from "bun:test"
import {
  buildGuardFixPrompt,
  guardActionsEnabled,
  guardCheckUnavailable,
  guardDependencyUnavailable,
  guardDialogText,
  guardFindings,
  guardResolveAction,
  guardShellCommand,
  guardShouldResume,
  guardSummary,
  resolveGuardFinding,
  runGuardAction,
  submitGuardFix,
  toolHasUnresolvedGuard,
  unresolvedGuardCount,
  type GuardFinding,
  type GuardScanResult,
} from "../../../src/routes/session/guard"

const warning = {
  id: "warning",
  rule_id: "execution.process",
  status: "warning",
  severity: "warning",
  confidence: "medium",
  source: "execution",
  file: "src/run.ts",
  line: 9,
  evidence: "exec(userInput)",
  remediation: "Use a constrained API.",
} as const

const critical = {
  id: "critical",
  rule_id: "secret.literal",
  status: "blocked",
  severity: "critical",
  confidence: "high",
  source: "secret",
  file: "src/config.ts",
  line: 42,
  evidence: 'apiKey = "[REDACTED]"',
  remediation: "Load the value from an environment variable.",
} as const

function metadata(findings: ReadonlyArray<GuardFinding>, phase: GuardScanResult["phase"] = "pre-write") {
  return {
    guard: {
      status: "blocked",
      phase,
      findings: [...findings],
      changes: [
        { file: "src/run.ts", diff: "+exec(userInput)" },
        { file: "src/config.ts", diff: '+const safe = true\n+const apiKey = "[REDACTED]"' },
      ],
      dependency_audit: { status: "unavailable" as const },
    },
  }
}

describe("session Guard helpers", () => {
  test("orders critical findings first and limits inline cards to three", () => {
    const result = guardSummary(
      metadata([warning, { ...warning, id: "warning-2" }, critical, { ...critical, id: "critical-2" }]),
    )

    expect(result.inline.map((finding) => finding.id)).toEqual(["critical", "critical-2", "warning"])
    expect(result.additional).toHaveLength(1)
  })

  test("filters findings to the matching apply-patch file", () => {
    expect(guardFindings(metadata([warning, critical]), "src/run.ts").map((finding) => finding.id)).toEqual(["warning"])
  })

  test("counts unresolved findings once per tool part", () => {
    const part = { id: "part-1", state: { metadata: metadata([warning, critical]) } }
    expect(unresolvedGuardCount([part, part, { ...part, id: "part-2" }])).toBe(4)
  })

  test("keeps completed tool details visible while Guard is unresolved", () => {
    expect(toolHasUnresolvedGuard(metadata([warning]))).toBe(true)
    expect(toolHasUnresolvedGuard(metadata([{ ...warning, status: "accepted" }]))).toBe(false)
    const unavailable = metadata([])
    unavailable.guard.status = "unavailable"
    expect(toolHasUnresolvedGuard(unavailable)).toBe(true)
    expect(guardCheckUnavailable(unavailable)).toBe(true)
  })

  test("enables card keys only when card is focused and no editor is focused", () => {
    expect(guardActionsEnabled({ cardFocused: true, promptFocused: false, editorFocused: false })).toBe(true)
    expect(guardActionsEnabled({ cardFocused: false, promptFocused: false, editorFocused: false })).toBe(false)
    expect(guardActionsEnabled({ cardFocused: true, promptFocused: true, editorFocused: false })).toBe(false)
    expect(guardActionsEnabled({ cardFocused: true, promptFocused: false, editorFocused: true })).toBe(false)
  })

  test("builds one scoped redacted fix prompt and submits it once", async () => {
    const calls: string[] = []
    const result = metadata([critical]).guard
    const prompt = buildGuardFixPrompt(critical, result)

    await submitGuardFix(critical, result, async (value) => calls.push(value))

    expect(calls).toEqual([prompt])
    expect(prompt).toContain("secret.literal")
    expect(prompt).toContain("src/config.ts:42")
    expect(prompt).toContain("[REDACTED]")
    expect(prompt).toContain("const safe = true")
  })

  test("never copies the original blocked secret into the fix prompt", () => {
    const secret = "sk_live" + "_51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB"
    expect(buildGuardFixPrompt(critical, metadata([critical]).guard)).not.toContain(secret)
  })

  test("conceals a shell command attached to a secret finding", () => {
    const secret = "sk_live" + "_51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB"
    expect(guardShellCommand(metadata([critical], "post-shell"), `echo ${secret} > config.ts`)).toBe(
      "[REDACTED COMMAND]",
    )
    expect(guardShellCommand({}, `echo ${secret}`)).toBe("[REDACTED COMMAND]")
    expect(guardShellCommand(metadata([warning], "post-shell"), "bun test")).toBe("bun test")
  })

  test("resumes only after the last unresolved post-shell finding is accepted", () => {
    expect(guardShouldResume(metadata([{ ...critical, status: "accepted" }, warning], "post-shell").guard)).toBe(false)
    expect(
      guardShouldResume(
        metadata(
          [
            { ...critical, status: "accepted" },
            { ...warning, status: "accepted" },
          ],
          "post-shell",
        ).guard,
      ),
    ).toBe(true)
  })

  test("reports dependency audit unavailability without a dependency finding", () => {
    expect(guardDependencyUnavailable(metadata([warning]))).toBe(true)
  })

  test("guards rejected async actions with one error callback", async () => {
    const errors: unknown[] = []
    await runGuardAction(
      async () => Promise.reject(new Error("offline")),
      (error) => errors.push(error),
    )
    expect(errors).toHaveLength(1)
  })

  test("maps Revert to discard before writes and revert after shell writes", () => {
    expect(guardResolveAction("pre-write")).toBe("discard")
    expect(guardResolveAction("post-shell")).toBe("revert")
  })

  test("does not discard a non-blocking pre-write warning", async () => {
    const resolutions: string[] = []
    await resolveGuardFinding({ phase: "pre-write", finding: warning }, async (action) => resolutions.push(action))
    expect(resolutions).toEqual([])
  })

  test("reverts without invoking a model prompt", async () => {
    const resolutions: string[] = []
    let prompts = 0
    await resolveGuardFinding({ phase: "post-shell", finding: warning }, async (action) => resolutions.push(action))

    expect(resolutions).toEqual(["revert"])
    expect(prompts).toBe(0)
  })

  test("formats unavailable manual scans deterministically", () => {
    expect(
      guardDialogText({
        status: "unavailable",
        phase: "manual",
        findings: [],
        changes: [],
        dependency_audit: { status: "unavailable" },
      }),
    ).toContain("check unavailable")
  })

  test("includes confidence in findings dialog text", () => {
    expect(guardDialogText(metadata([warning]).guard)).toContain("WARNING medium execution.process")
  })
})
