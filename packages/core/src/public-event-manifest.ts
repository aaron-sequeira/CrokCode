export * as PublicEventManifest from "./public-event-manifest"

import { Event } from "@crokcode/schema/event"
import { EventManifest } from "@crokcode/schema/event-manifest"

export const Definitions = EventManifest.ServerDefinitions
export const Latest = Event.latest(Definitions)
