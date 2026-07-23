<p align="center">
  <a href="https://crokcode.tech">
    <img src="packages/site/public/favicon.svg" alt="CrokCode" width="88" height="88">
  </a>
</p>
<h1 align="center">CrokCode</h1>
<p align="center">The open-source AI coding agent that <b>guards your code</b>.</p>
<p align="center">
  <a href="https://crokcode.tech">crokcode.tech</a> &nbsp;·&nbsp;
  <a href="https://github.com/aaron-sequeira/CrokCode/releases">Releases</a> &nbsp;·&nbsp;
  <a href="#crokcode-guard">Guard</a> &nbsp;·&nbsp;
  <a href="#plans">Plans</a>
</p>

---

CrokCode is a fork of [opencode](https://github.com/anomalyco/opencode) — a terminal-first AI coding agent — with three additions:

- **Guard** — a deterministic security scanner that runs on every AI-proposed change *before it reaches disk*. It hard-blocks hardcoded secrets and warns on risky patterns, and redacts detected secrets from what's sent to the model.
- **CrokAPI** — an optional hosted, OpenAI-compatible model gateway, so you can pay one bill instead of juggling per-provider API keys.
- **Usage-based plans** — daily/weekly limits or pay-as-you-go, managed from a web console at [crokcode.tech](https://crokcode.tech).

Everything opencode does still works: bring your own Anthropic, OpenAI, Google, OpenRouter or local model keys. CrokAPI is entirely optional.

## Installation

**macOS, Linux, WSL:**

```bash
curl -fsSL https://www.crokcode.tech/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://www.crokcode.tech/install.ps1 | iex
```

Both installers download the latest release binary, drop it on your `PATH`, and are configurable with environment variables:

| Variable | Purpose |
| --- | --- |
| `CROKCODE_VERSION` | Install a specific version |
| `CROKCODE_INSTALL_DIR` | Custom install directory |
| `CROKCODE_REPO` | GitHub repo to download releases from |
| `CROKCODE_BINARY` | Install a locally built binary instead of downloading |

Then launch it:

```bash
crokcode                 # start the TUI in the current directory
crokcode /path/to/repo   # start in a specific project
crokcode run "explain this codebase"
crokcode login           # connect the CLI to your CrokAPI account (browser pairing)
crokcode --help
```

> [!TIP]
> Restart your terminal after installing so the updated `PATH` is picked up.

### Build from source

Requires [Bun](https://bun.sh):

```bash
bun install
cd packages/opencode
bun run script/build.ts --single --skip-install
```

This produces `packages/opencode/dist/crokcode-<os>-<arch>/bin/crokcode`. Install the binary you just built:

```bash
# macOS / Linux
./install.sh --binary packages/opencode/dist/crokcode-*/bin/crokcode
```

```powershell
# Windows
$env:CROKCODE_BINARY="$PWD\packages\opencode\dist\crokcode-windows-x64\bin\crokcode.exe"; ./install.ps1
```

## Plans

CrokCode connects to **CrokAPI**, a hosted OpenAI-compatible gateway (backed by OpenRouter) serving GPT-5.6 Sol, Fable 5, Claude Opus 4.8, Kimi K3, GLM 5.2, Gemini 3.5 Pro, DeepSeek V4 and Grok 5.

| Plan | Price | Limits | For |
| --- | --- | --- | --- |
| **CrokGo** | $5 first month, then $10/mo | $0.50/day · $1.50/week | Efficient models (GLM, DeepSeek, Kimi) |
| **CrokPro** | $20/mo | $2/day · $3.50/week | Every model, including the frontier ones |
| **Crok-as-you-go** | Top up $5–$500 | No caps | Heavy, all-day use — pay per token |

Subscriptions are capped by daily and weekly usage budgets (they reset each day and each Monday). For uncapped, heavy agentic work, Crok-as-you-go bills per token from a balance you top up. Manage everything — plan, limits, keys, usage — in the console at [crokcode.tech](https://crokcode.tech).

### Connecting the CLI

The easiest way is `crokcode login`, which opens your browser, pairs the CLI, and writes the provider config for you. To do it manually, add a provider block to `~/.config/crokcode/opencode.jsonc`:

```jsonc
{
  "provider": {
    "crokapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CrokAPI",
      "options": {
        "baseURL": "https://zapkpyjeetjbufuuqwye.supabase.co/functions/v1/crokapi/v1",
        "apiKey": "crok_..."
      },
      "models": {
        "z-ai/glm-5.2": { "name": "GLM 5.2", "reasoning": true },
        "moonshotai/kimi-k3": { "name": "Kimi K3", "reasoning": true }
      }
    }
  }
}
```

Then pick a model as `crokapi/<vendor>/<model>`:

```bash
crokcode run --model crokapi/z-ai/glm-5.2 "hello"
```

Check your remaining budget any time with the **`/usage`** command in the TUI.

## Reasoning effort — spend fewer tokens on small tasks

Reasoning models expose effort tiers (`low` / `medium` / `high`, and more on some models). Lower effort means less thinking and fewer tokens — cheaper and faster for small tasks. In the TUI:

- **`/effort`** (aliases `/variants`, `/variant`) — pick a level for the current model
- **`variant.cycle`** keybind — cycle through levels

The active level shows in the prompt bar. Simple edit? Drop to `low`. Hard refactor? Bump to `high`.

## CrokCode Guard

Guard is CrokCode's built-in security layer. It scans every proposed change *before it reaches disk* and blocks critical findings:

- Hard-blocks added API keys, tokens and private keys
- Warns on `eval`/`exec`, unsafe HTML rendering, TLS/auth weakening and risky dependency sources
- Redacts detected secrets from evidence, logs and model prompts
- Snapshot-backed revert for shell commands

Guard scans added lines in JavaScript, TypeScript and JSON. Warnings never block; only critical, high-confidence findings stop a write, and you can revert or accept from the same card. The manual scan (Guard panel) diffs your working tree, so it needs the project to be a git repository.

## CrokAPI backend

The gateway and billing run as Supabase Edge Functions in `supabase/functions/`:

| Function | Auth | Purpose |
| --- | --- | --- |
| `crokapi` | CrokCode API key | OpenAI-compatible gateway. Enforces plan limits, proxies to OpenRouter, meters tokens. |
| `cli-auth` | Pairing codes | Device pairing for `crokcode login`. |
| `stripe-webhook` | Stripe signature | Syncs subscriptions and credit top-ups. |
| `keys` | Supabase JWT | Create / list / revoke API keys (shown once). |
| `checkout` | Supabase JWT | Creates a Stripe Checkout session for a plan. |

Secrets to set before going live:

```bash
supabase secrets set OPENROUTER_API_KEY=...
supabase secrets set STRIPE_SECRET_KEY=...
supabase secrets set STRIPE_WEBHOOK_SECRET=...
```

Register the Stripe webhook pointing at `/functions/v1/stripe-webhook`, subscribing to `checkout.session.completed`, `customer.subscription.*` and `invoice.paid`.

## Agents

CrokCode inherits opencode's agents, switchable with the `Tab` key:

- **build** — full-access agent for development work
- **plan** — read-only agent for analysis and exploration (denies edits, asks before running commands)
- **general** — subagent for complex searches and multistep tasks (`@general` in messages)

## Configuration & docs

CrokCode reads the same config format as opencode (`opencode.json` / `opencode.jsonc`). For base configuration, agents, keybinds and MCP, opencode's docs apply: [opencode.ai/docs](https://opencode.ai/docs). CrokCode-specific features — Guard, CrokAPI, plans, `/usage`, `/effort` — are documented here and at [crokcode.tech](https://crokcode.tech).

## Contributing

CrokCode is MIT-licensed and built on [opencode](https://github.com/anomalyco/opencode) (also MIT). See [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

---

<p align="center">
  <a href="https://crokcode.tech">crokcode.tech</a> · Built on <a href="https://github.com/anomalyco/opencode">opencode</a>
</p>
