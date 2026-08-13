// v1.1 Beta: controlled, user-triggered, low-frequency scraper. The user pastes
// the specific job-detail URLs they can legitimately access; we fetch them
// sequentially with a fixed delay, stop immediately on any login/captcha/block
// signal, and degrade to extension/manual import. Every run is logged with the
// adapter version and per-URL outcomes so selector/format breakage is visible.

import * as axios from "axios"
import { getDatabase } from "../../core/db/Database"
import { sha256 } from "../../core/ids"
import { detectPlatform } from "./normalize"
import { BLOCK_MESSAGES, detectBlocking, SCRAPE_POLICY } from "./scrapeGuard"

export const SCRAPER_VERSION = "0.1.0-beta"

export interface ScrapeRun {
  id: string
  startedAt: string
  finishedAt?: string
  urls: string[]
  succeeded: number
  failed: number
  blocked: boolean
  blockReason?: string
  degradeHint?: string
  log: Array<{ url: string; status: string; note?: string; contentHash?: string; excerpt?: string }>
  scraperVersion: string
}

const nowIso = () => new Date().toISOString()
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

// Keep the pure URL processor importable in Node tests. JobService pulls in the
// Electron-backed configuration layer, so load it only for production runs.
async function importJobWithService(input: {
  sourceType: "scraper"
  text: string
  jobUrl: string
  platform: ReturnType<typeof detectPlatform>
}) {
  const { jobService } = await import("./JobService")
  return jobService.importJobs(input)
}

export interface ScrapePageResponse {
  status: number
  body: string
  finalUrl: string
}

export interface ScrapeProcessorDeps {
  fetchPage: (url: string) => Promise<ScrapePageResponse>
  importJob: (input: { sourceType: "scraper"; text: string; jobUrl: string; platform: ReturnType<typeof detectPlatform> }) => Promise<{
    results: Array<{ outcome?: string }>
  }>
  wait: (ms: number) => Promise<void>
}

export interface ScrapeProcessorResult {
  succeeded: number
  failed: number
  blocked: boolean
  blockReason?: string
  log: ScrapeRun["log"]
}

async function fetchPage(url: string): Promise<ScrapePageResponse> {
  const response = await axios.default.get(url, {
    timeout: SCRAPE_POLICY.requestTimeoutMs,
    maxRedirects: 3,
    validateStatus: () => true,
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122 Safari/537.36"
    }
  })
  return {
    status: response.status,
    body: typeof response.data === "string" ? response.data : JSON.stringify(response.data),
    finalUrl: (response.request?.res?.responseUrl as string) || url
  }
}

export async function processScrapeUrls(
  urls: string[],
  deps: ScrapeProcessorDeps = {
    fetchPage,
    importJob: importJobWithService,
    wait: sleep
  }
): Promise<ScrapeProcessorResult> {
  let succeeded = 0
  let failed = 0
  let blocked = false
  let blockReason: string | undefined
  const log: ScrapeRun["log"] = []

  for (let i = 0; i < urls.length; i++) {
    const url = urls[i]
    if (i > 0) await deps.wait(SCRAPE_POLICY.delayBetweenRequestsMs)
    try {
      const page = await deps.fetchPage(url)
      const reason = detectBlocking(page.status, page.body, page.finalUrl)
      if (reason) {
        blocked = true
        blockReason = reason
        log.push({ url, status: `blocked:${reason}` })
        break
      }
      if (page.status >= 400) {
        failed++
        log.push({ url, status: `http-${page.status}` })
        continue
      }
      const summary = await deps.importJob({
        sourceType: "scraper",
        text: page.body,
        jobUrl: url,
        platform: detectPlatform(url)
      })
      const outcome = summary.results[0]?.outcome || "failed"
      succeeded++
      log.push({
        url,
        status: `imported:${outcome}`,
        contentHash: sha256(page.body).slice(0, 16),
        excerpt: page.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").slice(0, 300)
      })
    } catch (error) {
      failed++
      log.push({ url, status: "error", note: error instanceof Error ? error.message : String(error) })
    }
  }

  return { succeeded, failed, blocked, blockReason, log }
}

export class ControlledScraper {
  private runs() {
    return getDatabase().table<ScrapeRun>("scrape_runs")
  }

  listRuns(): ScrapeRun[] {
    return this.runs().find({ sort: (a, b) => b.startedAt.localeCompare(a.startedAt), limit: 20 })
  }

  /**
   * Fetch up to SCRAPE_POLICY.maxUrlsPerRun user-provided URLs, one by one,
   * with a fixed delay. Stops the entire run on the first blocking signal.
   */
  async run(urls: string[]): Promise<ScrapeRun> {
    const unique = [...new Set(urls.map((u) => u.trim()).filter((u) => /^https?:\/\//i.test(u)))]
    const batch = unique.slice(0, SCRAPE_POLICY.maxUrlsPerRun)
    const run = this.runs().insert({
      startedAt: nowIso(),
      urls: batch,
      succeeded: 0,
      failed: 0,
      blocked: false,
      log: [],
      scraperVersion: SCRAPER_VERSION
    })

    const result = await processScrapeUrls(batch)

    const updated = this.runs().update(run.id, {
      finishedAt: nowIso(),
      succeeded: result.succeeded,
      failed: result.failed,
      blocked: result.blocked,
      blockReason: result.blockReason,
      degradeHint: result.blocked && result.blockReason ? BLOCK_MESSAGES[result.blockReason as keyof typeof BLOCK_MESSAGES] : undefined,
      log: result.log
    }) as ScrapeRun
    getDatabase().flush()
    return updated
  }
}

export const controlledScraper = new ControlledScraper()

