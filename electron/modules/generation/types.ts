import type { UnsupportedClaim } from "../profile/factConstraint"
import type { MatchResult } from "./matching"

export type ArtifactKind = "cv" | "qa" | "match-report"

export type RunStatus =
  | "pending"
  | "running"
  | "paused"
  | "completed"
  | "failed"
  | "cancelled"

export type StepStatus = "pending" | "running" | "done" | "failed" | "skipped"

export interface GenerationRun {
  id: string
  kind: "cv-batch" | "qa-batch"
  profileVersion: number
  jobIds: string[]
  /** jobId → job_versions version captured at run creation. Part of the
   * reproducibility chain profile+job+template+prompt+model. */
  jobVersions?: Record<string, number>
  /** Resume template used for cv-batch runs. */
  templateId?: string
  templateVersion?: number
  model: string
  promptVersion: string
  status: RunStatus
  concurrency: number
  totalSteps: number
  completedSteps: number
  estimatedCostUsd: number
  actualCostUsd: number
  startedAt: string
  finishedAt?: string
  error?: string
  idempotencyKey: string
  recoverable?: boolean
}

export interface GenerationStep {
  id: string
  runId: string
  jobId: string
  status: StepStatus
  artifactId?: string
  error?: string
  costUsd?: number
  updatedAt: string
}

export interface Artifact {
  id: string
  kind: ArtifactKind
  jobId: string
  runId?: string
  profileVersion: number
  templateId?: string
  /** Rendered content: HTML for CV, markdown/JSON for QA. */
  content: string
  /** Structured match info for CV artifacts. */
  match?: MatchResult
  /** Fact-constraint result; artifact is export-blocked while unresolved. */
  factCheck?: { supported: boolean; issues: UnsupportedClaim[] }
  approved: boolean
  createdAt: string
  updatedAt: string
}

export interface ArtifactRevision {
  id: string
  artifactId: string
  content: string
  editedBy: "ai" | "user"
  createdAt: string
}

export interface PreparedAnswer {
  question: string
  category: "behavioral" | "technical" | "role-specific"
  shortAnswer: string
  detailedAnswer: string
  starPoints?: string[]
  followUps?: string[]
}

export interface QuestionSet {
  id: string
  jobId: string
  profileVersion: number
  answers: PreparedAnswer[]
  createdAt: string
}
