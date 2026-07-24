import { expect, test } from "bun:test"
import { LOCAL_MODELS, mergeLocalModels, ollamaProvider } from "../../src/util/local-models"

test("includes installed Ollama models that are not curated", () => {
  const models = mergeLocalModels([{ name: "custom-coder:latest", size: 2 * 1024 ** 3 }])

  expect(models[0]).toMatchObject({
    id: "custom-coder:latest",
    name: "custom-coder:latest",
    sizeGb: 2,
    minRamGb: 0,
    note: "Installed in Ollama",
  })
})

test("deduplicates installed and curated models by Ollama ID", () => {
  const models = mergeLocalModels([{ name: LOCAL_MODELS[0].id, size: 99 }])

  expect(models.filter((model) => model.id === LOCAL_MODELS[0].id)).toHaveLength(1)
  expect(models.find((model) => model.id === LOCAL_MODELS[0].id)).toEqual(LOCAL_MODELS[0])
})

test("registers every installed Ollama model with its exact ID", () => {
  const provider = ollamaProvider([
    { name: "llama3.1:8b" },
    { name: "llava:latest" },
    { name: "minimax-m3:cloud" },
  ])

  expect(provider.models).toEqual({
    "llama3.1:8b": { name: "llama3.1:8b" },
    "llava:latest": { name: "llava:latest" },
    "minimax-m3:cloud": { name: "minimax-m3:cloud" },
  })
})
