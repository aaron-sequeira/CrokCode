import { getComponentCatalogue } from "@opentui/solid/components"
import { registerSpinner } from "opentui-spinner/solid"

export function registerCrokcodeSpinner() {
  if (!getComponentCatalogue().spinner) registerSpinner()
}
