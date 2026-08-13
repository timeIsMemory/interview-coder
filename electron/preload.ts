console.log("Preload script starting...")
import { contextBridge, ipcRenderer } from "electron"
const { shell } = require("electron")

export const PROCESSING_EVENTS = {
  //global states
  UNAUTHORIZED: "procesing-unauthorized",
  NO_SCREENSHOTS: "processing-no-screenshots",
  OUT_OF_CREDITS: "out-of-credits",
  API_KEY_INVALID: "api-key-invalid",

  //states for generating the initial solution
  INITIAL_START: "initial-start",
  PROBLEM_EXTRACTED: "problem-extracted",
  SOLUTION_SUCCESS: "solution-success",
  INITIAL_SOLUTION_ERROR: "solution-error",
  RESET: "reset",

  //states for processing the debugging
  DEBUG_START: "debug-start",
  DEBUG_SUCCESS: "debug-success",
  DEBUG_ERROR: "debug-error"
} as const

// At the top of the file
console.log("Preload script is running")

const electronAPI = {
  // Original methods
  openSubscriptionPortal: async (authData: { id: string; email: string }) => {
    return ipcRenderer.invoke("open-subscription-portal", authData)
  },
  openSettingsPortal: () => ipcRenderer.invoke("open-settings-portal"),
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  clearStore: () => ipcRenderer.invoke("clear-store"),
  getScreenshots: () => ipcRenderer.invoke("get-screenshots"),
  deleteScreenshot: (path: string) =>
    ipcRenderer.invoke("delete-screenshot", path),
  toggleMainWindow: async () => {
    console.log("toggleMainWindow called from preload")
    try {
      const result = await ipcRenderer.invoke("toggle-window")
      console.log("toggle-window result:", result)
      return result
    } catch (error) {
      console.error("Error in toggleMainWindow:", error)
      throw error
    }
  },
  // Event listeners
  onScreenshotTaken: (
    callback: (data: { path: string; preview: string }) => void
  ) => {
    const subscription = (_: any, data: { path: string; preview: string }) =>
      callback(data)
    ipcRenderer.on("screenshot-taken", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot-taken", subscription)
    }
  },
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },
  onSolutionStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.INITIAL_START, subscription)
    }
  },
  onDebugStart: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_START, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_START, subscription)
    }
  },
  onDebugSuccess: (callback: (data: any) => void) => {
    ipcRenderer.on("debug-success", (_event, data) => callback(data))
    return () => {
      ipcRenderer.removeListener("debug-success", (_event, data) =>
        callback(data)
      )
    }
  },
  onDebugError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.DEBUG_ERROR, subscription)
    }
  },
  onSolutionError: (callback: (error: string) => void) => {
    const subscription = (_: any, error: string) => callback(error)
    ipcRenderer.on(PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        subscription
      )
    }
  },
  onProcessingNoScreenshots: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.NO_SCREENSHOTS, subscription)
    }
  },
  onOutOfCredits: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.OUT_OF_CREDITS, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.OUT_OF_CREDITS, subscription)
    }
  },
  onProblemExtracted: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.PROBLEM_EXTRACTED, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.PROBLEM_EXTRACTED,
        subscription
      )
    }
  },
  onSolutionSuccess: (callback: (data: any) => void) => {
    const subscription = (_: any, data: any) => callback(data)
    ipcRenderer.on(PROCESSING_EVENTS.SOLUTION_SUCCESS, subscription)
    return () => {
      ipcRenderer.removeListener(
        PROCESSING_EVENTS.SOLUTION_SUCCESS,
        subscription
      )
    }
  },
  onUnauthorized: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.UNAUTHORIZED, subscription)
    }
  },
  // External URL handler
  openLink: (url: string) => shell.openExternal(url),
  triggerScreenshot: () => ipcRenderer.invoke("trigger-screenshot"),
  triggerProcessScreenshots: () =>
    ipcRenderer.invoke("trigger-process-screenshots"),
  triggerReset: () => ipcRenderer.invoke("trigger-reset"),
  triggerMoveLeft: () => ipcRenderer.invoke("trigger-move-left"),
  triggerMoveRight: () => ipcRenderer.invoke("trigger-move-right"),
  triggerMoveUp: () => ipcRenderer.invoke("trigger-move-up"),
  triggerMoveDown: () => ipcRenderer.invoke("trigger-move-down"),
  onSubscriptionUpdated: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("subscription-updated", subscription)
    return () => {
      ipcRenderer.removeListener("subscription-updated", subscription)
    }
  },
  onSubscriptionPortalClosed: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("subscription-portal-closed", subscription)
    return () => {
      ipcRenderer.removeListener("subscription-portal-closed", subscription)
    }
  },
  onReset: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.RESET, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.RESET, subscription)
    }
  },
  startUpdate: () => ipcRenderer.invoke("start-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  onUpdateAvailable: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-available", subscription)
    return () => {
      ipcRenderer.removeListener("update-available", subscription)
    }
  },
  onUpdateDownloaded: (callback: (info: any) => void) => {
    const subscription = (_: any, info: any) => callback(info)
    ipcRenderer.on("update-downloaded", subscription)
    return () => {
      ipcRenderer.removeListener("update-downloaded", subscription)
    }
  },
  decrementCredits: () => ipcRenderer.invoke("decrement-credits"),
  onCreditsUpdated: (callback: (credits: number) => void) => {
    const subscription = (_event: any, credits: number) => callback(credits)
    ipcRenderer.on("credits-updated", subscription)
    return () => {
      ipcRenderer.removeListener("credits-updated", subscription)
    }
  },
  getPlatform: () => process.platform,
  
  // New methods for OpenAI API integration
  getConfig: () => ipcRenderer.invoke("get-config"),
  updateConfig: (config: { apiKey?: string; apiProvider?: "openai" | "gemini" | "anthropic"; extractionModel?: string; solutionModel?: string; debuggingModel?: string; model?: string; language?: string; opacity?: number; whisperExecutable?: string; whisperModelPath?: string }) =>
    ipcRenderer.invoke("update-config", config),
  onShowSettings: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("show-settings-dialog", subscription)
    return () => {
      ipcRenderer.removeListener("show-settings-dialog", subscription)
    }
  },
  checkApiKey: () => ipcRenderer.invoke("check-api-key"),
  validateApiKey: (apiKey: string, provider?: "openai" | "gemini" | "anthropic") =>
    ipcRenderer.invoke("validate-api-key", apiKey, provider),
  openExternal: (url: string) => 
    ipcRenderer.invoke("openExternal", url),
  onApiKeyInvalid: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on(PROCESSING_EVENTS.API_KEY_INVALID, subscription)
    return () => {
      ipcRenderer.removeListener(PROCESSING_EVENTS.API_KEY_INVALID, subscription)
    }
  },
  removeListener: (eventName: string, callback: (...args: any[]) => void) => {
    ipcRenderer.removeListener(eventName, callback)
  },
  onDeleteLastScreenshot: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("delete-last-screenshot", subscription)
    return () => {
      ipcRenderer.removeListener("delete-last-screenshot", subscription)
    }
  },
  deleteLastScreenshot: () => ipcRenderer.invoke("delete-last-screenshot")
}

// Before exposing the API
console.log(
  "About to expose electronAPI with methods:",
  Object.keys(electronAPI)
)

// Expose the API
contextBridge.exposeInMainWorld("electronAPI", electronAPI)

console.log("electronAPI exposed to window")

// ---------------------------------------------------------------------------
// Assistant API: profile / jobs / generation / recording / dashboard.
// Grouped by domain; every call returns { ok, data } | { ok:false, error }.
// ---------------------------------------------------------------------------
const invoke = (channel: string, ...args: any[]) => ipcRenderer.invoke(channel, ...args)

const assistantAPI = {
  profile: {
    get: () => invoke("assistant:profile:get"),
    update: (patch: any) => invoke("assistant:profile:update", patch),
    listFacts: () => invoke("assistant:facts:list"),
    evidence: (factId: string) => invoke("assistant:facts:evidence", factId),
    addFact: (input: any) => invoke("assistant:facts:add", input),
    updateFact: (id: string, patch: any) => invoke("assistant:facts:update", id, patch),
    confirmFact: (id: string) => invoke("assistant:facts:confirm", id),
    deleteFact: (id: string) => invoke("assistant:facts:delete", id),
    importResume: (text: string) => invoke("assistant:profile:importResume", text),
    importResumeFile: (filePath: string) => invoke("assistant:profile:importResumeFile", filePath),
    createVersion: () => invoke("assistant:profile:createVersion"),
    listVersions: () => invoke("assistant:profile:listVersions"),
    listTemplates: () => invoke("assistant:templates:list")
  },
  jobs: {
    list: (filter?: any) => invoke("assistant:jobs:list", filter),
    get: (id: string) => invoke("assistant:jobs:get", id),
    versions: (id: string) => invoke("assistant:jobs:versions", id),
    confirmDuplicate: (id: string, keepSeparate: boolean) =>
      invoke("assistant:jobs:confirmDuplicate", id, keepSeparate),
    import: (input: any) => invoke("assistant:jobs:import", input),
    updateStatus: (id: string, status: string) => invoke("assistant:jobs:updateStatus", id, status),
    delete: (id: string) => invoke("assistant:jobs:delete", id),
    importRuns: () => invoke("assistant:jobs:importRuns"),
    onUpdated: (callback: () => void) => {
      const sub = () => callback()
      ipcRenderer.on("assistant:jobs-updated", sub)
      return () => ipcRenderer.removeListener("assistant:jobs-updated", sub)
    }
  },
  extension: {
    status: () => invoke("assistant:extension:status"),
    enable: () => invoke("assistant:extension:enable"),
    disable: () => invoke("assistant:extension:disable")
  },
  live: {
    answer: (jobId: string, question: string) => invoke("assistant:live:answer", jobId, question),
    suggest: (jobId: string, query?: string) => invoke("assistant:live:suggest", jobId, query || "")
  },
  scrape: {
    run: (urls: string[]) => invoke("assistant:scrape:run", urls),
    runs: () => invoke("assistant:scrape:runs")
  },
  generation: {
    estimate: (kind: string, jobIds: string[]) => invoke("assistant:gen:estimate", kind, jobIds),
    cvBatch: (jobIds: string[], options?: any) => invoke("assistant:gen:cvBatch", jobIds, options),
    qaBatch: (jobIds: string[], options?: any) => invoke("assistant:gen:qaBatch", jobIds, options),
    control: (runId: string, action: string) => invoke("assistant:gen:control", runId, action),
    listRuns: () => invoke("assistant:gen:runs"),
    retryFailed: (runId: string, jobId?: string) => invoke("assistant:gen:retryFailed", runId, jobId),
    getRun: (runId: string) => invoke("assistant:gen:run", runId),
    listArtifacts: (filter?: any) => invoke("assistant:artifacts:list", filter),
    getArtifact: (id: string) => invoke("assistant:artifacts:get", id),
    updateArtifact: (id: string, content: string) => invoke("assistant:artifacts:update", id, content),
    approveArtifact: (id: string) => invoke("assistant:artifacts:approve", id),
    revisions: (id: string) => invoke("assistant:artifacts:revisions", id),
    exportPdf: (id: string) => invoke("assistant:artifacts:exportPdf", id),
    exportDocx: (id: string) => invoke("assistant:artifacts:exportDocx", id),
    onProgress: (callback: (payload: any) => void) => {
      const sub = (_: any, payload: any) => callback(payload)
      ipcRenderer.on("assistant:generation-progress", sub)
      return () => ipcRenderer.removeListener("assistant:generation-progress", sub)
    }
  },
  applications: {
    list: () => invoke("assistant:applications:list"),
    upsert: (input: any) => invoke("assistant:applications:upsert", input),
    events: (id: string) => invoke("assistant:applications:events", id),
    delete: (id: string) => invoke("assistant:applications:delete", id)
  },
  recording: {
    listSessions: () => invoke("assistant:rec:sessions"),
    createSession: (input: any) => invoke("assistant:rec:createSession", input),
    importMedia: (sessionId: string, filePath: string) => invoke("assistant:rec:importMedia", sessionId, filePath),
    saveCapture: (sessionId: string, bytes: Uint8Array, extension: string) => invoke("assistant:rec:saveCapture", sessionId, bytes, extension),
    transcribe: (sessionId: string) => invoke("assistant:rec:transcribe", sessionId),
    importTranscript: (sessionId: string, text: string, totalSeconds?: number) =>
      invoke("assistant:rec:importTranscript", sessionId, text, totalSeconds || 0),
    segments: (sessionId: string) => invoke("assistant:rec:segments", sessionId),
    updateSegment: (id: string, patch: any) => invoke("assistant:rec:updateSegment", id, patch),
    buildReport: (sessionId: string) => invoke("assistant:rec:buildReport", sessionId),
    getReport: (sessionId: string) => invoke("assistant:rec:getReport", sessionId),
    exportReport: (sessionId: string) => invoke("assistant:rec:exportReport", sessionId),
    cleanup: (retentionDays: number) => invoke("assistant:rec:cleanup", retentionDays),
    deleteSession: (id: string) => invoke("assistant:rec:deleteSession", id)
  },
  dashboard: () => invoke("assistant:dashboard"),
  pickFile: (kind: string) => invoke("assistant:pickFile", kind),
  backup: () => invoke("assistant:backup"),
  secure: {
    set: (key: string, value: string) => invoke("assistant:secure:set", key, value),
    has: (key: string) => invoke("assistant:secure:has", key)
  }
}

contextBridge.exposeInMainWorld("assistantAPI", assistantAPI)
console.log("assistantAPI exposed to window")

// Add this focus restoration handler
ipcRenderer.on("restore-focus", () => {
  // Try to focus the active element if it exists
  const activeElement = document.activeElement as HTMLElement
  if (activeElement && typeof activeElement.focus === "function") {
    activeElement.focus()
  }
})

// Remove auth-callback handling - no longer needed
