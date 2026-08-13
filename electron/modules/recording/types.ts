export type Speaker = "candidate" | "interviewer" | "unknown"

export interface TranscriptSegment {
  id: string
  sessionId: string
  /** Seconds from start. */
  start: number
  end: number
  speaker: Speaker
  text: string
}

export interface RecordingSession {
  id: string
  title: string
  jobId?: string
  profileVersion?: number
  mediaFileId?: string
  durationSec?: number
  createdAt: string
  transcribedAt?: string
  /** User acknowledged the consent/legal notice before recording/importing. */
  consentAcknowledged: boolean
}

export interface MediaFile {
  id: string
  sessionId: string
  /** Absolute path inside userData. */
  path: string
  mimeType: string
  sizeBytes: number
  createdAt: string
}

export interface ReviewMetric {
  key: string
  label: string
  score: number // 0..100
  detail: string
  /** Transcript time ranges (seconds) that justify the score. */
  evidence: Array<{ start: number; end: number; note: string }>
}

export interface ReviewReport {
  id: string
  sessionId: string
  overallScore: number
  metrics: ReviewMetric[]
  createdAt: string
}
