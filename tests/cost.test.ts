import { describe, it, expect } from "vitest"
import {
  estimateBatch,
  estimateCostUsd,
  estimateTokens,
  pricingFor
} from "../electron/core/ai/cost"

describe("cost estimation", () => {
  it("uses known pricing and falls back for unknown models", () => {
    expect(pricingFor("gpt-4o").inputPerMillion).toBe(2.5)
    expect(pricingFor("some-unknown-model").inputPerMillion).toBeGreaterThan(0)
  })

  it("estimates more tokens for CJK-heavy text than latin of same length", () => {
    const zh = estimateTokens("这是一段中文测试文本用于估算")
    const en = estimateTokens("abcdefghijklmn")
    expect(zh).toBeGreaterThan(en)
  })

  it("computes non-zero cost that scales with tokens", () => {
    const low = estimateCostUsd("gpt-4o", 1000, 500)
    const high = estimateCostUsd("gpt-4o", 10000, 5000)
    expect(high).toBeGreaterThan(low)
    expect(low).toBeGreaterThan(0)
  })

  it("aggregates a batch estimate", () => {
    const est = estimateBatch({
      model: "gpt-4o-mini",
      calls: 50,
      inputTokensPerCall: 1000,
      outputTokensPerCall: 1200
    })
    expect(est.calls).toBe(50)
    expect(est.totalInputTokens).toBe(50000)
    expect(est.totalOutputTokens).toBe(60000)
    expect(est.estimatedCostUsd).toBeGreaterThan(0)
  })
})
