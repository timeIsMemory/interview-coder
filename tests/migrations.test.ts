import { describe, it, expect } from "vitest"
import { latestVersion, pendingMigrations, type Migration } from "../electron/core/db/migrations"

const noop = () => undefined
const mk = (version: number): Migration => ({ version, name: `m${version}`, up: noop })

describe("pendingMigrations", () => {
  it("returns only migrations above current, sorted ascending", () => {
    const all = [mk(3), mk(1), mk(2)]
    expect(pendingMigrations(1, all).map((m) => m.version)).toEqual([2, 3])
  })

  it("returns empty when up to date", () => {
    expect(pendingMigrations(3, [mk(1), mk(2), mk(3)])).toEqual([])
  })

  it("throws on duplicate versions", () => {
    expect(() => pendingMigrations(0, [mk(1), mk(1)])).toThrow(/Duplicate/)
  })

  it("throws on non-positive versions", () => {
    expect(() => pendingMigrations(0, [mk(0)])).toThrow()
  })

  it("computes the latest version", () => {
    expect(latestVersion([mk(2), mk(5), mk(3)])).toBe(5)
  })
})
