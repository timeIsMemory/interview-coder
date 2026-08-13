// Structured-output validation for the screenshot solver. Ports the parsing
// logic that used to be copy-pasted per provider inside ProcessingHelper into
// pure, unit-tested functions operating on the raw model text.

import { parseJsonResponse } from "../ai/json"
import { DebugPayload, ProblemInfo, SolutionPayload, SolverParseError } from "./types"

function asOptionalString(value: unknown): string | undefined {
  if (value == null) return undefined
  if (typeof value === "string") return value
  // Models occasionally return arrays or objects for constraints/examples.
  try {
    return typeof value === "object" ? JSON.stringify(value) : String(value)
  } catch {
    return String(value)
  }
}

/** Parse and validate the extraction step output. Throws SolverParseError. */
export function parseProblemInfo(text: string): ProblemInfo {
  let data: unknown
  try {
    data = parseJsonResponse(text)
  } catch (err) {
    throw new SolverParseError(
      `Model did not return valid problem JSON: ${(err as Error).message}`,
      text
    )
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new SolverParseError("Problem JSON must be an object", text)
  }
  const record = data as Record<string, unknown>
  const statement = asOptionalString(record.problem_statement)
  if (!statement || !statement.trim()) {
    throw new SolverParseError("Problem JSON is missing problem_statement", text)
  }
  return {
    problem_statement: statement,
    constraints: asOptionalString(record.constraints),
    example_input: asOptionalString(record.example_input),
    example_output: asOptionalString(record.example_output)
  }
}

function normalizeComplexity(raw: string, fallback: string): string {
  let value = raw.trim()
  if (!value) return fallback
  if (!value.match(/O\([^)]+\)/i)) {
    return `O(n) - ${value}`
  }
  if (!value.includes("-") && !value.includes("because")) {
    const notationMatch = value.match(/O\([^)]+\)/i)
    if (notationMatch) {
      const notation = notationMatch[0]
      const rest = value.replace(notation, "").trim()
      value = `${notation} - ${rest}`
    }
  }
  return value
}

const DEFAULT_TIME_COMPLEXITY =
  "O(n) - Linear time complexity because we only iterate through the array once. Each element is processed exactly one time, and the hashmap lookups are O(1) operations."
const DEFAULT_SPACE_COMPLEXITY =
  "O(n) - Linear space complexity because we store elements in the hashmap. In the worst case, we might need to store all elements before finding the solution pair."

/** Parse the solution step output into code/thoughts/complexities. */
export function parseSolutionResponse(responseContent: string): SolutionPayload {
  const codeMatch = responseContent.match(/```(?:\w+)?\s*([\s\S]*?)```/)
  const code = codeMatch ? codeMatch[1].trim() : responseContent

  const thoughtsRegex =
    /(?:Thoughts:|Key Insights:|Reasoning:|Approach:)([\s\S]*?)(?:Time complexity:|$)/i
  const thoughtsMatch = responseContent.match(thoughtsRegex)
  let thoughts: string[] = []
  if (thoughtsMatch && thoughtsMatch[1]) {
    const bulletPoints = thoughtsMatch[1].match(/(?:^|\n)\s*(?:[-*•]|\d+\.)\s*(.*)/g)
    if (bulletPoints) {
      thoughts = bulletPoints
        .map((point) => point.replace(/^\s*(?:[-*•]|\d+\.)\s*/, "").trim())
        .filter(Boolean)
    } else {
      thoughts = thoughtsMatch[1]
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
    }
  }

  const timeComplexityPattern =
    /Time complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:Space complexity|$))/i
  const spaceComplexityPattern =
    /Space complexity:?\s*([^\n]+(?:\n[^\n]+)*?)(?=\n\s*(?:[A-Z]|$))/i

  const timeMatch = responseContent.match(timeComplexityPattern)
  const spaceMatch = responseContent.match(spaceComplexityPattern)

  return {
    code,
    thoughts:
      thoughts.length > 0
        ? thoughts
        : ["Solution approach based on efficiency and readability"],
    time_complexity: normalizeComplexity(timeMatch?.[1] ?? "", DEFAULT_TIME_COMPLEXITY),
    space_complexity: normalizeComplexity(spaceMatch?.[1] ?? "", DEFAULT_SPACE_COMPLEXITY)
  }
}

/** Parse the debug step output into analysis text + extracted code/thoughts. */
export function parseDebugResponse(debugContent: string): DebugPayload {
  let extractedCode = "// Debug mode - see analysis below"
  const codeMatch = debugContent.match(/```(?:[a-zA-Z]+)?([\s\S]*?)```/)
  if (codeMatch && codeMatch[1]) {
    extractedCode = codeMatch[1].trim()
  }

  let formattedDebugContent = debugContent
  if (!debugContent.includes("# ") && !debugContent.includes("## ")) {
    formattedDebugContent = debugContent
      .replace(/issues identified|problems found|bugs found/i, "## Issues Identified")
      .replace(/code improvements|improvements|suggested changes/i, "## Code Improvements")
      .replace(/optimizations|performance improvements/i, "## Optimizations")
      .replace(/explanation|detailed analysis/i, "## Explanation")
  }

  const bulletPoints = formattedDebugContent.match(/(?:^|\n)[ ]*(?:[-*•]|\d+\.)[ ]+([^\n]+)/g)
  // \s* (not [ ]*) so the leading newline captured by the global match above
  // is consumed and every bullet loses its marker, not just the first one.
  const thoughts = bulletPoints
    ? bulletPoints
        .map((point) => point.replace(/^\s*(?:[-*•]|\d+\.)[ ]+/, "").trim())
        .slice(0, 5)
    : ["Debug analysis based on your screenshots"]

  return {
    code: extractedCode,
    debug_analysis: formattedDebugContent,
    thoughts,
    time_complexity: "N/A - Debug mode",
    space_complexity: "N/A - Debug mode"
  }
}
