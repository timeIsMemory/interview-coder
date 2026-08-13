import { describe, expect, it } from "vitest"
import { isAbortError, solverErrorMessage } from "../electron/core/solver/errors"

describe("isAbortError", () => {
  it("detects DOMException-style aborts", () => {
    const err = new Error("The operation was aborted")
    err.name = "AbortError"
    expect(isAbortError(err)).toBe(true)
  })

  it("detects axios cancellations by name and code", () => {
    const byName = Object.assign(new Error("canceled"), { name: "CanceledError" })
    const byCode = Object.assign(new Error("canceled"), { code: "ERR_CANCELED" })
    expect(isAbortError(byName)).toBe(true)
    expect(isAbortError(byCode)).toBe(true)
  })

  it("detects OpenAI/Anthropic SDK user aborts", () => {
    const err = Object.assign(new Error("Request was aborted."), {
      name: "APIUserAbortError"
    })
    expect(isAbortError(err)).toBe(true)
  })

  it("does not flag ordinary errors", () => {
    expect(isAbortError(new Error("boom"))).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError("aborted")).toBe(false)
  })
})

describe("solverErrorMessage", () => {
  it("maps 401 to an invalid-key message for the active provider", () => {
    const err = Object.assign(new Error("unauthorized"), { status: 401 })
    expect(solverErrorMessage(err, "openai", "extraction")).toContain("Invalid OpenAI API key")
    expect(solverErrorMessage(err, "gemini", "solution")).toContain("Invalid Gemini API key")
  })

  it("reads status from axios-style response objects", () => {
    const err = Object.assign(new Error("unauthorized"), { response: { status: 401 } })
    expect(solverErrorMessage(err, "openai", "extraction")).toContain("Invalid OpenAI API key")
  })

  it("maps 429 with Anthropic-specific wording", () => {
    const err = Object.assign(new Error("rate limited"), { status: 429 })
    expect(solverErrorMessage(err, "anthropic", "solution")).toContain(
      "Claude API rate limit exceeded"
    )
    expect(solverErrorMessage(err, "openai", "solution")).toContain(
      "rate limit exceeded or insufficient credits"
    )
  })

  it("maps Anthropic payload-too-large and token errors to the switch-provider hint", () => {
    const tooLarge = Object.assign(new Error("payload"), { status: 413 })
    const tokenErr = new Error("prompt is too long: tokens exceed limit")
    expect(solverErrorMessage(tooLarge, "anthropic", "extraction")).toContain(
      "Switch to OpenAI or Gemini"
    )
    expect(solverErrorMessage(tokenErr, "anthropic", "extraction")).toContain(
      "Switch to OpenAI or Gemini"
    )
  })

  it("maps 5xx to a server-error message", () => {
    const err = Object.assign(new Error("boom"), { status: 503 })
    expect(solverErrorMessage(err, "gemini", "debugging")).toContain("server error")
  })

  it("falls back to a stage-specific generic message", () => {
    const err = new Error("weird failure")
    expect(solverErrorMessage(err, "gemini", "extraction")).toContain("Failed to process with Gemini API")
    expect(solverErrorMessage(err, "openai", "solution")).toContain(
      "Failed to generate solution with OpenAI API"
    )
    expect(solverErrorMessage(err, "anthropic", "debugging")).toContain(
      "Failed to process debug request with Claude API"
    )
  })
})
