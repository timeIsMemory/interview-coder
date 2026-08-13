// Integration tests for the batch generation engine: version-chain idempotency
// (profile + job + template + prompt + model), in-run resume without double
// billing, and pause/cancel/retry fault injection.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("electron", () => ({
  app: {
    getPath: () => path.join(os.tmpdir(), "assistant-gen-test-config")
  }
}))

const completeJson = vi.fn()
vi.mock("../electron/core/ai/AiGateway", () => ({
  aiGateway: {
    completeJson: (...args: unknown[]) => completeJson(...args),
    complete: vi.fn(),
    completeText: vi.fn(),
    isConfigured: () => true,
    getProvider: () => "gemini"
  }
}))

import { initDatabase, getDatabase } from "../electron/core/db/Database"
import { profileService } from "../electron/modules/profile/ProfileService"
import { jobService } from "../electron/modules/jobs/JobService"
import { generationService } from "../electron/modules/generation/GenerationService"

const dirs: string[] = []

function freshDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-gen-test-"))
  dirs.push(dir)
  initDatabase(path.join(dir, "assistant.db"))
}

afterAll(() => {
  try {
    getDatabase().close()
  } catch {
    // already closed
  }
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

function cvResponse(costUsd = 0.01) {
  return {
    data: {
      html: "<section><h2>工作经历</h2><ul><li>后端开发,负责订单系统</li></ul></section>",
      summary: "后端工程师"
    },
    usage: { inputTokens: 100, outputTokens: 200, estimatedCostUsd: costUsd }
  }
}

async function seedProfile() {
  profileService.getOrCreateDefaultProfile()
  profileService.addFact({
    category: "experience",
    label: "后端开发",
    detail: "负责订单系统的设计与开发, 使用 Node.js 和 SQLite",
    confirmed: true
  })
  profileService.createVersion()
}

async function importJob(positionId: string, description: string): Promise<string> {
  const summary = await jobService.importJobs({
    sourceType: "json",
    text: JSON.stringify([
      {
        title: `Backend Engineer ${positionId}`,
        company: "Acme",
        description,
        positionId,
        url: `https://www.zhipin.com/job_detail/${positionId}`
      }
    ])
  })
  return summary.results[0].job.id
}

async function waitForTerminal(runId: string, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  for (;;) {
    const run = generationService.getRun(runId)
    // finishedAt is written by finalize(), i.e. after every step has settled;
    // status alone flips early on cancel.
    if (run && !["running", "paused", "pending"].includes(run.status) && run.finishedAt) {
      return
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Run ${runId} did not settle: ${run?.status}`)
    }
    await new Promise((r) => setTimeout(r, 20))
  }
}

beforeEach(() => {
  completeJson.mockReset()
  freshDatabase()
})

describe("generation version chain", () => {
  it("records jobVersions and templateVersion on the run", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    completeJson.mockResolvedValue(cvResponse())

    const run = await generationService.generateCvBatch([jobA])
    await waitForTerminal(run.id)

    const stored = generationService.getRun(run.id)!
    expect(stored.jobVersions).toEqual({ [jobA]: 1 })
    expect(stored.templateId).toBeTruthy()
    expect(stored.templateVersion).toBe(1)
    expect(stored.profileVersion).toBe(1)
    expect(stored.promptVersion).toBeTruthy()
    expect(stored.idempotencyKey).toMatch(/^[0-9a-f]{64}$/)
  })

  it("changes the idempotency key when the job version bumps", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    completeJson.mockResolvedValue(cvResponse())

    const run1 = await generationService.generateCvBatch([jobA])
    await waitForTerminal(run1.id)

    // Re-import same posting (strong key) with new content → job version 2.
    await importJob("pos-a", "Build APIs with Node.js for orders and payments")
    expect(jobService.listVersions(jobA)[0].version).toBe(2)

    const run2 = await generationService.generateCvBatch([jobA])
    await waitForTerminal(run2.id)

    expect(run2.id).not.toBe(run1.id)
    expect(generationService.getRun(run2.id)!.idempotencyKey).not.toBe(
      generationService.getRun(run1.id)!.idempotencyKey
    )
    expect(generationService.getRun(run2.id)!.jobVersions).toEqual({ [jobA]: 2 })
  })

  it("changes the idempotency key when the template version bumps", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    completeJson.mockResolvedValue(cvResponse())

    const template = profileService.listTemplates()[0]
    const run1 = await generationService.generateCvBatch([jobA], { templateId: template.id })
    await waitForTerminal(run1.id)

    const bumped = profileService.updateTemplate(template.id, { name: "Adjusted" })!
    expect(bumped.version).toBe(2)

    const run2 = await generationService.generateCvBatch([jobA], { templateId: template.id })
    await waitForTerminal(run2.id)

    expect(run2.id).not.toBe(run1.id)
    expect(generationService.getRun(run2.id)!.templateVersion).toBe(2)
  })

  it("reuses a completed run for an identical request without re-billing", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    completeJson.mockResolvedValue(cvResponse())

    const run1 = await generationService.generateCvBatch([jobA])
    await waitForTerminal(run1.id)
    expect(completeJson).toHaveBeenCalledTimes(1)

    const run2 = await generationService.generateCvBatch([jobA])
    expect(run2.id).toBe(run1.id)
    expect(run2.status).toBe("completed")
    expect(completeJson).toHaveBeenCalledTimes(1)
  })
})

describe("resume without double billing", () => {
  it("continues only unfinished steps after a failure", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    const jobB = await importJob("pos-b", "Design distributed systems in Go")

    completeJson.mockImplementation(async (messages: Array<{ text: string }>) => {
      const prompt = messages[0].text
      if (prompt.includes("pos-b")) throw new Error("provider 500")
      return cvResponse(0.01)
    })

    const run = await generationService.generateCvBatch([jobA, jobB])
    await waitForTerminal(run.id)

    let steps = generationService.getSteps(run.id)
    const stepA = steps.find((s) => s.jobId === jobA)!
    const stepB = steps.find((s) => s.jobId === jobB)!
    expect(stepA.status).toBe("done")
    expect(stepB.status).toBe("failed")
    expect(generationService.getRun(run.id)!.recoverable).toBe(true)
    const artifactABefore = stepA.artifactId
    expect(completeJson).toHaveBeenCalledTimes(2)

    // Provider recovers; resume the same run.
    completeJson.mockImplementation(async () => cvResponse(0.02))
    const resumed = await generationService.resumeRun(run.id)
    expect(resumed.id).toBe(run.id)
    await waitForTerminal(run.id)

    steps = generationService.getSteps(run.id)
    expect(steps.every((s) => s.status === "done")).toBe(true)
    // Job A was NOT re-executed: same artifact, no extra AI call for it.
    expect(steps.find((s) => s.jobId === jobA)!.artifactId).toBe(artifactABefore)
    expect(completeJson).toHaveBeenCalledTimes(3)

    const final = generationService.getRun(run.id)!
    expect(final.status).toBe("completed")
    expect(final.recoverable).toBe(false)
    expect(final.completedSteps).toBe(2)
    // Cost = 0.01 (A first pass) + 0.02 (B retry); A is not billed twice.
    expect(final.actualCostUsd).toBeCloseTo(0.03, 6)
  })

  it("recovers interrupted runs on boot and resumes them in place", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    const jobB = await importJob("pos-b", "Design distributed systems in Go")
    completeJson.mockResolvedValue(cvResponse(0.01))

    const run = await generationService.generateCvBatch([jobA, jobB])
    await waitForTerminal(run.id)

    // Simulate a crash mid-run: run marked running, one step still running.
    const steps = generationService.getSteps(run.id)
    const db = getDatabase()
    db.table("generation_runs").update(run.id, { status: "running", finishedAt: undefined })
    db.table("generation_steps").update(steps[1].id, { status: "running", artifactId: undefined })

    const recovered = generationService.recoverInterruptedRuns()
    expect(recovered).toBe(1)
    const marked = generationService.getRun(run.id)!
    expect(marked.status).toBe("failed")
    expect(marked.recoverable).toBe(true)
    expect(
      generationService.getSteps(run.id).find((s) => s.id === steps[1].id)!.status
    ).toBe("failed")

    completeJson.mockClear()
    completeJson.mockResolvedValue(cvResponse(0.05))
    await generationService.resumeRun(run.id)
    await waitForTerminal(run.id)

    // Only the interrupted step was re-executed.
    expect(completeJson).toHaveBeenCalledTimes(1)
    expect(generationService.getRun(run.id)!.status).toBe("completed")
    expect(generationService.getSteps(run.id).every((s) => s.status === "done")).toBe(true)
  })

  it("retryFailed with a jobId reruns only that item in the same run", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    const jobB = await importJob("pos-b", "Design distributed systems in Go")
    const jobC = await importJob("pos-c", "Own the data warehouse pipelines")

    completeJson.mockImplementation(async (messages: Array<{ text: string }>) => {
      const prompt = messages[0].text
      if (prompt.includes("pos-a")) return cvResponse(0.01)
      throw new Error("provider 500")
    })

    const run = await generationService.generateCvBatch([jobA, jobB, jobC])
    await waitForTerminal(run.id)
    expect(
      generationService.getSteps(run.id).filter((s) => s.status === "failed")
    ).toHaveLength(2)

    completeJson.mockClear()
    completeJson.mockResolvedValue(cvResponse(0.01))
    const resumed = await generationService.retryFailed(run.id, jobB)
    expect(resumed.id).toBe(run.id)
    await waitForTerminal(run.id)

    const byJob = new Map(generationService.getSteps(run.id).map((s) => [s.jobId, s.status]))
    expect(byJob.get(jobA)).toBe("done")
    expect(byJob.get(jobB)).toBe("done")
    expect(byJob.get(jobC)).toBe("failed") // untouched by the single-item retry
    expect(completeJson).toHaveBeenCalledTimes(1)
  })
})

describe("pause / cancel / concurrency fault injection", () => {
  it("pause blocks further steps until resume", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    const jobB = await importJob("pos-b", "Design distributed systems in Go")

    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve))
    completeJson.mockImplementationOnce(async () => {
      await firstGate
      return cvResponse()
    })
    completeJson.mockResolvedValue(cvResponse())

    const run = await generationService.generateCvBatch([jobA, jobB], { concurrency: 1 })
    // Pause while the first call is in flight.
    expect(generationService.controlRun(run.id, "pause")).toBe(true)
    releaseFirst()

    await new Promise((r) => setTimeout(r, 150))
    // First step finished, second must NOT have started while paused.
    expect(completeJson).toHaveBeenCalledTimes(1)
    expect(generationService.getRun(run.id)!.status).toBe("paused")

    generationService.controlRun(run.id, "resume")
    await waitForTerminal(run.id)
    expect(completeJson).toHaveBeenCalledTimes(2)
    expect(generationService.getRun(run.id)!.status).toBe("completed")
  })

  it("cancel skips remaining steps and marks the run cancelled", async () => {
    await seedProfile()
    const jobA = await importJob("pos-a", "Build APIs with Node.js for orders")
    const jobB = await importJob("pos-b", "Design distributed systems in Go")
    const jobC = await importJob("pos-c", "Own the data warehouse pipelines")

    let releaseFirst!: () => void
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve))
    completeJson.mockImplementationOnce(async () => {
      await firstGate
      return cvResponse()
    })
    completeJson.mockResolvedValue(cvResponse())

    const run = await generationService.generateCvBatch([jobA, jobB, jobC], { concurrency: 1 })
    generationService.controlRun(run.id, "cancel")
    releaseFirst()
    await waitForTerminal(run.id)

    const statuses = generationService.getSteps(run.id).map((s) => s.status).sort()
    expect(statuses).toEqual(["done", "skipped", "skipped"])
    expect(generationService.getRun(run.id)!.status).toBe("cancelled")
    // Only the in-flight call happened; cancelled steps were never billed.
    expect(completeJson).toHaveBeenCalledTimes(1)
  })

  it("never exceeds the configured concurrency", async () => {
    await seedProfile()
    const ids: string[] = []
    for (let i = 0; i < 5; i++) {
      ids.push(await importJob(`pos-${i}`, `Role ${i}: build systems and APIs number ${i}`))
    }

    let inFlight = 0
    let maxInFlight = 0
    completeJson.mockImplementation(async () => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      await new Promise((r) => setTimeout(r, 30))
      inFlight--
      return cvResponse()
    })

    const run = await generationService.generateCvBatch(ids, { concurrency: 2 })
    await waitForTerminal(run.id)

    expect(maxInFlight).toBeLessThanOrEqual(2)
    expect(generationService.getSteps(run.id).every((s) => s.status === "done")).toBe(true)
  })
})
