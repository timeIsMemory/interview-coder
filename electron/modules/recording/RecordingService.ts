// Recording review service. Manages sessions, imported media, transcription,
// editable transcript segments and evidence-based review reports.

import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { getDatabase } from "../../core/db/Database"
import { profileService } from "../profile/ProfileService"
import { jobService } from "../jobs/JobService"
import { buildReview } from "./review"
import {
  ManualTranscriptProvider,
  LocalWhisperCppProvider,
  OpenAiWhisperProvider,
  type RawSegment
} from "./TranscriptionProvider"
import type {
  MediaFile,
  RecordingSession,
  ReviewReport,
  Speaker,
  TranscriptSegment
} from "./types"

const nowIso = () => new Date().toISOString()

export class RecordingService {
  private sessions() {
    return getDatabase().table<RecordingSession>("recording_sessions")
  }
  private media() {
    return getDatabase().table<MediaFile>("media_files")
  }
  private segments() {
    return getDatabase().table<TranscriptSegment>("transcript_segments")
  }
  private reports() {
    return getDatabase().table<ReviewReport>("review_reports")
  }

  private mediaDir(): string {
    const dir = path.join(app.getPath("userData"), "recordings")
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    return dir
  }

  listSessions(): RecordingSession[] {
    return this.sessions().find({ sort: (a, b) => b.createdAt.localeCompare(a.createdAt) })
  }

  getSession(id: string): RecordingSession | null {
    return this.sessions().get(id)
  }

  createSession(input: { title: string; jobId?: string; consentAcknowledged: boolean }): RecordingSession {
    if (!input.consentAcknowledged) {
      throw new Error("录音复盘需要先确认合规与双方同意声明。")
    }
    const profile = profileService.getOrCreateDefaultProfile()
    return this.sessions().insert({
      title: input.title || "Untitled session",
      jobId: input.jobId,
      profileVersion: profile.currentVersion || 0,
      consentAcknowledged: true,
      createdAt: nowIso()
    })
  }

  /** Copy an imported media file into userData and attach to a session. */
  importMedia(sessionId: string, sourcePath: string): MediaFile {
    const session = this.getSession(sessionId)
    if (!session) throw new Error("Session not found")
    const ext = path.extname(sourcePath) || ".dat"
    const dest = path.join(this.mediaDir(), `${sessionId}${ext}`)
    fs.copyFileSync(sourcePath, dest)
    const stat = fs.statSync(dest)
    const mediaFile = this.media().insert({
      sessionId,
      path: dest,
      mimeType: this.mimeFor(ext),
      sizeBytes: stat.size,
      createdAt: nowIso()
    })
    this.sessions().update(sessionId, { mediaFileId: mediaFile.id })
    return mediaFile
  }

  private mimeFor(ext: string): string {
    const map: Record<string, string> = {
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".m4a": "audio/mp4",
      ".mp4": "video/mp4",
      ".webm": "audio/webm",
      ".ogg": "audio/ogg"
    }
    return map[ext.toLowerCase()] || "application/octet-stream"
  }

  private saveSegments(sessionId: string, raw: RawSegment[]): TranscriptSegment[] {
    this.segments().deleteWhere((s) => s.sessionId === sessionId)
    return raw.map((r) =>
      this.segments().insert({
        sessionId,
        start: r.start,
        end: r.end,
        speaker: r.speaker,
        text: r.text
      })
    )
  }

  /** Transcribe attached media via the cloud provider. */
  async transcribeSession(sessionId: string): Promise<TranscriptSegment[]> {
    const session = this.getSession(sessionId)
    if (!session?.mediaFileId) throw new Error("该会话没有可转写的音频文件。")
    const mediaFile = this.media().get(session.mediaFileId)
    if (!mediaFile) throw new Error("找不到音频文件。")
    const localProvider = new LocalWhisperCppProvider()
    const cloudProvider = new OpenAiWhisperProvider()
    const provider = localProvider.isAvailable() ? localProvider : cloudProvider
    if (!provider.isAvailable()) {
      throw new Error("未配置转写用 OpenAI Key。请改用手动导入文稿或在设置中填写 Key。")
    }
    const { segments, durationSec } = await provider.transcribe(mediaFile.path)
    const saved = this.saveSegments(sessionId, segments)
    this.sessions().update(sessionId, { transcribedAt: nowIso(), durationSec })
    getDatabase().flush()
    return saved
  }

  /** Import a manual transcript (paste) instead of transcribing audio. */
  async importTranscriptText(
    sessionId: string,
    text: string,
    totalSeconds = 0
  ): Promise<TranscriptSegment[]> {
    const provider = new ManualTranscriptProvider(text, totalSeconds)
    const { segments, durationSec } = await provider.transcribe()
    const saved = this.saveSegments(sessionId, segments)
    this.sessions().update(sessionId, { transcribedAt: nowIso(), durationSec })
    getDatabase().flush()
    return saved
  }

  getSegments(sessionId: string): TranscriptSegment[] {
    return this.segments().find({
      where: (s) => s.sessionId === sessionId,
      sort: (a, b) => a.start - b.start
    })
  }

  updateSegment(id: string, patch: { text?: string; speaker?: Speaker }): TranscriptSegment | null {
    return this.segments().update(id, patch)
  }

  /** Recompute the evidence-based review report from current segments. */
  buildReport(sessionId: string): ReviewReport {
    const session = this.getSession(sessionId)
    if (!session) throw new Error("Session not found")
    const segments = this.getSegments(sessionId)
    const jobText = session.jobId ? jobService.getJob(session.jobId)?.description : undefined
    const corpusText = profileService
      .getFactCorpus()
      .map((c) => c.text)
      .join(" ")
    const { overallScore, metrics } = buildReview(segments, { jobText, corpusText })
    this.reports().deleteWhere((r) => r.sessionId === sessionId)
    const report = this.reports().insert({
      sessionId,
      overallScore,
      metrics,
      createdAt: nowIso()
    })
    getDatabase().flush()
    return report
  }

  getReport(sessionId: string): ReviewReport | null {
    return this.reports().findOne((r) => r.sessionId === sessionId)
  }

  deleteSession(id: string): boolean {
    const session = this.getSession(id)
    if (session?.mediaFileId) {
      const mf = this.media().get(session.mediaFileId)
      if (mf && fs.existsSync(mf.path)) {
        try {
          fs.unlinkSync(mf.path)
        } catch {
          /* best-effort */
        }
      }
    }
    this.media().deleteWhere((m) => m.sessionId === id)
    this.segments().deleteWhere((s) => s.sessionId === id)
    this.reports().deleteWhere((r) => r.sessionId === id)
    return this.sessions().delete(id)
  }

  cleanupExpired(retentionDays: number): number {
    if (retentionDays < 1 || retentionDays > 3650) throw new Error("保留天数必须在 1 到 3650 之间")
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const expired = this.listSessions().filter((session) => new Date(session.createdAt).getTime() < cutoff)
    for (const session of expired) this.deleteSession(session.id)
    getDatabase().flush()
    return expired.length
  }
}

export const recordingService = new RecordingService()
