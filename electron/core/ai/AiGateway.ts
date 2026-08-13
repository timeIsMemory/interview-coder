// Unified AI gateway. This is the single place that knows how to talk to
// OpenAI, Gemini and Anthropic. Every feature (extraction, solution, debug,
// resume/JD generation) goes through here so we don't copy three provider
// code paths per task. Text, JSON and vision are all supported.

import * as axios from "axios"
import { OpenAI } from "openai"
import Anthropic from "@anthropic-ai/sdk"
import { configHelper } from "../../ConfigHelper"
import { createLimiter } from "../concurrency"
import { estimateTokens, estimateCostUsd, type ProviderId } from "./cost"
import { parseJsonResponse } from "./json"
import {
  AiCompletionOptions,
  AiJsonResult,
  AiMessage,
  AiNotConfiguredError,
  AiSchemaError,
  AiTextResult,
  AiUsage
} from "./types"

export class AiGateway {
  private openai: OpenAI | null = null
  private geminiKey: string | null = null
  private anthropic: Anthropic | null = null
  private provider: ProviderId = "gemini"
  // Global limiter shared across all callers so batch jobs and live-assist
  // never exceed a sane per-app request rate.
  private limiter = createLimiter(3)

  constructor() {
    this.reinitialize()
    configHelper.on("config-updated", () => this.reinitialize())
  }

  private reinitialize(): void {
    try {
      const config = configHelper.loadConfig()
      this.provider = (config.apiProvider as ProviderId) || "gemini"
      this.openai = null
      this.geminiKey = null
      this.anthropic = null
      if (!config.apiKey) return
      if (this.provider === "openai") {
        this.openai = new OpenAI({ apiKey: config.apiKey, timeout: 60000, maxRetries: 2 })
      } else if (this.provider === "anthropic") {
        this.anthropic = new Anthropic({ apiKey: config.apiKey, timeout: 60000, maxRetries: 2 })
      } else {
        this.geminiKey = config.apiKey
      }
    } catch (err) {
      console.error("AiGateway reinitialize failed:", err)
    }
  }

  isConfigured(): boolean {
    return !!(this.openai || this.geminiKey || this.anthropic)
  }

  getProvider(): ProviderId {
    return this.provider
  }

  private modelForPurpose(opts: AiCompletionOptions): string {
    if (opts.model) return opts.model
    const config = configHelper.loadConfig()
    switch (opts.purpose) {
      case "extraction":
        return config.extractionModel
      case "debugging":
        return config.debuggingModel
      case "generation":
        return config.generationModel || config.solutionModel
      case "solution":
      default:
        return config.solutionModel
    }
  }

  /** Free-form text completion. */
  async complete(messages: AiMessage[], opts: AiCompletionOptions = {}): Promise<AiTextResult> {
    if (!this.isConfigured()) {
      throw new AiNotConfiguredError()
    }
    const model = this.modelForPurpose(opts)
    return this.limiter(() => this.dispatch(messages, model, opts))
  }

  /** JSON completion, parsed and optionally validated. */
  async completeJson<T = unknown>(
    messages: AiMessage[],
    opts: AiCompletionOptions & { validate?: (data: unknown) => data is T } = {}
  ): Promise<AiJsonResult<T>> {
    const result = await this.complete(messages, opts)
    let data: unknown
    try {
      data = parseJsonResponse(result.text)
    } catch (err) {
      throw new AiSchemaError(
        `Model did not return valid JSON: ${(err as Error).message}`,
        result.text
      )
    }
    if (opts.validate && !opts.validate(data)) {
      throw new AiSchemaError("Model JSON failed schema validation", result.text)
    }
    return { ...result, data: data as T }
  }

  private usageFor(model: string, inputText: string, outputText: string): AiUsage {
    const inputTokens = estimateTokens(inputText)
    const outputTokens = estimateTokens(outputText)
    return {
      inputTokens,
      outputTokens,
      estimatedCostUsd: estimateCostUsd(model, inputTokens, outputTokens)
    }
  }

  private async dispatch(
    messages: AiMessage[],
    model: string,
    opts: AiCompletionOptions
  ): Promise<AiTextResult> {
    const inputText = messages.map((m) => m.text).join("\n")
    if (this.provider === "openai") {
      const text = await this.callOpenAI(messages, model, opts)
      return { text, model, provider: "openai", usage: this.usageFor(model, inputText, text) }
    }
    if (this.provider === "anthropic") {
      const text = await this.callAnthropic(messages, model, opts)
      return { text, model, provider: "anthropic", usage: this.usageFor(model, inputText, text) }
    }
    const text = await this.callGemini(messages, model, opts)
    return { text, model, provider: "gemini", usage: this.usageFor(model, inputText, text) }
  }

  private async callOpenAI(
    messages: AiMessage[],
    model: string,
    opts: AiCompletionOptions
  ): Promise<string> {
    if (!this.openai) throw new AiNotConfiguredError("OpenAI not configured")
    const oaMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = messages.map(
      (m) => {
        // Only user messages may carry image parts in the OpenAI schema.
        if (m.role === "user" && m.images && m.images.length) {
          return {
            role: "user" as const,
            content: [
              { type: "text" as const, text: m.text },
              ...m.images.map((img) => ({
                type: "image_url" as const,
                image_url: { url: `data:${img.mimeType || "image/png"};base64,${img.data}` }
              }))
            ]
          }
        }
        return { role: m.role, content: m.text }
      }
    )
    const resp = await this.openai.chat.completions.create(
      {
        model,
        messages: oaMessages,
        max_tokens: opts.maxTokens ?? 4000,
        temperature: opts.temperature ?? 0.2
      },
      { signal: opts.signal }
    )
    return resp.choices[0]?.message?.content ?? ""
  }

  private async callAnthropic(
    messages: AiMessage[],
    model: string,
    opts: AiCompletionOptions
  ): Promise<string> {
    if (!this.anthropic) throw new AiNotConfiguredError("Anthropic not configured")
    const system = messages.filter((m) => m.role === "system").map((m) => m.text).join("\n\n")
    const convo: Anthropic.Messages.MessageParam[] = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: (m.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: [
          { type: "text" as const, text: m.text },
          ...(m.images || []).map((img) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: (img.mimeType ||
                "image/png") as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
              data: img.data
            }
          }))
        ]
      }))
    const resp = await this.anthropic.messages.create(
      {
        model,
        max_tokens: opts.maxTokens ?? 4000,
        temperature: opts.temperature ?? 0.2,
        system: system || undefined,
        messages: convo
      },
      { signal: opts.signal }
    )
    const block = resp.content[0] as { type: string; text?: string }
    return block?.text ?? ""
  }

  private async callGemini(
    messages: AiMessage[],
    model: string,
    opts: AiCompletionOptions
  ): Promise<string> {
    if (!this.geminiKey) throw new AiNotConfiguredError("Gemini not configured")
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [
          { text: m.text },
          ...(m.images || []).map((img) => ({
            inlineData: { mimeType: img.mimeType || "image/png", data: img.data }
          }))
        ]
      }))
    const systemText = messages.filter((m) => m.role === "system").map((m) => m.text).join("\n\n")
    const body: {
      contents: typeof contents
      generationConfig: { temperature: number }
      systemInstruction?: { parts: Array<{ text: string }> }
    } = { contents, generationConfig: { temperature: opts.temperature ?? 0.2 } }
    if (systemText) {
      body.systemInstruction = { parts: [{ text: systemText }] }
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${this.geminiKey}`
    const resp = await axios.default.post(url, body, {
      signal: opts.signal,
      headers: { "Content-Type": "application/json" }
    })
    const data = resp.data as {
      candidates?: Array<{ content: { parts: Array<{ text?: string }> } }>
    }
    if (!data.candidates || !data.candidates.length) {
      throw new Error("Empty response from Gemini API")
    }
    return data.candidates[0].content.parts.map((p) => p.text || "").join("")
  }
}

export const aiGateway = new AiGateway()
