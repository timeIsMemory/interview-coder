import { describe, it, expect } from "vitest"
import { clusterJobs, jaccard, matchJobToCorpus, tokenize } from "../electron/modules/generation/matching"

describe("tokenize", () => {
  it("extracts latin words and drops stopwords", () => {
    const toks = tokenize("We need Python and Kubernetes experience for the team")
    expect(toks).toContain("python")
    expect(toks).toContain("kubernetes")
    expect(toks).not.toContain("the")
  })
})

describe("matchJobToCorpus", () => {
  it("scores higher when corpus covers JD keywords", () => {
    const jd = "Looking for Python Django PostgreSQL Redis engineer"
    const good = matchJobToCorpus(jd, "Python Django PostgreSQL Redis expert")
    const poor = matchJobToCorpus(jd, "Java Spring Oracle developer")
    expect(good.score).toBeGreaterThan(poor.score)
    expect(good.gaps.length).toBeLessThan(poor.gaps.length)
  })

  it("reports gaps for uncovered keywords", () => {
    const res = matchJobToCorpus("Need Rust and Go skills", "I know Python")
    expect(res.gaps).toContain("rust")
    expect(res.gaps).toContain("go")
  })
})

describe("jaccard + clusterJobs", () => {
  it("jaccard of identical sets is 1", () => {
    expect(jaccard(new Set(["a", "b"]), new Set(["a", "b"]))).toBe(1)
  })

  it("clusters near-duplicate JDs together", () => {
    const jobs = [
      { id: "1", text: "Senior Python backend engineer Django REST" },
      { id: "2", text: "Senior Python backend engineer Django REST APIs" },
      { id: "3", text: "Frontend React TypeScript designer UI" }
    ]
    const clusters = clusterJobs(jobs, 0.5)
    const cluster12 = clusters.find((c) => c.includes("1"))
    expect(cluster12).toContain("2")
    expect(cluster12).not.toContain("3")
  })
})
