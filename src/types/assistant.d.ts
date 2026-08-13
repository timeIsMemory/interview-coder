// Type surface for window.assistantAPI exposed by electron/preload.ts.
// Every method resolves to a Result envelope: { ok, data } | { ok, error }.

export type Result<T> = { ok: true; data: T } | { ok: false; error: string }

export interface AssistantAPI {
  profile: {
    get: () => Promise<Result<any>>
    update: (patch: any) => Promise<Result<any>>
    listFacts: () => Promise<Result<any[]>>
    evidence: (factId: string) => Promise<Result<any[]>>
    addFact: (input: any) => Promise<Result<any>>
    updateFact: (id: string, patch: any) => Promise<Result<any>>
    confirmFact: (id: string) => Promise<Result<any>>
    deleteFact: (id: string) => Promise<Result<boolean>>
    importResume: (text: string) => Promise<Result<any[]>>
    importResumeFile: (filePath: string) => Promise<Result<any[]>>
    createVersion: () => Promise<Result<any>>
    listVersions: () => Promise<Result<any[]>>
    listTemplates: () => Promise<Result<any[]>>
  }
  jobs: {
    list: (filter?: any) => Promise<Result<any[]>>
    get: (id: string) => Promise<Result<any>>
    versions: (id: string) => Promise<Result<any[]>>
    confirmDuplicate: (id: string, keepSeparate: boolean) => Promise<Result<any>>
    import: (input: any) => Promise<Result<any>>
    updateStatus: (id: string, status: string) => Promise<Result<any>>
    delete: (id: string) => Promise<Result<boolean>>
    importRuns: () => Promise<Result<any[]>>
    onUpdated: (callback: () => void) => () => void
  }
  extension: {
    status: () => Promise<Result<{ enabled: boolean; running: boolean; token: string | null; port: number }>>
    enable: () => Promise<Result<{ token: string; port: number }>>
    disable: () => Promise<Result<boolean>>
  }
  live: {
    answer: (jobId: string, question: string) => Promise<Result<any>>
    suggest: (jobId: string, query?: string) => Promise<Result<any[]>>
  }
  scrape: {
    run: (urls: string[]) => Promise<Result<any>>
    runs: () => Promise<Result<any[]>>
  }
  generation: {
    estimate: (kind: string, jobIds: string[]) => Promise<Result<any>>
    cvBatch: (jobIds: string[], options?: any) => Promise<Result<any>>
    qaBatch: (jobIds: string[], options?: any) => Promise<Result<any>>
    control: (runId: string, action: string) => Promise<Result<boolean>>
    listRuns: () => Promise<Result<any[]>>
    retryFailed: (runId: string, jobId?: string) => Promise<Result<any>>
    getRun: (runId: string) => Promise<Result<any>>
    listArtifacts: (filter?: any) => Promise<Result<any[]>>
    getArtifact: (id: string) => Promise<Result<any>>
    updateArtifact: (id: string, content: string) => Promise<Result<any>>
    approveArtifact: (id: string) => Promise<Result<any>>
    revisions: (id: string) => Promise<Result<any[]>>
    exportPdf: (id: string) => Promise<Result<string | null>>
    exportDocx: (id: string) => Promise<Result<string | null>>
    onProgress: (callback: (payload: any) => void) => () => void
  }
  applications: {
    list: () => Promise<Result<any[]>>
    upsert: (input: any) => Promise<Result<any>>
    events: (id: string) => Promise<Result<any[]>>
    delete: (id: string) => Promise<Result<boolean>>
  }
  recording: {
    listSessions: () => Promise<Result<any[]>>
    createSession: (input: any) => Promise<Result<any>>
    importMedia: (sessionId: string, filePath: string) => Promise<Result<any>>
    saveCapture: (sessionId: string, bytes: Uint8Array, extension: string) => Promise<Result<any>>
    transcribe: (sessionId: string) => Promise<Result<any[]>>
    importTranscript: (sessionId: string, text: string, totalSeconds?: number) => Promise<Result<any[]>>
    segments: (sessionId: string) => Promise<Result<any[]>>
    updateSegment: (id: string, patch: any) => Promise<Result<any>>
    buildReport: (sessionId: string) => Promise<Result<any>>
    getReport: (sessionId: string) => Promise<Result<any>>
    exportReport: (sessionId: string) => Promise<Result<string | null>>
    cleanup: (retentionDays: number) => Promise<Result<number>>
    deleteSession: (id: string) => Promise<Result<boolean>>
  }
  dashboard: () => Promise<Result<any>>
  pickFile: (kind: string) => Promise<Result<string | null>>
  backup: () => Promise<Result<string | null>>
  secure: {
    set: (key: string, value: string) => Promise<Result<boolean>>
    has: (key: string) => Promise<Result<boolean>>
  }
}

declare global {
  interface Window {
    assistantAPI: AssistantAPI
  }
}

export {}
