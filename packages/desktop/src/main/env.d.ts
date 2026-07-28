interface ImportMetaEnv {
  readonly CROKCODE_CHANNEL: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

declare module "virtual:crokcode-server" {
  export namespace Server {
    export const listen: typeof import("../../../crokcode/dist/types/src/node").Server.listen
    export type Listener = import("../../../crokcode/dist/types/src/node").Server.Listener
  }
  export namespace Config {
    export const get: typeof import("../../../crokcode/dist/types/src/node").Config.get
    export type Info = import("../../../crokcode/dist/types/src/node").Config.Info
  }
  export const bootstrap: typeof import("../../../crokcode/dist/types/src/node").bootstrap
}
