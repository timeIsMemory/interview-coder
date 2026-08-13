// Transcription provider abstraction. v1 ships a cloud Whisper-style provider
// (OpenAI) and a manual/paste provider. A local whisper.cpp provider can be
// added later behind the same interface without touching the service.

import fs from "node:fs"
import { OpenAI } from "openai"
import { configHelper } from "../../ConfigHelper"
import type { Speaker } from "./types"
import { spawn } from "node:child_process"
import path from "node:path"
import os from "node:os"

export interface RawSegment {
  start: number
  end: number
  speaker: Speaker
  text: string
}

export interface TranscriptionProvider {
  readonly id: string
  isAvailable(): boolean
  transcribe(filePath: string): Promise<{ segments: RawSegment[]; durationSec: number }>
}

/** Resolve an OpenAI key usable for transcription, if any. */
function openAiKey(): string | null {
  const config = configHelper.loadConfig()
  if (config.transcriptionApiKey) return config.transcriptionApiKey
  if (config.apiProvider === "openai" && config.apiKey) return config.apiKey
  return null
}

export class OpenAiWhisperProvider implements TranscriptionProvider {
  readonly id = "openai-whisper"

  isAvailable(): boolean {
    return !!openAiKey()
  }

  async transcribe(filePath: string): Promise<{ segments: RawSegment[]; durationSec: number }> {
    const key = openAiKey()
    if (!key) {
      throw new Error(
        "语音转写需要 OpenAI API Key。请在设置中填写转写用 Key，或改用手动导入文稿。"
      )
    }
    const client = new OpenAI({ apiKey: key, timeout: 120000, maxRetries: 1 })
    // verbose_json responses carry segment timings which the SDK's base
    // Transcription type does not model.
    const resp = (await client.audio.transcriptions.create({
      file: fs.createReadStream(filePath),
      model: "whisper-1",
      response_format: "verbose_json"
    })) as unknown as {
      segments?: Array<{ start?: number; end?: number; text?: string }>
      duration?: number
      text?: string
    }
    const rawSegs = resp.segments || []
    const segments: RawSegment[] = rawSegs.length
      ? rawSegs.map((s) => ({
          start: Number(s.start) || 0,
          end: Number(s.end) || 0,
          speaker: "candidate" as Speaker,
          text: String(s.text || "").trim()
        }))
      : [{ start: 0, end: Number(resp.duration) || 0, speaker: "candidate", text: resp.text || "" }]
    return { segments, durationSec: Number(resp.duration) || segments[segments.length - 1]?.end || 0 }
  }
}

export class LocalWhisperCppProvider implements TranscriptionProvider {
  readonly id = "whisper.cpp"

  private config(): { executable?: string; model?: string } {
    const config = configHelper.loadConfig()
    return { executable: config.whisperExecutable, model: config.whisperModelPath }
  }

  isAvailable(): boolean {
    const { executable, model } = this.config()
    return !!executable && !!model && fs.existsSync(executable) && fs.existsSync(model)
  }

  async transcribe(filePath: string): Promise<{ segments: RawSegment[]; durationSec: number }> {
    const { executable, model } = this.config()
    if (!executable || !model || !this.isAvailable()) throw new Error("本地 whisper.cpp 尚未配置")
    const outputBase = path.join(os.tmpdir(), `whisper-${Date.now()}`)
    await new Promise<void>((resolve, reject) => {
      const child = spawn(executable, ["-m", model, "-f", filePath, "-oj", "-of", outputBase], {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe"]
      })
      let stderr = ""
      child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
      child.on("error", reject)
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(stderr || `whisper.cpp exited with ${code}`)))
    })
    const jsonPath = `${outputBase}.json`
    try {
      const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf8")) as {
        transcription?: Array<{ offsets?: { from?: number; to?: number }; text?: string }>
      }
      const source = Array.isArray(parsed.transcription) ? parsed.transcription : []
      const segments = source.map((item) => ({
        start: Number(item.offsets?.from || 0) / 1000,
        end: Number(item.offsets?.to || 0) / 1000,
        speaker: "candidate" as Speaker,
        text: String(item.text || "").trim()
      }))
      return { segments, durationSec: segments.at(-1)?.end || 0 }
    } finally {
      fs.rmSync(jsonPath, { force: true })
    }
  }
}

/**
 * Manual provider: the user pastes a transcript. We split into pseudo-segments
 * by line, distributing time evenly so the timeline UI still works. Speaker
 * labels can be inferred from "面试官:" / "我:" style prefixes.
 */
export class ManualTranscriptProvider implements TranscriptionProvider {
  readonly id = "manual"
  private text: string
  private totalSeconds: number

  constructor(text: string, totalSeconds = 0) {
    this.text = text
    this.totalSeconds = totalSeconds
  }

  isAvailable(): boolean {
    return this.text.trim().length > 0
  }

  async transcribe(): Promise<{ segments: RawSegment[]; durationSec: number }> {
    const lines = this.text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
    const total = this.totalSeconds || lines.length * 8
    const per = lines.length ? total / lines.length : 0
    const segments: RawSegment[] = lines.map((line, i) => {
      let speaker: Speaker = "candidate"
      let text = line
      const m = line.match(/^(面试官|interviewer|hr)\s*[:：]\s*(.*)$/i)
      const c = line.match(/^(我|candidate|me)\s*[:：]\s*(.*)$/i)
      if (m) {
        speaker = "interviewer"
        text = m[2]
      } else if (c) {
        speaker = "candidate"
        text = c[2]
      }
      return { start: Math.round(i * per), end: Math.round((i + 1) * per), speaker, text }
    })
    return { segments, durationSec: total }
  }
}
