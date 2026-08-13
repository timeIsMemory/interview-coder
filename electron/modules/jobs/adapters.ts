// Job source adapters. Each adapter's only job is to turn some input into one
// or more RawJobPayloads. Adapters never call the LLM and never write to the
// DB; that separation is what lets us add new sources (extension, API, scraper)
// without touching the generation pipeline.

import fs from "node:fs"
import path from "node:path"
import { detectPlatform } from "./normalize"
import type { RawJobPayload } from "./types"

export const ADAPTER_VERSION = "1.0.0"

/** Untrusted external job record (JSON import / extension payload). */
export interface LooseJobRecord {
  title?: string
  company?: string
  salary?: string
  city?: string
  location?: string
  description?: string
  jd?: string
  text?: string
  tags?: string[]
  url?: string
  jobUrl?: string
  positionId?: string
  id?: string
}

export interface JobImportInput {
  sourceType: RawJobPayload["sourceType"]
  /** Raw pasted text. */
  text?: string
  /** Absolute file path for file/csv/json imports. */
  filePath?: string
  /** Structured payload (extension/api). */
  payload?: LooseJobRecord
  jobUrl?: string
  platform?: RawJobPayload["platform"]
}

/** Split a large pasted blob into multiple JDs on strong separators. */
function splitPastedBlocks(text: string): string[] {
  const blocks = text
    .split(/\n\s*(?:-{3,}|={3,}|#{3,}|\*{3,})\s*\n/g)
    .map((b) => b.trim())
    .filter((b) => b.length > 20)
  return blocks.length ? blocks : [text.trim()].filter(Boolean)
}

export function pasteAdapter(input: JobImportInput): RawJobPayload[] {
  const text = (input.text || "").trim()
  if (!text) return []
  return splitPastedBlocks(text).map((block) => ({
    sourceType: "paste" as const,
    platform: input.platform || detectPlatform(input.jobUrl),
    content: block,
    jobUrl: input.jobUrl,
    sourceRef: "pasted"
  }))
}

/** Lazily require optional parsers so a missing dep never breaks the build. */
async function readFileAsText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()
  const buffer = fs.readFileSync(filePath)
  if (ext === ".pdf") {
    try {
      const pdfParse = require("pdf-parse") as (data: Buffer) => Promise<{ text?: string }>
      const parsed = await pdfParse(buffer)
      return parsed.text || ""
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
        throw new Error("PDF parsing dependency 'pdf-parse' is unavailable. Reinstall optional dependencies.")
      }
      throw new Error(`Unable to parse PDF: ${(error as Error).message}`)
    }
  }
  if (ext === ".docx") {
    try {
      const mammoth = require("mammoth") as {
        extractRawText: (input: { buffer: Buffer }) => Promise<{ value?: string }>
      }
      const parsed = await mammoth.extractRawText({ buffer })
      return parsed.value || ""
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "MODULE_NOT_FOUND") {
        throw new Error("DOCX parsing dependency 'mammoth' is unavailable. Reinstall optional dependencies.")
      }
      throw new Error(`Unable to parse DOCX: ${(error as Error).message}`)
    }
  }
  // txt / md / html / anything else: treat as UTF-8 text.
  return buffer.toString("utf8")
}

export async function fileAdapter(input: JobImportInput): Promise<RawJobPayload[]> {
  if (!input.filePath) return []
  const content = await readFileAsText(input.filePath)
  if (!content.trim()) return []
  return [
    {
      sourceType: "file",
      platform: input.platform || "unknown",
      content,
      sourceRef: path.basename(input.filePath),
      jobUrl: input.jobUrl
    }
  ]
}

/** Minimal, quote-aware CSV parser (no external dependency). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []
  let field = ""
  let row: string[] = []
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
    } else if (ch === '"') {
      inQuotes = true
    } else if (ch === ",") {
      row.push(field)
      field = ""
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++
      row.push(field)
      rows.push(row)
      row = []
      field = ""
    } else {
      field += ch
    }
  }
  if (field.length || row.length) {
    row.push(field)
    rows.push(row)
  }
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim().length))
  if (nonEmpty.length < 2) return []
  const headers = nonEmpty[0].map((h) => h.trim().toLowerCase())
  return nonEmpty.slice(1).map((cols) => {
    const rec: Record<string, string> = {}
    headers.forEach((h, idx) => {
      rec[h] = (cols[idx] ?? "").trim()
    })
    return rec
  })
}

function recordToPayload(rec: Record<string, string>): RawJobPayload | null {
  const title = rec.title || rec.position || rec["职位"] || rec["岗位"]
  const company = rec.company || rec["公司"]
  const description = rec.description || rec.jd || rec["描述"] || ""
  if (!title && !description) return null
  return {
    sourceType: "csv",
    platform: detectPlatform(rec.url || rec.joburl),
    content: description || `${title || ""}\n${company || ""}`,
    hints: {
      title,
      company,
      salary: rec.salary || rec["薪资"],
      city: rec.city || rec.location || rec["城市"],
      description,
      jobUrl: rec.url || rec.joburl
    },
    jobUrl: rec.url || rec.joburl,
    sourceRef: "csv-row"
  }
}

export async function csvAdapter(input: JobImportInput): Promise<RawJobPayload[]> {
  const text = input.text ?? (input.filePath ? fs.readFileSync(input.filePath, "utf8") : "")
  return parseCsv(text)
    .map(recordToPayload)
    .filter((p): p is RawJobPayload => p !== null)
}

export async function jsonAdapter(input: JobImportInput): Promise<RawJobPayload[]> {
  const text = input.text ?? (input.filePath ? fs.readFileSync(input.filePath, "utf8") : "")
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const items: LooseJobRecord[] = Array.isArray(parsed)
    ? parsed
    : (parsed as { jobs?: LooseJobRecord[] })?.jobs || [parsed as LooseJobRecord]
  return items
    .map((item) => {
      const description = item.description || item.jd || ""
      if (!item.title && !description) return null
      return {
        sourceType: "json" as const,
        platform: detectPlatform(item.url || item.jobUrl),
        content: description || `${item.title || ""}\n${item.company || ""}`,
        hints: {
          title: item.title,
          company: item.company,
          salary: item.salary,
          city: item.city || item.location,
          description,
          tags: item.tags,
          jobUrl: item.url || item.jobUrl,
          positionId: item.positionId || item.id
        },
        jobUrl: item.url || item.jobUrl,
        sourceRef: "json-item"
      } as RawJobPayload
    })
    .filter((p): p is RawJobPayload => p !== null)
}

/** Payload sent by the browser extension for the current open page. */
export function extensionAdapter(input: JobImportInput): RawJobPayload[] {
  const p = input.payload || {}
  const content = p.description || p.text || ""
  if (!content) return []
  return [
    {
      sourceType: "extension",
      platform: detectPlatform(p.url) || input.platform || "unknown",
      content,
      hints: {
        title: p.title,
        company: p.company,
        salary: p.salary,
        city: p.city,
        description: p.description,
        jobUrl: p.url
      },
      jobUrl: p.url,
      sourceRef: "extension"
    }
  ]
}

/** Raw HTML fetched by the controlled scraper; normalization strips the tags. */
export function scraperAdapter(input: JobImportInput): RawJobPayload[] {
  const content = (input.text || "").trim()
  if (!content) return []
  return [
    {
      sourceType: "scraper",
      platform: input.platform || detectPlatform(input.jobUrl),
      content,
      jobUrl: input.jobUrl,
      sourceRef: input.jobUrl || "scraper"
    }
  ]
}

export async function runAdapter(input: JobImportInput): Promise<RawJobPayload[]> {
  switch (input.sourceType) {
    case "paste":
      return pasteAdapter(input)
    case "file":
      return fileAdapter(input)
    case "csv":
      return csvAdapter(input)
    case "json":
      return jsonAdapter(input)
    case "extension":
      return extensionAdapter(input)
    case "scraper":
      return scraperAdapter(input)
    default:
      throw new Error(`Unsupported source type: ${input.sourceType}`)
  }
}
