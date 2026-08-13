// Job repository + import orchestration. Turns adapter payloads into normalized,
// deduplicated, traceable jobs in the local database.

import { getDatabase } from "../../core/db/Database"
import { aiGateway } from "../../core/ai/AiGateway"
import { runAdapter, ADAPTER_VERSION, type JobImportInput } from "./adapters"
import {
  contentHash,
  normalizeFields,
  strongKey,
  weakKey
} from "./normalize"
import type {
  ImportRun,
  JobPlatform,
  JobSource,
  JobVersion,
  JobStatus,
  NormalizedJob,
  NormalizedJobFields,
  RawJobPayload,
  UpsertResult
} from "./types"

const nowIso = () => new Date().toISOString()

export interface ImportOptions {
  /** Use the LLM to clean up title/company/city for messy pastes. */
  enrichWithAi?: boolean
}

export interface ImportSummary {
  run: ImportRun
  results: UpsertResult[]
  errors: string[]
}

export class JobService {
  private jobs() {
    return getDatabase().table<NormalizedJob>("jobs")
  }
  private sources() {
    return getDatabase().table<JobSource>("job_sources")
  }
  private runs() {
    return getDatabase().table<ImportRun>("import_runs")
  }
  private versions() {
    return getDatabase().table<JobVersion>("job_versions")
  }

  listJobs(filter?: { status?: JobStatus; search?: string }): NormalizedJob[] {
    const search = filter?.search?.trim().toLowerCase()
    return this.jobs().find({
      where: (j) => {
        if (j.duplicateOfJobId) return false
        if (filter?.status && j.status !== filter.status) return false
        if (search) {
          const hay = `${j.title} ${j.company} ${j.city || ""} ${j.description}`.toLowerCase()
          if (!hay.includes(search)) return false
        }
        return true
      },
      sort: (a, b) => b.createdAt.localeCompare(a.createdAt)
    })
  }

  getJob(id: string): NormalizedJob | null {
    return this.jobs().get(id)
  }

  getJobsByIds(ids: string[]): NormalizedJob[] {
    const set = new Set(ids)
    return this.jobs().find({ where: (j) => set.has(j.id) })
  }

  updateStatus(id: string, status: JobStatus): NormalizedJob | null {
    const updated = this.jobs().update(id, { status, updatedAt: nowIso() })
    if (updated) {
      const { applicationService } = require("../applications/ApplicationService")
      applicationService.syncStatus(id, status)
    }
    return updated
  }

  deleteJob(id: string): boolean {
    this.sources().deleteWhere((s) => s.jobId === id)
    this.versions().deleteWhere((v) => v.jobId === id)
    return this.jobs().delete(id)
  }

  listVersions(jobId: string): JobVersion[] {
    return this.versions().find({
      where: (v) => v.jobId === jobId,
      sort: (a, b) => b.version - a.version
    })
  }

  confirmDuplicate(id: string, keepSeparate: boolean): NormalizedJob | null {
    const job = this.jobs().get(id)
    if (!job?.duplicateCandidate) return job
    if (keepSeparate) return this.jobs().update(id, { duplicateCandidate: false, duplicateOfJobId: undefined })
    const canonical = job.duplicateOfJobId
    this.deleteJob(id)
    return canonical ? this.jobs().get(canonical) : null
  }

  private findExisting(
    platform: JobPlatform,
    fields: NormalizedJobFields,
    hash: string
  ): { job: NormalizedJob; kind: "strong" | "content" | "weak" } | null {
    const sKey = strongKey(platform, fields.positionId)
    if (sKey) {
      const match = this.jobs().findOne(
        (j) => strongKey(j.platform, j.positionId) === sKey
      )
      if (match) return { job: match, kind: "strong" }
    }
    const byHash = this.jobs().findOne((j) => j.contentHash === hash)
    if (byHash) return { job: byHash, kind: "content" }
    const wKey = weakKey(fields)
    const byWeak = this.jobs().findOne((j) => weakKey(j) === wKey)
    if (byWeak) return { job: byWeak, kind: "weak" }
    return null
  }

  private upsertPayload(raw: RawJobPayload): UpsertResult {
    const fields = normalizeFields(raw)
    const platform = raw.platform || "unknown"
    const hash = contentHash(fields)
    const existing = this.findExisting(platform, fields, hash)
    const ts = nowIso()

    if (existing) {
      const { job, kind } = existing
      if (kind === "strong") {
        // Same posting: refresh description/fields, keep original fetchedAt.
        const updated = this.jobs().update(job.id, {
          ...fields,
          platform,
          contentHash: hash,
          updatedAt: ts
        }) as NormalizedJob
        this.recordSource(updated.id, raw)
        this.recordVersion(updated, raw)
        return { job: updated, outcome: "updated" }
      }
      if (kind === "weak") {
        const candidate = this.jobs().insert({
          platform,
          sourceType: raw.sourceType,
          sourceRef: raw.sourceRef,
          contentHash: hash,
          status: "new",
          fetchedAt: ts,
          createdAt: ts,
          updatedAt: ts,
          duplicateCandidate: true,
          duplicateOfJobId: job.id,
          ...fields
        })
        this.recordSource(candidate.id, raw)
        this.recordVersion(candidate, raw)
        return { job: candidate, outcome: "duplicate" }
      }
      this.recordSource(job.id, raw)
      return { job, outcome: "duplicate" }
    }

    const job = this.jobs().insert({
      platform,
      sourceType: raw.sourceType,
      sourceRef: raw.sourceRef,
      contentHash: hash,
      status: "new",
      fetchedAt: ts,
      createdAt: ts,
      updatedAt: ts,
      ...fields
    })
    this.recordSource(job.id, raw)
    this.recordVersion(job, raw)
    return { job, outcome: "inserted" }
  }

  private recordVersion(job: NormalizedJob, raw: RawJobPayload): void {
    const previous = this.listVersions(job.id)[0]
    this.versions().insert({
      jobId: job.id,
      version: (previous?.version || 0) + 1,
      rawContent: raw.content,
      normalized: {
        title: job.title,
        company: job.company,
        salary: job.salary,
        city: job.city,
        description: job.description,
        positionId: job.positionId,
        tags: job.tags,
        jobUrl: job.jobUrl
      },
      sourceType: raw.sourceType,
      sourceRef: raw.sourceRef,
      contentHash: job.contentHash,
      createdAt: nowIso()
    })
  }

  private recordSource(jobId: string, raw: RawJobPayload): void {
    this.sources().insert({
      jobId,
      sourceType: raw.sourceType,
      sourceRef: raw.sourceRef,
      adapterVersion: ADAPTER_VERSION,
      importedAt: nowIso()
    })
  }

  private async enrich(raw: RawJobPayload): Promise<RawJobPayload> {
    try {
      const prompt = `Extract JD fields as JSON only:
{"title":"","company":"","salary":"","city":"","description":"cleaned full JD text"}
Only use info present in the text; leave a field empty if unknown.

JD:
${raw.content.slice(0, 12000)}`
      const res = await aiGateway.completeJson<{
        title?: string
        company?: string
        salary?: string
        city?: string
        description?: string
      }>([{ role: "user", text: prompt }], {
        purpose: "extraction",
        temperature: 0
      })
      return {
        ...raw,
        hints: {
          ...raw.hints,
          title: res.data.title || raw.hints?.title,
          company: res.data.company || raw.hints?.company,
          salary: res.data.salary || raw.hints?.salary,
          city: res.data.city || raw.hints?.city,
          description: res.data.description || raw.hints?.description
        }
      }
    } catch {
      // Enrichment is best-effort; fall back to deterministic normalization.
      return raw
    }
  }

  async importJobs(input: JobImportInput, options: ImportOptions = {}): Promise<ImportSummary> {
    const started = nowIso()
    const errors: string[] = []
    let payloads: RawJobPayload[] = []
    try {
      payloads = await runAdapter(input)
    } catch (err) {
      errors.push((err as Error).message)
    }

    const results: UpsertResult[] = []
    for (let raw of payloads) {
      try {
        if (options.enrichWithAi) raw = await this.enrich(raw)
        results.push(this.upsertPayload(raw))
      } catch (err) {
        errors.push((err as Error).message)
      }
    }

    const run = this.runs().insert({
      sourceType: input.sourceType,
      startedAt: started,
      finishedAt: nowIso(),
      total: payloads.length,
      succeeded: results.filter((r) => r.outcome !== "duplicate").length,
      failed: errors.length,
      duplicates: results.filter((r) => r.outcome === "duplicate").length,
      errorSummary: errors.slice(0, 5).join("; ") || undefined
    })

    getDatabase().flush()
    return { run, results, errors }
  }

  listImportRuns(): ImportRun[] {
    return this.runs().find({ sort: (a, b) => b.startedAt.localeCompare(a.startedAt), limit: 50 })
  }
}

export const jobService = new JobService()
