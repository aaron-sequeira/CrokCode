import { useEffect, useState } from "react"
import { Link, useNavigate } from "react-router-dom"
import { supabase } from "../lib/api"
import { Croc } from "../components/Croc"

export function Login() {
  const navigate = useNavigate()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState<"signin" | "signup">("signin")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [sent, setSent] = useState("")

  // Where to go after signing in. `crokcode login` sends users here as
  // /login?next=/link?code=XXXX so they land back on the pairing page.
  const next = new URLSearchParams(window.location.search).get("next")

  // If already signed in, don't show the form: continue to the pairing page
  // (when linking the CLI) or the console.
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) navigate(next || "/app", { replace: true })
    })
  }, [navigate, next])

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
    if (result.data.session) {
      navigate(next || "/app")
      return
    }
    // Email confirmation on: user exists but no session yet.
    if (mode === "signup") setSent("Check your inbox to confirm the address, then sign in.")
  }

  // Google OAuth. Supabase redirects back with the session in the URL hash;
  // the client picks it up automatically.
  const google = async () => {
    setError("")
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}${next || "/app"}` },
    })
    if (error) setError(error.message)
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
            {next
              ? "Sign in to connect the CrokCode CLI."
              : mode === "signup"
                ? "You will get an API key and a credit balance straight away."
                : "Manage your plan, API keys and usage."}
          </p>

          <button type="button" className="btn btn-google" onClick={google}>
            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1Z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84A11 11 0 0 0 12 23Z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.1a6.6 6.6 0 0 1 0-4.2V7.06H2.18a11 11 0 0 0 0 9.88l3.66-2.84Z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84C6.71 7.3 9.14 5.38 12 5.38Z"
              />
            </svg>
            Continue with Google
          </button>

          <div className="or-divider">
            <span>or</span>
          </div>

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
