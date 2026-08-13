import { describe, it, expect } from "vitest"
import {
  contentHash,
  detectPlatform,
  extractPositionId,
  htmlToText,
  normalizeFields,
  strongKey,
  weakKey
} from "../electron/modules/jobs/normalize"
import type { RawJobPayload } from "../electron/modules/jobs/types"

describe("htmlToText", () => {
  it("strips tags and decodes entities", () => {
    const out = htmlToText("<div>Senior&nbsp;Dev<br/>Line2</div><script>x=1</script>")
    expect(out).toContain("Senior Dev")
    expect(out).toContain("Line2")
    expect(out).not.toContain("x=1")
  })
})

describe("platform + position id detection", () => {
  it("detects platform from url", () => {
    expect(detectPlatform("https://www.zhipin.com/job_detail/abc123.html")).toBe("zhipin")
    expect(detectPlatform("https://www.linkedin.com/jobs/view/123")).toBe("linkedin")
    expect(detectPlatform(undefined)).toBe("unknown")
  })

  it("extracts position id", () => {
    expect(extractPositionId("https://www.zhipin.com/job_detail/abc123.html")).toBe("abc123")
    expect(extractPositionId("https://x.com/jobs/987654")).toBe("987654")
  })
})

describe("dedup keys", () => {
  const raw = (content: string, hints: RawJobPayload["hints"] = {}, url?: string): RawJobPayload => ({
    sourceType: "paste",
    platform: detectPlatform(url),
    content,
    hints,
    jobUrl: url
  })

  it("same content produces same content hash regardless of formatting", () => {
    const a = normalizeFields(raw("Backend  Engineer\n\nBuild APIs", { title: "Backend Engineer", company: "Acme", description: "Build APIs" }))
    const b = normalizeFields(raw("backend engineer build apis", { title: "backend engineer", company: "acme", description: "build   apis" }))
    expect(contentHash(a)).toBe(contentHash(b))
  })

  it("different content produces different hash", () => {
    const a = normalizeFields(raw("x", { title: "A", company: "C", description: "one" }))
    const b = normalizeFields(raw("y", { title: "B", company: "C", description: "two" }))
    expect(contentHash(a)).not.toBe(contentHash(b))
  })

  it("strong key requires platform and position id", () => {
    expect(strongKey("zhipin", "abc")).toBe("zhipin:abc")
    expect(strongKey("unknown", "abc")).toBeNull()
    expect(strongKey("zhipin", undefined)).toBeNull()
  })

  it("weak key matches on company+title+salary", () => {
    const a = normalizeFields(raw("", { title: "Dev", company: "Acme", salary: "20-30k", description: "d1" }))
    const b = normalizeFields(raw("", { title: "Dev", company: "Acme", salary: "20-30k", description: "different text" }))
    expect(weakKey(a)).toBe(weakKey(b))
  })
})
