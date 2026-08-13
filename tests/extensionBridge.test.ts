// Security tests for the browser-extension loopback bridge: forged requests,
// wrong pairing tokens, replayed imports, malformed and oversized payloads.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { initDatabase, getDatabase } from "../electron/core/db/Database"
import { initSecureStore } from "../electron/core/security/secureStore"
import { ExtensionBridge } from "../electron/modules/jobs/ExtensionBridge"
import { jobService } from "../electron/modules/jobs/JobService"

const TEST_PORT = 53911
const BASE = `http://127.0.0.1:${TEST_PORT}`

let dir: string
let bridge: ExtensionBridge
let token: string

async function waitForListening(timeoutMs = 3000): Promise<void> {
  const start = Date.now()
  for (;;) {
    try {
      await fetch(`${BASE}/`, { method: "GET" })
      return
    } catch {
      if (Date.now() - start > timeoutMs) throw new Error("bridge did not start")
      await new Promise((r) => setTimeout(r, 30))
    }
  }
}

const jobPayload = {
  title: "Backend Engineer",
  company: "Acme",
  description: "Design and build APIs with Node.js. 负责订单系统开发。",
  url: "https://www.zhipin.com/job_detail/pos-ext-1"
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-bridge-test-"))
  initDatabase(path.join(dir, "assistant.db"))
  initSecureStore(path.join(dir, "secure.json"))
  bridge = new ExtensionBridge(() => null, TEST_PORT)
  token = bridge.getToken()
  bridge.start()
  await waitForListening()
})

afterAll(() => {
  bridge.stop()
  try {
    getDatabase().close()
  } catch {
    // already closed
  }
  fs.rmSync(dir, { recursive: true, force: true })
})

describe("ExtensionBridge forged-request handling", () => {
  it("rejects requests without a pairing token", async () => {
    const res = await fetch(`${BASE}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jobs: [jobPayload] })
    })
    expect(res.status).toBe(401)
    expect(jobService.listJobs()).toHaveLength(0)
  })

  it("rejects requests with a wrong token", async () => {
    const res = await fetch(`${BASE}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pair-Token": "guessed-token" },
      body: JSON.stringify({ jobs: [jobPayload] })
    })
    expect(res.status).toBe(401)
    expect(jobService.listJobs()).toHaveLength(0)
  })

  it("rejects unknown methods and paths", async () => {
    const get = await fetch(`${BASE}/import`, { method: "GET" })
    expect(get.status).toBe(404)
    const wrongPath = await fetch(`${BASE}/exfiltrate`, {
      method: "POST",
      headers: { "X-Pair-Token": token },
      body: "{}"
    })
    expect(wrongPath.status).toBe(404)
  })

  it("accepts a correctly paired import", async () => {
    const res = await fetch(`${BASE}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pair-Token": token },
      body: JSON.stringify({ jobs: [jobPayload] })
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; imported: number }
    expect(body.ok).toBe(true)
    expect(body.imported).toBe(1)
    expect(jobService.listJobs()).toHaveLength(1)
  })

  it("deduplicates a replayed request instead of inserting twice", async () => {
    const res = await fetch(`${BASE}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pair-Token": token },
      body: JSON.stringify({ jobs: [jobPayload] })
    })
    expect(res.status).toBe(200)
    // Replay lands on the content-hash dedup path: still exactly one job.
    expect(jobService.listJobs()).toHaveLength(1)
  })

  it("returns 400 for malformed JSON", async () => {
    const res = await fetch(`${BASE}/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Pair-Token": token },
      body: "{not json"
    })
    expect(res.status).toBe(400)
  })

  it("drops oversized payloads", async () => {
    const huge = JSON.stringify({
      jobs: [{ ...jobPayload, description: "x".repeat(3 * 1024 * 1024) }]
    })
    await expect(
      fetch(`${BASE}/import`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Pair-Token": token },
        body: huge
      })
    ).rejects.toThrow()
    // Nothing new imported.
    expect(jobService.listJobs()).toHaveLength(1)
  })
})
