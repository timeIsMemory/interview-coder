// Pure migration selection/ordering logic. Kept dependency-free so it can be
// unit tested without touching disk or Electron. The actual `up` functions
// receive the Database instance at runtime.

import type { Database } from "./Database"

export interface Migration {
  version: number
  name: string
  up: (db: Database) => void
}

/**
 * Given the current applied version and the full migration set, return the
 * migrations that still need to run, in ascending version order. Throws if the
 * set has duplicate or non-positive versions so mistakes fail loudly.
 */
export function pendingMigrations(currentVersion: number, all: Migration[]): Migration[] {
  const seen = new Set<number>()
  for (const m of all) {
    if (m.version <= 0) throw new Error(`Migration version must be > 0: ${m.name}`)
    if (seen.has(m.version)) throw new Error(`Duplicate migration version: ${m.version}`)
    seen.add(m.version)
  }
  return all
    .filter((m) => m.version > currentVersion)
    .sort((a, b) => a.version - b.version)
}

export function latestVersion(all: Migration[]): number {
  return all.reduce((max, m) => Math.max(max, m.version), 0)
}

/**
 * The schema for the assistant. Each migration creates the tables/indexes it
 * needs. With the JSON store, "creating a table" just ensures the collection
 * exists; the real value is versioned, ordered, idempotent evolution.
 */
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "initial-schema",
    up: (db) => {
      const tables = [
        "profiles",
        "profile_versions",
        "facts",
        "fact_evidence",
        "resume_templates",
        "jobs",
        "job_versions",
        "job_sources",
        "import_runs",
        "scrape_runs",
        "generation_runs",
        "generation_steps",
        "artifacts",
        "artifact_revisions",
        "question_sets",
        "questions",
        "prepared_answers",
        "recording_sessions",
        "media_files",
        "transcript_segments",
        "review_reports",
        "applications",
        "application_events",
        "app_settings"
      ]
      for (const t of tables) db.ensureTable(t)
    }
  }
]
