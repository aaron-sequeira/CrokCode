import { Config } from "effect"

export function truthy(key: string) {
  const value = process.env[key]?.toLowerCase()
  return value === "true" || value === "1"
}

const copy = process.env["CROKCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"]
const fff = process.env["CROKCODE_DISABLE_FFF"]

function enabledByExperimental(key: string) {
  return process.env[key] === undefined ? truthy("CROKCODE_EXPERIMENTAL") : truthy(key)
}

export const Flag = {
  OTEL_EXPORTER_OTLP_ENDPOINT: process.env["OTEL_EXPORTER_OTLP_ENDPOINT"],
  OTEL_EXPORTER_OTLP_HEADERS: process.env["OTEL_EXPORTER_OTLP_HEADERS"],

  CROKCODE_AUTO_HEAP_SNAPSHOT: truthy("CROKCODE_AUTO_HEAP_SNAPSHOT"),
  CROKCODE_GIT_BASH_PATH: process.env["CROKCODE_GIT_BASH_PATH"],
  CROKCODE_CONFIG: process.env["CROKCODE_CONFIG"],
  CROKCODE_CONFIG_CONTENT: process.env["CROKCODE_CONFIG_CONTENT"],
  CROKCODE_DISABLE_AUTOUPDATE: truthy("CROKCODE_DISABLE_AUTOUPDATE"),
  CROKCODE_ALWAYS_NOTIFY_UPDATE: truthy("CROKCODE_ALWAYS_NOTIFY_UPDATE"),
  CROKCODE_DISABLE_PRUNE: truthy("CROKCODE_DISABLE_PRUNE"),
  CROKCODE_DISABLE_TERMINAL_TITLE: truthy("CROKCODE_DISABLE_TERMINAL_TITLE"),
  CROKCODE_SHOW_TTFD: truthy("CROKCODE_SHOW_TTFD"),
  CROKCODE_DISABLE_AUTOCOMPACT: truthy("CROKCODE_DISABLE_AUTOCOMPACT"),
  CROKCODE_DISABLE_MODELS_FETCH: truthy("CROKCODE_DISABLE_MODELS_FETCH"),
  CROKCODE_DISABLE_MOUSE: truthy("CROKCODE_DISABLE_MOUSE"),
  CROKCODE_FAKE_VCS: process.env["CROKCODE_FAKE_VCS"],
  CROKCODE_SERVER_PASSWORD: process.env["CROKCODE_SERVER_PASSWORD"],
  CROKCODE_SERVER_USERNAME: process.env["CROKCODE_SERVER_USERNAME"],
  CROKCODE_DISABLE_FFF: fff === undefined ? process.platform === "win32" : truthy("CROKCODE_DISABLE_FFF"),

  // Experimental
  CROKCODE_EXPERIMENTAL_FILEWATCHER: Config.boolean("CROKCODE_EXPERIMENTAL_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CROKCODE_EXPERIMENTAL_DISABLE_FILEWATCHER: Config.boolean("CROKCODE_EXPERIMENTAL_DISABLE_FILEWATCHER").pipe(
    Config.withDefault(false),
  ),
  CROKCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT:
    copy === undefined ? process.platform === "win32" : truthy("CROKCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT"),
  CROKCODE_MODELS_URL: process.env["CROKCODE_MODELS_URL"],
  CROKCODE_MODELS_PATH: process.env["CROKCODE_MODELS_PATH"],
  CROKCODE_DB: process.env["CROKCODE_DB"],

  CROKCODE_WORKSPACE_ID: process.env["CROKCODE_WORKSPACE_ID"],
  CROKCODE_EXPERIMENTAL_WORKSPACES: enabledByExperimental("CROKCODE_EXPERIMENTAL_WORKSPACES"),

  // Evaluated at access time (not module load) because tests, the CLI, and
  // external tooling set these env vars at runtime.
  get CROKCODE_DISABLE_PROJECT_CONFIG() {
    return truthy("CROKCODE_DISABLE_PROJECT_CONFIG")
  },
  get CROKCODE_EXPERIMENTAL_REFERENCES() {
    return enabledByExperimental("CROKCODE_EXPERIMENTAL_REFERENCES")
  },
  get CROKCODE_TUI_CONFIG() {
    return process.env["CROKCODE_TUI_CONFIG"]
  },
  get CROKCODE_CONFIG_DIR() {
    return process.env["CROKCODE_CONFIG_DIR"]
  },
  get CROKCODE_PURE() {
    return truthy("CROKCODE_PURE")
  },
  get CROKCODE_PERMISSION() {
    return process.env["CROKCODE_PERMISSION"]
  },
  get CROKCODE_PLUGIN_META_FILE() {
    return process.env["CROKCODE_PLUGIN_META_FILE"]
  },
  get CROKCODE_CLIENT() {
    return process.env["CROKCODE_CLIENT"] ?? "cli"
  },
}
