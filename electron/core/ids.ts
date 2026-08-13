// Dependency-free identity and hashing helpers.
// Uses only Node built-ins so this module is safe to import from unit tests
// without pulling in Electron or any native module.
import { createHash, randomUUID } from "node:crypto"

/** Generate a stable internal UUID (v4). */
export function newId(): string {
  return randomUUID()
}

/** Deterministic sha256 hex of the given string. */
export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex")
}

/**
 * Normalize free text for hashing/dedup: lowercase, collapse whitespace,
 * strip zero-width characters and most punctuation noise. The goal is that
 * two JD texts that differ only by formatting produce the same hash.
 */
export function normalizeForHash(input: string | null | undefined): string {
  if (!input) return ""
  return input
    .replace(/\u200b|\u200c|\u200d|\ufeff/g, "")
    .replace(/[\t\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[·•∙‧・]/g, " ")
    .trim()
    .toLowerCase()
}

/** Short, human-friendly id fragment for logs/filenames (not a UUID). */
export function shortId(length = 8): string {
  return randomUUID().replace(/-/g, "").slice(0, Math.max(4, length))
}
