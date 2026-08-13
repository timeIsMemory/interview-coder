// Pure helpers for extracting JSON out of a model response. Models frequently
// wrap JSON in ```json fences or add prose before/after; this recovers the
// first balanced JSON object/array. Dependency-free and unit-tested.

/** Strip markdown code fences and surrounding prose, returning candidate JSON. */
export function stripJsonFences(text: string): string {
  if (!text) return ""
  let t = text.trim()
  // Remove ```json ... ``` or ``` ... ``` fences.
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence && fence[1]) {
    t = fence[1].trim()
  }
  return t
}

/**
 * Extract the first balanced JSON value from arbitrary text. Handles strings
 * and escapes so braces inside string literals don't confuse the scanner.
 * Returns null if no balanced object/array is found.
 */
export function extractJson(text: string): string | null {
  const t = stripJsonFences(text)
  const startObj = t.indexOf("{")
  const startArr = t.indexOf("[")
  let start = -1
  if (startObj === -1) start = startArr
  else if (startArr === -1) start = startObj
  else start = Math.min(startObj, startArr)
  if (start === -1) return null

  const open = t[start]
  const close = open === "{" ? "}" : "]"
  let depth = 0
  let inString = false
  let escaped = false

  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (ch === "\\") {
        escaped = true
      } else if (ch === '"') {
        inString = false
      }
      continue
    }
    if (ch === '"') {
      inString = true
    } else if (ch === open) {
      depth++
    } else if (ch === close) {
      depth--
      if (depth === 0) {
        return t.slice(start, i + 1)
      }
    }
  }
  return null
}

/** Parse a model response into JSON, tolerant of fences/prose. Throws on failure. */
export function parseJsonResponse<T = unknown>(text: string): T {
  const candidate = extractJson(text)
  if (candidate == null) {
    throw new Error("No JSON found in response")
  }
  return JSON.parse(candidate) as T
}
