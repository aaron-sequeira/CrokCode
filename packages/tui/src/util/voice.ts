// On-device dictation: record the mic, transcribe with whisper.cpp.
//
// Audio never leaves the machine — the only network access is the one-time
// download of the whisper binary + model on first use.
//
// Recording climbs to the first thing already present on the box: Windows uses
// winmm's MCI via PowerShell (no install at all), Linux uses arecord, macOS
// uses ffmpeg/sox. Transcription is whisper.cpp's CLI, auto-provisioned on
// Windows (upstream ships prebuilt x64 binaries) and detected elsewhere.
import { spawn, type ChildProcess } from "child_process"
import { accessSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { Global } from "@crokcode/core/global"

// Message is shown to the user verbatim, so it has to say what to do next.
export class VoiceError extends Error {}

const MODEL_FILE = process.env["CROKCODE_WHISPER_MODEL"] || "ggml-base.en.bin"
const MODEL_URL = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${MODEL_FILE}`
const WHISPER_RELEASE = "https://api.github.com/repos/ggml-org/whisper.cpp/releases/latest"
const WHISPER_NAMES = ["whisper-cli", "whisper-cpp"]
// Older whisper.cpp archives ship the CLI as `main`, which is far too generic to
// go looking for on PATH — only accept it inside our own download.
const WHISPER_ARCHIVE_NAMES = [...WHISPER_NAMES, "main"]

export type Progress = (message: string) => void

function voiceDir(...parts: string[]) {
  return path.join(Global.Path.cache, "whisper", ...parts)
}

async function exists(file: string) {
  return fs
    .stat(file)
    .then(() => true)
    .catch(() => false)
}

/* ------------------------------------------------------------------ record */

export type Recording = { stop(): Promise<string> }

export type RecorderChoice =
  | { kind: "mci" }
  | { kind: "spawn"; cmd: string; args: string[]; stop: "quit" | "signal" }

/**
 * First recorder that exists on this platform, or undefined if the user needs
 * to install something. Pure so the ladder is testable without a microphone.
 */
export function chooseRecorder(
  platform: NodeJS.Platform,
  has: (bin: string) => boolean,
  out: string,
): RecorderChoice | undefined {
  // Windows records through winmm, which is part of the OS — nothing to install.
  if (platform === "win32") return { kind: "mci" }
  if (platform === "linux" && has("arecord"))
    return { kind: "spawn", cmd: "arecord", args: ["-q", "-f", "S16_LE", "-r", "16000", "-c", "1", "-t", "wav", out], stop: "signal" }
  if (has("ffmpeg")) {
    const input = platform === "darwin" ? ["-f", "avfoundation", "-i", ":default"] : ["-f", "alsa", "-i", "default"]
    return {
      kind: "spawn",
      cmd: "ffmpeg",
      args: ["-hide_banner", "-loglevel", "error", ...input, "-ar", "16000", "-ac", "1", "-y", out],
      stop: "quit",
    }
  }
  if (has("rec")) return { kind: "spawn", cmd: "rec", args: ["-q", "-r", "16000", "-c", "1", "-b", "16", out], stop: "signal" }
  return undefined
}

export const RECORDER_HINT: Record<string, string> = {
  darwin: "No microphone recorder found. Install one with: brew install ffmpeg",
  linux: "No microphone recorder found. Install alsa-utils (arecord) or ffmpeg.",
  default: "No microphone recorder found. Install ffmpeg and retry.",
}

// PATHEXT lists plenty of things spawn() cannot execute — .CPL, .MSC, .VBS —
// and system32 has generic names like main.CPL waiting to be mistaken for a
// tool. Only consider real executables.
const WIN_EXEC_EXTS = [".EXE", ".COM", ".BAT", ".CMD"]

function onPath(bin: string) {
  const exts = process.platform === "win32" ? WIN_EXEC_EXTS : [""]
  for (const dir of (process.env["PATH"] || "").split(path.delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      try {
        accessSync(path.join(dir, bin + ext))
        return path.join(dir, bin + ext)
      } catch {
        // keep looking
      }
    }
  }
  return undefined
}

export async function record(): Promise<Recording> {
  const out = path.join(os.tmpdir(), `crokcode-dictate-${Date.now()}.wav`)
  const choice = chooseRecorder(process.platform, (bin) => Boolean(onPath(bin)), out)
  if (!choice) throw new VoiceError(RECORDER_HINT[process.platform] ?? RECORDER_HINT["default"]!)
  if (choice.kind === "mci") return recordWithMci(out)

  const proc = spawn(choice.cmd, choice.args, { stdio: ["pipe", "ignore", "pipe"] })
  let stderr = ""
  proc.stderr?.on("data", (chunk) => (stderr += chunk))
  const exited = new Promise<void>((resolve, reject) => {
    proc.on("error", () => reject(new VoiceError(`Could not start ${choice.cmd}. ${RECORDER_HINT[process.platform] ?? ""}`)))
    proc.on("close", () => resolve())
  })

  return {
    async stop() {
      if (choice.stop === "quit") proc.stdin?.write("q\n")
      else proc.kill("SIGINT")
      await exited
      if (!(await exists(out))) throw new VoiceError(stderr.trim().split("\n").pop() || "Recording failed — no audio captured.")
      return out
    },
  }
}

// PowerShell + winmm.dll. Add-Type compiles the P/Invoke shim on first call
// (~1s), so the host process is kept warm for the rest of the session — losing
// the first second of every push-to-talk is the difference between working and
// broken.
//
// ponytail: MCI buffers the take in memory (~2 MB/min at 16 kHz mono). Fine for
// dictation; add a hard cap if someone starts recording meetings with it.
const MCI_SCRIPT = [
  "$ErrorActionPreference = 'Stop'",
  "Add-Type -Name Mci -Namespace Crok -MemberDefinition '",
  '[DllImport("winmm.dll", CharSet = CharSet.Ansi)]',
  "public static extern int mciSendStringA(string command, System.Text.StringBuilder ret, int retLen, System.IntPtr hwnd);",
  "'",
  "function Invoke-Mci([string]$command) {",
  "  $sb = New-Object System.Text.StringBuilder 512",
  "  $code = [Crok.Mci]::mciSendStringA($command, $sb, $sb.Capacity, [System.IntPtr]::Zero)",
  "  if ($code -ne 0) { Write-Output ('ERR ' + $code) }",
  "}",
  "Write-Output 'WARM'",
  "while ($true) {",
  "  $line = [Console]::In.ReadLine()",
  "  if ($null -eq $line) { break }",
  "  $line = $line.Trim()",
  "  if ($line -eq 'EXIT') { break }",
  "  if ($line -eq 'START') {",
  "    Invoke-Mci 'open new type waveaudio alias crokrec'",
  "    Invoke-Mci 'set crokrec bitspersample 16 channels 1 samplespersec 16000 alignment 2 bytespersec 32000'",
  "    Invoke-Mci 'record crokrec'",
  "    Write-Output 'RECORDING'",
  "    continue",
  "  }",
  "  if ($line.StartsWith('SAVE ')) {",
  "    Invoke-Mci 'stop crokrec'",
  "    Invoke-Mci ('save crokrec \"' + $line.Substring(5) + '\"')",
  "    Invoke-Mci 'close crokrec'",
  "    Write-Output 'SAVED'",
  "    continue",
  "  }",
  "}",
].join("\r\n")

// WASAPI's endpoint peak meter, so the UI can show that the mic is actually
// hearing something. Reads 0 until a capture stream is open, which is why it
// only means anything while recording. PowerShell can't cast a raw COM object
// to a ComImport interface, so the QueryInterface happens in C#.
const METER_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
public class MMDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDeviceEnumerator {
  int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr devices);
  int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IMMDevice {
  int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object iface);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IAudioMeterInformation {
  int GetPeakValue(out float peak);
}

public static class CrokMeter {
  static IAudioMeterInformation meter;
  public static void Open() {
    var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumerator();
    IMMDevice device;
    enumerator.GetDefaultAudioEndpoint(1, 0, out device);
    Guid iid = typeof(IAudioMeterInformation).GUID;
    object obj;
    device.Activate(ref iid, 1, IntPtr.Zero, out obj);
    meter = (IAudioMeterInformation)obj;
  }
  public static float Peak() {
    float peak;
    meter.GetPeakValue(out peak);
    return peak;
  }
}
'@
[CrokMeter]::Open()
while ($true) {
  Write-Output ("LEVEL " + [CrokMeter]::Peak().ToString("0.0000"))
  Start-Sleep -Milliseconds 150
}
`

// Ambient room noise measured up to 0.018 here; speech sits well above it.
// ponytail: one global threshold, no auto-calibration — CROKCODE_MIC_THRESHOLD
// is the knob if a quiet mic or a loud room needs a different line.
export const MIC_SPEECH_LEVEL = Number(process.env["CROKCODE_MIC_THRESHOLD"] || 0.04)

let meterProc: ChildProcess | undefined
let meterLevel = 0

/** Latest mic peak, 0..1. Always 0 where metering isn't supported. */
export function micLevel() {
  return meterLevel
}

async function startMeter() {
  if (meterProc || process.platform !== "win32") return
  const script = voiceDir("mic-meter.ps1")
  await fs.mkdir(path.dirname(script), { recursive: true })
  await fs.writeFile(script, METER_SCRIPT)
  const proc = spawn("powershell", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script], {
    stdio: ["ignore", "pipe", "ignore"],
    windowsHide: true,
  })
  meterProc = proc
  let buffer = ""
  proc.stdout?.setEncoding("utf8")
  proc.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl)
      buffer = buffer.slice(nl + 1)
      const value = /LEVEL ([\d.]+)/.exec(line)
      if (value) meterLevel = Number(value[1])
    }
  })
  // Metering is a nicety — losing it must never take dictation down with it.
  const stop = () => {
    if (meterProc === proc) meterProc = undefined
    meterLevel = 0
  }
  proc.on("error", stop)
  proc.on("close", stop)
}

type MciHost = { send(line: string): void; expect(marker: string, timeoutMs: number): Promise<void> }
let mciHost: MciHost | undefined

async function mci(): Promise<MciHost> {
  if (mciHost) return mciHost
  const script = voiceDir("mci-recorder.ps1")
  await fs.mkdir(path.dirname(script), { recursive: true })
  await fs.writeFile(script, MCI_SCRIPT)

  const proc: ChildProcess = spawn(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
    { stdio: ["pipe", "pipe", "pipe"], windowsHide: true },
  )
  // Markers are consumed, never replayed: a stale SAVED from the previous take
  // must not satisfy the next stop(). `pending` only covers a marker arriving
  // before its expect() call.
  const pending: string[] = []
  const waiters: { marker: string; resolve: () => void; reject: (error: Error) => void }[] = []
  const settle = (line: string) => {
    if (line.startsWith("ERR")) {
      waiters.splice(0).forEach((waiter) => waiter.reject(new VoiceError(`Microphone error (${line}).`)))
      return
    }
    const index = waiters.findIndex((waiter) => waiter.marker === line)
    if (index === -1) pending.push(line)
    else waiters.splice(index, 1)[0]!.resolve()
  }
  let buffer = ""
  proc.stdout?.setEncoding("utf8")
  proc.stdout?.on("data", (chunk: string) => {
    buffer += chunk
    let nl: number
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!line) continue
      settle(line)
    }
  })
  const die = (error: Error) => {
    mciHost = undefined
    waiters.splice(0).forEach((waiter) => waiter.reject(error))
  }
  proc.on("error", () => die(new VoiceError("Could not start PowerShell, which CrokCode uses to record audio on Windows.")))
  proc.on("close", () => die(new VoiceError("The recorder stopped unexpectedly.")))

  const host: MciHost = {
    send(line) {
      proc.stdin?.write(line + "\r\n")
    },
    expect(marker, timeoutMs) {
      const seen = pending.indexOf(marker)
      if (seen !== -1) {
        pending.splice(seen, 1)
        return Promise.resolve()
      }
      return new Promise<void>((resolve, reject) => {
        const waiter = { marker, resolve, reject }
        waiters.push(waiter)
        setTimeout(() => {
          const index = waiters.indexOf(waiter)
          if (index === -1) return
          waiters.splice(index, 1)
          reject(new VoiceError(`Recorder did not respond (${marker}).`))
        }, timeoutMs).unref?.()
      })
    },
  }
  await host.expect("WARM", 20_000)
  mciHost = host
  return host
}

async function recordWithMci(out: string): Promise<Recording> {
  const host = await mci()
  void startMeter().catch(() => {})
  host.send("START")
  await host.expect("RECORDING", 5_000)
  return {
    async stop() {
      host.send(`SAVE ${out}`)
      await host.expect("SAVED", 15_000)
      if (!(await exists(out))) throw new VoiceError("Recording failed — no audio captured. Check the microphone permission for your terminal.")
      return out
    },
  }
}

/* -------------------------------------------------------------- transcribe */

export const WHISPER_HINT: Record<string, string> = {
  darwin: "whisper.cpp not found. Install it with: brew install whisper-cpp",
  linux: "whisper.cpp not found. Install whisper-cli (build ggml-org/whisper.cpp) and put it on your PATH.",
  default: "whisper.cpp not found. Install whisper-cli and put it on your PATH.",
}

/**
 * whisper.cpp emits non-speech markers like [BLANK_AUDIO] and (silence), and
 * one line per segment. Dictation wants a single clean run of text.
 */
export function cleanTranscript(raw: string): string {
  return raw
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\((?:blank_audio|silence|music|applause|laughter|inaudible)[^)]*\)/gi, " ")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim()
}

async function findWhisper(): Promise<string | undefined> {
  for (const name of WHISPER_NAMES) {
    const found = onPath(name)
    if (found) return found
  }
  for (const name of WHISPER_ARCHIVE_NAMES) {
    const cached = voiceDir(process.platform === "win32" ? `${name}.exe` : name)
    if (await exists(cached)) return cached
  }
  return undefined
}

async function download(url: string, target: string, label: string, onProgress: Progress) {
  const res = await fetch(url, { redirect: "follow" })
  if (!res.ok || !res.body) throw new VoiceError(`Could not download ${label} (${res.status}).`)
  const total = Number(res.headers.get("content-length") || 0)
  const tmp = `${target}.part`
  await fs.mkdir(path.dirname(target), { recursive: true })
  const handle = await fs.open(tmp, "w")
  let done = 0
  let announced = 0
  try {
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      await handle.write(chunk)
      done += chunk.length
      if (Date.now() - announced < 500) continue
      announced = Date.now()
      onProgress(total ? `Downloading ${label}… ${Math.round((done / total) * 100)}%` : `Downloading ${label}…`)
    }
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, target)
}

// Upstream ships prebuilt CLI binaries for Windows only; every other platform
// gets a package-manager hint instead of a surprise compile.
async function installWhisperWindows(onProgress: Progress): Promise<string> {
  onProgress("Fetching whisper.cpp release…")
  const res = await fetch(WHISPER_RELEASE, { headers: { accept: "application/vnd.github+json" } })
  if (!res.ok) throw new VoiceError("Could not reach the whisper.cpp release feed. Check your connection and retry.")
  const body = (await res.json()) as { assets?: { name: string; browser_download_url: string }[] }
  const asset =
    body.assets?.find((item) => /^whisper-bin-x64\.zip$/i.test(item.name)) ??
    body.assets?.find((item) => /bin.*x64.*\.zip$/i.test(item.name))
  if (!asset) throw new VoiceError("No prebuilt whisper.cpp binary in the latest release. Install whisper-cli manually.")

  const zip = voiceDir("whisper-bin.zip")
  await download(asset.browser_download_url, zip, "whisper.cpp", onProgress)
  onProgress("Unpacking whisper.cpp…")
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${voiceDir()}' -Force`],
      { stdio: "ignore", windowsHide: true },
    )
    proc.on("error", reject)
    proc.on("close", (code) => (code === 0 ? resolve() : reject(new VoiceError("Could not unpack the whisper.cpp download."))))
  })
  await fs.rm(zip, { force: true })

  // The archive nests the binaries under a build folder; flatten what we need.
  for (const entry of await fs.readdir(voiceDir(), { recursive: true, withFileTypes: true })) {
    if (!WHISPER_ARCHIVE_NAMES.includes(path.parse(entry.name).name)) continue
    const from = path.join(entry.parentPath ?? voiceDir(), entry.name)
    if (path.dirname(from) === voiceDir()) return from
    for (const sibling of await fs.readdir(path.dirname(from))) {
      await fs.rename(path.join(path.dirname(from), sibling), voiceDir(sibling)).catch(() => {})
    }
    await fs.rm(path.dirname(from), { recursive: true, force: true }).catch(() => {})
    return voiceDir(entry.name)
  }
  throw new VoiceError("The whisper.cpp download did not contain a CLI binary.")
}

async function ensureWhisper(onProgress: Progress) {
  let bin = await findWhisper()
  if (!bin && process.platform === "win32") bin = await installWhisperWindows(onProgress)
  if (!bin) throw new VoiceError(WHISPER_HINT[process.platform] ?? WHISPER_HINT["default"]!)

  const model = voiceDir(MODEL_FILE)
  if (!(await exists(model))) await download(MODEL_URL, model, "speech model (~150 MB)", onProgress)
  return { bin, model }
}

/** Transcribe a WAV on-device and delete it. Returns "" when nothing was said. */
export async function transcribe(wav: string, onProgress: Progress): Promise<string> {
  try {
    const { bin, model } = await ensureWhisper(onProgress)
    onProgress("Transcribing…")
    const proc = spawn(bin, ["-m", model, "-f", wav, "-nt", "-np"], { stdio: ["ignore", "pipe", "pipe"] })
    let out = ""
    let err = ""
    proc.stdout?.on("data", (chunk) => (out += chunk))
    proc.stderr?.on("data", (chunk) => (err += chunk))
    const code = await new Promise<number>((resolve, reject) => {
      proc.on("error", () => reject(new VoiceError(`Could not run ${path.basename(bin)}.`)))
      proc.on("close", (value) => resolve(value ?? 1))
    })
    // -np silences whisper's progress prints, so a failure often leaves stderr
    // empty; fall back to stdout before giving up on saying why.
    if (code !== 0) throw new VoiceError(`${(err.trim() || out.trim()).split("\n").pop() || "Transcription failed"} (${path.basename(bin)} exit ${code}).`)
    return cleanTranscript(out)
  } finally {
    await fs.rm(wav, { force: true }).catch(() => {})
  }
}

/** Stop the warm recorder host. Safe to call when dictation was never used. */
export function shutdown() {
  mciHost?.send("EXIT")
  mciHost = undefined
  meterProc?.kill()
  meterProc = undefined
  meterLevel = 0
}
