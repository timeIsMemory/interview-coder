import { describe, it, expect } from "vitest"
import { detectBlocking, BLOCK_MESSAGES, SCRAPE_POLICY } from "../electron/modules/jobs/scrapeGuard"

describe("detectBlocking", () => {
  it("detects auth by status and login markers", () => {
    expect(detectBlocking(401, "")).toBe("auth")
    expect(detectBlocking(200, "<div>请登录后查看该职位</div>")).toBe("auth")
    expect(detectBlocking(200, "", "https://passport.zhipin.com/login")).toBe("auth")
  })

  it("detects captcha markers", () => {
    expect(detectBlocking(200, "<div class='geetest_panel'>安全验证</div>")).toBe("captcha")
    expect(detectBlocking(200, "please complete the security check")).toBe("captcha")
  })

  it("detects forbidden and rate limits", () => {
    expect(detectBlocking(403, "")).toBe("forbidden")
    expect(detectBlocking(429, "")).toBe("rate-limit")
  })

  it("returns null for a normal page", () => {
    expect(detectBlocking(200, "<h1>Backend Engineer</h1><p>Great job</p>")).toBeNull()
  })

  it("has a degradation message for every block reason", () => {
    for (const key of ["auth", "captcha", "rate-limit", "forbidden"] as const) {
      expect(BLOCK_MESSAGES[key]).toBeTruthy()
    }
  })

  it("keeps a conservative policy", () => {
    expect(SCRAPE_POLICY.maxUrlsPerRun).toBeLessThanOrEqual(10)
    expect(SCRAPE_POLICY.delayBetweenRequestsMs).toBeGreaterThanOrEqual(5000)
  })
})
