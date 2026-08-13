// Boundary tests for malformed import files: corrupt PDF/DOCX bytes, broken
// CSV/JSON, and empty inputs must fail with friendly errors (or produce zero
// payloads), never crash the process.

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { csvAdapter, fileAdapter, jsonAdapter } from "../electron/modules/jobs/adapters"

const dirs: string[] = []
const tempFile = (name: string, content: Buffer | string) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "assistant-malformed-"))
  dirs.push(dir)
  const file = path.join(dir, name)
  fs.writeFileSync(file, content)
  return file
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true })
})

describe("malformed PDF", () => {
  it("throws a friendly error instead of crashing", async () => {
    const file = tempFile("broken.pdf", Buffer.from("not a real pdf at all %%EOF nope"))
    await expect(fileAdapter({ sourceType: "file", filePath: file })).rejects.toThrow(
      /Unable to parse PDF/i
    )
  })

  it("handles a zero-byte PDF", async () => {
    const file = tempFile("empty.pdf", Buffer.alloc(0))
    await expect(fileAdapter({ sourceType: "file", filePath: file })).rejects.toThrow(
      /Unable to parse PDF/i
    )
  })
})

describe("malformed DOCX", () => {
  // Wider timeout: mammoth's cold import can exceed 5s when all suites run in parallel.
  it("throws a friendly error for non-zip bytes", { timeout: 15000 }, async () => {
    const file = tempFile("broken.docx", Buffer.from([0x00, 0x01, 0x02, 0x03]))
    await expect(fileAdapter({ sourceType: "file", filePath: file })).rejects.toThrow(
      /Unable to parse DOCX/i
    )
  })
})

describe("malformed CSV", () => {
  it("returns no payloads for binary garbage", async () => {
    const payloads = await csvAdapter({
      sourceType: "csv",
      text: "\u0000\u0001\u0002 garbage without commas"
    })
    expect(payloads).toEqual([])
  })

  it("returns no payloads for a header-only file", async () => {
    const payloads = await csvAdapter({ sourceType: "csv", text: "title,company,description" })
    expect(payloads).toEqual([])
  })

  it("skips rows with no usable fields but keeps valid ones", async () => {
    const payloads = await csvAdapter({
      sourceType: "csv",
      text: 'title,company,description\n,,\n"Engineer","Acme","Build APIs"'
    })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].hints?.title).toBe("Engineer")
  })
})

describe("malformed JSON", () => {
  it("returns no payloads for invalid JSON", async () => {
    expect(await jsonAdapter({ sourceType: "json", text: "{broken" })).toEqual([])
    expect(await jsonAdapter({ sourceType: "json", text: "" })).toEqual([])
  })

  it("ignores entries without title or description", async () => {
    const payloads = await jsonAdapter({
      sourceType: "json",
      text: JSON.stringify([{ company: "NoTitle Inc" }, { title: "Real", description: "JD" }])
    })
    expect(payloads).toHaveLength(1)
    expect(payloads[0].hints?.title).toBe("Real")
  })

  it("survives deeply nested / unexpected shapes", async () => {
    const payloads = await jsonAdapter({
      sourceType: "json",
      text: JSON.stringify({ jobs: [{ title: { nested: true }, description: ["array"] }] })
    })
    // Shape is odd but must not throw; content is stringified downstream.
    expect(Array.isArray(payloads)).toBe(true)
  })
})

describe("empty text file", () => {
  it("yields zero payloads", async () => {
    const file = tempFile("empty.txt", "   \n  ")
    expect(await fileAdapter({ sourceType: "file", filePath: file })).toEqual([])
  })
})
