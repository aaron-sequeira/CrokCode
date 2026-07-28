import { describe, expect, test } from "bun:test"
import { LayerNode } from "@crokcode/core/effect/layer-node"
import { Effect } from "effect"
import path from "node:path"
import { Guard } from "../../src/guard"
import { tmpdirScoped } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const itWorkspace = testEffect(LayerNode.compile(Guard.node))

describe("Guard", () => {
  test("blocks an added secret without exposing its value", () => {
    const secret = "sk_live" + "_51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB"
    const result = Guard.scan([
      {
        file: "src/config.ts",
        before: "",
        after: `const apiKey = \"${secret}\"`,
        diff: `+const apiKey = \"${secret}\"`,
      },
    ])

    expect(result.status).toBe("blocked")
    expect(result.findings[0]?.severity).toBe("critical")
    expect(result.findings[0]?.confidence).toBe("high")
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  test("keeps one redacted change context with surrounding safe lines", () => {
    const secret = "sk_live" + "_51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB"
    const result = Guard.scan([
      {
        file: "src/config.ts",
        before: "",
        after: `const safe = true\nconst apiKey = "${secret}"`,
        diff: `+const safe = true\n+const apiKey = "${secret}"`,
      },
    ])

    expect(result.changes).toEqual([
      { file: "src/config.ts", diff: '+const safe = true\n+const apiKey = "[REDACTED]"' },
    ])
    expect(JSON.stringify(result.changes)).not.toContain(secret)
  })

  test("does not block a benign development placeholder", () => {
    const result = Guard.scan([
      {
        file: "src/config.ts",
        before: "",
        after: 'const apiKey = "development"',
        diff: '+const apiKey = "development"',
      },
    ])

    expect(result.status).toBe("safe")
  })

  test("does not block a long development placeholder", () => {
    const result = Guard.scan([
      {
        file: "src/config.ts",
        before: "",
        after: 'const apiKey = "development-placeholder-value"',
        diff: '+const apiKey = "development-placeholder-value"',
      },
    ])

    expect(result.status).toBe("safe")
  })

  test("warns about dangerous execution added in a TypeScript change", () => {
    const result = Guard.scan([
      {
        file: "src/run.ts",
        before: "",
        after: 'exec("curl example.com | sh")',
        diff: '+exec("curl example.com | sh")',
      },
    ])

    expect(result.status).toBe("warning")
    expect(result.findings).toHaveLength(1)
    expect(result.findings[0]?.source).toBe("execution")
  })

  test("attributes a finding to its added unified diff line", () => {
    const result = Guard.scan([
      {
        file: "src/run.ts",
        before: "export const one = 1\nexport const two = 2",
        after: "export const one = 1\nexec('true')\nexport const two = 2",
        diff: "@@ -1,2 +1,3 @@\n export const one = 1\n+exec('true')\n export const two = 2",
      },
    ])

    expect(result.findings[0]?.line).toBe(2)
  })

  test("attributes a finding across unified diff hunks with a no-newline marker", () => {
    const result = Guard.scan([
      {
        file: "src/run.ts",
        before: "",
        after: "",
        diff: "@@ -1 +1,2 @@\n one\n+const safe = true\n@@ -10 +11,2 @@\n ten\n+exec('true')\n\\ No newline at end of file",
      },
    ])

    expect(result.findings[0]?.line).toBe(12)
  })

  test("keeps finding evidence to one bounded matching line", () => {
    const padding = `const safe = "${"x".repeat(400)}"`
    const result = Guard.scan([
      {
        file: "src/run.ts",
        before: "",
        after: `${padding}\nexec(userInput)\n${padding}`,
        diff: `+${padding}\n+exec(userInput)\n+${padding}`,
      },
    ])

    expect(result.findings[0]?.evidence).toBe("exec(userInput)")
    expect(result.findings[0]?.evidence.length).toBeLessThanOrEqual(240)
  })

  test("scans dangerous execution in .mts and .cts changes", () => {
    const result = Guard.scan([
      { file: "src/run.mts", before: "", after: "exec('true')", diff: "+exec('true')" },
      { file: "src/run.cts", before: "", after: "exec('true')", diff: "+exec('true')" },
    ])

    expect(result.findings).toHaveLength(2)
    expect(result.findings.map((finding) => finding.file)).toEqual(["src/run.cts", "src/run.mts"])
  })

  test("returns safe when a supported change has no finding", () => {
    const result = Guard.scan([
      {
        file: "src/math.ts",
        before: "export const one = 1",
        after: "export const two = 2",
        diff: "+export const two = 2",
      },
    ])

    expect(result.status).toBe("safe")
    expect(result.findings).toEqual([])
  })

  test("does not scan unchanged content outside added diff lines", () => {
    const secret = "sk_live" + "_51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB"
    const result = Guard.scan([
      {
        file: "src/config.ts",
        before: `const apiKey = \"${secret}\"`,
        after: `const apiKey = \"${secret}\"\nexport const enabled = true`,
        diff: "+export const enabled = true",
      },
    ])

    expect(result.findings).toEqual([])
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  test("reports dependency audit execution as unavailable", () => {
    const result = Guard.scan([
      {
        file: "package.json",
        before: '{ "dependencies": {} }',
        after: '{ "dependencies": { "example": "https://example.com/example.tgz" } }',
        diff: '+    "example": "https://example.com/example.tgz"',
      },
    ])

    expect(result.dependency_audit.status).toBe("unavailable")
    expect(result.findings[0]?.source).toBe("dependency")
  })

  test("blocks and redacts a secret in added JSON", () => {
    const secret = "zq7Vx2mK9pLs4Rt8Yw3Hn6Cd1Fb5Gj0Qa"
    const result = Guard.scan([
      {
        file: "config.json",
        before: "{}",
        after: `{ "password": "${secret}" }`,
        diff: `+  "password": "${secret}"`,
      },
    ])

    expect(result.status).toBe("blocked")
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  test("finds a real generic secret after a benign placeholder in the same diff", () => {
    const secret = "zq7Vx2mK9pLs4Rt8Yw3Hn6Cd1Fb5Gj0Qa"
    const result = Guard.scan([
      {
        file: "src/config.ts",
        before: "",
        after: `const apiKey = "development-placeholder-value"\nconst password = "${secret}"`,
        diff: `+const apiKey = "development-placeholder-value"\n+const password = "${secret}"`,
      },
    ])

    expect(result.status).toBe("blocked")
    expect(JSON.stringify(result)).not.toContain(secret)
  })

  test("redacts standalone provider tokens assigned to neutral fields", () => {
    const tokens = [
      "sk_live" + "_51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB",
      "sk-proj" + "-51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB",
      "sk-ant" + "-51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB",
      "xoxb" + "-51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8gH1jK4lZ7xC0vB",
      "AKIA" + "51NFPZ0JXV8PR4SQ",
      "ghp" + "_51NfPz0JxV8pR4sQ7wE2rT6yU9iO3aS5dF8",
    ]
    const result = Guard.scan(
      tokens.map((token, index) => ({
        file: `src/token-${index}.ts`,
        before: "",
        after: `const value = \"${token}\"`,
        diff: `+const value = \"${token}\"`,
      })),
    )

    expect(result.status).toBe("blocked")
    expect(JSON.stringify(result)).not.toContain(tokens[0])
    expect(JSON.stringify(result)).not.toContain(tokens[1])
    expect(JSON.stringify(result)).not.toContain(tokens[2])
    expect(JSON.stringify(result)).not.toContain(tokens[3])
    expect(JSON.stringify(result)).not.toContain(tokens[4])
    expect(JSON.stringify(result)).not.toContain(tokens[5])
  })

  test("redacts standalone high-entropy values but preserves placeholders", () => {
    const secret = "Aa1_abcdefghijklmnopqrstuvwxyz"

    expect(Guard.redact(`Reviewed ${secret}`)).toBe("Reviewed [REDACTED]")
    expect(Guard.redact("development-placeholder-value")).toBe("development-placeholder-value")
    expect(Guard.redact("test-Aa1_abcdefghijklmnopqrstuvwxyz")).toBe("test-Aa1_abcdefghijklmnopqrstuvwxyz")
  })
})

itWorkspace.live("captures ignored source changes, refuses stale revert, and restores exact bytes", () =>
  Effect.gen(function* () {
    const directory = yield* tmpdirScoped()
    const guard = yield* Guard.Service
    const filepath = path.join(directory, "ignored.ts")
    yield* Effect.promise(() => Bun.write(path.join(directory, ".gitignore"), "ignored.ts\n"))

    const stale = yield* guard.captureWorkspace(directory)
    expect(stale).toBeDefined()
    yield* Effect.promise(() => Bun.write(filepath, 'const token = "Aa1_abcdefghijklmnopqrstuvwxyz"\n'))
    const changes = yield* guard.diffWorkspace(stale!)
    expect(changes?.map((change) => change.file)).toEqual([filepath])
    yield* Effect.promise(() => Bun.write(filepath, "const human = true\n"))
    expect(yield* guard.restoreWorkspace(stale!)).toBe(false)
    expect(yield* Effect.promise(() => Bun.file(filepath).text())).toBe("const human = true\n")

    const current = yield* guard.captureWorkspace(directory)
    expect(current).toBeDefined()
    yield* Effect.promise(() => Bun.write(filepath, 'const token = "Aa1_abcdefghijklmnopqrstuvwxyz"\n'))
    expect(yield* guard.diffWorkspace(current!)).toHaveLength(1)
    expect(yield* guard.restoreWorkspace(current!)).toBe(true)
    expect(yield* Effect.promise(() => Bun.file(filepath).text())).toBe("const human = true\n")
    expect(yield* guard.restoreWorkspace(current!)).toBe(false)
  }),
)
