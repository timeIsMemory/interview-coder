import { describe, it, expect } from "vitest"
import { ControlToken, createLimiter, isCancellationError } from "../electron/core/concurrency"

describe("createLimiter", () => {
  it("never exceeds max concurrency", async () => {
    const limit = createLimiter(2)
    let active = 0
    let maxActive = 0
    const task = () =>
      limit(async () => {
        active++
        maxActive = Math.max(maxActive, active)
        await new Promise((r) => setTimeout(r, 10))
        active--
      })
    await Promise.all(Array.from({ length: 8 }, task))
    expect(maxActive).toBeLessThanOrEqual(2)
  })

  it("returns task results", async () => {
    const limit = createLimiter(3)
    const results = await Promise.all([1, 2, 3].map((n) => limit(async () => n * 2)))
    expect(results).toEqual([2, 4, 6])
  })
})

describe("ControlToken", () => {
  it("throws a tagged cancellation error", () => {
    const t = new ControlToken()
    t.cancel()
    expect(t.isCancelled).toBe(true)
    try {
      t.throwIfCancelled()
      throw new Error("should have thrown")
    } catch (err) {
      expect(isCancellationError(err)).toBe(true)
    }
  })

  it("resumes waiters when unpaused", async () => {
    const t = new ControlToken()
    t.pause()
    let resumed = false
    const wait = t.waitWhilePaused().then(() => {
      resumed = true
    })
    expect(resumed).toBe(false)
    t.resume()
    await wait
    expect(resumed).toBe(true)
  })
})
