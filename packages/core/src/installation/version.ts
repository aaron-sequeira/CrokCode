declare global {
  const CROKCODE_VERSION: string
  const CROKCODE_CHANNEL: string
}

export const InstallationVersion = typeof CROKCODE_VERSION === "string" ? CROKCODE_VERSION : "local"
export const InstallationChannel = typeof CROKCODE_CHANNEL === "string" ? CROKCODE_CHANNEL : "local"
export const InstallationLocal = InstallationChannel === "local"
