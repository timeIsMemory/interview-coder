// Batch generation engine for tailored CVs and interview Q&A. Owns the run/step
// lifecycle, cost estimation, pause/cancel, fact-constraint checking, matching,
// artifact persistence and revision history.
//
// Reproducibility contract: every run records profileVersion + per-job
// jobVersion + templateVersion + promptVersion + model, and the idempotency
// key is derived from exactly that tuple. Identical requests resume the
// existing run instead of re-billing completed steps.

import { getDatabase } from "../../core/db/Database"
import { aiGateway } from "../../core/ai/AiGateway"
import { ControlToken, createLimiter, isCancellationError } from "../../core/concurrency"
import { estimateBatch, estimateTokens } from "../../core/ai/cost"
import { profileService } from "../profile/ProfileService"
import { checkFactSupport, type FactCorpusEntry } from "../profile/factConstraint"
import { jobService } from "../jobs/JobService"
import { htmlToText } from "../jobs/normalize"
import { sanitizeHtml } from "../../core/security/sanitizeHtml"
import { sha256 } from "../../core/ids"
import { matchJobToCorpus, clusterJobs } from "./matching"
import {
  buildAnswersPrompt,
  buildCvPrompt,
  buildQuestionsPrompt,
  PROMPT_VERSION
} from "./prompts"
import type {
  Artifact,
  ArtifactRevision,
  GenerationRun,
  GenerationStep,
  PreparedAnswer,
  QuestionSet,
  RunStatus
} from "./types"
import type { Fact, ResumeTemplate } from "../profile/types"
import type { NormalizedJob } from "../jobs/types"

const nowIso = () => new Date().toISOString()

export interface ProgressPayload {
  runId: string
  status: RunStatus
  completedSteps: number
  totalSteps: number
  actualCostUsd: number
  lastJobId?: string
  lastOutcome?: "done" | "failed"
}

/** What a per-job worker must produce for its step to be marked done. */
type StepWorker = (job: NormalizedJob) => Promise<{ artifactId: string; costUsd: number }>

export class GenerationService {
  private tokens = new Map<string, ControlToken>()
  onProgress?: (payload: ProgressPayload) => void

  private runs() {
    return getDatabase().table<GenerationRun>("generation_runs")
  }
  private steps() {
    return getDatabase().table<GenerationStep>("generation_steps")
  }
  private artifacts() {
    return getDatabase().table<Artifact>("artifacts")
  }
  private revisions() {
    return getDatabase().table<ArtifactRevision>("artifact_revisions")
  }
  private questionSets() {
    return getDatabase().table<QuestionSet>("question_sets")
  }

  private modelForGeneration(): string {
    try {
      const { configHelper } =
        require("../../ConfigHelper") as typeof import("../../ConfigHelper")
      const config = configHelper.loadConfig()
      return config.generationModel || config.solutionModel || "gpt-4o"
    } catch {
      // Config is unavailable outside the Electron runtime (unit tests).
      return "gpt-4o"
    }
  }

  private confirmedFacts(): Fact[] {
    return profileService.listFacts().filter((f) => f.confirmed)
  }

  /** Facts backing a run: the frozen snapshot for its profileVersion when one
   * exists, so resuming reproduces the original inputs even after edits. */
  private factsForRun(run: GenerationRun): Fact[] {
    const snapshot = profileService.getVersion(run.profileVersion)
    if (snapshot) return snapshot.snapshot.facts.filter((f) => f.confirmed)
    return this.confirmedFacts()
  }

  private corpusFor(facts: Fact[]): FactCorpusEntry[] {
    return facts.map((f) => ({ id: f.id, text: `${f.label}. ${f.detail}` }))
  }

  /** Pre-run cost estimate the UI shows before the user commits. */
  estimate(kind: "cv-batch" | "qa-batch", jobIds: string[]) {
    const model = this.modelForGeneration()
    const facts = this.confirmedFacts()
    const factTokens = estimateTokens(facts.map((f) => f.detail).join(" "))
    const jobs = jobService.getJobsByIds(jobIds)
    const avgJdTokens =
      jobs.length === 0
        ? 0
        : jobs.reduce((s, j) => s + estimateTokens(j.description), 0) / jobs.length

    if (kind === "cv-batch") {
      return estimateBatch({
        model,
        calls: jobIds.length,
        inputTokensPerCall: Math.ceil(factTokens + avgJdTokens + 400),
        outputTokensPerCall: 1200
      })
    }
    // QA: one call for questions + one for answers per (clustered) job. Assume
    // ~30% dedup via clustering.
    const effectiveJobs = Math.max(1, Math.ceil(jobIds.length * 0.7))
    return estimateBatch({
      model,
      calls: effectiveJobs * 2,
      inputTokensPerCall: Math.ceil(factTokens + avgJdTokens + 300),
      outputTokensPerCall: 1500
    })
  }

  /** Current job_versions version per job; 0 for jobs without history. */
  private jobVersionsFor(jobIds: string[]): Record<string, number> {
    const versions: Record<string, number> = {}
    for (const id of jobIds) {
      versions[id] = jobService.listVersions(id)[0]?.version ?? 0
    }
    return versions
  }

  /** The full reproducibility tuple hashed into the idempotency key. */
  private idempotencyKeyFor(
    kind: "cv-batch" | "qa-batch",
    profileVersion: number,
    jobVersions: Record<string, number>,
    template: ResumeTemplate | undefined,
    model: string
  ): string {
    const jobs = Object.keys(jobVersions)
      .sort()
      .map((id) => ({ id, version: jobVersions[id] }))
    return sha256(
      JSON.stringify({
        kind,
        profileVersion,
        jobs,
        templateId: template?.id ?? null,
        templateVersion: template?.version ?? null,
        model,
        promptVersion: PROMPT_VERSION
      })
    )
  }

  private findRunByKey(key: string): GenerationRun | null {
    const matches = this.runs().find({
      where: (r) => r.idempotencyKey === key,
      sort: (a, b) => b.startedAt.localeCompare(a.startedAt)
    })
    return matches[0] || null
  }

  private createRun(
    kind: "cv-batch" | "qa-batch",
    jobIds: string[],
    concurrency: number,
    idempotencyKey: string,
    jobVersions: Record<string, number>,
    template?: ResumeTemplate
  ): GenerationRun {
    const est = this.estimate(kind, jobIds)
    const profile = profileService.getOrCreateDefaultProfile()
    const run = this.runs().insert({
      kind,
      profileVersion: profile.currentVersion || 0,
      jobIds,
      jobVersions,
      templateId: template?.id,
      templateVersion: template?.version,
      model: this.modelForGeneration(),
      promptVersion: PROMPT_VERSION,
      status: "running",
      concurrency,
      totalSteps: jobIds.length,
      completedSteps: 0,
      estimatedCostUsd: est.estimatedCostUsd,
      actualCostUsd: 0,
      startedAt: nowIso(),
      idempotencyKey
    })
    for (const jobId of jobIds) {
      this.steps().insert({
        runId: run.id,
        jobId,
        status: "pending",
        updatedAt: nowIso()
      })
    }
    return run
  }

  /** Convert runs interrupted by process termination into an explicit,
   * recoverable state. No work is silently repeated (and billed) on boot;
   * the user resumes via retryFailed/resumeRun which skip completed steps. */
  recoverInterruptedRuns(): number {
    const interrupted = this.runs().find({ where: (run) => run.status === "running" || run.status === "paused" })
    for (const run of interrupted) {
      this.runs().update(run.id, {
        status: "failed",
        recoverable: true,
        error: "应用在任务执行期间退出，可继续未完成项。",
        finishedAt: nowIso()
      })
      for (const step of this.getSteps(run.id)) {
        if (step.status === "running") this.steps().update(step.id, { status: "failed", error: "任务被应用重启中断", updatedAt: nowIso() })
      }
    }
    if (interrupted.length) getDatabase().flush()
    return interrupted.length
  }

  /**
   * Continue a run in place: only steps that are not `done` are re-executed,
   * so completed work is never repeated or re-billed. Pass `onlyJobIds` to
   * re-run a subset (single-item retry).
   */
  async resumeRun(runId: string, onlyJobIds?: string[]): Promise<GenerationRun> {
    const run = this.getRun(runId)
    if (!run) throw new Error("Generation run not found")
    if (this.tokens.has(runId)) throw new Error("任务仍在执行中")

    const steps = this.getSteps(runId)
    const targets = steps.filter(
      (s) => s.status !== "done" && (!onlyJobIds || onlyJobIds.includes(s.jobId))
    )
    if (!targets.length) {
      const done = steps.filter((s) => s.status === "done").length
      const updated = this.runs().update(runId, {
        status: "completed",
        completedSteps: done,
        recoverable: false,
        error: undefined,
        finishedAt: run.finishedAt || nowIso()
      }) as GenerationRun
      getDatabase().flush()
      return updated
    }

    for (const step of targets) {
      this.steps().update(step.id, { status: "pending", error: undefined, updatedAt: nowIso() })
    }
    const resumed = this.runs().update(runId, {
      status: "running",
      completedSteps: run.totalSteps - targets.length,
      error: undefined,
      finishedAt: undefined,
      recoverable: false
    }) as GenerationRun

    const facts = this.factsForRun(resumed)
    const jobs = jobService.getJobsByIds(targets.map((t) => t.jobId))
    if (resumed.kind === "cv-batch") {
      const templates = profileService.listTemplates()
      const template =
        templates.find((t) => t.id === resumed.templateId) || templates[0]
      this.dispatch(resumed, jobs, this.cvWorker(resumed, template, facts))
    } else {
      const clusters = clusterJobs(jobs.map((j) => ({ id: j.id, text: j.description })))
      this.dispatch(resumed, jobs, this.qaWorker(resumed, facts, clusters, new Map()))
    }
    this.emit(resumed)
    return resumed
  }

  /** Re-run failed/skipped/pending items of an existing run, in the same run. */
  async retryFailed(runId: string, jobId?: string): Promise<GenerationRun> {
    const run = this.getRun(runId)
    if (!run) throw new Error("Generation run not found")
    const retryIds = this.getSteps(runId)
      .filter((step) => (!jobId || step.jobId === jobId) && ["failed", "skipped", "pending"].includes(step.status))
      .map((step) => step.jobId)
    if (!retryIds.length) throw new Error("没有可重试的任务项")
    return this.resumeRun(runId, retryIds)
  }

  private emit(run: GenerationRun, lastJobId?: string, lastOutcome?: "done" | "failed") {
    this.onProgress?.({
      runId: run.id,
      status: run.status,
      completedSteps: run.completedSteps,
      totalSteps: run.totalSteps,
      actualCostUsd: run.actualCostUsd,
      lastJobId,
      lastOutcome
    })
  }

  private finalize(runId: string): GenerationRun {
    const token = this.tokens.get(runId)
    let status: RunStatus = "completed"
    if (token?.isCancelled) status = "cancelled"
    const unfinished = this.getSteps(runId).some((s) => s.status !== "done")
    const updated = this.runs().update(runId, {
      status,
      recoverable: unfinished,
      finishedAt: nowIso()
    }) as GenerationRun
    this.tokens.delete(runId)
    getDatabase().flush()
    this.emit(updated)
    return updated
  }

  private bumpProgress(run: GenerationRun, costDelta: number): GenerationRun {
    const fresh = this.runs().get(run.id) as GenerationRun
    return this.runs().update(run.id, {
      completedSteps: fresh.completedSteps + 1,
      actualCostUsd: Math.round((fresh.actualCostUsd + costDelta) * 1e6) / 1e6
    }) as GenerationRun
  }

  controlRun(runId: string, action: "pause" | "resume" | "cancel"): boolean {
    const token = this.tokens.get(runId)
    if (!token) return false
    if (action === "pause") {
      token.pause()
      this.runs().update(runId, { status: "paused" })
    } else if (action === "resume") {
      token.resume()
      this.runs().update(runId, { status: "running" })
    } else {
      token.cancel()
      this.runs().update(runId, { status: "cancelled" })
    }
    return true
  }

  /**
   * Shared step executor. Skips steps already `done` (resume path), honors
   * pause/cancel, records per-step cost and finalizes the run when all
   * scheduled steps settle.
   */
  private dispatch(run: GenerationRun, jobs: NormalizedJob[], worker: StepWorker): void {
    const token = new ControlToken()
    this.tokens.set(run.id, token)
    const limiter = createLimiter(run.concurrency)

    void (async () => {
      const tasks = jobs.map((job) =>
        limiter(async () => {
          const step = this.steps().findOne(
            (s) => s.runId === run.id && s.jobId === job.id
          )
          // Never redo (and re-bill) a completed step.
          if (!step || step.status === "done") return
          try {
            token.throwIfCancelled()
            await token.waitWhilePaused()
            token.throwIfCancelled()
            this.steps().update(step.id, { status: "running", updatedAt: nowIso() })

            const { artifactId, costUsd } = await worker(job)

            this.steps().update(step.id, {
              status: "done",
              artifactId,
              costUsd,
              updatedAt: nowIso()
            })
            const updated = this.bumpProgress(run, costUsd)
            this.emit(updated, job.id, "done")
          } catch (err) {
            if (isCancellationError(err)) {
              this.steps().update(step.id, { status: "skipped", updatedAt: nowIso() })
              return
            }
            this.steps().update(step.id, {
              status: "failed",
              error: (err as Error).message,
              updatedAt: nowIso()
            })
            const updated = this.bumpProgress(run, 0)
            this.emit(updated, job.id, "failed")
          }
        })
      )
      await Promise.allSettled(tasks)
      this.finalize(run.id)
    })()
  }

  private cvWorker(
    run: GenerationRun,
    template: ResumeTemplate,
    facts: Fact[]
  ): StepWorker {
    const corpus = this.corpusFor(facts)
    return async (job) => {
      const prompt = buildCvPrompt(job, facts, template.sections, template.language)
      const res = await aiGateway.completeJson<{ html?: string; summary?: string }>(
        [{ role: "user", text: prompt }],
        { purpose: "generation" }
      )
      // Model output is untrusted: it is rendered as HTML in the renderer and
      // loaded into a window for PDF export, so strip anything executable.
      const html = sanitizeHtml(String(res.data.html || ""))
      const summary = String(res.data.summary || "")
      const plain = `${summary}\n${htmlToText(html)}`
      const factCheck = checkFactSupport(plain, corpus)
      const match = matchJobToCorpus(job.description, corpus.map((c) => c.text).join(" "))

      const artifact = this.artifacts().insert({
        kind: "cv",
        jobId: job.id,
        runId: run.id,
        profileVersion: run.profileVersion,
        templateId: template.id,
        content: html,
        match,
        factCheck,
        approved: false,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
      this.revisions().insert({
        artifactId: artifact.id,
        content: html,
        editedBy: "ai",
        createdAt: nowIso()
      })
      return { artifactId: artifact.id, costUsd: res.usage.estimatedCostUsd }
    }
  }

  private qaWorker(
    run: GenerationRun,
    facts: Fact[],
    clusters: string[][],
    clusterQuestions: Map<string, Array<{ question: string; category: string }>>
  ): StepWorker {
    return async (job) => {
      const clusterKey = clusters.find((c) => c.includes(job.id))?.[0] || job.id
      let questions = clusterQuestions.get(clusterKey)
      let cost = 0
      if (!questions) {
        const qRes = await aiGateway.completeJson<{
          questions?: Array<{ question: string; category: string }>
        }>(
          [{ role: "user", text: buildQuestionsPrompt(job) }],
          { purpose: "generation" }
        )
        questions = (qRes.data.questions || []).slice(0, 18)
        clusterQuestions.set(clusterKey, questions)
        cost += qRes.usage.estimatedCostUsd
      }
      const resolvedQuestions = questions ?? []
      const aRes = await aiGateway.completeJson<{ answers?: PreparedAnswer[] }>(
        [{ role: "user", text: buildAnswersPrompt(resolvedQuestions, facts) }],
        { purpose: "generation" }
      )
      cost += aRes.usage.estimatedCostUsd
      const answers: PreparedAnswer[] = aRes.data.answers || []

      this.questionSets().insert({
        jobId: job.id,
        profileVersion: run.profileVersion,
        answers,
        createdAt: nowIso()
      })
      const artifact = this.artifacts().insert({
        kind: "qa",
        jobId: job.id,
        runId: run.id,
        profileVersion: run.profileVersion,
        content: JSON.stringify(answers),
        approved: false,
        createdAt: nowIso(),
        updatedAt: nowIso()
      })
      return { artifactId: artifact.id, costUsd: cost }
    }
  }

  async generateCvBatch(
    jobIds: string[],
    options: { templateId?: string; concurrency?: number } = {}
  ): Promise<GenerationRun> {
    const concurrency = Math.max(1, Math.min(5, options.concurrency ?? 3))
    const templates = profileService.listTemplates()
    const template = templates.find((t) => t.id === options.templateId) || templates[0]
    const profile = profileService.getOrCreateDefaultProfile()
    const jobVersions = this.jobVersionsFor(jobIds)
    const key = this.idempotencyKeyFor(
      "cv-batch",
      profile.currentVersion || 0,
      jobVersions,
      template,
      this.modelForGeneration()
    )

    // Identical request → reuse the existing run instead of paying again.
    const existing = this.findRunByKey(key)
    if (existing) {
      if (this.tokens.has(existing.id)) return existing
      return this.resumeRun(existing.id)
    }

    const run = this.createRun("cv-batch", jobIds, concurrency, key, jobVersions, template)
    const facts = this.factsForRun(run)
    const jobs = jobService.getJobsByIds(jobIds)
    this.dispatch(run, jobs, this.cvWorker(run, template, facts))
    return run
  }

  async generateQaBatch(
    jobIds: string[],
    options: { concurrency?: number } = {}
  ): Promise<GenerationRun> {
    const concurrency = Math.max(1, Math.min(5, options.concurrency ?? 3))
    const profile = profileService.getOrCreateDefaultProfile()
    const jobVersions = this.jobVersionsFor(jobIds)
    const key = this.idempotencyKeyFor(
      "qa-batch",
      profile.currentVersion || 0,
      jobVersions,
      undefined,
      this.modelForGeneration()
    )

    const existing = this.findRunByKey(key)
    if (existing) {
      if (this.tokens.has(existing.id)) return existing
      return this.resumeRun(existing.id)
    }

    const run = this.createRun("qa-batch", jobIds, concurrency, key, jobVersions)
    const facts = this.factsForRun(run)
    const jobs = jobService.getJobsByIds(jobIds)

    // Cluster near-duplicate JDs so we generate one question bank per cluster
    // and reuse it, then tailor answers per job.
    const clusters = clusterJobs(jobs.map((j) => ({ id: j.id, text: j.description })))
    this.dispatch(run, jobs, this.qaWorker(run, facts, clusters, new Map()))
    return run
  }

  listRuns(): GenerationRun[] {
    return this.runs().find({ sort: (a, b) => b.startedAt.localeCompare(a.startedAt), limit: 50 })
  }

  getRun(runId: string): GenerationRun | null {
    return this.runs().get(runId)
  }

  getSteps(runId: string): GenerationStep[] {
    return this.steps().find({ where: (s) => s.runId === runId })
  }

  listArtifacts(filter?: { kind?: Artifact["kind"]; jobId?: string }): Artifact[] {
    return this.artifacts().find({
      where: (a) => {
        if (filter?.kind && a.kind !== filter.kind) return false
        if (filter?.jobId && a.jobId !== filter.jobId) return false
        return true
      },
      sort: (a, b) => b.createdAt.localeCompare(a.createdAt)
    })
  }

  getArtifact(id: string): Artifact | null {
    return this.artifacts().get(id)
  }

  /** User edit: store a revision and re-run the fact check. */
  updateArtifact(id: string, content: string): Artifact | null {
    const artifact = this.artifacts().get(id)
    if (!artifact) return null
    const safeContent = artifact.kind === "cv" ? sanitizeHtml(content) : content
    this.revisions().insert({
      artifactId: id,
      content: safeContent,
      editedBy: "user",
      createdAt: nowIso()
    })
    let factCheck = artifact.factCheck
    if (artifact.kind === "cv") {
      const corpus = profileService.getFactCorpus()
      factCheck = checkFactSupport(htmlToText(safeContent), corpus)
    }
    return this.artifacts().update(id, {
      content: safeContent,
      factCheck,
      approved: false,
      updatedAt: nowIso()
    })
  }

  /** Approval is blocked while the fact check has unresolved issues. */
  approveArtifact(id: string): { ok: boolean; reason?: string; artifact?: Artifact } {
    const artifact = this.artifacts().get(id)
    if (!artifact) return { ok: false, reason: "not-found" }
    if (artifact.factCheck && !artifact.factCheck.supported) {
      return {
        ok: false,
        reason: "unsupported-claims",
        artifact
      }
    }
    const updated = this.artifacts().update(id, { approved: true, updatedAt: nowIso() })
    getDatabase().flush()
    return { ok: true, artifact: updated as Artifact }
  }

  getRevisions(artifactId: string): ArtifactRevision[] {
    return this.revisions().find({
      where: (r) => r.artifactId === artifactId,
      sort: (a, b) => b.createdAt.localeCompare(a.createdAt)
    })
  }
}

export const generationService = new GenerationService()
