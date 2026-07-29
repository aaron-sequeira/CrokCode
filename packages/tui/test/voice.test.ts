import { expect, test } from "bun:test"
import { chooseRecorder, cleanTranscript, RECORDER_HINT } from "../src/util/voice"

const nothing = () => false
const everything = () => true
const only =
  (...bins: string[]) =>
  (bin: string) =>
    bins.includes(bin)

test("windows records through winmm, with nothing installed", () => {
  expect(chooseRecorder("win32", nothing, "out.wav")).toEqual({ kind: "mci" })
})

test("linux prefers arecord, falls back to ffmpeg", () => {
  const arecord = chooseRecorder("linux", only("arecord", "ffmpeg"), "out.wav")
  expect(arecord).toMatchObject({ kind: "spawn", cmd: "arecord", stop: "signal" })

  const ffmpeg = chooseRecorder("linux", only("ffmpeg"), "out.wav")
  expect(ffmpeg).toMatchObject({ kind: "spawn", cmd: "ffmpeg", stop: "quit" })
  expect((ffmpeg as { args: string[] }).args).toContain("alsa")
})

test("macos uses avfoundation via ffmpeg, then sox", () => {
  const ffmpeg = chooseRecorder("darwin", everything, "out.wav")
  expect((ffmpeg as { args: string[] }).args).toContain("avfoundation")
  expect(chooseRecorder("darwin", only("rec"), "out.wav")).toMatchObject({ kind: "spawn", cmd: "rec" })
})

test("records 16 kHz mono, which is what whisper wants", () => {
  for (const platform of ["linux", "darwin"] as const) {
    const args = (chooseRecorder(platform, everything, "out.wav") as { args: string[] }).args
    expect(args).toContain("16000")
    expect(args).toContain("out.wav")
  }
})

test("no recorder anywhere yields an actionable hint rather than a crash", () => {
  expect(chooseRecorder("darwin", nothing, "out.wav")).toBeUndefined()
  expect(chooseRecorder("linux", nothing, "out.wav")).toBeUndefined()
  expect(RECORDER_HINT["darwin"]).toContain("brew install ffmpeg")
})

test("strips whisper's non-speech markers and joins segments", () => {
  expect(cleanTranscript("[BLANK_AUDIO]\n")).toBe("")
  expect(cleanTranscript(" hello world\n")).toBe("hello world")
  expect(cleanTranscript("  fix the login bug\n  and add a test\n")).toBe("fix the login bug and add a test")
  expect(cleanTranscript("[_BEG_] run the tests (silence)")).toBe("run the tests")
  expect(cleanTranscript("(applause) ship it")).toBe("ship it")
})

test("keeps parentheses that are actually dictated words", () => {
  expect(cleanTranscript("call foo (the helper) twice")).toBe("call foo (the helper) twice")
})
