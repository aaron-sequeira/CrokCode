import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import type { User } from "@supabase/supabase-js"
import { api, GATEWAY_URL, loadAccount, money, supabase, type Account, type ApiKey } from "../lib/api"

const PLAN_LABEL: Record<string, string> = {
  crokgo: "CrokGo",
  crokpro: "CrokPro",
  crok_as_you_go: "Crok-as-you-go",
}

export function Dashboard({ user }: { user: User }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [fresh, setFresh] = useState("")
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

  const revoke = (id: string) =>
    guard(id, async () => {
      await api.revokeKey(id)
      setKeys(await api.listKeys())
    })

  const subscribe = (plan: string) =>
    guard(plan, async () => {
      location.href = await api.checkout(plan)
    })

  const planName = account?.plan ? (PLAN_LABEL[account.plan] ?? account.plan) : null

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

        {error && <p className="note note-error" style={{ marginBottom: 20 }}>{error}</p>}

        {/* metrics */}
        <div className="app-grid">
          <div className="panel metric">
            <span>Plan</span>
            <b style={{ color: planName ? "var(--croc)" : "var(--muted)" }}>{planName ?? "None"}</b>
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
              {account?.status ? `Status: ${account.status}` : "Subscribe or top up to start using CrokAPI."}
            </p>
          </div>
          <div className="panel metric">
            <span>Credit balance</span>
            <b>{money(account?.balanceCents ?? 0)}</b>
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>
              Drawn down by pay-as-you-go usage.
            </p>
          </div>
          <div className="panel metric">
            <span>Recent spend</span>
            <b>{money(Math.round(account?.spentCents ?? 0))}</b>
            <p style={{ color: "var(--muted)", fontSize: 13, marginTop: 8 }}>Across the last 25 requests.</p>
          </div>
        </div>

        {/* billing */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 6 }}>Billing</h3>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 20 }}>
            Subscriptions are not metered against credits. Top-ups never expire.
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => subscribe("crokpro")}>
              {busy === "crokpro" ? "Opening…" : "CrokPro — $20/mo"}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => subscribe("crokgo")}>
              {busy === "crokgo" ? "Opening…" : "CrokGo — $5/mo"}
            </button>
            <button className="btn btn-ghost" disabled={!!busy} onClick={() => subscribe("crok-as-you-go")}>
              {busy === "crok-as-you-go" ? "Opening…" : "Top up credits"}
            </button>
          </div>
        </div>

        {/* keys */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 6, flexWrap: "wrap" }}>
            <h3>API keys</h3>
            <button
              className="btn btn-primary btn-sm"
              style={{ marginLeft: "auto" }}
              disabled={!!busy}
              onClick={createKey}
            >
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
                <em>
                  {key.last_used_at ? `used ${new Date(key.last_used_at).toLocaleDateString()}` : "never used"}
                </em>
                <button className="btn btn-danger btn-sm" disabled={!!busy} onClick={() => revoke(key.id)}>
                  {busy === key.id ? "Revoking…" : "Revoke"}
                </button>
              </div>
            ))
          )}
        </div>

        {/* connect */}
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginBottom: 6 }}>Connect the CLI</h3>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 16 }}>
            Add this to <code style={{ fontFamily: "var(--mono)" }}>~/.config/crokcode/opencode.jsonc</code>, then
            pick a model with <code style={{ fontFamily: "var(--mono)" }}>crokapi/&lt;vendor&gt;/&lt;model&gt;</code>.
          </p>
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
    "crokapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CrokAPI",
      "options": {
        "baseURL": "${GATEWAY_URL}",
        "apiKey": "crok_..."
      },
      "models": { "z-ai/glm-5.2": { "name": "GLM 5.2" } }
    }
  }
}`}</pre>
        </div>

        {/* usage */}
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
      </main>
    </>
  )
}
