import { isRecord } from "../../util/record"

export type GuardFinding = {
  id: string
  rule_id: string
  status: string
  severity: "critical" | "warning"
  confidence: "high" | "medium"
  source: string
  file: string
  line?: number
  evidence: string
  remediation: string
}

export type GuardScanResult = {
  status: string
  phase: "pre-write" | "post-shell" | "manual"
  findings: GuardFinding[]
  changes: Array<{ file: string; diff: string }>
  dependency_audit: { status: "unavailable" }
  before_snapshot?: string
}

const unresolved = new Set(["blocked", "warning"])

export function guardFindings(metadata: unknown, file?: string) {
  const result = guardResult(metadata)
  if (!result) return []
  return result.findings
    .filter((finding) => !file || finding.file.replaceAll("\\", "/") === file.replaceAll("\\", "/"))
    .sort((a, b) => Number(b.severity === "critical") - Number(a.severity === "critical"))
}

export function guardSummary(metadata: unknown, file?: string) {
  const findings = guardFindings(metadata, file).filter((finding) => unresolved.has(finding.status))
  return { inline: findings.slice(0, 3), additional: findings.slice(3) }
}

export function guardResult(metadata: unknown): GuardScanResult | undefined {
  if (!isRecord(metadata) || !isRecord(metadata.guard)) return
  const value = metadata.guard
  if (!Array.isArray(value.findings) || !isRecord(value.dependency_audit)) return
  const findings = value.findings.flatMap((item) => {
    if (!isRecord(item)) return []
    if (
      typeof item.id !== "string" ||
      typeof item.rule_id !== "string" ||
      typeof item.status !== "string" ||
      (item.severity !== "critical" && item.severity !== "warning") ||
      (item.confidence !== "high" && item.confidence !== "medium") ||
      typeof item.source !== "string" ||
      typeof item.file !== "string" ||
      typeof item.evidence !== "string" ||
      typeof item.remediation !== "string"
    )
      return []
    return [
      {
        id: item.id,
        rule_id: item.rule_id,
        status: item.status,
        severity: item.severity as GuardFinding["severity"],
        confidence: item.confidence as GuardFinding["confidence"],
        source: item.source,
        file: item.file,
        line: typeof item.line === "number" && Number.isFinite(item.line) ? item.line : undefined,
        evidence: item.evidence,
        remediation: item.remediation,
      },
    ]
  })
  const phase = value.phase
  if (phase !== "pre-write" && phase !== "post-shell" && phase !== "manual") return
  const changes = Array.isArray(value.changes)
    ? value.changes.flatMap((item) => {
        if (!isRecord(item) || typeof item.file !== "string" || typeof item.diff !== "string") return []
        return [{ file: item.file, diff: item.diff }]
      })
    : []
  return {
    status: typeof value.status === "string" ? value.status : "unavailable",
    phase,
    findings,
    changes,
    dependency_audit: { status: "unavailable" },
    before_snapshot: typeof value.before_snapshot === "string" ? value.before_snapshot : undefined,
  }
}

export function toolHasUnresolvedGuard(metadata: unknown) {
  const result = guardResult(metadata)
  return result?.status === "unavailable" || guardFindings(metadata).some((finding) => unresolved.has(finding.status))
}

export function guardCheckUnavailable(metadata: unknown) {
  return guardResult(metadata)?.status === "unavailable"
}

export function guardDependencyUnavailable(metadata: unknown) {
  return guardResult(metadata)?.dependency_audit.status === "unavailable"
}

export function guardShellCommand(metadata: unknown, command: string | undefined) {
  if (guardFindings(metadata).some((finding) => finding.source === "secret")) return "[REDACTED COMMAND]"
  if (
    command &&
    /(?:api[_-]?key|secret|access[_-]?key|auth[_-]?token|token|password|private[_-]?key)\s*[:=]\s*["']?[A-Za-z0-9_./+=-]{20,}|\b(?:sk_live_|sk-(?:proj|ant)-|xox[baprs]-|gh[pousr]_)[A-Za-z0-9_-]{20,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/i.test(
      command,
    )
  )
    return "[REDACTED COMMAND]"
  if (
    command
      ?.match(/[A-Za-z0-9_./+=-]{20,}/g)
      ?.some(
        (candidate) =>
          !/placeholder|test|example|dummy|changeme|development/i.test(candidate) &&
          [/[a-z]/, /[A-Z]/, /\d/, /[_./+=-]/].filter((pattern) => pattern.test(candidate)).length >= 3,
      )
  )
    return "[REDACTED COMMAND]"
  return command
}

export function guardShouldResume(value: unknown) {
  const result = guardResult({ guard: value })
  return Boolean(result && !result.findings.some((finding) => unresolved.has(finding.status)))
}

export function unresolvedGuardCount(parts: ReadonlyArray<unknown>) {
  const seen = new Set<string>()
  parts.forEach((part, index) => {
    if (!isRecord(part) || !isRecord(part.state)) return
    const partID = typeof part.id === "string" ? part.id : String(index)
    guardFindings(part.state.metadata).forEach((finding) => {
      if (unresolved.has(finding.status)) seen.add(`${partID}:${finding.id}`)
    })
  })
  return seen.size
}

export function guardActionsEnabled(input: { cardFocused: boolean; promptFocused: boolean; editorFocused: boolean }) {
  return input.cardFocused && !input.promptFocused && !input.editorFocused
}

export function buildGuardFixPrompt(finding: GuardFinding, result: GuardScanResult) {
  const location = `${finding.file}${finding.line ? `:${finding.line}` : ""}`
  const file = finding.file.replaceAll("\\", "/")
  const change = result.changes.find((item) => item.file.replaceAll("\\", "/") === file)?.diff ?? finding.evidence
  return [
    `Fix only Guard finding ${finding.rule_id} at ${location}.`,
    `Evidence (redacted): ${finding.evidence}`,
    `Remediation: ${finding.remediation}`,
    "Relevant added change (redacted):",
    change,
  ].join("\n")
}

export async function submitGuardFix(
  finding: GuardFinding,
  result: GuardScanResult,
  submit: (prompt: string) => unknown,
) {
  await submit(buildGuardFixPrompt(finding, result))
}

export async function runGuardAction(action: () => unknown, onError: (error: unknown) => void) {
  await Promise.resolve().then(action).catch(onError)
}

export function guardResolveAction(phase: GuardScanResult["phase"], status: GuardFinding["status"] = "blocked") {
  if (phase === "post-shell") return "revert"
  if (phase === "pre-write" && status === "blocked") return "discard"
}

export async function resolveGuardFinding(
  input: { phase: GuardScanResult["phase"]; finding: GuardFinding },
  resolve: (action: "discard" | "revert", finding: GuardFinding) => unknown,
) {
  const action = guardResolveAction(input.phase, input.finding.status)
  if (!action) return
  await resolve(action, input.finding)
}

export function guardDialogText(value: unknown) {
  const result = guardResult({ guard: value }) ?? {
    status: "unavailable",
    phase: "manual" as const,
    findings: [],
    dependency_audit: { status: "unavailable" as const },
    changes: [],
  }
  const findings = result.findings.length
    ? result.findings
        .map(
          (finding) =>
            `${finding.severity.toUpperCase()} ${finding.confidence} ${finding.rule_id} ${finding.file}${finding.line ? `:${finding.line}` : ""}\n${finding.evidence}\n${finding.remediation}`,
        )
        .join("\n\n")
    : result.status === "unavailable"
      ? "Guard check unavailable."
      : "No Guard findings."
  return `${findings}\n\nDependency check: check unavailable`
}
