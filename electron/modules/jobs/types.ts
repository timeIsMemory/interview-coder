export type JobSourceType =
  | "paste"
  | "file"
  | "csv"
  | "json"
  | "extension"
  | "api"
  | "scraper"

export type JobPlatform =
  | "zhipin"
  | "lagou"
  | "liepin"
  | "51job"
  | "linkedin"
  | "unknown"

export type JobStatus = "new" | "saved" | "applied" | "interviewing" | "rejected" | "offer"

/** Raw payload handed from an adapter to the normalizer. */
export interface RawJobPayload {
  sourceType: JobSourceType
  platform?: JobPlatform
  /** Raw text or serialized HTML/JSON of the JD. */
  content: string
  /** Optional pre-parsed structured hints (from extension/API). */
  hints?: Partial<NormalizedJobFields>
  sourceRef?: string
  jobUrl?: string
}

export interface NormalizedJobFields {
  title: string
  company: string
  salary?: string
  city?: string
  description: string
  positionId?: string
  tags?: string[]
  jobUrl?: string
}

export interface NormalizedJob extends NormalizedJobFields {
  id: string
  platform: JobPlatform
  sourceType: JobSourceType
  sourceRef?: string
  contentHash: string
  status: JobStatus
  fetchedAt: string
  createdAt: string
  updatedAt: string
  /** If this was detected as a duplicate, points at the canonical job. */
  duplicateOfJobId?: string
  duplicateCandidate?: boolean
}

export interface JobVersion {
  id: string
  jobId: string
  version: number
  rawContent: string
  normalized: NormalizedJobFields
  sourceType: JobSourceType
  sourceRef?: string
  contentHash: string
  createdAt: string
}

export interface JobSource {
  id: string
  jobId: string
  sourceType: JobSourceType
  sourceRef?: string
  adapterVersion: string
  importedAt: string
}

export interface ImportRun {
  id: string
  sourceType: JobSourceType
  startedAt: string
  finishedAt?: string
  total: number
  succeeded: number
  failed: number
  duplicates: number
  errorSummary?: string
}

export type UpsertOutcome = "inserted" | "updated" | "duplicate"

export interface UpsertResult {
  job: NormalizedJob
  outcome: UpsertOutcome
}
