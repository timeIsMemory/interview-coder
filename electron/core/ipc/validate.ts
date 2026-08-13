// Small, dependency-free IPC input guards. The renderer is trusted-ish but we
// still validate at this boundary so a bug (or a compromised renderer) can't
// send oversized payloads or traverse the filesystem.

import path from "node:path"
import fs from "node:fs"
import { redactError, redactSecrets } from "../security/redact"

export function asString(value: unknown, field: string, maxLen = 200_000): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`)
  if (value.length > maxLen) throw new Error(`${field} exceeds max length ${maxLen}`)
  return value
}

export function asOptionalString(value: unknown, field: string, maxLen = 200_000): string | undefined {
  if (value == null) return undefined
  return asString(value, field, maxLen)
}

export function asStringArray(value: unknown, field: string, maxItems = 1000): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  if (value.length > maxItems) throw new Error(`${field} has too many items`)
  return value.map((v, i) => asString(v, `${field}[${i}]`, 500))
}

export function asBoolean(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`)
  return value
}

export function asNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || Number.isNaN(value)) throw new Error(`${field} must be a number`)
  return value
}

const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50MB
const ALLOWED_EXT = new Set([
  ".pdf", ".docx", ".txt", ".md", ".csv", ".json", ".html",
  ".mp3", ".wav", ".m4a", ".mp4", ".webm", ".ogg"
])

/** Validate a user-selected file path: must exist, be a regular file, allowed
 * extension, and within size limits. Returns the resolved absolute path. */
export function validateFilePath(value: unknown, field = "filePath"): string {
  const p = asString(value, field, 4096)
  const resolved = path.resolve(p)
  if (!fs.existsSync(resolved)) throw new Error("File does not exist")
  const stat = fs.statSync(resolved)
  if (!stat.isFile()) throw new Error("Path is not a file")
  if (stat.size > MAX_FILE_BYTES) throw new Error("File is too large")
  const ext = path.extname(resolved).toLowerCase()
  if (!ALLOWED_EXT.has(ext)) throw new Error(`Unsupported file type: ${ext}`)
  return resolved
}

/** Wrap a handler so thrown errors return a structured, non-crashing result.
 * Both the log line and the error surfaced to the renderer are redacted so
 * provider errors can never leak API keys (Gemini embeds them in URLs). */
export function safe<T extends unknown[], R>(
  fn: (...args: T) => Promise<R> | R
): (...args: T) => Promise<{ ok: true; data: R } | { ok: false; error: string }> {
  return async (...args: T) => {
    try {
      const data = await fn(...args)
      return { ok: true, data }
    } catch (err) {
      console.error("IPC handler error:", redactError(err))
      return { ok: false, error: redactSecrets((err as Error).message || "Unknown error") }
    }
  }
}
