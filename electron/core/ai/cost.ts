// Pure cost/token estimation. No provider SDKs imported here so it can be
// unit-tested and used to show a "this run will cost about X" preview before
// any network call is made.

export type ProviderId = "openai" | "gemini" | "anthropic"

export interface ModelPricing {
  /** USD per 1M input tokens. */
  inputPerMillion: number
  /** USD per 1M output tokens. */
  outputPerMillion: number
}

// Rough, intentionally conservative public pricing. These are used only for a
// pre-run estimate and a post-run tally, never for billing. Unknown models
// fall back to a mid-range default so the estimate is never zero.
export const MODEL_PRICING: Record<string, ModelPricing> = {
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gemini-1.5-pro": { inputPerMillion: 1.25, outputPerMillion: 5 },
  "gemini-2.0-flash": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "claude-3-7-sonnet-20250219": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-5-sonnet-20241022": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-opus-20240229": { inputPerMillion: 15, outputPerMillion: 75 }
}

const DEFAULT_PRICING: ModelPricing = { inputPerMillion: 1, outputPerMillion: 3 }

export function pricingFor(model: string): ModelPricing {
  return MODEL_PRICING[model] ?? DEFAULT_PRICING
}

/**
 * Very rough token estimate from character count. English is ~4 chars/token,
 * CJS text is closer to ~1.5 chars/token, so we detect CJK density and blend.
 * This is deliberately an over-estimate to avoid surprising the user.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/g) || []).length
  const rest = text.length - cjk
  const tokens = cjk / 1.5 + rest / 3.5
  return Math.max(1, Math.ceil(tokens))
}

export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const p = pricingFor(model)
  return (
    (inputTokens / 1_000_000) * p.inputPerMillion +
    (outputTokens / 1_000_000) * p.outputPerMillion
  )
}

export interface BatchEstimateInput {
  model: string
  /** Number of LLM calls in the batch. */
  calls: number
  /** Estimated input tokens per call. */
  inputTokensPerCall: number
  /** Estimated output tokens per call. */
  outputTokensPerCall: number
}

export interface BatchEstimate {
  calls: number
  totalInputTokens: number
  totalOutputTokens: number
  estimatedCostUsd: number
}

export function estimateBatch(input: BatchEstimateInput): BatchEstimate {
  const totalInputTokens = input.calls * input.inputTokensPerCall
  const totalOutputTokens = input.calls * input.outputTokensPerCall
  return {
    calls: input.calls,
    totalInputTokens,
    totalOutputTokens,
    estimatedCostUsd: estimateCostUsd(
      input.model,
      totalInputTokens,
      totalOutputTokens
    )
  }
}
