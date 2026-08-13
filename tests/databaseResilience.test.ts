// Resilience tests for the SQLite store: corrupt legacy JSON import, corrupt
// rows on disk, transaction rollback on write failure, and backup/restore.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import { Database } from "../electron/core/db/Database"

const dirs: string[] = []
const tempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-dbres-test-"))
  dirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("corrupt legacy JSON migration", () => {
  it("survives invalid legacy JSON and starts empty", () => {
    const dir = tempDir()
    const legacy = path.join(dir, "assistant-db.json")
    fs.writeFileSync(legacy, "{definitely broken json")
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)

    const db = new Database(path.join(dir, "assistant.db"), legacy)
    expect(db.table<{ id: string }>("jobs").all()).toEqual([])
    // The broken file is left in place for manual inspection, not renamed.
    expect(fs.existsSync(legacy)).toBe(true)
    expect(fs.existsSync(`${legacy}.migrated`)).toBe(false)

    db.close()
    errorSpy.mockRestore()
  })

  it("does not re-import legacy data on subsequent boots", () => {
    const dir = tempDir()
    const legacy = path.join(dir, "assistant-db.json")
    fs.writeFileSync(
      legacy,
      JSON.stringify({ schemaVersion: 1, tables: { jobs: [{ id: "j1", title: "A" }] } })
    )
    const file = path.join(dir, "assistant.db")

    const first = new Database(file, legacy)
    expect(first.table<{ id: string }>("jobs").all()).toHaveLength(1)
    first.table<{ id: string }>("jobs").delete("j1")
    first.close()

    // Legacy file was renamed; a reopen must not resurrect deleted rows.
    const second = new Database(file, legacy)
    expect(second.table<{ id: string }>("jobs").all()).toHaveLength(0)
    second.close()
  })
})

describe("corrupt rows on disk", () => {
  it("skips unreadable rows and loads the rest", () => {
    const dir = tempDir()
    const file = path.join(dir, "assistant.db")
    const db = new Database(file)
    db.table<{ id: string; v: string }>("sample").insert({ id: "good", v: "ok" })
    db.flush()
    db.close()

    // Corrupt one row directly in SQLite.
    const { DatabaseSync } = require("node:sqlite")
    const raw = new DatabaseSync(file)
    raw
      .prepare("INSERT INTO app_rows(table_name, id, data) VALUES (?, ?, ?)")
      .run("sample", "bad", "{corrupt json")
    raw.close()

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
    const reopened = new Database(file)
    const rows = reopened.table<{ id: string; v: string }>("sample").all()
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe("good")
    expect(errorSpy).toHaveBeenCalled()
    reopened.close()
    errorSpy.mockRestore()
  })
})

describe("transaction rollback", () => {
  it("keeps the last consistent snapshot when a write fails mid-transaction", () => {
    const dir = tempDir()
    const file = path.join(dir, "assistant.db")
    const db = new Database(file)
    const table = db.table<{ id: string; v?: unknown }>("sample")
    table.insert({ id: "keep", v: 1 })
    db.flush()

    // A row that cannot be serialized makes flush() fail mid-transaction.
    const poison: { id: string; v?: unknown } = { id: "poison" }
    poison.v = poison // circular
    db.rawTable("sample").push(poison)
    db.markDirty()
    expect(() => db.flush()).toThrow()

    // Remove the poison row and flush cleanly before closing.
    const raw = db.rawTable("sample")
    raw.splice(raw.findIndex((r) => r.id === "poison"), 1)
    db.markDirty()
    db.flush()
    db.close()

    // On-disk state contains the consistent data, nothing partial.
    const reopened = new Database(file)
    const rows = reopened.table<{ id: string }>("sample").all()
    expect(rows.map((r) => r.id)).toEqual(["keep"])
    reopened.close()
  })
})

describe("backup and restore", () => {
  it("produces an openable backup with identical data", () => {
    const dir = tempDir()
    const db = new Database(path.join(dir, "assistant.db"))
    db.migrate()
    db.table<{ id: string; title: string }>("jobs").insert({ title: "Engineer" })
    db.flush()

    const backupDir = path.join(dir, "backups")
    const backupPath = db.backup(backupDir)
    expect(fs.existsSync(backupPath)).toBe(true)
    db.close()

    // Restoring = opening the backup file directly.
    const restored = new Database(backupPath)
    expect(restored.schemaVersion).toBeGreaterThanOrEqual(1)
    const jobs = restored.table<{ id: string; title: string }>("jobs").all()
    expect(jobs).toHaveLength(1)
    expect(jobs[0].title).toBe("Engineer")
    restored.close()
  })

  it("backups taken after more writes contain the newer data", () => {
    const dir = tempDir()
    const db = new Database(path.join(dir, "assistant.db"))
    db.table<{ id: string; n: number }>("sample").insert({ id: "a", n: 1 })
    const backup1 = db.backup(path.join(dir, "b1"))
    db.table<{ id: string; n: number }>("sample").insert({ id: "b", n: 2 })
    const backup2 = db.backup(path.join(dir, "b2"))
    db.close()

    const first = new Database(backup1)
    const second = new Database(backup2)
    expect(first.table("sample").all()).toHaveLength(1)
    expect(second.table("sample").all()).toHaveLength(2)
    first.close()
    second.close()
  })
})
