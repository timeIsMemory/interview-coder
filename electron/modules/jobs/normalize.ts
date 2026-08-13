// Pure JD normalization + dedup key computation. No DB, no AI, no Electron, so
// this is fully unit-testable. The LLM-based structured extraction lives in the
// service; this module handles deterministic cleanup, field heuristics, hashing
// and duplicate detection.

import { normalizeForHash, sha256 } from "../../core/ids"
import type { JobPlatform, NormalizedJobFields, RawJobPayload } from "./types"

/** Strip HTML tags and decode a few common entities into readable text. */
export function htmlToText(input: string): string {
  if (!input) return ""
  return input
    .replace(/<\s*(script|style)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, " ")
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|li|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim()
}

/** Detect the platform from a job URL host, best-effort. */
export function detectPlatform(url?: string): JobPlatform {
  if (!url) return "unknown"
  const u = url.toLowerCase()
  if (u.includes("zhipin.com")) return "zhipin"
  if (u.includes("lagou.com")) return "lagou"
  if (u.includes("liepin.com")) return "liepin"
  if (u.includes("51job.com") || u.includes("jobs.51job")) return "51job"
  if (u.includes("linkedin.com")) return "linkedin"
  return "unknown"
}

/** Extract a platform position id from common URL shapes. */
export function extractPositionId(url?: string): string | undefined {
  if (!url) return undefined
  const m =
    url.match(/\/job_detail\/([a-z0-9~_-]+)/i) ||
    url.match(/\/jobs\/(\d+)/i) ||
    url.match(/[?&](?:jobId|positionId|currentPage|securityId)=([^&]+)/i) ||
    url.match(/\/(\d{6,})(?:\.html)?/)
  return m ? m[1] : undefined
}

/**
 * Deterministic normalization of a raw payload into JD fields, merging any
 * structured hints the adapter provided (which win over heuristics).
 */
export function normalizeFields(raw: RawJobPayload): NormalizedJobFields {
  const text = htmlToText(raw.content)
  const hints = raw.hints || {}
  const platformUrl = hints.jobUrl || raw.jobUrl

  const description = (hints.description && hints.description.trim()) || text
  const title = (hints.title || guessTitle(text) || "Untitled role").trim()
  const company = (hints.company || guessCompany(text) || "Unknown company").trim()

  return {
    title,
    company,
    salary: hints.salary || guessSalary(text),
    city: hints.city || guessCity(text),
    description,
    positionId: hints.positionId || extractPositionId(platformUrl),
    tags: hints.tags || [],
    jobUrl: platformUrl
  }
}

function firstNonEmptyLine(text: string): string | undefined {
  const line = text.split(/\n/).map((l) => l.trim()).find((l) => l.length > 0)
  return line
}

function guessTitle(text: string): string | undefined {
  const labelled = text.match(/(?:职位名称|岗位名称|Job Title|Position)[：:\s]+(.+)/i)
  if (labelled) return labelled[1].trim().slice(0, 120)
  const line = firstNonEmptyLine(text)
  return line ? line.slice(0, 120) : undefined
}

function guessCompany(text: string): string | undefined {
  const labelled = text.match(/(?:公司名称|公司|Company)[：:\s]+(.+)/i)
  return labelled ? labelled[1].trim().slice(0, 120) : undefined
}

function guessSalary(text: string): string | undefined {
  const m = text.match(/(\d+\s*[-~]\s*\d+\s*[kK])|(\d+\s*[-~]\s*\d+\s*万)|([$￥]\s*\d[\d,.]*\s*[-~]\s*[$￥]?\s*\d[\d,.]*)/)
  return m ? m[0].trim() : undefined
}

function guessCity(text: string): string | undefined {
  const m = text.match(/(?:工作地点|城市|Location|City)[：:\s]+([^\n,，]+)/i)
  return m ? m[1].trim().slice(0, 40) : undefined
}

/** Strong dedup key: platform + position id (when both are known). */
export function strongKey(platform: JobPlatform, positionId?: string): string | null {
  if (platform === "unknown" || !positionId) return null
  return `${platform}:${positionId}`
}

/** Content hash for cross-source / repeat-import dedup. */
export function contentHash(fields: NormalizedJobFields): string {
  const basis = [
    normalizeForHash(fields.title),
    normalizeForHash(fields.company),
    normalizeForHash(fields.city || ""),
    normalizeForHash(fields.description)
  ].join("||")
  return sha256(basis)
}

/** Weak fallback key when there is no position id (list pages, pastes). */
export function weakKey(fields: NormalizedJobFields): string {
  return sha256(
    [
      normalizeForHash(fields.company),
      normalizeForHash(fields.title),
      normalizeForHash(fields.salary || "")
    ].join("||")
  )
}
