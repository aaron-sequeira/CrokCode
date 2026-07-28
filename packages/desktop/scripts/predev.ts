import { $ } from "bun"

await $`bun ./scripts/copy-icons.ts ${process.env.CROKCODE_CHANNEL ?? "dev"}`

await $`cd ../crokcode && bun script/build-node.ts`
