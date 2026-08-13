import { describe, expect, it, vi } from "vitest"
import { processScrapeUrls } from "../electron/modules/jobs/ControlledScraper"

describe("processScrapeUrls", () => {
  it("imports accessible pages sequentially and records import outcomes", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: "<h1>Backend Engineer</h1>", finalUrl: "https://www.zhipin.com/job/a" })
      .mockResolvedValueOnce({ status: 200, body: "<h1>Platform Engineer</h1>", finalUrl: "https://www.zhipin.com/job/b" })
    const importJob = vi.fn().mockResolvedValue({ results: [{ outcome: "inserted" }] })
    const wait = vi.fn().mockResolvedValue(undefined)

    const result = await processScrapeUrls(
      ["https://www.zhipin.com/job/a", "https://www.zhipin.com/job/b"],
      { fetchPage, importJob, wait }
    )

    expect(result).toMatchObject({ succeeded: 2, failed: 0, blocked: false })
    expect(importJob).toHaveBeenCalledTimes(2)
    expect(wait).toHaveBeenCalledTimes(1)
    expect(result.log.map((entry) => entry.status)).toEqual(["imported:inserted", "imported:inserted"])
  })

  it("stops immediately when a login wall is detected", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ status: 200, body: "?????????", finalUrl: "https://passport.zhipin.com/login" })
      .mockResolvedValueOnce({ status: 200, body: "should not be fetched", finalUrl: "https://www.zhipin.com/job/b" })
    const importJob = vi.fn()

    const result = await processScrapeUrls(
      ["https://www.zhipin.com/job/a", "https://www.zhipin.com/job/b"],
      { fetchPage, importJob, wait: vi.fn().mockResolvedValue(undefined) }
    )

    expect(result).toMatchObject({ succeeded: 0, failed: 0, blocked: true, blockReason: "auth" })
    expect(fetchPage).toHaveBeenCalledTimes(1)
    expect(importJob).not.toHaveBeenCalled()
    expect(result.log[0].status).toBe("blocked:auth")
  })

  it("records HTTP failures and continues to the next URL", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ status: 500, body: "server error", finalUrl: "https://example.com/a" })
      .mockResolvedValueOnce({ status: 200, body: "<h1>Developer</h1>", finalUrl: "https://example.com/b" })
    const importJob = vi.fn().mockResolvedValue({ results: [{ outcome: "duplicate" }] })

    const result = await processScrapeUrls(
      ["https://example.com/a", "https://example.com/b"],
      { fetchPage, importJob, wait: vi.fn().mockResolvedValue(undefined) }
    )

    expect(result).toMatchObject({ succeeded: 1, failed: 1, blocked: false })
    expect(result.log.map((entry) => entry.status)).toEqual(["http-500", "imported:duplicate"])
  })
})
