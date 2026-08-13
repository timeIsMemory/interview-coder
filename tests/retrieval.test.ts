import { describe, it, expect } from "vitest"
import { bestMatch, rankAnswers } from "../electron/modules/live/retrieval"
import type { PreparedAnswer } from "../electron/modules/generation/types"

const bank: PreparedAnswer[] = [
  {
    question: "Tell me about a time you improved system performance",
    category: "behavioral",
    shortAnswer: "I cut API latency by 30%.",
    detailedAnswer: "…"
  },
  {
    question: "How do you design a rate limiter",
    category: "technical",
    shortAnswer: "Token bucket per client.",
    detailedAnswer: "…"
  },
  {
    question: "Why do you want to join our company",
    category: "role-specific",
    shortAnswer: "Mission fit.",
    detailedAnswer: "…"
  }
]

describe("live retrieval", () => {
  it("ranks the semantically closest question first", () => {
    const ranked = rankAnswers("how would you design a rate limiter service", bank)
    expect(ranked[0].answer.question).toContain("rate limiter")
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })

  it("returns a best match above the threshold", () => {
    const m = bestMatch("design a rate limiter", bank)
    expect(m).not.toBeNull()
    expect(m!.answer.category).toBe("technical")
  })

  it("returns null for unrelated questions", () => {
    const m = bestMatch("what is your expected salary in RMB", bank)
    expect(m).toBeNull()
  })
})
