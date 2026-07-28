// @ts-nocheck

import { CrokCode } from "@crokcode/core"
import { ReadTool } from "@crokcode/core/tools"

const crokcode = CrokCode.make({})

crokcode.tool.add(ReadTool)

crokcode.tool.add({
  name: "bash",
  schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The command to run.",
      },
    },
    required: ["command"],
  },
  execute(input, ctx) {},
})

crokcode.auth.add({
  provider: "openai",
  type: "api",
  value: process.env.OPENAI_API_KEY,
})

crokcode.agent.add({
  name: "build",
  permissions: [],
  model: {
    id: "gpt-5-5",
    provider: "openai",
    variant: "xhigh",
  },
})

const sessionID = await crokcode.session.create({
  agent: "build",
})

crokcode.subscribe((event) => {
  console.log(event)
})

await crokcode.session.prompt({
  sessionID,
  text: "hey what is up",
})

await crokcode.session.prompt({
  sessionID,
  text: "what is up with this",
  files: [
    {
      mime: "image/png",
      uri: "data:image/png;base64,xxxx",
    },
  ],
})

await crokcode.session.wait()

console.log(await crokcode.session.messages(sessionID))
