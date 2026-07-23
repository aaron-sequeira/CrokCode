# TUI Updates and Local Models Design

## Goal

Make new CrokCode releases visible at TUI startup, make `/local` reliably show
installed and recommended Ollama models, and publish a verified release that
the existing Windows installer can install.

## Update experience

The existing asynchronous startup check remains in place so an unavailable or
slow network never delays opening CrokCode. When it reports a newer version,
the TUI opens a blocking, Codex-style update dialog with:

- **Update now**: installs the reported version, shows progress, and asks the
  user to restart after success.
- **Later**: closes the dialog for this launch without suppressing future
  reminders.
- **Skip this version**: stores the reported version and suppresses it until a
  newer version is available.

The dialog reuses the current update event, upgrade API, theme, keyboard
handling, and persisted key-value state. A failed update leaves the TUI open
and shows an actionable error. A failed update check remains silent.

## Local model experience

`/local` combines two sources:

1. Every model returned by Ollama's local tags endpoint.
2. The existing curated, coding-focused download catalog.

Models are deduplicated by Ollama model ID. Curated metadata supplies friendly
names, download sizes, memory guidance, and recommendations. Installed models
that are not curated remain visible and selectable using Ollama's metadata;
they are never hidden or disabled merely because CrokCode does not recognize
them.

Selecting an installed model connects it. Selecting an available curated model
downloads it with the existing progress view, then connects it. If Ollama is
unavailable, `/local` keeps the existing install/start guidance instead of
showing an empty list.

## Black-bar root cause

The screenshot and renderer tests identify two independent render failures:

- A model footer rendered a `<text>` node inside `DialogSelect`'s existing
  `<text>` wrapper, which OpenTUI rejects.
- On short terminals, the calculated scrollbox height could become zero or
  negative, causing all option rows to paint at the same position.

The fix keeps model footer content as valid inline spans and clamps the shared
select-list height to at least one row. This fixes `/local` at the shared
rendering boundary without adding command-specific layout workarounds.

## Data flow

1. TUI startup schedules the existing background release check.
2. A newer version emits the existing installation event.
3. The update dialog blocks TUI interaction until the user updates, postpones,
   or skips that version.
4. `/local` fetches Ollama tags and machine specifications concurrently.
5. Installed tags are merged with the curated catalog and rendered through
   `DialogSelect`.
6. Connecting a model updates the Ollama provider configuration, refreshes the
   instance, and opens the normal model picker.

## Verification

Focused tests will cover:

- short terminals render at least one legible model row;
- model footers do not create invalid nested text nodes;
- every installed Ollama model appears;
- installed and curated entries with the same ID are deduplicated;
- update dialog actions update, postpone, or persist a skipped version;
- update failures keep the TUI usable.

After focused tests, run `bun typecheck` and the relevant TUI and opencode test
suites from their package directories.

## Release and deployment

The Windows installer already resolves the latest GitHub release and downloads
`crokcode-windows-x64.zip`, matching `.github/workflows/crokcode-release.yml`.
No duplicate installer logic is needed unless verification finds a mismatch.

After all checks pass:

1. Commit the implementation using the repository's conventional commit style.
2. Create and push a version tag.
3. Run or monitor `crokcode-release.yml` until all platform assets are attached
   to the public GitHub release.
4. Deploy `packages/site` to production.
5. Fetch `https://www.crokcode.tech/install.ps1`, verify its text content and
   headers, and perform a clean Windows install against the new release.

Publishing stops if tests fail, release assets are incomplete, or the live
installer cannot install the newly published version.
