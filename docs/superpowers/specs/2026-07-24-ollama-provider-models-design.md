# Ollama Models in Provider Menu Design

## Goal

Let users select every model already installed in Ollama through CrokCode's
normal provider and model menus, without depending on the broken `/local`
picker. Keep `/local` available for browsing and downloading the curated
catalog.

## User experience

The provider menu keeps its existing **Local models** entry. Selecting it:

1. Queries Ollama's local tags endpoint.
2. Registers every returned model under an **Ollama (local)** provider.
3. Refreshes CrokCode's provider state.
4. Opens the normal model selector filtered to **Ollama (local)**.

The model selector shows only models currently installed in Ollama. Selecting
one uses the existing model-selection flow, including recent-model tracking.
Users who want to download another model can still run `/local`.

If Ollama is unavailable, CrokCode shows an actionable message asking the user
to start it. If Ollama is running but has no models, CrokCode explains that no
models are installed and points users to `/local`. Neither case opens an empty
dialog.

## Implementation

Reuse the existing Ollama status function, config update API, instance refresh,
sync bootstrap, and `DialogModel` component. The provider configuration uses
the existing OpenAI-compatible Ollama endpoint and adds one model entry per
installed tag. No new picker or provider abstraction is needed.

The existing `/local` connection code continues probing a selected model for
its context window and tool support. Provider-menu registration stays fast and
does not load every installed model merely to probe capabilities.

## Testing

Add a focused test around the provider-menu Ollama registration data:

- all installed tags become provider models;
- an empty model list remains empty;
- model IDs and display names are preserved.

Verify the provider-option tests, local-model tests, TUI typecheck, and the
relevant TUI suite before release.

## Release

After verification, publish the next patch release, confirm all release assets,
verify the live Windows installer resolves that release, reinstall it locally,
and confirm the installed version.
