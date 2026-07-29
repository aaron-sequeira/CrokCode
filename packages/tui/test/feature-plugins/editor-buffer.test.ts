import { expect, test } from "bun:test"
import { beforeSave, isDirty, onExternalChange } from "../../src/feature-plugins/system/editor/buffer"

const state = { savedText: "one\n", mtime: 1000 }

test("a buffer matching what was saved is not dirty", () => {
  expect(isDirty(state, "one\n")).toBe(false)
  expect(isDirty(state, "one changed\n")).toBe(true)
})

test("a clean buffer reloads when the agent edits the file", () => {
  expect(onExternalChange(state, "one\n", { text: "agent wrote this\n", mtime: 2000 })).toEqual({
    action: "reload",
    text: "agent wrote this\n",
    mtime: 2000,
  })
})

test("a dirty buffer asks instead of reloading, so typing is never lost", () => {
  expect(onExternalChange(state, "my edits\n", { text: "agent wrote this\n", mtime: 2000 })).toEqual({
    action: "conflict",
  })
})

test("an event that carries no actual change does nothing, dirty or not", () => {
  expect(onExternalChange(state, "one\n", { text: "one\n", mtime: 1000 })).toEqual({ action: "none" })
  expect(onExternalChange(state, "my edits\n", { text: "one\n", mtime: 1000 })).toEqual({ action: "none" })
})

test("saving over a file that changed underneath us conflicts instead of clobbering", () => {
  expect(beforeSave(state, { mtime: 1000 })).toEqual({ action: "write" })
  expect(beforeSave(state, { mtime: 2000 })).toEqual({ action: "conflict" })
})
