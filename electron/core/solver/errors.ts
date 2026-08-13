// Error classification for the solver pipeline. Maps provider/SDK errors to
// the user-facing messages the renderer already expects, without the caller
// having to know which SDK produced the error.

import type { ProviderId } from "../ai/cost"

const PROVIDER_LABEL: Record<ProviderId, string> = {
  openai: "OpenAI",
  gemini: "Gemini",
  anthropic: "Claude"
}

/** True when the error represents a user-initiated cancellation/abort. */
export function isAbortError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const err = error as { name?: string; code?: string }
  return (
    err.name === "AbortError" || // DOMException from AbortSignal
    err.name === "CanceledError" || // axios cancellation
    err.name === "APIUserAbortError" || // OpenAI / Anthropic SDK abort
    err.code === "ERR_CANCELED"
  )
}

function statusOf(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined
  const err = error as { status?: unknown; response?: { status?: unknown } }
  if (typeof err.status === "number") return err.status
  if (err.response && typeof err.response.status === "number") return err.response.status
  return undefined
}

/**
 * Map an SDK/HTTP error to the user-facing message shown in the solver UI.
 * Keeps the historical per-provider wording so the renderer behavior and
 * existing user expectations do not change.
 */
export function solverErrorMessage(
  error: unknown,
  provider: ProviderId,
  stage: "extraction" | "solution" | "debugging"
): string {
  const label = PROVIDER_LABEL[provider]
  const status = statusOf(error)
  const message = error instanceof Error ? error.message : String(error)

  if (status === 401) {
    return `Invalid ${label} API key. Please check your settings.`
  }
  if (status === 429) {
    return provider === "anthropic"
      ? "Claude API rate limit exceeded. Please wait a few minutes before trying again."
      : `${label} API rate limit exceeded or insufficient credits. Please try again later.`
  }
  if (provider === "anthropic" && (status === 413 || /token/i.test(message))) {
    return "Your screenshots contain too much information for Claude to process. Switch to OpenAI or Gemini in settings which can handle larger inputs."
  }
  if (status !== undefined && status >= 500) {
    return `${label} server error. Please try again later.`
  }
  if (stage === "extraction") {
    return `Failed to process with ${label} API. Please check your API key or try again later.`
  }
  if (stage === "solution") {
    return `Failed to generate solution with ${label} API. Please check your API key or try again later.`
  }
  return `Failed to process debug request with ${label} API. Please check your API key or try again later.`
}
