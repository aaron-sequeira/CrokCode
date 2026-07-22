import path from "path"

process.env.CROKCODE_DB = ":memory:"
process.env.CROKCODE_MODELS_PATH = path.join(import.meta.dir, "plugin", "fixtures", "models-dev.json")
process.env.CROKCODE_DISABLE_MODELS_FETCH = "true"
