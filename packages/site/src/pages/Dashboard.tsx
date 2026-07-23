import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import type { User } from "@supabase/supabase-js"
import { api, GATEWAY_URL, loadAccount, money, supabase, type Account, type ApiKey } from "../lib/api"

const PLAN_LABEL: Record<string, string> = {
  crokgo: "CrokGo",
  crokpro: "CrokPro",
  crok_as_you_go: "Crok-as-you-go",
}

type TabId = "overview" | "crokgo" | "crokpro" | "payg" | "keys" | "usage"
const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "crokgo", label: "CrokGo" },
  { id: "crokpro", label: "CrokPro" },
  { id: "payg", label: "Crok-as-you-go" },
  { id: "keys", label: "API keys / CLI" },
  { id: "usage", label: "Recent usage" },
]

// A copy-pasteable provider block for ~/.config/crokcode/opencode.jsonc.
function ConnectSnippet({ providerId, name, apiKey }: { providerId: string; name: string; apiKey: string }) {
  return (
    <pre
      style={{
        background: "var(--ink)",
        border: "1px solid var(--line)",
        borderRadius: 4,
        padding: 16,
        overflowX: "auto",
        fontFamily: "var(--mono)",
        fontSize: 12.5,
        lineHeight: 1.7,
        color: "var(--muted)",
        margin: 0,
      }}
    >{`{
  "provider": {
    "${providerId}": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "${name}",
      "options": {
        "baseURL": "${GATEWAY_URL}",
        "apiKey": "${apiKey}"
      },
      "models": { "z-ai/glm-5.2": { "name": "GLM 5.2" } }
    }
  }
}`}</pre>
  )
}

export function Dashboard({ user }: { user: User }) {
  const [tab, setTab] = useState<TabId>("overview")
  const [account, setAccount] = useState<Account | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [fresh, setFresh] = useState("")
  const [paygKey, setPaygKey] = useState("")
  const [amount, setAmount] = useState("10")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")

  const refresh = useCallback(async () => {
    try {
      const [next, keyList] = await Promise.all([loadAccount(user.id), api.listKeys()])
      setAccount(next)
      setKeys(keyList)
    } catch (cause) {
      setError((cause as Error).message)
    }
  }, [user.id])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const guard = async (label: string, run: () => Promise<void>) => {
    setBusy(label)
    setError("")
    try {
      await run()
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy("")
    }
  }

  const createKey = () =>
    guard("key", async () => {
      setFresh(await api.createKey("crokcode cli"))
      setKeys(await api.listKeys())
    })

  const createPaygKey = () =>
    guard("paygkey", async () => {
      setPaygKey(await api.createKey("crok-as-you-go"))
      setKeys(await api.listKeys())
    })

  const revoke = (id: string) =>
    guard(id, async () => {
      await api.revokeKey(id)
      setKeys(await api.listKeys())
    })

  const subscribe = (plan: string) =>
    guard(plan, async () => {
      const result = await api.checkout(plan)
      if (result.url) {
        location.href = result.url // new subscription — go to Stripe Checkout
      } else if (result.updated) {
        await refresh() // existing subscription changed in place (prorated)
      }
    })

  const buyCredits = () =>
    guard("payg", async () => {
      const cents = Math.round(parseFloat(amount) * 100)
      if (!Number.isFinite(cents) || cents < 500 || cents > 50000) {
        setError("Enter an amount between $5 and $500.")
        return
      }
      const result = await api.checkout("crok-as-you-go", cents)
      if (result.url) location.href = result.url
    })

  const planName = account?.plan ? (PLAN_LABEL[account.plan] ?? account.plan) : null
  const isPayg = account?.dailyLimitCents == null

  return (
    <>
      <header className="nav">
        <div className="wrap nav-inner">
          <Link to="/" className="brand">
            crok<em>code</em>
          </Link>
          <div className="nav-links">
            <span>{user.email}</span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => supabase.auth.signOut()}>
            Sign out
          </button>
        </div>
      </header>

      <main className="wrap" style={{ padding: "48px 24px 90px" }}>
        <div className="app-head">
          <h2>Console</h2>
          <button className="btn btn-ghost btn-sm" style={{ marginLeft: "auto" }} onClick={refresh}>
            Refresh
          </button>
        </div>

        <div className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={`tab${tab === t.id ? " tab-active" : ""}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {error && <p className="note note-error" style={{ marginBottom: 20 }}>{error}</p>}

        {/* ---- Overview ---- */}
        {tab === "overview" && (
          <>
            <div className="app-grid">
              <div className="panel metric">
                <span>Plan</span>
                <b style={{ color: planName ? "var(--croc)" : "var(--muted)" }}>{planName ?? "None"}</b>
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
                  {account?.status ? `Status: ${account.status}` : "Subscribe or top up to start using CrokAPI."}
                </p>
              </div>
              {!isPayg ? (
                <div className="panel metric">
                  <span>Usage limits</span>
                  <b>
                    {money(account?.dailyUsedCents ?? 0)}{" "}
                    <span style={{ color: "var(--muted)", fontWeight: 400 }}>
                      / {money(account?.dailyLimitCents ?? 0)} today
                    </span>
                  </b>
                  <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
                    {money(account?.weeklyUsedCents ?? 0)} / {money(account?.weeklyLimitCents ?? 0)} this week.
                  </p>
                </div>
              ) : (
                <div className="panel metric">
                  <span>Credit balance</span>
                  <b>{money(account?.balanceCents ?? 0)}</b>
                  <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
                    Pay-as-you-go — drawn down by usage.
                  </p>
                </div>
              )}
              <div className="panel metric">
                <span>Recent spend</span>
                <b>{money(Math.round(account?.spentCents ?? 0))}</b>
                <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Across the last 25 requests.</p>
              </div>
            </div>
            <div className="panel">
              <h3 style={{ marginBottom: 6 }}>Getting started</h3>
              <p style={{ color: "var(--muted)", fontSize: 14 }}>
                Pick a plan tab to subscribe, or open <b style={{ color: "var(--bone)" }}>Crok-as-you-go</b> to buy
                credits. Then connect the CLI from <b style={{ color: "var(--bone)" }}>API keys / CLI</b> — or just run{" "}
                <code style={{ fontFamily: "var(--mono)" }}>crokcode login</code>.
              </p>
            </div>
          </>
        )}

        {/* ---- CrokGo ---- */}
        {tab === "crokgo" && (
          <div className="panel">
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h3>CrokGo</h3>
              <b style={{ color: "var(--croc)" }}>$5 first month, then $10/mo</b>
              {account?.plan === "crokgo" && <span className="note note-ok" style={{ margin: 0 }}>Current plan</span>}
            </div>
            <p style={{ color: "var(--muted)", fontSize: 14, margin: "10px 0 18px" }}>
              The efficient models — GLM 5.2, DeepSeek V4, Kimi K3 — with daily and weekly usage limits
              (<b style={{ color: "var(--bone)" }}>$0.50/day · $1.50/week</b>). Guard runs on every edit.
            </p>
            <button className="btn btn-primary" disabled={!!busy || account?.plan === "crokgo"} onClick={() => subscribe("crokgo")}>
              {busy === "crokgo" ? "Opening…" : account?.plan === "crokgo" ? "Subscribed" : "Subscribe to CrokGo"}
            </button>
          </div>
        )}

        {/* ---- CrokPro ---- */}
        {tab === "crokpro" && (
          <div className="panel">
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
              <h3>CrokPro</h3>
              <b style={{ color: "var(--croc)" }}>$20/mo</b>
              {account?.plan === "crokpro" && <span className="note note-ok" style={{ margin: 0 }}>Current plan</span>}
            </div>
            <p style={{ color: "var(--muted)", fontSize: 14, margin: "10px 0 18px" }}>
              Every CrokAPI model, including the frontier ones (Claude Opus 4.8, GPT-5.6 Sol, Grok 5, Gemini 3.5 Pro).
              Higher daily and weekly limits (<b style={{ color: "var(--bone)" }}>$2/day · $3.50/week</b>).
            </p>
            <button className="btn btn-primary" disabled={!!busy || account?.plan === "crokpro"} onClick={() => subscribe("crokpro")}>
              {busy === "crokpro" ? "Opening…" : account?.plan === "crokpro" ? "Subscribed" : "Subscribe to CrokPro"}
            </button>
          </div>
        )}

        {/* ---- Crok-as-you-go ---- */}
        {tab === "payg" && (
          <>
            <div className="panel" style={{ marginBottom: 16 }}>
              <h3 style={{ marginBottom: 6 }}>Buy credits</h3>
              <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>
                No subscription, no caps — pay per token from a balance. Credits never expire. Enter any amount from $5
                to $500.
              </p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <div className="amount-field">
                  <span>$</span>
                  <input
                    type="number"
                    min={5}
                    max={500}
                    step={1}
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                  />
                </div>
                <button className="btn btn-primary" disabled={!!busy} onClick={buyCredits}>
                  {busy === "payg" ? "Opening…" : `Buy ${money(Math.round((parseFloat(amount) || 0) * 100))} credits`}
                </button>
              </div>
            </div>

            <div className="panel">
              <h3 style={{ marginBottom: 6 }}>Use it via the API</h3>
              <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>
                Crok-as-you-go runs through the CrokAPI gateway with an API key. Create one, then add this{" "}
                <code style={{ fontFamily: "var(--mono)" }}>crok-as-you-go</code> provider to{" "}
                <code style={{ fontFamily: "var(--mono)" }}>~/.config/crokcode/opencode.jsonc</code>.
              </p>
              <button className="btn btn-primary btn-sm" style={{ marginBottom: 16 }} disabled={!!busy} onClick={createPaygKey}>
                {busy === "paygkey" ? "Creating…" : "Create a Crok-as-you-go key"}
              </button>
              {paygKey && (
                <p className="note note-ok" style={{ marginTop: 0, marginBottom: 12 }}>
                  Copy the key below now — you will not see it again.
                </p>
              )}
              <ConnectSnippet providerId="crok-as-you-go" name="Crok-as-you-go" apiKey={paygKey || "crok_..."} />
            </div>
          </>
        )}

        {/* ---- API keys / Connect CLI ---- */}
        {tab === "keys" && (
          <>
            <div className="panel" style={{ marginBottom: 16 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
                <h3>API keys</h3>
                <button className="btn btn-primary btn-sm" style={{ marginLeft: "auto" }} disabled={!!busy} onClick={createKey}>
                  {busy === "key" ? "Creating…" : "Create key"}
                </button>
              </div>
              <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>
                Only the hash is stored, so a key is shown once and cannot be recovered.
              </p>

              {fresh && (
                <>
                  <div className="reveal">{fresh}</div>
                  <p className="note note-ok" style={{ marginTop: 0 }}>
                    Copy this now. You will not see it again.
                  </p>
                </>
              )}

              {keys.length === 0 ? (
                <p className="empty">No keys yet. Create one to connect the CLI.</p>
              ) : (
                keys.map((key) => (
                  <div className="keyrow" key={key.id}>
                    <b>{key.key_prefix}…</b>
                    <em>{key.name}</em>
                    <em>{key.last_used_at ? `used ${new Date(key.last_used_at).toLocaleDateString()}` : "never used"}</em>
                    <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => revoke(key.id)}>
                      {busy === key.id ? "Revoking…" : "Revoke"}
                    </button>
                  </div>
                ))
              )}
            </div>

            <div className="panel">
              <h3 style={{ marginBottom: 6 }}>Connect the CLI</h3>
              <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>
                Easiest: run <code style={{ fontFamily: "var(--mono)" }}>crokcode login</code>. Or paste a key into your
                config manually:
              </p>
              <ConnectSnippet providerId="crokapi" name="CrokAPI" apiKey={fresh || "crok_..."} />
            </div>
          </>
        )}

        {/* ---- Recent usage ---- */}
        {tab === "usage" && (
          <div className="panel">
            <h3 style={{ marginBottom: 18 }}>Recent usage</h3>
            {!account?.usage.length ? (
              <p className="empty">Nothing yet. Usage appears here as soon as the CLI makes a request.</p>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Model</th>
                    <th>In</th>
                    <th>Out</th>
                    <th>Cost</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {account.usage.map((row, index) => (
                    <tr key={index}>
                      <td>{row.model}</td>
                      <td>{row.input_tokens.toLocaleString()}</td>
                      <td>{row.output_tokens.toLocaleString()}</td>
                      <td>{money(Number(row.cost_cents))}</td>
                      <td>{new Date(row.created_at).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </>
  )
}
