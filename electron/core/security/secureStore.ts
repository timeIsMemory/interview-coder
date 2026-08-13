// Encrypted-at-rest storage for sensitive strings (API keys, private profile
// fields). Uses Electron safeStorage (OS keychain / DPAPI) when available and
// transparently falls back to plaintext-with-warning on platforms where the OS
// crypto backend is unavailable, so the app still works but we can surface the
// weaker guarantee to the user.

import fs from "node:fs"
import path from "node:path"

let safeStorage: typeof import("electron").safeStorage | null = null
try {
  // Lazy require so this module can be imported in unit tests without Electron.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  safeStorage = require("electron").safeStorage
} catch {
  safeStorage = null
}

export class SecureStore {
  private filePath: string
  private cache: Record<string, string> = {}
  private available = false

  constructor(filePath: string) {
    this.filePath = filePath
    this.available = !!safeStorage && safeStorage.isEncryptionAvailable()
    this.load()
  }

  get encryptionAvailable(): boolean {
    return this.available
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.filePath)) return
      const raw = JSON.parse(fs.readFileSync(this.filePath, "utf8")) as Record<string, string>
      for (const [key, stored] of Object.entries(raw)) {
        this.cache[key] = this.decryptValue(stored)
      }
    } catch (err) {
      console.error("SecureStore load failed:", err)
    }
  }

  private decryptValue(stored: string): string {
    if (stored.startsWith("enc:") && this.available && safeStorage) {
      try {
        const buf = Buffer.from(stored.slice(4), "base64")
        return safeStorage.decryptString(buf)
      } catch {
        return ""
      }
    }
    if (stored.startsWith("plain:")) return stored.slice(6)
    return stored
  }

  private encryptValue(value: string): string {
    if (this.available && safeStorage) {
      const buf = safeStorage.encryptString(value)
      return `enc:${buf.toString("base64")}`
    }
    return `plain:${value}`
  }

  private persist(): void {
    try {
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
      const out: Record<string, string> = {}
      for (const [key, value] of Object.entries(this.cache)) {
        out[key] = this.encryptValue(value)
      }
      const tmp = `${this.filePath}.tmp`
      fs.writeFileSync(tmp, JSON.stringify(out), "utf8")
      fs.renameSync(tmp, this.filePath)
    } catch (err) {
      console.error("SecureStore persist failed:", err)
    }
  }

  get(key: string): string | null {
    return key in this.cache ? this.cache[key] : null
  }

  set(key: string, value: string): void {
    this.cache[key] = value
    this.persist()
  }

  delete(key: string): void {
    delete this.cache[key]
    this.persist()
  }

  has(key: string): boolean {
    return key in this.cache && this.cache[key].length > 0
  }
}

let singleton: SecureStore | null = null

export function initSecureStore(filePath: string): SecureStore {
  singleton = new SecureStore(filePath)
  return singleton
}

export function getSecureStore(): SecureStore {
  if (!singleton) throw new Error("SecureStore not initialized")
  return singleton
}
