import { describe, it, expect } from "vitest"
import { buildReview } from "../electron/modules/recording/review"
import type { TranscriptSegment } from "../electron/modules/recording/types"

function seg(partial: Partial<TranscriptSegment>): TranscriptSegment {
  return {
    id: Math.random().toString(36).slice(2),
    sessionId: "s1",
    start: 0,
    end: 10,
    speaker: "candidate",
    text: "",
    ...partial
  }
}

describe("buildReview", () => {
  it("produces metrics with evidence and an overall score", () => {
    const segments: TranscriptSegment[] = [
      seg({ start: 0, end: 12, text: "First, I designed the API. For example, we cut latency. As a result, users were happier." }),
      seg({ start: 12, end: 20, text: "然后 我 负责 后端 因此 提升 了 性能" })
    ]
    const { overallScore, metrics } = buildReview(segments, {
      jobText: "backend api latency performance engineer",
      corpusText: "designed api backend latency performance"
    })
    expect(metrics.length).toBe(5)
    expect(overallScore).toBeGreaterThan(0)
    const structure = metrics.find((m) => m.key === "structure")!
    expect(structure.evidence.length).toBeGreaterThan(0)
  })

  it("penalizes filler-heavy answers on conciseness", () => {
    const filler = buildReview([
      seg({ text: "um uh like you know basically actually um uh sort of like" })
    ])
    const clean = buildReview([
      seg({ text: "I built the service and it improved throughput significantly." })
    ])
    const fillerScore = filler.metrics.find((m) => m.key === "conciseness")!.score
    const cleanScore = clean.metrics.find((m) => m.key === "conciseness")!.score
    expect(cleanScore).toBeGreaterThan(fillerScore)
  })

  it("does not invent relevance/fact scores without context", () => {
    const { metrics } = buildReview([seg({ text: "hello" })])
    expect(metrics.find((m) => m.key === "relevance")!.score).toBe(0)
    expect(metrics.find((m) => m.key === "fact-support")!.score).toBe(0)
  })
})
