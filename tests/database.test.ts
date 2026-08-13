import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { Database } from "../electron/core/db/Database"

const dirs: string[] = []
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-db-test-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("SQLite Database", () => {
  it("persists rows and schema version", () => {
    const file = path.join(tempDir(), "assistant.db")
    const first = new Database(file)
    first.migrate()
    first.table<{ id: string; value: string }>("sample").insert({ value: "ok" })
    first.flush()
    first.close()

    const reopened = new Database(file)
    expect(reopened.schemaVersion).toBe(1)
    expect(reopened.table<{ id: string; value: string }>("sample").all()).toHaveLength(1)
    reopened.close()
  })

  it("imports the legacy JSON store once", () => {
    const dir = tempDir()
    const legacy = path.join(dir, "assistant-db.json")
    fs.writeFileSync(legacy, JSON.stringify({ schemaVersion: 1, tables: { jobs: [{ id: "j1", title: "Engineer" }] } }))
    const db = new Database(path.join(dir, "assistant.db"), legacy)
    expect(db.table<{ id: string; title: string }>("jobs").get("j1")?.title).toBe("Engineer")
    expect(fs.existsSync(`${legacy}.migrated`)).toBe(true)
    db.close()
  })
})
