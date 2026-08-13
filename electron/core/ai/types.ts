import type { ProviderId } from "./cost"

export type { ProviderId }

export interface AiImage {
  /** base64-encoded image data, no data: prefix. */
  data: string
  mimeType?: string
}

export interface AiMessage {
  role: "system" | "user" | "assistant"
  text: string
  images?: AiImage[]
}

export interface AiCompletionOptions {
  /** Which task this is, used only to pick the configured model. */
  purpose?: "extraction" | "solution" | "debugging" | "generation"
  /** Explicit model override; otherwise chosen from config by purpose. */
  model?: string
  maxTokens?: number
  temperature?: number
  signal?: AbortSignal
}

export interface AiUsage {
  inputTokens: number
  outputTokens: number
  estimatedCostUsd: number
}

export interface AiTextResult {
  text: string
  model: string
  provider: ProviderId
  usage: AiUsage
}

export interface AiJsonResult<T = unknown> extends AiTextResult {
  data: T
}

/** Thrown when the gateway has no usable API key/client for the provider. */
export class AiNotConfiguredError extends Error {
  constructor(message = "AI provider is not configured") {
    super(message)
    this.name = "AiNotConfiguredError"
  }
}

/** Thrown when a JSON completion could not be parsed/validated. */
export class AiSchemaError extends Error {
  constructor(message: string, public raw?: string) {
    super(message)
    this.name = "AiSchemaError"
  }
}
