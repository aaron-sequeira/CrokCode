import { run as runTui, type TuiInput } from "@crokcode/tui"
import { Global } from "@crokcode/core/global"
import { AppNodeBuilder } from "@crokcode/core/effect/app-node-builder"
import { Effect } from "effect"

export function run(input: TuiInput) {
  return runTui(input).pipe(Effect.provide(AppNodeBuilder.build(Global.node)))
}
