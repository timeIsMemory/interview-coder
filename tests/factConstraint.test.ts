import { describe, it, expect } from "vitest"
import { checkFactSupport } from "../electron/modules/profile/factConstraint"

const corpus = [
  { id: "F1", text: "Backend engineer at Acme. Improved API latency by 30% over 3 years." },
  { id: "F2", text: "Led a team using Node.js and PostgreSQL." }
]

describe("checkFactSupport", () => {
  it("passes text whose numbers are supported by facts", () => {
    const res = checkFactSupport(
      "Improved latency by 30% and worked for 3 years on the platform.",
      corpus
    )
    expect(res.supported).toBe(true)
    expect(res.issues).toEqual([])
  })

  it("flags an unsupported number claim", () => {
    const res = checkFactSupport("Boosted revenue by 85% in one quarter.", corpus)
    expect(res.supported).toBe(false)
    expect(res.issues.some((i) => i.claim.includes("85"))).toBe(true)
    expect(res.issues[0].reason).toBe("unsupported-number")
  })

  it("flags an unsupported known entity", () => {
    const res = checkFactSupport("Worked closely with Google on the project.", corpus, {
      knownEntities: ["Google"]
    })
    expect(res.supported).toBe(false)
    expect(res.issues.some((i) => i.reason === "unsupported-entity")).toBe(true)
  })

  it("ignores small single-digit quantities", () => {
    const res = checkFactSupport("Led 1 team and shipped features.", corpus)
    expect(res.supported).toBe(true)
  })
})
