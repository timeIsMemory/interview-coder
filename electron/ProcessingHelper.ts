// ProcessingHelper.ts
//
// Coordinator for the screenshot solver. Provider calls go through the shared
// AiGateway (electron/core/ai), prompts live in electron/core/solver/prompts,
// and structured-output validation lives in electron/core/solver/parse. This
// class only sequences the pipeline and reports progress/events to the UI.

import fs from "node:fs"
import { BrowserWindow } from "electron"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { IProcessingHelperDeps } from "./main"
import { configHelper } from "./ConfigHelper"
import { aiGateway } from "./core/ai/AiGateway"
import { AiNotConfiguredError } from "./core/ai/types"
import {
  buildDebugMessages,
  buildExtractionMessages,
  buildSolutionMessages
} from "./core/solver/prompts"
import {
  parseDebugResponse,
  parseProblemInfo,
  parseSolutionResponse
} from "./core/solver/parse"
import { isAbortError, solverErrorMessage } from "./core/solver/errors"
import { SolverParseError, type ProblemInfo } from "./core/solver/types"

interface StepResult<T> {
  success: boolean
  data?: T
  error?: string
}

interface LoadedScreenshot {
  path: string
  preview: string
  data: string
}

export class ProcessingHelper {
  private deps: IProcessingHelperDeps
  private screenshotHelper: ScreenshotHelper

  // AbortControllers for API requests
  private currentProcessingAbortController: AbortController | null = null
  private currentExtraProcessingAbortController: AbortController | null = null

  constructor(deps: IProcessingHelperDeps) {
    this.deps = deps
    const screenshotHelper = deps.getScreenshotHelper()
    if (!screenshotHelper) throw new Error("Screenshot helper is not initialized")
    this.screenshotHelper = screenshotHelper
  }

  private async waitForInitialization(mainWindow: BrowserWindow): Promise<void> {
    let attempts = 0
    const maxAttempts = 50 // 5 seconds total

    while (attempts < maxAttempts) {
      const isInitialized = await mainWindow.webContents.executeJavaScript(
        "window.__IS_INITIALIZED__"
      )
      if (isInitialized) return
      await new Promise((resolve) => setTimeout(resolve, 100))
      attempts++
    }
    throw new Error("App failed to initialize after 5 seconds")
  }

  private async getLanguage(): Promise<string> {
    try {
      const config = configHelper.loadConfig()
      if (config.language) {
        return config.language
      }

      // Fallback to window variable if config doesn't have language
      const mainWindow = this.deps.getMainWindow()
      if (mainWindow) {
        try {
          await this.waitForInitialization(mainWindow)
          const language = await mainWindow.webContents.executeJavaScript(
            "window.__LANGUAGE__"
          )
          if (typeof language === "string" && language) {
            return language
          }
        } catch (err) {
          console.warn("Could not get language from window", err)
        }
      }

      return "python"
    } catch (error) {
      console.error("Error getting language:", error)
      return "python"
    }
  }

  private sendStatus(message: string, progress: number): void {
    const mainWindow = this.deps.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("processing-status", { message, progress })
    }
  }

  private async loadScreenshots(paths: string[]): Promise<LoadedScreenshot[]> {
    const screenshots = await Promise.all(
      paths.map(async (path) => {
        try {
          if (!fs.existsSync(path)) {
            console.warn(`Screenshot file does not exist: ${path}`)
            return null
          }
          return {
            path,
            preview: await this.screenshotHelper.getImagePreview(path),
            data: fs.readFileSync(path).toString("base64")
          }
        } catch (err) {
          console.error(`Error reading screenshot ${path}:`, err)
          return null
        }
      })
    )
    return screenshots.filter((s): s is LoadedScreenshot => s !== null)
  }

  public async processScreenshots(): Promise<void> {
    const mainWindow = this.deps.getMainWindow()
    if (!mainWindow) return

    // A single configuration check replaces the old per-provider client checks.
    if (!aiGateway.isConfigured()) {
      console.error("AI provider not configured")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
      return
    }

    const view = this.deps.getView()
    console.log("Processing screenshots in view:", view)

    if (view === "queue") {
      await this.processInitialQueue(mainWindow)
    } else {
      await this.processDebugQueue(mainWindow)
    }
  }

  private async processInitialQueue(mainWindow: BrowserWindow): Promise<void> {
    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.INITIAL_START)
    const screenshotQueue = this.screenshotHelper.getScreenshotQueue()
    console.log("Processing main queue screenshots:", screenshotQueue)

    if (!screenshotQueue || screenshotQueue.length === 0) {
      console.log("No screenshots found in queue")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    const existingScreenshots = screenshotQueue.filter((path) => fs.existsSync(path))
    if (existingScreenshots.length === 0) {
      console.log("Screenshot files don't exist on disk")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    try {
      this.currentProcessingAbortController = new AbortController()
      const { signal } = this.currentProcessingAbortController

      const validScreenshots = await this.loadScreenshots(existingScreenshots)
      if (validScreenshots.length === 0) {
        throw new Error("Failed to load screenshot data")
      }

      const result = await this.runInitialPipeline(validScreenshots, signal)

      if (!result.success) {
        console.log("Processing failed:", result.error)
        if (
          result.error?.includes("API Key") ||
          result.error?.includes("API key") ||
          result.error?.includes("OpenAI") ||
          result.error?.includes("Gemini")
        ) {
          mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.API_KEY_INVALID)
        } else {
          mainWindow.webContents.send(
            this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
            result.error
          )
        }
        console.log("Resetting view to queue due to error")
        this.deps.setView("queue")
        return
      }

      console.log("Setting view to solutions after successful processing")
      mainWindow.webContents.send(
        this.deps.PROCESSING_EVENTS.SOLUTION_SUCCESS,
        result.data
      )
      this.deps.setView("solutions")
    } catch (error: unknown) {
      console.error("Processing error:", error)
      const message = isAbortError(error)
        ? "Processing was canceled by the user."
        : (error as Error)?.message || "Server error. Please try again."
      mainWindow.webContents.send(
        this.deps.PROCESSING_EVENTS.INITIAL_SOLUTION_ERROR,
        message
      )
      console.log("Resetting view to queue due to error")
      this.deps.setView("queue")
    } finally {
      this.currentProcessingAbortController = null
    }
  }

  private async processDebugQueue(mainWindow: BrowserWindow): Promise<void> {
    const extraScreenshotQueue = this.screenshotHelper.getExtraScreenshotQueue()
    console.log("Processing extra queue screenshots:", extraScreenshotQueue)

    if (!extraScreenshotQueue || extraScreenshotQueue.length === 0) {
      console.log("No extra screenshots found in queue")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    const existingExtraScreenshots = extraScreenshotQueue.filter((path) =>
      fs.existsSync(path)
    )
    if (existingExtraScreenshots.length === 0) {
      console.log("Extra screenshot files don't exist on disk")
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
      return
    }

    mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_START)

    this.currentExtraProcessingAbortController = new AbortController()
    const { signal } = this.currentExtraProcessingAbortController

    try {
      // Debug uses both the original problem screenshots and the new ones.
      const allPaths = [
        ...this.screenshotHelper.getScreenshotQueue(),
        ...existingExtraScreenshots
      ]
      const validScreenshots = await this.loadScreenshots(allPaths)
      if (validScreenshots.length === 0) {
        throw new Error("Failed to load screenshot data for debugging")
      }
      console.log(
        "Combined screenshots for processing:",
        validScreenshots.map((s) => s.path)
      )

      const result = await this.runDebugStep(validScreenshots, signal)

      if (result.success) {
        this.deps.setHasDebugged(true)
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.DEBUG_SUCCESS,
          result.data
        )
      } else {
        mainWindow.webContents.send(
          this.deps.PROCESSING_EVENTS.DEBUG_ERROR,
          result.error
        )
      }
    } catch (error: unknown) {
      const message = isAbortError(error)
        ? "Extra processing was canceled by the user."
        : (error as Error)?.message
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.DEBUG_ERROR, message)
    } finally {
      this.currentExtraProcessingAbortController = null
    }
  }

  /** Extraction → solution pipeline for the initial queue. */
  private async runInitialPipeline(
    screenshots: LoadedScreenshot[],
    signal: AbortSignal
  ): Promise<StepResult<unknown>> {
    const language = await this.getLanguage()
    const mainWindow = this.deps.getMainWindow()
    const imageDataList = screenshots.map((screenshot) => screenshot.data)

    this.sendStatus("Analyzing problem from screenshots...", 20)

    let problemInfo: ProblemInfo
    try {
      const extraction = await aiGateway.complete(
        buildExtractionMessages(language, imageDataList),
        { purpose: "extraction", signal, maxTokens: 4000, temperature: 0.2 }
      )
      problemInfo = parseProblemInfo(extraction.text)
    } catch (error: unknown) {
      return this.stepFailure(error, "extraction")
    }

    this.sendStatus("Problem analyzed successfully. Preparing to generate solution...", 40)

    this.deps.setProblemInfo(problemInfo)

    if (!mainWindow) {
      return { success: false, error: "Failed to process screenshots" }
    }
    mainWindow.webContents.send(
      this.deps.PROCESSING_EVENTS.PROBLEM_EXTRACTED,
      problemInfo
    )

    const solutionsResult = await this.runSolutionStep(problemInfo, language, signal)
    if (!solutionsResult.success) {
      return {
        success: false,
        error: solutionsResult.error || "Failed to generate solutions"
      }
    }

    // Clear any existing extra screenshots before transitioning to solutions view.
    this.screenshotHelper.clearExtraScreenshotQueue()
    this.sendStatus("Solution generated successfully", 100)
    return { success: true, data: solutionsResult.data }
  }

  private async runSolutionStep(
    problemInfo: ProblemInfo,
    language: string,
    signal: AbortSignal
  ): Promise<StepResult<unknown>> {
    this.sendStatus("Creating optimal solution with detailed explanations...", 60)

    try {
      const solution = await aiGateway.complete(
        buildSolutionMessages(problemInfo, language),
        { purpose: "solution", signal, maxTokens: 4000, temperature: 0.2 }
      )
      if (!solution.text) {
        return { success: false, error: "The AI provider returned an empty solution." }
      }
      return { success: true, data: parseSolutionResponse(solution.text) }
    } catch (error: unknown) {
      return this.stepFailure(error, "solution")
    }
  }

  private async runDebugStep(
    screenshots: LoadedScreenshot[],
    signal: AbortSignal
  ): Promise<StepResult<unknown>> {
    const problemInfo = this.deps.getProblemInfo()
    if (!problemInfo) {
      return { success: false, error: "No problem info available" }
    }
    const language = await this.getLanguage()
    const imageDataList = screenshots.map((screenshot) => screenshot.data)

    this.sendStatus("Processing debug screenshots...", 30)
    this.sendStatus("Analyzing code and generating debug feedback...", 60)

    try {
      const debug = await aiGateway.complete(
        buildDebugMessages(problemInfo, language, imageDataList),
        { purpose: "debugging", signal, maxTokens: 4000, temperature: 0.2 }
      )
      if (!debug.text) {
        return {
          success: false,
          error: "The AI provider returned an empty debug analysis."
        }
      }
      this.sendStatus("Debug analysis complete", 100)
      return { success: true, data: parseDebugResponse(debug.text) }
    } catch (error: unknown) {
      return this.stepFailure(error, "debugging")
    }
  }

  /** Map errors from a pipeline step to the historical user-facing messages. */
  private stepFailure(
    error: unknown,
    stage: "extraction" | "solution" | "debugging"
  ): StepResult<never> {
    if (isAbortError(error)) {
      return { success: false, error: "Processing was canceled by the user." }
    }
    if (error instanceof AiNotConfiguredError) {
      return {
        success: false,
        error: "API key not configured or invalid. Please check your settings."
      }
    }
    if (error instanceof SolverParseError) {
      console.error(`Solver ${stage} parse error:`, error.message)
      return {
        success: false,
        error:
          "Failed to parse problem information. Please try again or use clearer screenshots."
      }
    }
    console.error(`Solver ${stage} error:`, error)
    return {
      success: false,
      error: solverErrorMessage(error, aiGateway.getProvider(), stage)
    }
  }

  public cancelOngoingRequests(): void {
    let wasCancelled = false

    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort()
      this.currentProcessingAbortController = null
      wasCancelled = true
    }

    if (this.currentExtraProcessingAbortController) {
      this.currentExtraProcessingAbortController.abort()
      this.currentExtraProcessingAbortController = null
      wasCancelled = true
    }

    this.deps.setHasDebugged(false)

    this.deps.setProblemInfo(null)

    const mainWindow = this.deps.getMainWindow()
    if (wasCancelled && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(this.deps.PROCESSING_EVENTS.NO_SCREENSHOTS)
    }
  }
}
