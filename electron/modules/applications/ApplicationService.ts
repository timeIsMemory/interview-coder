import { getDatabase } from "../../core/db/Database"
import type { JobStatus } from "../jobs/types"
import type { Application, ApplicationEvent } from "./types"

const nowIso = () => new Date().toISOString()

export class ApplicationService {
  private applications() {
    return getDatabase().table<Application>("applications")
  }

  private events() {
    return getDatabase().table<ApplicationEvent>("application_events")
  }

  list(): Application[] {
    return this.applications().find({ sort: (a, b) => b.updatedAt.localeCompare(a.updatedAt) })
  }

  getByJob(jobId: string): Application | null {
    return this.applications().findOne((item) => item.jobId === jobId)
  }

  upsert(input: {
    jobId: string
    status: JobStatus
    notes?: string
    nextAction?: string
    nextActionAt?: string
  }): Application {
    const existing = this.getByJob(input.jobId)
    const timestamp = nowIso()
    if (!existing) {
      const created = this.applications().insert({ ...input, createdAt: timestamp, updatedAt: timestamp })
      this.addEvent(created.id, "created", `状态：${created.status}`)
      return created
    }
    const updated = this.applications().update(existing.id, { ...input, updatedAt: timestamp }) as Application
    if (updated.status !== existing.status) this.addEvent(updated.id, "status", `${existing.status} -> ${updated.status}`)
    if (updated.notes !== existing.notes) this.addEvent(updated.id, "note", updated.notes || "清空备注")
    if (updated.nextAction !== existing.nextAction || updated.nextActionAt !== existing.nextActionAt) {
      this.addEvent(updated.id, "reminder", [updated.nextAction, updated.nextActionAt].filter(Boolean).join(" @ "))
    }
    getDatabase().flush()
    return updated
  }

  syncStatus(jobId: string, status: JobStatus): Application | null {
    const existing = this.getByJob(jobId)
    if (!existing && !["applied", "interviewing", "offer", "rejected"].includes(status)) return null
    return this.upsert({
      jobId,
      status,
      notes: existing?.notes,
      nextAction: existing?.nextAction,
      nextActionAt: existing?.nextActionAt
    })
  }

  listEvents(applicationId: string): ApplicationEvent[] {
    return this.events().find({
      where: (event) => event.applicationId === applicationId,
      sort: (a, b) => b.createdAt.localeCompare(a.createdAt)
    })
  }

  delete(id: string): boolean {
    this.events().deleteWhere((event) => event.applicationId === id)
    return this.applications().delete(id)
  }

  private addEvent(applicationId: string, type: ApplicationEvent["type"], detail: string): void {
    this.events().insert({ applicationId, type, detail, createdAt: nowIso() })
  }
}

export const applicationService = new ApplicationService()
