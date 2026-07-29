import { useState } from "react"
import { Link } from "react-router-dom"
import { Croc } from "../components/Croc"

const INSTALL = {
  macOS: "curl -fsSL https://www.crokcode.tech/install.sh | bash",
  Windows: "irm https://www.crokcode.tech/install.ps1 | iex",
  Build: "bun install && bun run script/build.ts --single",
}

const FEATURES = [
  {
    mark: "GUARD",
    title: "Security review on every edit",
    body: "A deterministic scanner runs on the diff before it is written. Secrets hard-block the write. Weaker findings warn and let you keep moving.",
  },
  {
    mark: "MODELS",
    title: "Any provider, or ours",
    body: "Bring your own Anthropic, OpenAI, Google or local keys, or route everything through CrokAPI on a single plan. 160+ providers carried over from upstream.",
  },
  {
    mark: "TUI",
    title: "Built for the terminal",
    body: "A fast, keyboard-first interface with themes, mouse support and a Guard card that appears inline with the change that triggered it.",
  },
  {
    mark: "LSP",
    title: "Real language intelligence",
    body: "Language servers load automatically, so the agent sees the same diagnostics, types and references your editor does.",
  },
  {
    mark: "AGENTS",
    title: "Parallel sessions",
    body: "Run several agents at once against the same project, each in its own session, and share any session as a link.",
  },
  {
    mark: "OPEN",
    title: "MIT licensed",
    body: "The whole client is open source and forkable. Guard's rules are readable code, not a black box you have to trust.",
  },
]

const RULES = [
  ["secret.literal", "critical", "API keys, tokens and private keys in added code"],
  ["injection.dynamic-code", "warning", "eval and new Function on untrusted input"],
  ["execution.process", "warning", "exec, execSync, spawn and spawnSync"],
  ["rendering.unsafe-html", "warning", "innerHTML and dangerouslySetInnerHTML"],
  ["transport.disabled-verification", "warning", "TLS verification or auth switched off"],
  ["dependency.unreviewed-source", "warning", "Dependencies pulled from git, file or http"],
]

const PENTEST = [
  {
    mark: "YOU DECLARE IT",
    title: "It only touches what you name",
    body: "The agent never picks a target. You give it a URL, it asks you to authorize that exact origin, and anything else is refused for the rest of the session.",
  },
  {
    mark: "DRY RUN FIRST",
    title: "See the probes before they fire",
    body: "The first output is the plan — every request it intends to send, in order. Nothing leaves your machine until you say go.",
  },
  {
    mark: "REAL TRAFFIC",
    title: "Not a linter with opinions",
    body: "Crafted requests hit your running app and the agent reads the actual responses. That is how it finds an IDOR that only exists once the session cookie is real.",
  },
  {
    mark: "YOUR TOOLS",
    title: "Drives nuclei and sqlmap",
    body: "If they are already on your PATH it uses them and reasons over the output. It never installs a scanner behind your back.",
  },
]

const LOCAL = [
  {
    mark: "OLLAMA",
    title: "Detected, not configured",
    body: "If Ollama is running, every model you have pulled shows up in the model picker under its own provider. No config file, no base URL to paste.",
  },
  {
    mark: "OFFLINE",
    title: "No key, no account, no bill",
    body: "Point CrokCode at a local model and nothing leaves the machine — not the prompt, not the diff, not a telemetry ping.",
  },
  {
    mark: "SAME AGENT",
    title: "All the tools still work",
    body: "Local models get the same edit, shell, LSP and search tools as the frontier ones, and Guard scans their diffs exactly the same way.",
  },
]

const VOICE = [
  {
    mark: "HOLD OR TAP",
    title: "Push-to-talk that knows the difference",
    body: "Hold the key and talk, release and it transcribes. Tap it instead and recording latches on until you tap again. Rebindable like every other key.",
  },
  {
    mark: "ON DEVICE",
    title: "whisper.cpp, locally",
    body: "The model runs on your machine. Your voice is never uploaded, to us or to anyone — there is no transcription API in the loop.",
  },
  {
    mark: "AT THE CURSOR",
    title: "Straight into the prompt",
    body: "The transcript lands where your cursor is, so you can talk the paragraph and type the file path. Nothing is sent until you hit enter.",
  },
]

const MODELS = [
  ["GPT-5.6 Sol", "openai/gpt-5.6-sol"],
  ["Claude Opus 4.8", "anthropic/claude-opus-4.8"],
  ["Fable 5", "anthropic/claude-fable-5"],
  ["Claude Sonnet 5", "anthropic/claude-sonnet-5"],
  ["Kimi K3", "moonshotai/kimi-k3"],
  ["Grok 4.5", "x-ai/grok-4.5"],
  ["Gemini 3.1 Pro", "google/gemini-3.1-pro-preview"],
  ["GLM 5.2", "z-ai/glm-5.2"],
  ["DeepSeek V4 Pro", "deepseek/deepseek-v4-pro"],
  ["MiniMax M3", "minimax/minimax-m3"],
  ["Qwen3.7 Plus", "qwen/qwen3.7-plus"],
  ["MiMo V2.5", "xiaomi/mimo-v2.5"],
]

const PLANS = [
  {
    id: "crokgo",
    name: "CrokGo",
    price: "$5",
    per: " first month",
    for: "Then $10/mo. 9 efficient models (GLM, DeepSeek, Qwen, MiniMax, MiMo) with daily + weekly usage limits.",
    features: ["9 efficient coding models", "Guard on every edit", "$0.50/day · $1.50/week", "Community support"],
  },
  {
    id: "crokpro",
    name: "CrokPro",
    price: "$20",
    per: "/month",
    for: "For people who reach for the frontier models all day.",
    features: [
      "All 21 models (Opus, GPT, Grok, Gemini…)",
      "Higher daily & weekly limits",
      "Priority routing on frontier models",
      "Usage analytics",
    ],
    featured: true,
  },
  {
    id: "crok-as-you-go",
    name: "Crok-as-you-go",
    price: "Top up",
    per: " any amount",
    for: "No caps. Pay per token — the tier for heavy, all-day agentic work.",
    features: ["Every model, no daily/weekly caps", "Pay only for tokens used", "Credits never expire", "Top up from $5"],
  },
]

const FAQ = [
  [
    "What makes CrokCode different from other coding agents?",
    "Guard. Other agents will happily paste a live API key into your source and let you find out in review, or after a leak. CrokCode scans the diff before the write lands, and a critical finding stops the write entirely.",
  ],
  [
    "Do I have to use CrokAPI?",
    "No. CrokCode is a fork of opencode and keeps every provider it supports, so your own Anthropic, OpenAI, Google, OpenRouter or local model keys work as they always did. CrokAPI is there if you would rather pay one bill and skip key management.",
  ],
  [
    "What does Guard actually check?",
    "Added lines only, on JavaScript, TypeScript and JSON. It looks for hard-coded credentials, dynamic code execution, process spawning, unsafe HTML rendering, disabled TLS or auth, and dependencies pulled from unreviewed sources. Detected secrets are redacted everywhere, including in what gets sent to the model.",
  ],
  [
    "Can Guard block something I actually meant to write?",
    "Yes, and it tells you exactly which rule fired and where. Warnings never block. Only critical, high-confidence findings stop a write, and you can revert or accept from the same card.",
  ],
  [
    "Does CrokCode send my code anywhere?",
    "Only to the model provider you pick, the same as any coding agent. Guard itself runs locally and deterministically, with no model call and no telemetry on your source.",
  ],
  [
    "Is the pentest tool safe to point at my app?",
    "It is only ever pointed where you point it. The agent cannot choose a target: you supply the URL, CrokCode asks you to authorize that exact origin, and every request to anything else is refused for the rest of the session. The first run is a dry run that lists the probes without sending them, and there is a hard cap on request volume so it cannot hammer your staging box. Use it on systems you own or are authorized to test.",
  ],
  [
    "Does dictation send my voice to a server?",
    "No. Recording and transcription both happen on your machine — whisper.cpp runs locally and the model is downloaded once on first use. There is no transcription API involved, so there is nothing to leak and nothing to opt out of.",
  ],
  [
    "Can I use local models instead of a provider?",
    "Yes. Run Ollama and your pulled models appear in the picker automatically, grouped under their own provider, with no key and no account. They get the same tools and the same Guard scanning as any hosted model.",
  ],
  [
    "Which platforms are supported?",
    "macOS, Linux, Windows and WSL, on x64 and arm64.",
  ],
  [
    "How do the plan limits and pay-as-you-go work?",
    "CrokGo and CrokPro give you a daily and weekly usage budget — spend up to that and it resets each day and each Monday. Great for the efficient models and everyday work. If you need uncapped, all-day heavy use on the frontier models, Crok-as-you-go bills only for the tokens you use, drawn from a balance you top up from $5.",
  ],
  [
    "Is it really open source?",
    "Yes, MIT. Fork it, read the Guard rules, disagree with them, change them.",
  ],
]

export function Landing() {
  const [os, setOs] = useState<keyof typeof INSTALL>("macOS")
  const [copied, setCopied] = useState(false)

  const copy = async () => {
    await navigator.clipboard.writeText(INSTALL[os])
    setCopied(true)
    setTimeout(() => setCopied(false), 1600)
  }

  return (
    <>
      <header className="nav">
        <div className="wrap nav-inner">
          <Link to="/" className="brand">
            crok<em>code</em>
          </Link>
          <nav className="nav-links">
            <a href="#guard">Guard</a>
            <a href="#pentest">Pentest</a>
            <a href="#features">Features</a>
            <a href="#models">Models</a>
            <a href="#voice">Voice</a>
            <a href="#pricing">Pricing</a>
            <a href="#faq">FAQ</a>
          </nav>
          <Link to="/app" className="btn btn-ghost btn-sm">
            Console
          </Link>
        </div>
      </header>

      <main>
        {/* hero */}
        <section className="wrap hero">
          <div>
            <h1>
              The AI coding agent
              <br />
              that <em>guards your code</em>
            </h1>
            <p className="lede">
              CrokCode writes code with any model you like, then refuses to write a secret to disk. Open source,
              terminal-first, and built on opencode.
            </p>

            <div className="os-tabs">
              {(Object.keys(INSTALL) as (keyof typeof INSTALL)[]).map((key) => (
                <button key={key} data-on={os === key} onClick={() => setOs(key)}>
                  {key === "Build" ? "From source" : key}
                </button>
              ))}
            </div>

            <div className="cmd">
              <span className="cmd-prompt">$</span>
              <code>{INSTALL[os]}</code>
              <button onClick={copy}>{copied ? "copied" : "copy"}</button>
            </div>

            <div className="hero-actions">
              <Link to="/app" className="btn btn-primary">
                Get an API key
              </Link>
              <a href="#guard" className="btn btn-ghost">
                See Guard work
              </a>
            </div>
            <p className="hero-note">MIT licensed · macOS, Linux, Windows, WSL</p>
          </div>
          <Croc />
        </section>

        {/* guard */}
        <section id="guard" className="band">
          <div className="wrap">
            <div className="section-head">
              <div className="eyebrow">Guard</div>
              <h2>It stops the write, not the review</h2>
              <p className="lede">
                Guard scans the diff after the agent proposes it and before anything touches your filesystem. A
                critical, high-confidence finding raises a typed error, pauses the session and guarantees the change
                never lands.
              </p>
            </div>

            <div className="term">
              <div className="term-bar">
                <span style={{ color: "var(--croc)" }}>●</span> crokcode — auth-fix
              </div>
              <div className="term-body">
                <div className="term-dim">◆ Updated src/auth/session.ts</div>
                <div>
                  <span className="term-add">+ const apiKey = "sk_live_[REDACTED]"</span>
                </div>

                <div className="finding">
                  <div className="finding-head">
                    ▣ Guard · Critical <span>CROK-001 · secret.literal</span>
                  </div>
                  <div style={{ marginTop: 8 }}>Private API key in added code</div>
                  <div className="term-dim" style={{ fontSize: 12 }}>
                    src/auth/session.ts:42 · high confidence
                  </div>
                  <div className="finding-keys">
                    <span className="key key-on">F Fix</span>
                    <span className="key">E Explain</span>
                    <span className="key">R Revert</span>
                  </div>
                </div>

                <div className="term-dim">Edit blocked before file write. Nothing was written to disk.</div>
              </div>
            </div>

            <div className="grid grid-2" style={{ marginTop: 28 }}>
              {RULES.map(([id, severity, body]) => (
                <div className="cell" key={id}>
                  <span className="cell-mark" style={{ color: severity === "critical" ? "var(--danger)" : "var(--amber)" }}>
                    {severity}
                  </span>
                  <h3 style={{ fontFamily: "var(--mono)", fontSize: 14 }}>{id}</h3>
                  <p>{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* pentest */}
        <section id="pentest" className="band">
          <div className="wrap">
            <div className="section-head">
              <div className="eyebrow">Pentest</div>
              <h2>It attacks your app, on purpose</h2>
              <p className="lede">
                Guard reads the diff. Pentest goes further — you point it at your own running app and it sends real
                attack traffic, then reports what actually got through. Every other agent guesses from source. This one
                knocks.
              </p>
            </div>

            <div className="term">
              <div className="term-bar">
                <span style={{ color: "var(--croc)" }}>●</span> crokcode — pentest
              </div>
              <div className="term-body">
                <div className="term-dim">◆ pentest http://localhost:3000 — dry run</div>
                <div className="term-dim">18 probes planned · idor, authz, injection, headers</div>
                <div>
                  <span className="term-add">▣ Authorize http://localhost:3000 for this session?</span>
                </div>
                <div className="finding-keys">
                  <span className="key key-on">Y Authorize</span>
                  <span className="key">N Cancel</span>
                </div>

                <div className="finding" style={{ marginTop: 20 }}>
                  <div className="finding-head">
                    ▣ Finding · High <span>idor · broken object access</span>
                  </div>
                  <div style={{ marginTop: 8 }}>GET /api/orders/1042 returns another account's order</div>
                  <div className="term-dim" style={{ fontSize: 12 }}>
                    authenticated as user 7 · expected 403, got 200
                  </div>
                </div>

                <div className="term-dim">41 requests sent to localhost:3000. No other host was contacted.</div>
              </div>
            </div>

            <div className="grid grid-2" style={{ marginTop: 28 }}>
              {PENTEST.map((item) => (
                <div className="cell" key={item.mark}>
                  <span className="cell-mark">{item.mark}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* features */}
        <section id="features" className="band">
          <div className="wrap">
            <div className="section-head">
              <div className="eyebrow">What it is</div>
              <h2>Everything opencode does, plus a security layer</h2>
              <p className="lede">
                CrokCode is a fork, not a rewrite. Every provider, agent and integration carries over. Guard, the
                theme and CrokAPI are what we added.
              </p>
            </div>
            <div className="grid grid-3">
              {FEATURES.map((feature) => (
                <div className="cell" key={feature.mark}>
                  <span className="cell-mark">{feature.mark}</span>
                  <h3>{feature.title}</h3>
                  <p>{feature.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* models */}
        <section id="models" className="band">
          <div className="wrap">
            <div className="section-head">
              <div className="eyebrow">CrokAPI</div>
              <h2>One key, the frontier models</h2>
              <p className="lede">
                CrokAPI is our hosted gateway. It speaks the OpenAI API, so it drops into anything, and it meters real
                token counts against your plan.
              </p>
            </div>
            <div className="models">
              {MODELS.map(([name, id]) => (
                <div className="model" key={id}>
                  <b>{name}</b>
                  <span>{id}</span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* local models */}
        <section id="local" className="band">
          <div className="wrap">
            <div className="section-head">
              <div className="eyebrow">Local models</div>
              <h2>Or run the whole thing on your own machine</h2>
              <p className="lede">
                Start Ollama and CrokCode finds it. Your local models appear in the picker beside the hosted ones, with
                the same tools and the same Guard — the only difference is that nothing leaves the laptop.
              </p>
            </div>
            <div className="grid grid-3">
              {LOCAL.map((item) => (
                <div className="cell" key={item.mark}>
                  <span className="cell-mark">{item.mark}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* voice */}
        <section id="voice" className="band">
          <div className="wrap">
            <div className="section-head">
              <div className="eyebrow">Voice</div>
              <h2>Talk to it. Nothing is uploaded.</h2>
              <p className="lede">
                Hold <span className="key">ctrl+alt+v</span> and describe what you want. Speech is transcribed on-device by whisper.cpp
                and dropped at your cursor in the prompt — dictation that works on a plane, in a locked-down repo, or
                anywhere you would not paste your voice into someone's API.
              </p>
            </div>

            <div className="term">
              <div className="term-bar">
                <span style={{ color: "var(--croc)" }}>●</span> crokcode — prompt
              </div>
              <div className="term-body">
                <div>
                  <span className="term-add">▐█▌▃▅█</span>{" "}
                  <span className="term-dim">hearing you 0:06 · ctrl+alt+v stop</span>
                </div>
                <div className="term-dim">◆ transcribing…</div>
                <div>
                  &gt; refactor the session store so the cache key includes the workspace id
                  <span style={{ color: "var(--croc)" }}>▌</span>
                </div>
                <div className="term-dim">Transcribed locally. No audio left this machine.</div>
              </div>
            </div>

            <div className="grid grid-3" style={{ marginTop: 28 }}>
              {VOICE.map((item) => (
                <div className="cell" key={item.mark}>
                  <span className="cell-mark">{item.mark}</span>
                  <h3>{item.title}</h3>
                  <p>{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* stats */}
        <section className="band band-tight">
          <div className="wrap stats">
            <div className="stat">
              <b>160+</b>
              <span>Model providers supported</span>
            </div>
            <div className="stat">
              <b>6</b>
              <span>Guard rules, all readable</span>
            </div>
            <div className="stat">
              <b>0</b>
              <span>Secrets written to disk</span>
            </div>
            <div className="stat">
              <b>MIT</b>
              <span>Licensed, fork it freely</span>
            </div>
          </div>
        </section>

        {/* pricing */}
        <section id="pricing" className="band">
          <div className="wrap">
            <div className="section-head">
              <div className="eyebrow">Pricing</div>
              <h2>Pay for the gateway, not the agent</h2>
              <p className="lede">
                The CLI is free and always will be. Plans cover CrokAPI, the hosted gateway. Bring your own keys and
                you pay us nothing.
              </p>
            </div>
            <div className="plans">
              {PLANS.map((plan) => (
                <div className={`plan${plan.featured ? " plan-featured" : ""}`} key={plan.id}>
                  <div className="plan-name">{plan.name}</div>
                  <div className="plan-price">
                    {plan.price}
                    <small>{plan.per}</small>
                  </div>
                  <p className="plan-for">{plan.for}</p>
                  <ul>
                    {plan.features.map((feature) => (
                      <li key={feature}>{feature}</li>
                    ))}
                  </ul>
                  <Link to="/app" className={`btn ${plan.featured ? "btn-primary" : "btn-ghost"}`}>
                    Choose {plan.name}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* faq */}
        <section id="faq" className="band">
          <div className="wrap">
            <div className="section-head">
              <div className="eyebrow">FAQ</div>
              <h2>Questions worth asking</h2>
            </div>
            <div className="faq">
              {FAQ.map(([question, answer]) => (
                <details key={question}>
                  <summary>{question}</summary>
                  <p>{answer}</p>
                </details>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="wrap footer">
        <span>© {new Date().getFullYear()} CrokCode · MIT</span>
        <div className="footer-links">
          <a href="#guard">Guard</a>
          <a href="#pricing">Pricing</a>
          <Link to="/app">Console</Link>
          <a href="https://github.com/aaron-sequeira/crokcode">GitHub</a>
        </div>
      </footer>
    </>
  )
}
