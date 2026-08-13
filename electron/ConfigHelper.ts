// ConfigHelper.ts
import fs from "node:fs"
import path from "node:path"
import { app } from "electron"
import { EventEmitter } from "events"
import { OpenAI } from "openai"
import { getSecureStore } from "./core/security/secureStore"
import { redactSecrets } from "./core/security/redact"

interface Config {
  apiKey: string;
  apiProvider: "openai" | "gemini" | "anthropic";  // Added provider selection
  extractionModel: string;
  solutionModel: string;
  debuggingModel: string;
  language: string;
  opacity: number;
  // Model used for resume/JD/Q&A generation. Falls back to solutionModel.
  generationModel?: string;
  // Optional dedicated OpenAI key for Whisper transcription, independent of the
  // chat provider (so a Gemini/Anthropic user can still transcribe).
  transcriptionApiKey?: string;
  whisperExecutable?: string;
  whisperModelPath?: string;
}

export class ConfigHelper extends EventEmitter {
  private configPath: string;
  private defaultConfig: Config = {
    apiKey: "",
    apiProvider: "gemini", // Default to Gemini
    extractionModel: "gemini-2.0-flash", // Default to Flash for faster responses
    solutionModel: "gemini-2.0-flash",
    debuggingModel: "gemini-2.0-flash",
    language: "python",
    opacity: 1.0
  };

  constructor() {
    super();
    // Use the app's user data directory to store the config
    try {
      this.configPath = path.join(app.getPath('userData'), 'config.json');
      console.log('Config path:', this.configPath);
    } catch (err) {
      console.warn('Could not access user data path, using fallback');
      this.configPath = path.join(process.cwd(), 'config.json');
    }
    
    // Ensure the initial config file exists
    this.ensureConfigExists();
  }

  /**
   * Ensure config file exists
   */
  private ensureConfigExists(): void {
    try {
      if (!fs.existsSync(this.configPath)) {
        this.saveConfig(this.defaultConfig);
      }
    } catch (err) {
      console.error("Error ensuring config exists:", err);
    }
  }

  /**
   * Validate and sanitize model selection to ensure only allowed models are used
   */
  private sanitizeModelSelection(model: string, provider: "openai" | "gemini" | "anthropic"): string {
    if (provider === "openai") {
      // Only allow gpt-4o and gpt-4o-mini for OpenAI
      const allowedModels = ['gpt-4o', 'gpt-4o-mini'];
      if (!allowedModels.includes(model)) {
        console.warn(`Invalid OpenAI model specified: ${model}. Using default model: gpt-4o`);
        return 'gpt-4o';
      }
      return model;
    } else if (provider === "gemini")  {
      // Only allow gemini-1.5-pro and gemini-2.0-flash for Gemini
      const allowedModels = ['gemini-1.5-pro', 'gemini-2.0-flash'];
      if (!allowedModels.includes(model)) {
        console.warn(`Invalid Gemini model specified: ${model}. Using default model: gemini-2.0-flash`);
        return 'gemini-2.0-flash'; // Changed default to flash
      }
      return model;
    }  else if (provider === "anthropic") {
      // Only allow Claude models
      const allowedModels = ['claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-20241022', 'claude-3-opus-20240229'];
      if (!allowedModels.includes(model)) {
        console.warn(`Invalid Anthropic model specified: ${model}. Using default model: claude-3-7-sonnet-20250219`);
        return 'claude-3-7-sonnet-20250219';
      }
      return model;
    }
    // Default fallback
    return model;
  }

  public loadConfig(): Config {
    try {
      if (fs.existsSync(this.configPath)) {
        const configData = fs.readFileSync(this.configPath, 'utf8');
        const config = JSON.parse(configData);
        
        // Ensure apiProvider is a valid value
        if (config.apiProvider !== "openai" && config.apiProvider !== "gemini"  && config.apiProvider !== "anthropic") {
          config.apiProvider = "gemini"; // Default to Gemini if invalid
        }
        
        // Sanitize model selections to ensure only allowed models are used
        if (config.extractionModel) {
          config.extractionModel = this.sanitizeModelSelection(config.extractionModel, config.apiProvider);
        }
        if (config.solutionModel) {
          config.solutionModel = this.sanitizeModelSelection(config.solutionModel, config.apiProvider);
        }
        if (config.debuggingModel) {
          config.debuggingModel = this.sanitizeModelSelection(config.debuggingModel, config.apiProvider);
        }
        
        const safe = this.loadSensitiveConfig({
          apiKey: typeof config.apiKey === "string" ? config.apiKey : undefined,
          transcriptionApiKey:
            typeof config.transcriptionApiKey === "string" ? config.transcriptionApiKey : undefined
        })
        return {
          ...this.defaultConfig,
          ...config,
          ...safe
        };
      }
      
      // If no config exists, create a default one
      this.saveConfig(this.defaultConfig);
      return this.defaultConfig;
    } catch (err) {
      console.error("Error loading config:", err);
      return this.defaultConfig;
    }
  }

  /**
   * Save configuration to disk
   */
  public saveConfig(config: Config): void {
    try {
      // Ensure the directory exists
      const configDir = path.dirname(this.configPath);
      if (!fs.existsSync(configDir)) {
        fs.mkdirSync(configDir, { recursive: true });
      }
      // Write the config file
      const { apiKey, transcriptionApiKey, ...nonSensitive } = config
      fs.writeFileSync(this.configPath, JSON.stringify(nonSensitive, null, 2));
      this.saveSensitiveConfig({ apiKey, transcriptionApiKey })
    } catch (err) {
      console.error("Error saving config:", err);
    }
  }

  /**
   * Update specific configuration values
   */
  public updateConfig(updates: Partial<Config>): Config {
    try {
      const currentConfig = this.loadConfig();
      let provider = updates.apiProvider || currentConfig.apiProvider;
      
      // Auto-detect provider based on API key format if a new key is provided
      if (updates.apiKey && !updates.apiProvider) {
        // If API key starts with "sk-", it's likely an OpenAI key
        if (updates.apiKey.trim().startsWith('sk-')) {
          provider = "openai";
          console.log("Auto-detected OpenAI API key format");
        } else if (updates.apiKey.trim().startsWith('sk-ant-')) {
          provider = "anthropic";
          console.log("Auto-detected Anthropic API key format");
        } else {
          provider = "gemini";
          console.log("Using Gemini API key format (default)");
        }
        
        // Update the provider in the updates object
        updates.apiProvider = provider;
      }
      
      // If provider is changing, reset models to the default for that provider
      if (updates.apiProvider && updates.apiProvider !== currentConfig.apiProvider) {
        if (updates.apiProvider === "openai") {
          updates.extractionModel = "gpt-4o";
          updates.solutionModel = "gpt-4o";
          updates.debuggingModel = "gpt-4o";
        } else if (updates.apiProvider === "anthropic") {
          updates.extractionModel = "claude-3-7-sonnet-20250219";
          updates.solutionModel = "claude-3-7-sonnet-20250219";
          updates.debuggingModel = "claude-3-7-sonnet-20250219";
        } else {
          updates.extractionModel = "gemini-2.0-flash";
          updates.solutionModel = "gemini-2.0-flash";
          updates.debuggingModel = "gemini-2.0-flash";
        }
      }
      
      // Sanitize model selections in the updates
      if (updates.extractionModel) {
        updates.extractionModel = this.sanitizeModelSelection(updates.extractionModel, provider);
      }
      if (updates.solutionModel) {
        updates.solutionModel = this.sanitizeModelSelection(updates.solutionModel, provider);
      }
      if (updates.debuggingModel) {
        updates.debuggingModel = this.sanitizeModelSelection(updates.debuggingModel, provider);
      }
      
      const newConfig = { ...currentConfig, ...updates };
      this.saveConfig(newConfig);
      
      // Only emit update event for changes other than opacity
      // This prevents re-initializing the AI client when only opacity changes
      if (updates.apiKey !== undefined || updates.apiProvider !== undefined || 
          updates.extractionModel !== undefined || updates.solutionModel !== undefined || 
          updates.debuggingModel !== undefined || updates.language !== undefined) {
        this.emit('config-updated', newConfig);
      }
      
      return newConfig;
    } catch (error) {
      console.error('Error updating config:', error);
      return this.defaultConfig;
    }
  }

  private loadSensitiveConfig(
    legacy: Partial<Pick<Config, "apiKey" | "transcriptionApiKey">> = {}
  ): Pick<Config, "apiKey" | "transcriptionApiKey"> {
    try {
      const store = getSecureStore()
      const apiKey = store.get("apiKey") || legacy.apiKey || ""
      const transcriptionApiKey = store.get("transcriptionApiKey") || legacy.transcriptionApiKey
      if (legacy.apiKey && !store.has("apiKey")) store.set("apiKey", legacy.apiKey)
      if (legacy.transcriptionApiKey && !store.has("transcriptionApiKey")) {
        store.set("transcriptionApiKey", legacy.transcriptionApiKey)
      }
      return {
        apiKey,
        transcriptionApiKey
      }
    } catch {
      // ConfigHelper is also imported by isolated tests before Electron boot.
      return { apiKey: legacy.apiKey || "", transcriptionApiKey: legacy.transcriptionApiKey }
    }
  }

  private saveSensitiveConfig(values: Pick<Config, "apiKey" | "transcriptionApiKey">): void {
    try {
      const store = getSecureStore()
      if (values.apiKey !== undefined) {
        if (values.apiKey) store.set("apiKey", values.apiKey)
        else store.delete("apiKey")
      }
      if (values.transcriptionApiKey !== undefined) {
        if (values.transcriptionApiKey) store.set("transcriptionApiKey", values.transcriptionApiKey)
        else store.delete("transcriptionApiKey")
      }
    } catch {
      // Keep config loading usable outside the Electron lifecycle.
    }
  }

  /**
   * Check if the API key is configured
   */
  public hasApiKey(): boolean {
    const config = this.loadConfig();
    return !!config.apiKey && config.apiKey.trim().length > 0;
  }
  
  /**
   * Validate the API key format
   */
  public isValidApiKeyFormat(apiKey: string, provider?: "openai" | "gemini" | "anthropic" ): boolean {
    // If provider is not specified, attempt to auto-detect
    if (!provider) {
      if (apiKey.trim().startsWith('sk-')) {
        if (apiKey.trim().startsWith('sk-ant-')) {
          provider = "anthropic";
        } else {
          provider = "openai";
        }
      } else {
        provider = "gemini";
      }
    }
    
    if (provider === "openai") {
      // Basic format validation for OpenAI API keys
      return /^sk-[a-zA-Z0-9_-]{20,}$/.test(apiKey.trim());
    } else if (provider === "gemini") {
      // Basic format validation for Gemini API keys (usually alphanumeric with no specific prefix)
      return apiKey.trim().length >= 20
    } else if (provider === "anthropic") {
      // Basic format validation for Anthropic API keys
      return /^sk-ant-[a-zA-Z0-9_-]{20,}$/.test(apiKey.trim());
    }
    
    return false;
  }
  
  /**
   * Get the stored opacity value
   */
  public getOpacity(): number {
    const config = this.loadConfig();
    return config.opacity !== undefined ? config.opacity : 1.0;
  }

  /**
   * Set the window opacity value
   */
  public setOpacity(opacity: number): void {
    // Ensure opacity is between 0.1 and 1.0
    const validOpacity = Math.min(1.0, Math.max(0.1, opacity));
    this.updateConfig({ opacity: validOpacity });
  }  
  
  /**
   * Get the preferred programming language
   */
  public getLanguage(): string {
    const config = this.loadConfig();
    return config.language || "python";
  }

  /**
   * Set the preferred programming language
   */
  public setLanguage(language: string): void {
    this.updateConfig({ language });
  }
  
  /** Test an API key against the selected provider before persisting it. */
  public async testApiKey(
    apiKey: string,
    provider?: "openai" | "gemini" | "anthropic"
  ): Promise<{ valid: boolean; error?: string }> {
    const resolvedProvider = provider || this.detectProvider(apiKey)
    if (!this.isValidApiKeyFormat(apiKey, resolvedProvider)) {
      return { valid: false, error: `Invalid ${resolvedProvider} API key format.` }
    }

    if (resolvedProvider === "openai") return this.testOpenAIKey(apiKey)
    if (resolvedProvider === "gemini") return this.testGeminiKey(apiKey)
    return this.testAnthropicKey(apiKey)
  }

  private detectProvider(apiKey: string): "openai" | "gemini" | "anthropic" {
    if (apiKey.trim().startsWith("sk-ant-")) return "anthropic"
    if (apiKey.trim().startsWith("sk-")) return "openai"
    return "gemini"
  }

  private errorMessage(provider: string, error: unknown): string {
    const status = this.errorStatus(error)
    const detail = redactSecrets(error instanceof Error ? error.message : String(error))
    if (status === 401 || status === 403) return `Invalid ${provider} API key or insufficient permissions.`
    if (status === 429) return `${provider} rate limit or quota exceeded.`
    if (status && status >= 500) return `${provider} server error. Please try again later.`
    return `Unable to validate ${provider} API key: ${detail}`
  }

  private errorStatus(error: unknown): number | undefined {
    if (!error || typeof error !== "object" || !("status" in error)) return undefined
    const value = (error as { status?: unknown }).status
    return typeof value === "number" ? value : undefined
  }

  private async testOpenAIKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const openai = new OpenAI({ apiKey, timeout: 10000, maxRetries: 0 })
      await openai.models.list()
      return { valid: true }
    } catch (error: unknown) {
      console.error("OpenAI API key test failed:", error)
      return { valid: false, error: this.errorMessage("OpenAI", error) }
    }
  }

  /** Gemini has a read-only model-list endpoint that validates the supplied key. */
  private async testGeminiKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`,
        { signal: AbortSignal.timeout(10000) }
      )
      if (!response.ok) throw Object.assign(new Error(await response.text()), { status: response.status })
      return { valid: true }
    } catch (error: unknown) {
      console.error("Gemini API key test failed:", error)
      return { valid: false, error: this.errorMessage("Gemini", error) }
    }
  }

  /** Anthropic's model-list endpoint validates x-api-key without generating content. */
  private async testAnthropicKey(apiKey: string): Promise<{ valid: boolean; error?: string }> {
    try {
      const response = await fetch("https://api.anthropic.com/v1/models?limit=1", {
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01"
        },
        signal: AbortSignal.timeout(10000)
      })
      if (!response.ok) throw Object.assign(new Error(await response.text()), { status: response.status })
      return { valid: true }
    } catch (error: unknown) {
      console.error("Anthropic API key test failed:", error)
      return { valid: false, error: this.errorMessage("Anthropic", error) }
    }
  }

}

// Export a singleton instance
export const configHelper = new ConfigHelper();
