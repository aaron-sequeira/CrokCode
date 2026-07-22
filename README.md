<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="CrokCode logo">
    </picture>
  </a>
</p>
<p align="center">CrokCode &mdash; the open source AI coding agent that guards your code.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![CrokCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://github.com/anomalyco/crokcode)

---

### Installation

**macOS, Linux, WSL:**

```bash
curl -fsSL https://crokcode.tech/install.sh | bash
```

**Windows PowerShell:**

```powershell
irm https://crokcode.tech/install.ps1 | iex
```

Both installers download the release binary, drop it on your `PATH`, and are
configurable with environment variables:

| Variable | Purpose |
| --- | --- |
| `CROKCODE_VERSION` | Install a specific version |
| `CROKCODE_INSTALL_DIR` | Custom install directory |
| `CROKCODE_REPO` | GitHub repo to download releases from |
| `CROKCODE_BINARY` | Install a locally built binary instead of downloading |

> [!NOTE]
> Those URLs serve the scripts in this repo (`install.sh` / `install.ps1`). Until
> `crokcode.tech` is pointed at them and you cut a GitHub release, use the local
> build below — or set `CROKCODE_REPO=you/crokcode` to pull from your own repo.

#### Build from source

**1. Build the binary** (requires [Bun](https://bun.sh)):

```bash
bun install
cd packages/opencode
bun run script/build.ts --single --skip-install
```

This produces `packages/opencode/dist/crokcode-<os>-<arch>/bin/crokcode`.

**2. Install it onto your PATH:**

```powershell
# Windows (PowerShell) - installs to %LOCALAPPDATA%\crokcode\bin and updates PATH
$env:CROKCODE_BINARY="$PWD\packages\opencode\dist\crokcode-windows-x64\bin\crokcode.exe"; ./install.ps1
```

```bash
# macOS / Linux - install the binary you just built
./install.sh --binary packages/opencode/dist/crokcode-*/bin/crokcode
```

**3. Launch it:**

```bash
crokcode              # start the CrokCode TUI in the current directory
crokcode /path/to/repo   # start in a specific project
crokcode run "explain this codebase"
crokcode --help
```

> [!TIP]
> Restart your terminal after installing so the updated PATH is picked up.

Once you publish releases to GitHub, the one-line installer works too. Point it
at your repo with `CROKCODE_REPO`:

```bash
CROKCODE_REPO=you/crokcode curl -fsSL https://raw.githubusercontent.com/you/crokcode/dev/install | bash
```

### Plans

CrokCode connects to **CrokAPI**, our hosted gateway (OpenAI-compatible, backed by
OpenRouter), which serves frontier models including GPT-5.6 Sol, Fable 5,
Claude Opus 4.8, Kimi K3, GLM 5.2, Gemini 3.5 Pro, DeepSeek V4 and Grok 5.

| Plan | Price | For |
| --- | --- | --- |
| **CrokGo** | $5/mo | Getting started |
| **CrokPro** | $20/mo | Daily driver, higher limits |
| **Crok-as-you-go** | Top up any amount | Pay only for what you use |

#### Connecting the CLI to CrokAPI

Add a `provider.crokapi` block to your config (`~/.config/crokcode/opencode.jsonc`
globally, or `opencode.json` in a project). Custom providers are resolved from
config, so this is what makes the models selectable:

```jsonc
{
  "provider": {
    "crokapi": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "CrokAPI",
      "options": {
        "baseURL": "https://<your-project>.supabase.co/functions/v1/crokapi/v1",
        "apiKey": "crok_..."
      },
      "models": {
        "openai/gpt-5.6-sol": { "name": "GPT-5.6 Sol" },
        "anthropic/claude-fable-5": { "name": "Fable 5" },
        "moonshotai/kimi-k3": { "name": "Kimi K3" },
        "z-ai/glm-5.2": { "name": "GLM 5.2" }
      }
    }
  }
}
```

Then select a model as `crokapi/<vendor>/<model>`:

```bash
crokcode models | grep crokapi
crokcode run --model crokapi/z-ai/glm-5.2 "hello"
```

Every call is authenticated against your CrokCode account, checked for an active
plan or remaining credits, and metered into `usage_events`.

#### CrokAPI backend

The gateway and billing run as Supabase Edge Functions in `supabase/functions/`:

| Function | Auth | Purpose |
| --- | --- | --- |
| `crokapi` | CrokCode API key | OpenAI-compatible gateway. Checks entitlement, proxies to OpenRouter, meters tokens. |
| `stripe-webhook` | Stripe signature | Syncs subscriptions and credits top-ups. |
| `keys` | Supabase JWT | Create / list / revoke API keys (plaintext shown once). |
| `checkout` | Supabase JWT | Creates a Stripe Checkout session for a plan. |

Set these secrets before going live:

```bash
supabase secrets set OPENROUTER_API_KEY=sk-or-...
supabase secrets set STRIPE_SECRET_KEY=sk_live_...
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

Then add the webhook in Stripe pointing at `/functions/v1/stripe-webhook`, subscribing to
`checkout.session.completed` and `customer.subscription.*`.

### CrokCode Guard

Guard is CrokCode's built-in security layer. It scans every proposed change
*before it reaches disk* and blocks critical findings:

- Hard-blocks added API keys, tokens and private keys
- Warns on `eval`/`exec`, unsafe HTML rendering, TLS/auth weakening and risky dependencies
- Redacts detected secrets from evidence, logs and model prompts
- Snapshot-backed revert for shell commands

### Desktop App (BETA)

OpenCode is also available as a desktop application. Download directly from the [releases page](https://github.com/anomalyco/opencode/releases) or [opencode.ai/download](https://opencode.ai/download).

| Platform              | Download                           |
| --------------------- | ---------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-mac-arm64.dmg`   |
| macOS (Intel)         | `opencode-desktop-mac-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe` |
| Linux                 | `.deb`, `.rpm`, or `.AppImage`     |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Installation Directory

The install script respects the following priority order for the installation path:

1. `$CROKCODE_INSTALL_DIR` - Custom installation directory
2. `$XDG_BIN_DIR` - XDG Base Directory Specification compliant path
3. `$HOME/bin` - Standard user binary directory (if it exists or can be created)
4. `$HOME/.opencode/bin` - Default fallback

```bash
# Examples
CROKCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Agents

OpenCode includes two built-in agents you can switch between with the `Tab` key.

- **build** - Default, full-access agent for development work
- **plan** - Read-only agent for analysis and code exploration
  - Denies file edits by default
  - Asks permission before running bash commands
  - Ideal for exploring unfamiliar codebases or planning changes

Also included is a **general** subagent for complex searches and multistep tasks.
This is used internally and can be invoked using `@general` in messages.

Learn more about [agents](https://opencode.ai/docs/agents).

### Documentation

For more info on how to configure OpenCode, [**head over to our docs**](https://opencode.ai/docs).

### Contributing

If you're interested in contributing to OpenCode, please read our [contributing docs](./CONTRIBUTING.md) before submitting a pull request.

### Building on OpenCode

If you are working on a project that's related to OpenCode and is using "opencode" as part of its name, for example "opencode-dashboard" or "opencode-mobile", please add a note to your README to clarify that it is not built by the OpenCode team and is not affiliated with us in any way.

---

**Join our community** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
