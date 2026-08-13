export interface ScreenshotPreview {
  path: string
  preview: string
}

export interface LegacySolutionPayload {
  code?: string
  thoughts?: string[]
  time_complexity?: string
  space_complexity?: string
}

export interface LegacyDebugPayload extends LegacySolutionPayload {
  debug_analysis?: string
}

export interface LegacyConfig {
  apiKey?: string
  model?: string
  language?: string
  opacity?: number
  [key: string]: unknown
}

export interface ElectronAPI {
  openSubscriptionPortal: (authData: { id: string; email: string }) => Promise<{ success: boolean; error?: string }>
  updateContentDimensions: (dimensions: { width: number; height: number }) => Promise<void>
  clearStore: () => Promise<{ success: boolean; error?: string }>
  getScreenshots: () => Promise<{ success: boolean; previews?: ScreenshotPreview[] | null; error?: string }>
  deleteScreenshot: (path: string) => Promise<{ success: boolean; error?: string }>
  deleteLastScreenshot: () => Promise<{ success: boolean; error?: string }>
  onScreenshotTaken: (callback: (data: ScreenshotPreview) => void) => () => void
  onDeleteLastScreenshot: (callback: () => void) => () => void
  onResetView: (callback: () => void) => () => void
  onSolutionStart: (callback: () => void) => () => void
  onDebugStart: (callback: () => void) => () => void
  onDebugSuccess: (callback: (data: LegacyDebugPayload) => void) => () => void
  onSolutionError: (callback: (error: string) => void) => () => void
  onProcessingNoScreenshots: (callback: () => void) => () => void
  onProblemExtracted: (callback: (data: unknown) => void) => () => void
  onSolutionSuccess: (callback: (data: LegacySolutionPayload) => void) => () => void
  onUnauthorized: (callback: () => void) => () => void
  onDebugError: (callback: (error: string) => void) => () => void
  openExternal: (url: string) => void
  openLink: (url: string) => void
  toggleMainWindow: () => Promise<{ success: boolean; error?: string }>
  triggerScreenshot: () => Promise<{ success: boolean; error?: string }>
  triggerProcessScreenshots: () => Promise<{ success: boolean; error?: string }>
  triggerReset: () => Promise<{ success: boolean; error?: string }>
  triggerMoveLeft: () => Promise<{ success: boolean; error?: string }>
  triggerMoveRight: () => Promise<{ success: boolean; error?: string }>
  triggerMoveUp: () => Promise<{ success: boolean; error?: string }>
  triggerMoveDown: () => Promise<{ success: boolean; error?: string }>
  onSubscriptionUpdated: (callback: () => void) => () => void
  onSubscriptionPortalClosed: (callback: () => void) => () => void
  startUpdate: () => Promise<{ success: boolean; error?: string }>
  installUpdate: () => void
  onUpdateAvailable: (callback: (info: unknown) => void) => () => void
  onUpdateDownloaded: (callback: (info: unknown) => void) => () => void
  decrementCredits: () => Promise<void>
  setInitialCredits: (credits: number) => Promise<void>
  onCreditsUpdated: (callback: (credits: number) => void) => () => void
  onOutOfCredits: (callback: () => void) => () => void
  openSettingsPortal: () => Promise<void>
  getPlatform: () => string
  getConfig: () => Promise<LegacyConfig>
  updateConfig: (config: LegacyConfig) => Promise<boolean>
  checkApiKey: () => Promise<boolean>
  validateApiKey: (apiKey: string, provider?: "openai" | "gemini" | "anthropic") => Promise<{ valid: boolean; error?: string }>
  onShowSettings: (callback: () => void) => () => void
  onApiKeyInvalid: (callback: () => void) => () => void
  removeListener: (eventName: string, callback: (...args: unknown[]) => void) => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
    electron: {
      ipcRenderer: {
        on: (channel: string, func: (...args: unknown[]) => void) => void
        removeListener: (channel: string, func: (...args: unknown[]) => void) => void
      }
    }
    __CREDITS__: number
    __LANGUAGE__: string
    __IS_INITIALIZED__: boolean
    __AUTH_TOKEN__?: string | null
  }
}

export {}
