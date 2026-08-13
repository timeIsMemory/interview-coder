import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs"
import path from "node:path"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

vi.mock("electron", () => ({
  app: {
    getPath: () => path.join(process.cwd(), ".tmp-vitest-config")
  }
}))

import { ConfigHelper } from "../electron/ConfigHelper"

describe("ConfigHelper provider validation", () => {
  const configDir = path.join(process.cwd(), ".tmp-vitest-config")
  const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined)
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined)

  beforeEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true })
    fs.mkdirSync(configDir, { recursive: true })
  })

  afterEach(() => {
    fetchMock.mockReset()
  })

  afterAll(() => {
    errorSpy.mockRestore()
    logSpy.mockRestore()
    fs.rmSync(configDir, { recursive: true, force: true })
  })

  it("validates Gemini with the provider model-list endpoint", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ models: [] }), { status: 200 }))
    const helper = new ConfigHelper()

    await expect(helper.testApiKey("A".repeat(20), "gemini")).resolves.toEqual({ valid: true })
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("generativelanguage.googleapis.com/v1beta/models?key="),
      expect.objectContaining({ signal: expect.any(AbortSignal) })
    )
  })

  it("returns a useful Gemini permission error for rejected credentials", async () => {
    fetchMock.mockResolvedValue(new Response("denied", { status: 403 }))
    const helper = new ConfigHelper()

    await expect(helper.testApiKey("A".repeat(20), "gemini")).resolves.toMatchObject({
      valid: false,
      error: expect.stringContaining("Invalid Gemini API key")
    })
  })

  it("validates Anthropic with x-api-key and the version header", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }))
    const helper = new ConfigHelper()
    const key = `sk-ant-${"a".repeat(32)}`

    await expect(helper.testApiKey(key, "anthropic")).resolves.toEqual({ valid: true })
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.anthropic.com/v1/models?limit=1",
      expect.objectContaining({
        headers: {
          "x-api-key": key,
          "anthropic-version": "2023-06-01"
        }
      })
    )
  })
})
