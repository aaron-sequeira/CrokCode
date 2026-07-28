import { Context } from "effect"
import type { InstanceContext } from "@/project/instance-context"
import type { WorkspaceV2 } from "@crokcode/core/workspace"

export const InstanceRef = Context.Reference<InstanceContext | undefined>("~crokcode/InstanceRef", {
  defaultValue: () => undefined,
})

export const WorkspaceRef = Context.Reference<WorkspaceV2.ID | undefined>("~crokcode/WorkspaceRef", {
  defaultValue: () => undefined,
})
