import { expect, test } from "bun:test"
import { LOCAL_MODELS, mergeLocalModels } from "../../src/util/local-models"

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
