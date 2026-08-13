// Optional loopback HTTP receiver for the browser extension. Off by default.
// When the user enables it, it listens ONLY on 127.0.0.1 and requires a pairing
// token, so a page cannot silently push jobs. If disabled or not running, the
// extension falls back to downloading a JSON file the user imports manually.

import http from "node:http"
import { BrowserWindow } from "electron"
import { getSecureStore } from "../../core/security/secureStore"
import { newId } from "../../core/ids"
import { jobService } from "./JobService"
import type { LooseJobRecord } from "./adapters"

const PORT = 53127
const TOKEN_KEY = "extensionPairToken"
const ENABLED_KEY = "extensionBridgeEnabled"

export class ExtensionBridge {
  private server: http.Server | null = null
  private port: number

  constructor(
    private getMainWindow: () => BrowserWindow | null,
    port: number = PORT
  ) {
    this.port = port
  }

  getToken(): string {
    const store = getSecureStore()
    let token = store.get(TOKEN_KEY)
    if (!token) {
      token = newId()
      store.set(TOKEN_KEY, token)
    }
    return token
  }

  isEnabled(): boolean {
    return getSecureStore().get(ENABLED_KEY) === "1"
  }

  get isRunning(): boolean {
    return !!this.server
  }

  enable(): { token: string; port: number } {
    getSecureStore().set(ENABLED_KEY, "1")
    this.start()
    return { token: this.getToken(), port: this.port }
  }

  disable(): void {
    getSecureStore().set(ENABLED_KEY, "0")
    this.stop()
  }

  startIfEnabled(): void {
    if (this.isEnabled()) this.start()
  }

  start(): void {
    if (this.server) return
    const token = this.getToken()
    this.server = http.createServer((req, res) => {
      res.setHeader("Access-Control-Allow-Origin", "*")
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Pair-Token")
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS")
      if (req.method === "OPTIONS") {
        res.writeHead(204)
        res.end()
        return
      }
      if (req.method !== "POST" || req.url !== "/import") {
        res.writeHead(404)
        res.end()
        return
      }
      if (req.headers["x-pair-token"] !== token) {
        res.writeHead(401)
        res.end(JSON.stringify({ ok: false, error: "bad token" }))
        return
      }
      let body = ""
      let size = 0
      req.on("data", (chunk) => {
        size += chunk.length
        if (size > 2 * 1024 * 1024) {
          req.destroy()
          return
        }
        body += chunk
      })
      req.on("end", async () => {
        try {
          const parsed: unknown = JSON.parse(body || "{}")
          const jobs: LooseJobRecord[] = Array.isArray(parsed)
            ? parsed
            : (parsed as { jobs?: LooseJobRecord[] })?.jobs || []
          let imported = 0
          for (const job of jobs) {
            await jobService.importJobs({ sourceType: "extension", payload: job })
            imported++
          }
          this.getMainWindow()?.webContents.send("assistant:jobs-updated")
          res.writeHead(200, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: true, imported }))
        } catch (err) {
          res.writeHead(400, { "Content-Type": "application/json" })
          res.end(JSON.stringify({ ok: false, error: (err as Error).message }))
        }
      })
    })
    this.server.on("error", (err) => {
      console.error("ExtensionBridge server error:", err)
      this.server = null
    })
    // Bind to loopback only.
    this.server.listen(this.port, "127.0.0.1", () => {
      console.log(`ExtensionBridge listening on 127.0.0.1:${this.port}`)
    })
  }

  stop(): void {
    if (this.server) {
      this.server.close()
      this.server = null
    }
  }
}
