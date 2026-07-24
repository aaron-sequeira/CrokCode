import { TextAttributes } from "@opentui/core"
import { For } from "solid-js"
import { createStore } from "solid-js/store"
import { useTheme } from "../context/theme"
import { useBindings } from "../keymap"
import { useDialog, type DialogContext } from "./dialog"

export type UpdateChoice = "update" | "later" | "skip"

export function DialogUpdate(props: { version: string; onSelect: (choice: UpdateChoice) => void }) {
  const dialog = useDialog()
  const { theme } = useTheme()
  const choices = [
    { value: "update" as const, label: "Update now" },
    { value: "later" as const, label: "Later" },
    { value: "skip" as const, label: "Skip this version" },
  ]
  const [store, setStore] = createStore({ selected: 0 })
  const select = () => {
    props.onSelect(choices[store.selected].value)
    dialog.clear()
  }

  useBindings(() => ({
    bindings: [
      {
        key: "left",
        desc: "Previous update action",
        group: "Dialog",
        cmd: () => setStore("selected", (store.selected + choices.length - 1) % choices.length),
      },
      {
        key: "right",
        desc: "Next update action",
        group: "Dialog",
        cmd: () => setStore("selected", (store.selected + 1) % choices.length),
      },
      { key: "return", desc: "Choose update action", group: "Dialog", cmd: select },
    ],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} paddingBottom={1} gap={1} width={58}>
      <text attributes={TextAttributes.BOLD} fg={theme.text}>
        CrokCode update available
      </text>
      <text fg={theme.textMuted}>
        Version {props.version} is ready. Update now or continue with your current version.
      </text>
      <box flexDirection="row" justifyContent="flex-end" marginTop={1}>
        <For each={choices}>
          {(choice, index) => (
            <box
              paddingLeft={1}
              paddingRight={1}
              backgroundColor={index() === store.selected ? theme.primary : undefined}
              onMouseUp={() => {
                props.onSelect(choice.value)
                dialog.clear()
              }}
            >
              <text fg={index() === store.selected ? theme.selectedListItemText : theme.textMuted}>{choice.label}</text>
            </box>
          )}
        </For>
      </box>
      <text fg={theme.textMuted}>← → choose · enter confirm</text>
    </box>
  )
}

DialogUpdate.show = (dialog: DialogContext, version: string) =>
  new Promise<UpdateChoice>((resolve) => {
    dialog.replace(
      () => <DialogUpdate version={version} onSelect={resolve} />,
      () => resolve("later"),
    )
  })
