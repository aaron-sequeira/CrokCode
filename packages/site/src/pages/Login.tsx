import { useState } from "react"
import { Link } from "react-router-dom"
import { supabase } from "../lib/api"
import { Croc } from "../components/Croc"

export function Login() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState("")

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setBusy(true)
    setError("")
    setSent("")

    const result =
      mode === "signup"
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })

    setBusy(false)
    if (result.error) return setError(result.error.message)
    // A project with email confirmation on returns a user but no session.
    if (mode === "signup" && !result.data.session) {
      setSent("Check your inbox to confirm the address, then sign in.")
    }
  }

  return (
    <div className="auth">
      <div className="auth-card">
        <div style={{ display: "flex", justifyContent: "center", marginBottom: 30 }}>
          <Croc px={6} />
        </div>

        <div className="panel">
          <h2 style={{ fontSize: 22, marginBottom: 6 }}>
            {mode === "signup" ? "Create your account" : "Sign in"}
          </h2>
          <p style={{ color: "var(--muted)", fontSize: 14, marginBottom: 22 }}>
            {mode === "signup"
              ? "You will get an API key and a credit balance straight away."
              : "Manage your plan, API keys and usage."}
          </p>

          <form onSubmit={submit}>
            <label className="field">
              <span>Email</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Password</span>
              <input
                type="password"
                required
                minLength={8}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>

            <button className="btn btn-primary" style={{ width: "100%" }} disabled={busy}>
              {busy ? "Working…" : mode === "signup" ? "Create account" : "Sign in"}
            </button>
          </form>

          {error && <p className="note note-error">{error}</p>}
          {sent && <p className="note note-ok">{sent}</p>}

          <p className="note">
            {mode === "signup" ? "Already have an account? " : "No account yet? "}
            <button
              onClick={() => {
                setMode(mode === "signup" ? "signin" : "signup")
                setError("")
                setSent("")
              }}
              style={{
                background: "none",
                border: "none",
                color: "var(--croc)",
                cursor: "pointer",
                font: "inherit",
                padding: 0,
              }}
            >
              {mode === "signup" ? "Sign in" : "Create one"}
            </button>
          </p>
        </div>

        <p className="note" style={{ textAlign: "center" }}>
          <Link to="/">← Back to crokcode.tech</Link>
        </p>
      </div>
    </div>
  )
}
