import { LayerNode } from "@crokcode/core/effect/layer-node"
import { serviceUse } from "@crokcode/core/effect/service-use"
import { Context, Effect, Layer, Schema } from "effect"
import { randomUUID } from "node:crypto"
import { chmod, lstat, mkdir, readdir, readFile, readlink, rm, symlink, writeFile } from "node:fs/promises"
import path from "node:path"
import { createTwoFilesPatch } from "diff"

export const Severity = Schema.Literals(["critical", "warning"])
export type Severity = typeof Severity.Type

export const Confidence = Schema.Literals(["high", "medium"])
export type Confidence = typeof Confidence.Type

export const Status = Schema.Literals([
  "blocked",
  "warning",
  "accepted",
  "discarded",
  "reverted",
  "fixed",
  "safe",
  "unavailable",
])
export type Status = typeof Status.Type

export const Phase = Schema.Literals(["pre-write", "post-shell", "manual"])
export type Phase = typeof Phase.Type

export const Source = Schema.Literals(["secret", "execution", "injection", "rendering", "transport", "dependency"])
export type Source = typeof Source.Type

export const Change = Schema.Struct({
  file: Schema.String,
  before: Schema.String,
  after: Schema.String,
  diff: Schema.String,
})
export type Change = typeof Change.Type

export const ChangeContext = Schema.Struct({
  file: Schema.String,
  diff: Schema.String,
})
export type ChangeContext = typeof ChangeContext.Type

export const GuardFinding = Schema.Struct({
  id: Schema.String,
  rule_id: Schema.String,
  status: Status,
  line: Schema.optional(Schema.Number),
  severity: Severity,
  confidence: Confidence,
  source: Source,
  file: Schema.String,
  evidence: Schema.String,
  remediation: Schema.String,
  resolution_reason: Schema.optional(Schema.String),
})
export type GuardFinding = typeof GuardFinding.Type

export const DependencyAudit = Schema.Struct({
  status: Schema.Literal("unavailable"),
})
export type DependencyAudit = typeof DependencyAudit.Type

export const GuardScanResult = Schema.Struct({
  status: Status,
  phase: Phase,
  findings: Schema.Array(GuardFinding),
  changes: Schema.optional(Schema.Array(ChangeContext)),
  dependency_audit: DependencyAudit,
  before_snapshot: Schema.optional(Schema.String),
})
export type GuardScanResult = typeof GuardScanResult.Type

export class GuardBlockedError extends Schema.TaggedErrorClass<GuardBlockedError>()("GuardBlockedError", {
  findings: Schema.Array(GuardFinding),
}) {}

export function scan(changes: ReadonlyArray<Change>, phase: Phase = "pre-write"): GuardScanResult {
  const findings = changes
    .filter((change) => /\.(?:[cm]?[jt]sx?|json)$/i.test(change.file))
    .flatMap((change) => scanChange(change))
    .sort((a, b) => {
      const left = `${a.file}:${a.source}:${a.evidence}`
      const right = `${b.file}:${b.source}:${b.evidence}`
      return left < right ? -1 : left > right ? 1 : 0
    })
    .map((finding, index) => ({ ...finding, id: `${finding.rule_id}:${finding.file}:${index + 1}` }))

  return {
    status: findings.some((finding) => finding.severity === "critical")
      ? "blocked"
      : findings.length
        ? "warning"
        : "safe",
    phase,
    findings,
    changes: changes.map((change) => ({ file: change.file, diff: redact(change.diff) })),
    dependency_audit: { status: "unavailable" },
  }
}

function scanChange(change: Change): GuardFinding[] {
  const lines = addedLines(change.diff)
  const added = lines.map((line) => line.text).join("\n")
  if (!added) return []

  const findings: GuardFinding[] = []
  if (lines.some((line) => hasSecret(line.text))) {
    findings.push({
      id: "",
      rule_id: "secret.literal",
      status: "blocked",
      severity: "critical",
      confidence: "high",
      source: "secret",
      file: change.file,
      line: lines.find((line) => hasSecret(line.text))?.line,
      evidence: evidence(lines, hasSecret),
      remediation: "Remove the secret and load it from a secret manager or environment variable.",
    })
  }
  if (/\b(?:exec|execSync|spawn|spawnSync|eval)\s*\(|new\s+Function\s*\(/.test(added)) {
    const rule = /\beval\s*\(|new\s+Function\s*\(/
    const match = rule.test(added) ? rule : /\b(?:exec|execSync|spawn|spawnSync)\s*\(/
    findings.push({
      id: "",
      rule_id: rule.test(added) ? "injection.dynamic-code" : "execution.process",
      status: "warning",
      severity: "warning",
      confidence: "medium",
      source: rule.test(added) ? "injection" : "execution",
      file: change.file,
      line: lines.find((line) => match.test(line.text))?.line,
      evidence: evidence(lines, (line) => match.test(line)),
      remediation: "Avoid executing untrusted input; use a constrained API instead.",
    })
  }
  if (/dangerouslySetInnerHTML|\binnerHTML\s*=/.test(added)) {
    findings.push({
      id: "",
      rule_id: "rendering.unsafe-html",
      status: "warning",
      severity: "warning",
      confidence: "medium",
      source: "rendering",
      file: change.file,
      line: lines.find((line) => /dangerouslySetInnerHTML|\binnerHTML\s*=/.test(line.text))?.line,
      evidence: evidence(lines, (line) => /dangerouslySetInnerHTML|\binnerHTML\s*=/.test(line)),
      remediation: "Sanitize HTML before rendering it.",
    })
  }
  if (
    /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|\b(?:verify|auth)\s*:\s*false/.test(added)
  ) {
    findings.push({
      id: "",
      rule_id: "transport.disabled-verification",
      status: "warning",
      severity: "warning",
      confidence: "medium",
      source: "transport",
      file: change.file,
      line: lines.find((line) =>
        /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|\b(?:verify|auth)\s*:\s*false/.test(
          line.text,
        ),
      )?.line,
      evidence: evidence(lines, (line) =>
        /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0|\b(?:verify|auth)\s*:\s*false/.test(
          line,
        ),
      ),
      remediation: "Keep TLS certificate validation and authentication enabled.",
    })
  }
  if (/package\.json$/i.test(change.file) && /["'](?:https?:|git\+|file:|link:)/.test(added)) {
    findings.push({
      id: "",
      rule_id: "dependency.unreviewed-source",
      status: "warning",
      severity: "warning",
      confidence: "medium",
      source: "dependency",
      file: change.file,
      line: lines.find((line) => /["'](?:https?:|git\+|file:|link:)/.test(line.text))?.line,
      evidence: evidence(lines, (line) => /["'](?:https?:|git\+|file:|link:)/.test(line)),
      remediation: "Use a reviewed registry package and run a dependency audit when available.",
    })
  }
  return findings
}

function addedLines(diff: string) {
  const state: { line?: number } = {}
  return diff.split("\n").flatMap((text) => {
    const hunk = text.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunk) {
      state.line = Number(hunk[1])
      return []
    }
    if (text.startsWith("+++") || text.startsWith("-") || text.startsWith("\\ No newline")) return []
    if (text.startsWith("+")) {
      const added = { text: text.slice(1), line: state.line }
      if (state.line !== undefined) state.line += 1
      return [added]
    }
    if (state.line !== undefined) state.line += 1
    return []
  })
}

function evidence(lines: ReadonlyArray<{ text: string }>, matches: (line: string) => boolean) {
  return redact(lines.find((line) => matches(line.text))?.text ?? "").slice(0, 240)
}

function hasSecret(value: string) {
  const keyed = value.match(
    /["']?(?:api[_-]?key|secret|access[_-]?key|auth[_-]?token|token|password|private[_-]?key)["']?\s*[:=]\s*["']?([A-Za-z0-9_./+=-]{20,})/i,
  )
  return (
    isGenericSecret(keyed?.[1]) ||
    /\b(?:sk_live_[A-Za-z0-9_-]{20,}|sk-(?:proj|ant)-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/.test(value) ||
    /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(value) ||
    /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/.test(value) ||
    /-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----/.test(value)
  )
}

export function redact(value: string) {
  return value
    .replace(
      /(["']?(?:api[_-]?key|secret|access[_-]?key|auth[_-]?token|token|password|private[_-]?key)["']?\s*[:=]\s*["']?)[A-Za-z0-9_./+=-]{20,}/gi,
      "$1[REDACTED]",
    )
    .replace(
      /\b(?:sk_live_[A-Za-z0-9_-]{20,}|sk-(?:proj|ant)-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{20,})\b/g,
      "[REDACTED]",
    )
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g, "[REDACTED]")
    .replace(/-----BEGIN(?: [A-Z]+)? PRIVATE KEY-----[\s\S]*/g, "[REDACTED PRIVATE KEY]")
    .replace(/[A-Za-z0-9_./+=-]{20,}/g, (candidate) => (isGenericSecret(candidate) ? "[REDACTED]" : candidate))
}

export function changeDiff(result: GuardScanResult, file: string) {
  const normalized = file.replaceAll("\\", "/")
  return result.changes?.find((change) => change.file.replaceAll("\\", "/") === normalized)?.diff ?? ""
}

function isGenericSecret(value: string | undefined) {
  if (!value || /placeholder|test|example|dummy|changeme|development/i.test(value)) return false
  return [/[a-z]/, /[A-Z]/, /\d/, /[_./+=-]/].filter((pattern) => pattern.test(value)).length >= 3
}

export interface Interface {
  readonly scan: (changes: ReadonlyArray<Change>, phase?: Phase) => Effect.Effect<GuardScanResult>
  readonly captureWorkspace: (root: string) => Effect.Effect<string | undefined>
  readonly diffWorkspace: (snapshot: string) => Effect.Effect<Change[] | undefined>
  readonly restoreWorkspace: (snapshot: string) => Effect.Effect<boolean>
  readonly releaseWorkspace: (snapshot: string) => Effect.Effect<void>
}

type WorkspaceEntry =
  | { kind: "file"; bytes: Uint8Array; mode: number }
  | { kind: "directory"; mode: number }
  | { kind: "link"; target: string }

export class Service extends Context.Service<Service, Interface>()("@opencode/Guard") {}

export const use = serviceUse(Service)

const layer = Layer.sync(Service, () => {
  const snapshots = new Map<
    string,
    { root: string; before: Map<string, WorkspaceEntry>; after?: Map<string, WorkspaceEntry> }
  >()

  return Service.of({
    scan: (changes, phase) => Effect.succeed(scan(changes, phase)),
    captureWorkspace: (root) =>
      Effect.promise(async () => {
        // ponytail: v0.1 keeps at most four unresolved snapshots in memory; fail new captures instead of evicting live cards.
        if (snapshots.size >= 4) return
        const files = await capture(root)
        if (!files) return
        const id = randomUUID()
        snapshots.set(id, { root: path.resolve(root), before: files })
        return id
      }),
    diffWorkspace: (snapshot) =>
      Effect.promise(async () => {
        const state = snapshots.get(snapshot)
        if (!state) return
        const after = await capture(state.root)
        if (!after) return
        state.after = after
        const files = Array.from(new Set([...state.before.keys(), ...after.keys()])).sort()
        const changed = files.filter((file) => !entriesEqual(state.before.get(file), after.get(file)))
        if (changed.some((file) => state.before.get(file)?.kind === "link" || after.get(file)?.kind === "link")) return
        const supported = changed.filter((file) => /\.(?:[cm]?[jt]sx?|json)$/i.test(file))
        const decoded = supported.map((file) => ({
          file,
          before: decode(entryBytes(state.before.get(file))),
          after: decode(entryBytes(after.get(file))),
        }))
        if (decoded.some((item) => item.before === undefined || item.after === undefined)) return
        return decoded.map((item) => ({
          file: path.join(state.root, item.file),
          before: item.before!,
          after: item.after!,
          diff: createTwoFilesPatch(item.file, item.file, item.before!, item.after!),
        }))
      }),
    restoreWorkspace: (snapshot) =>
      Effect.promise(async () => {
        const state = snapshots.get(snapshot)
        if (!state?.after) return false
        const current = await capture(state.root)
        if (!current || !mapsEqual(current, state.after)) return false
        const restored = await restore(state.root, state.before, current)
        if (restored) snapshots.delete(snapshot)
        return restored
      }),
    releaseWorkspace: (snapshot) => Effect.sync(() => void snapshots.delete(snapshot)),
  })
})

async function capture(root: string) {
  try {
    const files = new Map<string, WorkspaceEntry>()
    const base = path.resolve(root)
    const size = { bytes: 0, files: 0 }
    const walk = async (dir: string): Promise<void> => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        if (entry.name === ".git" || entry.name === "node_modules") continue
        const filepath = path.join(dir, entry.name)
        const before = await lstat(filepath)
        const relative = path.relative(base, filepath).replaceAll("\\", "/")
        if (before.isSymbolicLink()) {
          files.set(relative, { kind: "link", target: await readlink(filepath) })
          continue
        }
        if (before.isDirectory()) {
          files.set(relative, { kind: "directory", mode: before.mode })
          await walk(filepath)
          continue
        }
        if (!before.isFile()) continue
        size.bytes += Number(before.size)
        size.files += 1
        if (size.bytes > 128 * 1024 * 1024 || size.files > 100_000) throw new Error("workspace snapshot limit")
        const bytes = await readFile(filepath)
        const after = await lstat(filepath)
        if (!after.isFile() || before.size !== after.size || before.mtimeMs !== after.mtimeMs) throw new Error("changed")
        files.set(relative, { kind: "file", bytes, mode: before.mode })
      }
    }
    await walk(base)
    return files
  } catch {
    return
  }
}

function decode(value: Uint8Array | undefined) {
  if (!value) return ""
  try {
    if (value[0] === 0xff && value[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(value.subarray(2))
    if (value[0] === 0xfe && value[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(value.subarray(2))
    return new TextDecoder("utf-8", { fatal: true }).decode(value)
  } catch {
    return
  }
}

function bytesEqual(left: Uint8Array | undefined, right: Uint8Array | undefined) {
  if (!left || !right) return left === right
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function entryBytes(value: WorkspaceEntry | undefined) {
  return value?.kind === "file" ? value.bytes : undefined
}

function entriesEqual(
  left: WorkspaceEntry | undefined,
  right: WorkspaceEntry | undefined,
) {
  if (!left || !right || left.kind !== right.kind) return left === right
  if (left.kind === "link") return right.kind === "link" && left.target === right.target
  if (left.kind === "directory") return right.kind === "directory" && left.mode === right.mode
  return right.kind === "file" && left.mode === right.mode && bytesEqual(left.bytes, right.bytes)
}

function mapsEqual(left: Map<string, WorkspaceEntry>, right: Map<string, WorkspaceEntry>) {
  return left.size === right.size && Array.from(left).every(([file, entry]) => entriesEqual(entry, right.get(file)))
}

async function restore(
  root: string,
  before: Map<string, WorkspaceEntry>,
  current: Map<string, WorkspaceEntry>,
) {
  try {
    const changed = Array.from(new Set([...before.keys(), ...current.keys()]))
      .filter((file) => !entriesEqual(before.get(file), current.get(file)))
      .sort((left, right) => right.length - left.length)
    for (const file of changed) await rm(path.join(root, file), { recursive: true, force: true })
    for (const file of changed.sort()) {
      const entry = before.get(file)
      if (!entry) continue
      const target = path.join(root, file)
      if (entry.kind === "directory") {
        await mkdir(target, { recursive: true })
        await chmod(target, entry.mode)
        continue
      }
      await mkdir(path.dirname(target), { recursive: true })
      if (entry.kind === "link") {
        await symlink(entry.target, target)
        continue
      }
      await writeFile(target, entry.bytes)
      await chmod(target, entry.mode)
    }
    return true
  } catch {
    return false
  }
}

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as Guard from "."
