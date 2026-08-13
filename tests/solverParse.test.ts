import { describe, expect, it } from "vitest"
import {
  parseDebugResponse,
  parseProblemInfo,
  parseSolutionResponse
} from "../electron/core/solver/parse"
import { SolverParseError } from "../electron/core/solver/types"

describe("parseProblemInfo", () => {
  it("parses plain JSON", () => {
    const info = parseProblemInfo(
      JSON.stringify({
        problem_statement: "Two sum",
        constraints: "n <= 10^5",
        example_input: "[1,2]",
        example_output: "3"
      })
    )
    expect(info.problem_statement).toBe("Two sum")
    expect(info.constraints).toBe("n <= 10^5")
  })

  it("parses JSON wrapped in markdown fences with prose", () => {
    const text = 'Here you go:\n```json\n{"problem_statement": "Reverse a list"}\n```\nGood luck!'
    expect(parseProblemInfo(text).problem_statement).toBe("Reverse a list")
  })

  it("stringifies non-string fields instead of dropping them", () => {
    const info = parseProblemInfo(
      JSON.stringify({
        problem_statement: "X",
        constraints: ["a", "b"],
        example_input: 42
      })
    )
    expect(info.constraints).toBe('["a","b"]')
    expect(info.example_input).toBe("42")
  })

  it("throws SolverParseError when no JSON is present", () => {
    expect(() => parseProblemInfo("sorry, I cannot help")).toThrow(SolverParseError)
  })

  it("throws SolverParseError when problem_statement is missing", () => {
    expect(() => parseProblemInfo('{"constraints": "none"}')).toThrow(SolverParseError)
    expect(() => parseProblemInfo('{"problem_statement": "  "}')).toThrow(SolverParseError)
  })

  it("throws SolverParseError for JSON arrays", () => {
    expect(() => parseProblemInfo('["not", "an", "object"]')).toThrow(SolverParseError)
  })
})

describe("parseSolutionResponse", () => {
  const full = [
    "Thoughts:",
    "- Use a hashmap for O(1) lookups",
    "- Iterate once",
    "",
    "```python",
    "def two_sum(nums, target):",
    "    seen = {}",
    "```",
    "",
    "Time complexity: O(n) because we iterate through the array only once. Each lookup is constant.",
    "Space complexity: O(n) because the hashmap can hold all elements. It grows linearly."
  ].join("\n")

  it("extracts code from the fenced block", () => {
    const parsed = parseSolutionResponse(full)
    expect(parsed.code).toContain("def two_sum")
    expect(parsed.code).not.toContain("```")
  })

  it("extracts bullet-point thoughts", () => {
    const parsed = parseSolutionResponse(full)
    expect(parsed.thoughts).toEqual([
      "Use a hashmap for O(1) lookups",
      "Iterate once"
    ])
  })

  it("extracts both complexity sections", () => {
    const parsed = parseSolutionResponse(full)
    expect(parsed.time_complexity).toMatch(/^O\(n\)/)
    expect(parsed.space_complexity).toMatch(/^O\(n\)/)
  })

  it("falls back to whole text as code when no fence exists", () => {
    const parsed = parseSolutionResponse("just plain text")
    expect(parsed.code).toBe("just plain text")
  })

  it("provides default thoughts and complexities when sections are missing", () => {
    const parsed = parseSolutionResponse("```js\nlet a = 1\n```")
    expect(parsed.thoughts).toEqual([
      "Solution approach based on efficiency and readability"
    ])
    expect(parsed.time_complexity).toContain("O(n)")
    expect(parsed.space_complexity).toContain("O(n)")
  })

  it("prefixes complexity with O(n) when notation is absent", () => {
    const parsed = parseSolutionResponse(
      "Time complexity: linear scan of the input\nSpace complexity: constant extra memory"
    )
    expect(parsed.time_complexity.startsWith("O(n) - ")).toBe(true)
  })

  it("inserts a dash between notation and explanation when missing", () => {
    const parsed = parseSolutionResponse(
      "Time complexity: O(log n) binary search halves the range\nSpace complexity: O(1) no extra allocations here"
    )
    expect(parsed.time_complexity).toBe("O(log n) - binary search halves the range")
  })
})

describe("parseDebugResponse", () => {
  it("extracts code and keeps structured markdown untouched", () => {
    const content = [
      "### Issues Identified",
      "- Off-by-one error in loop",
      "- Missing null check",
      "",
      "```java",
      "for (int i = 0; i < n; i++) {}",
      "```"
    ].join("\n")
    const parsed = parseDebugResponse(content)
    expect(parsed.code).toContain("for (int i = 0;")
    expect(parsed.debug_analysis).toContain("### Issues Identified")
    expect(parsed.thoughts).toEqual([
      "Off-by-one error in loop",
      "Missing null check"
    ])
    expect(parsed.time_complexity).toBe("N/A - Debug mode")
  })

  it("uses placeholder code when no fence exists", () => {
    const parsed = parseDebugResponse("issues identified: the loop is wrong")
    expect(parsed.code).toBe("// Debug mode - see analysis below")
  })

  it("injects markdown headers into unstructured responses", () => {
    const parsed = parseDebugResponse("issues identified\nthe loop bound is wrong")
    expect(parsed.debug_analysis).toContain("## Issues Identified")
  })

  it("caps extracted thoughts at five bullets", () => {
    const bullets = Array.from({ length: 8 }, (_, i) => `- point ${i + 1}`).join("\n")
    const parsed = parseDebugResponse(`## Issues\n${bullets}`)
    expect(parsed.thoughts).toHaveLength(5)
  })
})
