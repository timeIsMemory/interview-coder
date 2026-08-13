import { describe, expect, it } from "vitest"
import {
  buildDebugMessages,
  buildExtractionMessages,
  buildSolutionMessages,
  buildSolutionPrompt
} from "../electron/core/solver/prompts"

const IMAGES = ["aGVsbG8=", "d29ybGQ="]

describe("buildExtractionMessages", () => {
  it("includes system instruction, language and all images", () => {
    const messages = buildExtractionMessages("java", IMAGES)
    expect(messages[0].role).toBe("system")
    expect(messages[0].text).toContain("coding challenge interpreter")
    expect(messages[1].role).toBe("user")
    expect(messages[1].text).toContain("java")
    expect(messages[1].images).toHaveLength(2)
    expect(messages[1].images?.[0]).toEqual({ data: "aGVsbG8=", mimeType: "image/png" })
  })
})

describe("buildSolutionPrompt", () => {
  it("embeds problem fields and language", () => {
    const prompt = buildSolutionPrompt(
      {
        problem_statement: "Find the median",
        constraints: "O(log n) required",
        example_input: "[1,2,3]",
        example_output: "2"
      },
      "cpp"
    )
    expect(prompt).toContain("Find the median")
    expect(prompt).toContain("O(log n) required")
    expect(prompt).toContain("LANGUAGE: cpp")
  })

  it("uses fallback text for missing optional fields", () => {
    const prompt = buildSolutionPrompt({ problem_statement: "X" }, "python")
    expect(prompt).toContain("No specific constraints provided.")
    expect(prompt).toContain("No example input provided.")
    expect(prompt).toContain("No example output provided.")
  })
})

describe("buildSolutionMessages", () => {
  it("carries no images and an expert-system instruction", () => {
    const messages = buildSolutionMessages({ problem_statement: "X" }, "python")
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe("system")
    expect(messages[0].text).toContain("expert coding interview assistant")
    expect(messages[1].images).toBeUndefined()
  })
})

describe("buildDebugMessages", () => {
  it("includes the required section structure and screenshots", () => {
    const messages = buildDebugMessages(
      { problem_statement: "Binary search" },
      "go",
      IMAGES
    )
    expect(messages[0].text).toContain("### Issues Identified")
    expect(messages[0].text).toContain("### Key Points")
    expect(messages[1].text).toContain('"Binary search"')
    expect(messages[1].text).toContain("go")
    expect(messages[1].images).toHaveLength(2)
  })
})
