export * from "./client.js"
export * from "./server.js"

import { createCrokcodeClient } from "./client.js"
import { createCrokcodeServer } from "./server.js"
import type { ServerOptions } from "./server.js"

export * as data from "./data.js"

export async function createCrokcode(options?: ServerOptions) {
  const server = await createCrokcodeServer({
    ...options,
  })

  const client = createCrokcodeClient({
    baseUrl: server.url,
  })

  return {
    client,
    server,
  }
}
