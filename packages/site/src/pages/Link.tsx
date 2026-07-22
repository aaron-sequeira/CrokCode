import { useEffect, useState } from "react"
import { Link as RouterLink } from "react-router-dom"
import { SUPABASE_URL, supabase } from "../lib/api"
import { Croc } from "../components/Croc"

// The page `crokcode login` opens in the browser. The user signs in (Google or
// email) and approves the pairing code shown in their terminal; the CLI then
// receives its API key by polling cli-auth.
export function Link() {
  const code = (new URLSearchParams(window.location.search).get("code") ?? "").toUpperCase()
  const [phase, setPhase] = useState<"checking" | "ready" | "approving" | "done" | "error">("checking")
  const [error, setError] = useState("")
  const [email, setEmail] = useState<string | undefined>()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        // Sign in first, then return to this exact pairing page.
        window.location.href = `/login?next=${encodeURIComponent(`/link?code=${code}`)}`
        return
      }
      setEmail(data.session.user.email ?? undefined)
      setPhase("ready")
    })
  }, [code])

  const approve = async () => {
    setPhase("approving")
    setError("")
    const { data } = await supabase.auth.getSession()
    const token = data.session?.access_token
    const response = await fetch(`${SUPABASE_URL}/functions/v1/cli-auth`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "approve", user_code: code }),
    })
    const body = await response.json().catch(() => ({}))
    if (!response.ok) {
      setError(body?.error ?? "Could not link the CLI.")
      setPhase("error")
      return
    }
    setPhase("done")
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
          <Croc px={6} />
        </div>

        <div className="panel">
          <h2 style={{ fontSize: 22, marginBottom: 6 }}>Connect the CrokCode CLI</h2>

          {!code && <p className="note note-error">No pairing code in the link. Run `crokcode login` again.</p>}

          {code && phase !== "done" && (
            <>
              <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 18 }}>
                {email ? (
                  <>
                    Signed in as <b style={{ color: "var(--bone)" }}>{email}</b>. Confirm this is the code shown in
                    your terminal, then approve.
                  </>
                ) : (
                  "Checking your session…"
                )}
              </p>

              <div className="reveal" style={{ textAlign: "center", fontSize: 22, letterSpacing: "0.3em" }}>
                {code}
              </div>

              <button
                className="btn btn-primary"
                style={{ width: "100%", marginTop: 8 }}
                disabled={phase !== "ready"}
                onClick={approve}
              >
                {phase === "approving" ? "Linking…" : "Approve and connect"}
              </button>

              {error && <p className="note note-error">{error}</p>}
            </>
          )}

          {phase === "done" && (
            <>
              <p className="note note-ok" style={{ fontSize: 15, marginTop: 4 }}>
                ✓ Connected. Return to your terminal — the CLI is ready to use.
              </p>
              <p style={{ color: "var(--muted)", fontSize: 14, marginTop: 14 }}>
                You can close this tab. Manage keys and usage in the{" "}
                <RouterLink to="/app" style={{ color: "var(--croc)" }}>
                  console
                </RouterLink>
                .
              </p>
            </>
          )}
        </div>

        <p className="note" style={{ textAlign: "center" }}>
          <RouterLink to="/">← Back to crokcode.tech</RouterLink>
        </p>
      </div>
    </div>
  )
}
