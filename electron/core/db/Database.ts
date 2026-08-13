import fs from "node:fs"
import path from "node:path"
import { newId } from "../ids"
import { MIGRATIONS, latestVersion, pendingMigrations, type Migration } from "./migrations"

interface SqliteStatement {
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): unknown
}

interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
  close(): void
}

const { DatabaseSync } = require("node:sqlite") as {
  DatabaseSync: new (filePath: string) => SqliteDatabase
}

export interface Row {
  id: string
}

interface PersistedJson {
  schemaVersion?: number
  tables?: Record<string, Row[]>
}

export interface QueryFilter<T> {
  where?: (row: T) => boolean
  sort?: (a: T, b: T) => number
  limit?: number
  offset?: number
}

export class Table<T extends { id: string }> {
  constructor(private db: Database, private name: string) {}

  private rows(): Row[] {
    return this.db.rawTable(this.name)
  }

  all(): T[] {
    return this.rows().map((row) => ({ ...row })) as T[]
  }

  find(filter: QueryFilter<T> = {}): T[] {
    let result = this.all()
    if (filter.where) result = result.filter(filter.where)
    if (filter.sort) result.sort(filter.sort)
    if (filter.offset) result = result.slice(filter.offset)
    if (filter.limit != null) result = result.slice(0, filter.limit)
    return result
  }

  findOne(where: (row: T) => boolean): T | null {
    const row = this.rows().find((candidate) => where(candidate as T))
    return row ? ({ ...row } as T) : null
  }

  get(id: string): T | null {
    return this.findOne((row) => row.id === id)
  }

  count(where?: (row: T) => boolean): number {
    return where ? this.rows().filter((row) => where(row as T)).length : this.rows().length
  }

  insert(row: Omit<T, "id"> & { id?: string }): T {
    const record = { ...row, id: row.id || newId() } as T
    this.rows().push(record)
    this.db.markDirty()
    return { ...record }
  }

  update(id: string, patch: Partial<T>): T | null {
    const rows = this.rows()
    const index = rows.findIndex((row) => row.id === id)
    if (index < 0) return null
    rows[index] = { ...rows[index], ...patch, id }
    this.db.markDirty()
    return { ...rows[index] } as T
  }

  upsert(row: T): T {
    return row.id && this.get(row.id) ? (this.update(row.id, row) as T) : this.insert(row)
  }

  delete(id: string): boolean {
    const rows = this.rows()
    const index = rows.findIndex((row) => row.id === id)
    if (index < 0) return false
    rows.splice(index, 1)
    this.db.markDirty()
    return true
  }

  deleteWhere(where: (row: T) => boolean): number {
    const rows = this.rows()
    let removed = 0
    for (let index = rows.length - 1; index >= 0; index--) {
      if (where(rows[index] as T)) {
        rows.splice(index, 1)
        removed++
      }
    }
    if (removed) this.db.markDirty()
    return removed
  }
}

export class Database {
  private sqlite: SqliteDatabase
  private tables: Record<string, Row[]> = {}
  private currentSchemaVersion = 0
  private dirty = false
  private saveTimer: NodeJS.Timeout | null = null

  constructor(private filePath: string, legacyJsonPath?: string) {
    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    this.sqlite = new DatabaseSync(filePath)
    this.sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;")
    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS app_rows (
        table_name TEXT NOT NULL,
        id TEXT NOT NULL,
        data TEXT NOT NULL,
        PRIMARY KEY (table_name, id)
      );
      CREATE INDEX IF NOT EXISTS idx_app_rows_table ON app_rows(table_name);
    `)
    this.load()
    if (legacyJsonPath && Object.keys(this.tables).length === 0) this.importLegacyJson(legacyJsonPath)
  }

  private load(): void {
    const version = this.sqlite.prepare("SELECT value FROM app_meta WHERE key = 'schemaVersion'").get() as
      | { value: string }
      | undefined
    this.currentSchemaVersion = Number(version?.value || 0)
    const rows = this.sqlite.prepare("SELECT table_name, data FROM app_rows ORDER BY rowid").all() as Array<{
      table_name: string
      data: string
    }>
    for (const entry of rows) {
      try {
        const row = JSON.parse(entry.data) as Row
        ;(this.tables[entry.table_name] ||= []).push(row)
      } catch (error) {
        console.error(`Skipping corrupt row in ${entry.table_name}:`, error)
      }
    }
  }

  private importLegacyJson(legacyPath: string): void {
    if (!fs.existsSync(legacyPath)) return
    try {
      const legacy = JSON.parse(fs.readFileSync(legacyPath, "utf8")) as PersistedJson
      this.tables = legacy.tables || {}
      this.currentSchemaVersion = legacy.schemaVersion || 0
      this.dirty = true
      this.flush()
      fs.renameSync(legacyPath, `${legacyPath}.migrated`)
    } catch (error) {
      console.error("Legacy database import failed:", error)
    }
  }

  rawTable(name: string): Row[] {
    return (this.tables[name] ||= [])
  }

  ensureTable(name: string): void {
    if (!this.tables[name]) {
      this.tables[name] = []
      this.markDirty()
    }
  }

  table<T extends { id: string }>(name: string): Table<T> {
    this.ensureTable(name)
    return new Table<T>(this, name)
  }

  get schemaVersion(): number {
    return this.currentSchemaVersion
  }

  migrate(migrations: Migration[] = MIGRATIONS): void {
    const pending = pendingMigrations(this.currentSchemaVersion, migrations)
    for (const migration of pending) {
      migration.up(this)
      this.currentSchemaVersion = migration.version
    }
    if (pending.length) {
      this.currentSchemaVersion = latestVersion(migrations)
      this.dirty = true
      this.flush()
    }
  }

  markDirty(): void {
    this.dirty = true
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      this.flush()
    }, 150)
  }

  flush(): void {
    if (!this.dirty) return
    try {
      this.sqlite.exec("BEGIN IMMEDIATE")
      this.sqlite.prepare("DELETE FROM app_rows").run()
      const insert = this.sqlite.prepare("INSERT INTO app_rows(table_name, id, data) VALUES (?, ?, ?)")
      for (const [tableName, rows] of Object.entries(this.tables)) {
        for (const row of rows) insert.run(tableName, row.id, JSON.stringify(row))
      }
      this.sqlite
        .prepare("INSERT INTO app_meta(key, value) VALUES ('schemaVersion', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
        .run(String(this.currentSchemaVersion))
      this.sqlite.exec("COMMIT")
    } catch (error) {
      try { this.sqlite.exec("ROLLBACK") } catch { /* no transaction to roll back */ }
      throw error
    }
    this.dirty = false
  }

  backup(destDir: string): string {
    this.flush()
    if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const destination = path.join(destDir, `assistant-backup-${stamp}.db`)
    this.sqlite.exec("PRAGMA wal_checkpoint(FULL)")
    fs.copyFileSync(this.filePath, destination)
    return destination
  }

  close(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.flush()
    this.sqlite.close()
  }
}

let singleton: Database | null = null

export function initDatabase(filePath: string, legacyJsonPath?: string): Database {
  singleton?.close()
  singleton = new Database(filePath, legacyJsonPath)
  singleton.migrate()
  return singleton
}

export function getDatabase(): Database {
  if (!singleton) throw new Error("Database not initialized. Call initDatabase() first.")
  return singleton
}
