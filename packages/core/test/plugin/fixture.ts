import { AgentV2 } from "@crokcode/core/agent"
import { AISDK } from "@crokcode/core/aisdk"
import { Catalog } from "@crokcode/core/catalog"
import { CommandV2 } from "@crokcode/core/command"
import { Credential } from "@crokcode/core/credential"
import { AppNodeBuilder } from "@crokcode/core/effect/app-node-builder"
import { LayerNodePlatform } from "@crokcode/core/effect/app-node-platform"
import { LayerNode } from "@crokcode/core/effect/layer-node"
import { EventV2 } from "@crokcode/core/event"
import { FileSystem } from "@crokcode/core/filesystem"
import { FSUtil } from "@crokcode/core/fs-util"
import { Integration } from "@crokcode/core/integration"
import { Location } from "@crokcode/core/location"
import { Npm } from "@crokcode/core/npm"
import { PluginV2 } from "@crokcode/core/plugin"
import { Reference } from "@crokcode/core/reference"
import { SkillV2 } from "@crokcode/core/skill"
import { Effect, Layer } from "effect"
import { tempLocationLayer } from "../fixture/location"

const npmLayer = Layer.succeed(
  Npm.Service,
  Npm.Service.of({
    add: () => Effect.succeed({ directory: "", entrypoint: undefined }),
    install: () => Effect.void,
    which: () => Effect.succeed(undefined),
  }),
)

export const PluginTestLayer = AppNodeBuilder.build(
  LayerNode.group([
    FileSystem.node,
    FSUtil.node,
    Location.node,
    Npm.node,
    Credential.node,
    EventV2.node,
    LayerNodePlatform.httpClient,
    PluginV2.node,
    AgentV2.node,
    AISDK.node,
    Catalog.node,
    CommandV2.node,
    Integration.node,
    Reference.node,
    SkillV2.node,
  ]),
  [
    [Location.node, tempLocationLayer],
    [Npm.node, npmLayer],
  ],
)
