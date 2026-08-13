import { describe, it, expect } from "vitest"
import { extractJson, parseJsonResponse, stripJsonFences } from "../electron/core/ai/json"

describe("json extraction", () => {
  it("strips ```json fences", () => {
    expect(stripJsonFences('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it("extracts a balanced object ignoring surrounding prose", () => {
    const text = 'Sure! Here is the result:\n{"title":"Engineer","n":3} Hope this helps.'
    expect(extractJson(text)).toBe('{"title":"Engineer","n":3}')
  })

  it("does not get confused by braces inside strings", () => {
    const text = '{"note":"use {curly} braces","ok":true}'
    expect(parseJsonResponse(text)).toEqual({ note: "use {curly} braces", ok: true })
  })

  it("extracts arrays", () => {
    expect(parseJsonResponse('[1,2,{"x":[3]}]')).toEqual([1, 2, { x: [3] }])
  })

  it("throws when there is no JSON", () => {
    expect(() => parseJsonResponse("no json here")).toThrow()
  })
})
