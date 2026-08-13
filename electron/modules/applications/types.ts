import type { JobStatus } from "../jobs/types"

export interface Application {
  id: string
  jobId: string
  status: JobStatus
  notes?: string
  nextAction?: string
  nextActionAt?: string
  createdAt: string
  updatedAt: string
}

export interface ApplicationEvent {
  id: string
  applicationId: string
  type: "created" | "status" | "note" | "reminder"
  detail: string
  createdAt: string
}
