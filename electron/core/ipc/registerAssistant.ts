// Central registration of all assistant IPC handlers. Grouped by domain and
// wrapped with input validation + safe() so a failing handler returns a
// structured error instead of crashing the main process.

import { BrowserWindow, ipcMain, dialog } from "electron"
import fs from "node:fs"
import path from "node:path"
import { profileService } from "../../modules/profile/ProfileService"
import { jobService } from "../../modules/jobs/JobService"
import { generationService } from "../../modules/generation/GenerationService"
import { recordingService } from "../../modules/recording/RecordingService"
import { liveAssistService } from "../../modules/live/LiveAssistService"
import { applicationService } from "../../modules/applications/ApplicationService"
import { ExtensionBridge } from "../../modules/jobs/ExtensionBridge"
import { getDatabase } from "../db/Database"
import { getSecureStore } from "../security/secureStore"
import {
  asBoolean,
  asNumber,
  asOptionalString,
  asString,
  asStringArray,
  safe,
  validateFilePath
} from "./validate"
import type { FactCategory } from "../../modules/profile/types"
import type { JobSourceType, JobStatus } from "../../modules/jobs/types"

export function registerAssistantHandlers(getMainWindow: () => BrowserWindow | null): void {
  generationService.recoverInterruptedRuns()
  // Stream batch-generation progress to the renderer.
  generationService.onProgress = (payload) => {
    getMainWindow()?.webContents.send("assistant:generation-progress", payload)
  }

  // Optional browser-extension loopback bridge (off by default).
  const extensionBridge = new ExtensionBridge(getMainWindow)
  extensionBridge.startIfEnabled()
  ipcMain.handle(
    "assistant:extension:status",
    safe(async () => ({
      enabled: extensionBridge.isEnabled(),
      running: extensionBridge.isRunning,
      token: extensionBridge.isEnabled() ? extensionBridge.getToken() : null,
      port: 53127
    }))
  )
  ipcMain.handle("assistant:extension:enable", safe(async () => extensionBridge.enable()))
  ipcMain.handle(
    "assistant:extension:disable",
    safe(async () => {
      extensionBridge.disable()
      return true
    })
  )

  // ---- Profile / fact bank ----
  ipcMain.handle("assistant:profile:get", safe(async () => profileService.getOrCreateDefaultProfile()))
  ipcMain.handle(
    "assistant:profile:update",
    safe(async (_e, patch: any) => profileService.updateProfile(patch || {}))
  )
  ipcMain.handle("assistant:facts:list", safe(async () => profileService.listFacts()))
  ipcMain.handle(
    "assistant:facts:evidence",
    safe(async (_e, factId: string) => profileService.listEvidence(asString(factId, "factId", 100)))
  )
  ipcMain.handle(
    "assistant:facts:add",
    safe(async (_e, input: any) =>
      profileService.addFact({
        category: asString(input?.category, "category") as FactCategory,
        label: asString(input?.label, "label", 500),
        detail: asString(input?.detail, "detail", 20000),
        startDate: asOptionalString(input?.startDate, "startDate", 40),
        endDate: asOptionalString(input?.endDate, "endDate", 40),
        tags: input?.tags ? asStringArray(input.tags, "tags", 50) : undefined,
        sensitivity: input?.sensitivity,
        confirmed: input?.confirmed !== false,
        source: asOptionalString(input?.source, "source", 500),
        sourceSnippet: asOptionalString(input?.sourceSnippet, "sourceSnippet", 20000)
      })
    )
  )
  ipcMain.handle(
    "assistant:facts:update",
    safe(async (_e, id: string, patch: any) => profileService.updateFact(asString(id, "id", 100), patch || {}))
  )
  ipcMain.handle(
    "assistant:facts:confirm",
    safe(async (_e, id: string) => profileService.confirmFact(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:facts:delete",
    safe(async (_e, id: string) => profileService.deleteFact(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:profile:importResume",
    safe(async (_e, text: string) => profileService.importResumeText(asString(text, "text", 200000)))
  )
  ipcMain.handle(
    "assistant:profile:importResumeFile",
    safe(async (_e, filePath: string) => {
      const resolved = validateFilePath(filePath)
      const { fileAdapter } = require("../../modules/jobs/adapters")
      const payloads = await fileAdapter({ sourceType: "file", filePath: resolved })
      const text = payloads.map((p: any) => p.content).join("\n")
      return profileService.importResumeText(text, resolved)
    })
  )
  ipcMain.handle("assistant:profile:createVersion", safe(async () => profileService.createVersion()))
  ipcMain.handle("assistant:profile:listVersions", safe(async () => profileService.listVersions()))
  ipcMain.handle("assistant:templates:list", safe(async () => profileService.listTemplates()))

  // ---- Jobs ----
  ipcMain.handle(
    "assistant:jobs:list",
    safe(async (_e, filter: any) =>
      jobService.listJobs({
        status: filter?.status as JobStatus,
        search: asOptionalString(filter?.search, "search", 500)
      })
    )
  )
  ipcMain.handle(
    "assistant:jobs:get",
    safe(async (_e, id: string) => jobService.getJob(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:jobs:versions",
    safe(async (_e, id: string) => jobService.listVersions(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:jobs:confirmDuplicate",
    safe(async (_e, id: string, keepSeparate: boolean) =>
      jobService.confirmDuplicate(asString(id, "id", 100), asBoolean(keepSeparate, "keepSeparate"))
    )
  )
  ipcMain.handle(
    "assistant:jobs:import",
    safe(async (_e, input: any) => {
      const sourceType = asString(input?.sourceType, "sourceType", 20) as JobSourceType
      const payload: any = { sourceType }
      if (input?.text != null) payload.text = asString(input.text, "text", 500000)
      if (input?.filePath != null) payload.filePath = validateFilePath(input.filePath)
      if (input?.jobUrl != null) payload.jobUrl = asString(input.jobUrl, "jobUrl", 2000)
      if (input?.platform != null) payload.platform = asString(input.platform, "platform", 30)
      if (input?.payload != null) payload.payload = input.payload
      return jobService.importJobs(payload, { enrichWithAi: input?.enrichWithAi === true })
    })
  )
  ipcMain.handle(
    "assistant:jobs:updateStatus",
    safe(async (_e, id: string, status: string) =>
      jobService.updateStatus(asString(id, "id", 100), asString(status, "status", 30) as JobStatus)
    )
  )
  ipcMain.handle(
    "assistant:jobs:delete",
    safe(async (_e, id: string) => jobService.deleteJob(asString(id, "id", 100)))
  )
  ipcMain.handle("assistant:jobs:importRuns", safe(async () => jobService.listImportRuns()))

  // ---- Applications ----
  ipcMain.handle("assistant:applications:list", safe(async () => applicationService.list()))
  ipcMain.handle(
    "assistant:applications:upsert",
    safe(async (_e, input: any) =>
      applicationService.upsert({
        jobId: asString(input?.jobId, "jobId", 100),
        status: asString(input?.status, "status", 30) as JobStatus,
        notes: asOptionalString(input?.notes, "notes", 20000),
        nextAction: asOptionalString(input?.nextAction, "nextAction", 500),
        nextActionAt: asOptionalString(input?.nextActionAt, "nextActionAt", 50)
      })
    )
  )
  ipcMain.handle(
    "assistant:applications:events",
    safe(async (_e, id: string) => applicationService.listEvents(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:applications:delete",
    safe(async (_e, id: string) => applicationService.delete(asString(id, "id", 100)))
  )

  // ---- Controlled scraper (v1.1 Beta, user-triggered, low frequency) ----
  ipcMain.handle(
    "assistant:scrape:run",
    safe(async (_e, urls: string[]) => {
      const { controlledScraper } = require("../../modules/jobs/ControlledScraper")
      return controlledScraper.run(asStringArray(urls, "urls", 10))
    })
  )
  ipcMain.handle(
    "assistant:scrape:runs",
    safe(async () => {
      const { controlledScraper } = require("../../modules/jobs/ControlledScraper")
      return controlledScraper.listRuns()
    })
  )

  // ---- Generation ----
  ipcMain.handle(
    "assistant:gen:estimate",
    safe(async (_e, kind: string, jobIds: string[]) =>
      generationService.estimate(
        asString(kind, "kind", 20) as any,
        asStringArray(jobIds, "jobIds", 500)
      )
    )
  )
  ipcMain.handle(
    "assistant:gen:cvBatch",
    safe(async (_e, jobIds: string[], options: any) =>
      generationService.generateCvBatch(asStringArray(jobIds, "jobIds", 500), {
        templateId: asOptionalString(options?.templateId, "templateId", 100),
        concurrency: options?.concurrency ? asNumber(options.concurrency, "concurrency") : undefined
      })
    )
  )
  ipcMain.handle(
    "assistant:gen:qaBatch",
    safe(async (_e, jobIds: string[], options: any) =>
      generationService.generateQaBatch(asStringArray(jobIds, "jobIds", 500), {
        concurrency: options?.concurrency ? asNumber(options.concurrency, "concurrency") : undefined
      })
    )
  )
  ipcMain.handle(
    "assistant:gen:control",
    safe(async (_e, runId: string, action: string) =>
      generationService.controlRun(asString(runId, "runId", 100), action as any)
    )
  )
  ipcMain.handle("assistant:gen:runs", safe(async () => generationService.listRuns()))
  ipcMain.handle(
    "assistant:gen:retryFailed",
    safe(async (_e, runId: string, jobId?: string) =>
      generationService.retryFailed(
        asString(runId, "runId", 100),
        asOptionalString(jobId, "jobId", 100)
      )
    )
  )
  ipcMain.handle(
    "assistant:gen:run",
    safe(async (_e, runId: string) => ({
      run: generationService.getRun(asString(runId, "runId", 100)),
      steps: generationService.getSteps(runId)
    }))
  )
  ipcMain.handle(
    "assistant:artifacts:list",
    safe(async (_e, filter: any) =>
      generationService.listArtifacts({
        kind: filter?.kind,
        jobId: asOptionalString(filter?.jobId, "jobId", 100)
      })
    )
  )
  ipcMain.handle(
    "assistant:artifacts:get",
    safe(async (_e, id: string) => generationService.getArtifact(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:artifacts:update",
    safe(async (_e, id: string, content: string) =>
      generationService.updateArtifact(asString(id, "id", 100), asString(content, "content", 500000))
    )
  )
  ipcMain.handle(
    "assistant:artifacts:approve",
    safe(async (_e, id: string) => generationService.approveArtifact(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:artifacts:revisions",
    safe(async (_e, id: string) => generationService.getRevisions(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:artifacts:exportPdf",
    safe(async (_e, id: string) => exportArtifactPdf(asString(id, "id", 100)))
  )
  ipcMain.handle(
    "assistant:artifacts:exportDocx",
    safe(async (_e, id: string) => exportArtifactDocx(asString(id, "id", 100)))
  )

  // ---- Recording ----
  ipcMain.handle("assistant:rec:sessions", safe(async () => recordingService.listSessions()))
  ipcMain.handle(
    "assistant:rec:createSession",
    safe(async (_e, input: any) =>
      recordingService.createSession({
        title: asString(input?.title, "title", 200),
        jobId: asOptionalString(input?.jobId, "jobId", 100),
        consentAcknowledged: asBoolean(input?.consentAcknowledged, "consentAcknowledged")
      })
    )
  )
  ipcMain.handle(
    "assistant:rec:importMedia",
    safe(async (_e, sessionId: string, filePath: string) =>
      recordingService.importMedia(asString(sessionId, "sessionId", 100), validateFilePath(filePath))
    )
  )
  ipcMain.handle(
    "assistant:rec:saveCapture",
    safe(async (_e, sessionId: string, bytes: Uint8Array, extension: string) => {
      const id = asString(sessionId, "sessionId", 100)
      const ext = asString(extension, "extension", 10)
      if (![".webm", ".ogg", ".wav"].includes(ext)) throw new Error("Unsupported capture format")
      if (!(bytes instanceof Uint8Array) || bytes.byteLength > 200 * 1024 * 1024) throw new Error("Capture is too large")
      const tempPath = path.join(require("electron").app.getPath("temp"), `capture-${id}-${Date.now()}${ext}`)
      fs.writeFileSync(tempPath, Buffer.from(bytes))
      try {
        return recordingService.importMedia(id, tempPath)
      } finally {
        fs.rmSync(tempPath, { force: true })
      }
    })
  )
  ipcMain.handle(
    "assistant:rec:transcribe",
    safe(async (_e, sessionId: string) => recordingService.transcribeSession(asString(sessionId, "sessionId", 100)))
  )
  ipcMain.handle(
    "assistant:rec:importTranscript",
    safe(async (_e, sessionId: string, text: string, totalSeconds: number) =>
      recordingService.importTranscriptText(
        asString(sessionId, "sessionId", 100),
        asString(text, "text", 500000),
        totalSeconds ? asNumber(totalSeconds, "totalSeconds") : 0
      )
    )
  )
  ipcMain.handle(
    "assistant:rec:segments",
    safe(async (_e, sessionId: string) => recordingService.getSegments(asString(sessionId, "sessionId", 100)))
  )
  ipcMain.handle(
    "assistant:rec:updateSegment",
    safe(async (_e, id: string, patch: any) =>
      recordingService.updateSegment(asString(id, "id", 100), {
        text: asOptionalString(patch?.text, "text", 20000),
        speaker: patch?.speaker
      })
    )
  )
  ipcMain.handle(
    "assistant:rec:buildReport",
    safe(async (_e, sessionId: string) => recordingService.buildReport(asString(sessionId, "sessionId", 100)))
  )
  ipcMain.handle(
    "assistant:rec:getReport",
    safe(async (_e, sessionId: string) => recordingService.getReport(asString(sessionId, "sessionId", 100)))
  )
  ipcMain.handle(
    "assistant:rec:exportReport",
    safe(async (_e, sessionId: string) => {
      const report = recordingService.getReport(asString(sessionId, "sessionId", 100))
      if (!report) throw new Error("Report not found")
      const result = await dialog.showSaveDialog({
        defaultPath: path.join(require("electron").app.getPath("documents"), `interview-review-${sessionId.slice(0, 8)}.json`),
        filters: [{ name: "JSON", extensions: ["json"] }]
      })
      if (result.canceled || !result.filePath) return null
      fs.writeFileSync(result.filePath, JSON.stringify(report, null, 2), "utf8")
      return result.filePath
    })
  )
  ipcMain.handle(
    "assistant:rec:cleanup",
    safe(async (_e, retentionDays: number) => recordingService.cleanupExpired(asNumber(retentionDays, "retentionDays")))
  )
  ipcMain.handle(
    "assistant:rec:deleteSession",
    safe(async (_e, id: string) => recordingService.deleteSession(asString(id, "id", 100)))
  )

  // ---- Live assist ----
  ipcMain.handle(
    "assistant:live:answer",
    safe(async (_e, jobId: string, question: string) =>
      liveAssistService.answer(asString(jobId, "jobId", 100), asString(question, "question", 2000))
    )
  )
  ipcMain.handle(
    "assistant:live:suggest",
    safe(async (_e, jobId: string, query: string) =>
      liveAssistService.suggest(asString(jobId, "jobId", 100), asOptionalString(query, "query", 500) || "")
    )
  )

  // ---- Dashboard aggregate ----
  ipcMain.handle("assistant:dashboard", safe(async () => buildDashboard()))

  // ---- File pickers (renderer can't touch the FS directly) ----
  ipcMain.handle(
    "assistant:pickFile",
    safe(async (_e, kind: string) => {
      const filters =
        kind === "audio"
          ? [{ name: "Audio/Video", extensions: ["mp3", "wav", "m4a", "mp4", "webm", "ogg"] }]
          : kind === "resume"
          ? [{ name: "Documents", extensions: ["pdf", "docx", "txt", "md"] }]
          : [{ name: "Data", extensions: ["csv", "json", "txt", "pdf", "docx", "md", "html"] }]
      const win = getMainWindow()
      const res = win
        ? await dialog.showOpenDialog(win, { properties: ["openFile"], filters })
        : await dialog.showOpenDialog({ properties: ["openFile"], filters })
      return res.canceled ? null : res.filePaths[0]
    })
  )

  // ---- Backup ----
  ipcMain.handle(
    "assistant:backup",
    safe(async () => {
      const win = getMainWindow()
      const res = win
        ? await dialog.showOpenDialog(win, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] })
      if (res.canceled || !res.filePaths[0]) return null
      return getDatabase().backup(res.filePaths[0])
    })
  )

  // ---- Secure settings (transcription key etc.) ----
  ipcMain.handle(
    "assistant:secure:set",
    safe(async (_e, key: string, value: string) => {
      getSecureStore().set(asString(key, "key", 100), asString(value, "value", 10000))
      return true
    })
  )
  ipcMain.handle(
    "assistant:secure:has",
    safe(async (_e, key: string) => getSecureStore().has(asString(key, "key", 100)))
  )
}

async function exportArtifactPdf(artifactId: string): Promise<string | null> {
  const artifact = generationService.getArtifact(artifactId)
  if (!artifact) throw new Error("Artifact not found")
  if (artifact.kind !== "cv") throw new Error("Only CV artifacts can be exported to PDF")
  if (!artifact.approved) throw new Error("请先通过事实核对并批准，再导出。")

  const { app, BrowserWindow, dialog } = require("electron")
  const path = require("path")
  const fs = require("fs")

  const res = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath("documents"), `resume-${artifactId.slice(0, 8)}.pdf`),
    filters: [{ name: "PDF", extensions: ["pdf"] }]
  })
  if (res.canceled || !res.filePath) return null

  // Defense in depth: content is sanitized at persistence time, but never
  // load untrusted markup into a window with JavaScript enabled anyway.
  const { sanitizeHtml } = require("../security/sanitizeHtml")
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:-apple-system,Segoe UI,Roboto,'Microsoft YaHei',sans-serif;padding:40px;color:#111;line-height:1.5}
    h1,h2{color:#0b3d91;margin-bottom:6px} section{margin-bottom:16px} ul{margin:4px 0}
  </style></head><body>${sanitizeHtml(artifact.content)}</body></html>`

  const printWindow = new BrowserWindow({
    show: false,
    webPreferences: { offscreen: true, javascript: false, nodeIntegration: false, contextIsolation: true }
  })
  try {
    await printWindow.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(html))
    const pdf = await printWindow.webContents.printToPDF({ printBackground: true, pageSize: "A4" })
    fs.writeFileSync(res.filePath, pdf)
    return res.filePath
  } finally {
    printWindow.destroy()
  }
}

async function exportArtifactDocx(artifactId: string): Promise<string | null> {
  const artifact = generationService.getArtifact(artifactId)
  if (!artifact) throw new Error("Artifact not found")
  if (artifact.kind !== "cv") throw new Error("Only CV artifacts can be exported to DOCX")
  if (!artifact.approved) throw new Error("请先批准产物，再导出 DOCX。")

  const { Document, Packer, Paragraph, TextRun, HeadingLevel } = await import("docx")
  const { app, dialog } = require("electron")
  const path = require("path")
  const fs = require("fs")
  const html = artifact.content
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>|<\/div>|<\/li>|<\/h[1-6]>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
  const lines = html.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const children = lines.map((line, index) =>
    new Paragraph({
      heading: index === 0 ? HeadingLevel.TITLE : undefined,
      children: [new TextRun({ text: line, bold: index === 0 })]
    })
  )
  const document = new Document({ sections: [{ children }] })
  const result = await dialog.showSaveDialog({
    defaultPath: path.join(app.getPath("documents"), `resume-${artifactId.slice(0, 8)}.docx`),
    filters: [{ name: "Word Document", extensions: ["docx"] }]
  })
  if (result.canceled || !result.filePath) return null
  fs.writeFileSync(result.filePath, await Packer.toBuffer(document))
  return result.filePath
}

function buildDashboard() {
  const jobs = jobService.listJobs()
  const byStatus: Record<string, number> = {}
  for (const j of jobs) byStatus[j.status] = (byStatus[j.status] || 0) + 1
  const runs = generationService.listRuns()
  const artifacts = generationService.listArtifacts()
  const facts = profileService.listFacts()
  const sessions = recordingService.listSessions()
  const applications = applicationService.list()
  return {
    jobs: {
      total: jobs.length,
      byStatus
    },
    facts: {
      total: facts.length,
      confirmed: facts.filter((f) => f.confirmed).length
    },
    artifacts: {
      total: artifacts.length,
      cv: artifacts.filter((a) => a.kind === "cv").length,
      qa: artifacts.filter((a) => a.kind === "qa").length,
      approved: artifacts.filter((a) => a.approved).length,
      needsReview: artifacts.filter((a) => a.factCheck && !a.factCheck.supported).length
    },
    runs: {
      total: runs.length,
      totalCostUsd: Math.round(runs.reduce((s, r) => s + (r.actualCostUsd || 0), 0) * 1e4) / 1e4
    },
    recordings: {
      total: sessions.length
    },
    applications: {
      total: applications.length,
      upcoming: applications.filter((item) => item.nextActionAt && item.nextActionAt >= nowIsoDate()).length
    }
  }
}

function nowIsoDate(): string {
  return new Date().toISOString().slice(0, 10)
}
