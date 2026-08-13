import { afterEach, describe, it, expect } from "vitest"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { csvAdapter, fileAdapter, jsonAdapter, parseCsv, pasteAdapter } from "../electron/modules/jobs/adapters"

describe("pasteAdapter", () => {
  it("splits multiple JDs on separators", () => {
    const text = `Job A description text here that is long enough\n---\nJob B description text here that is long enough`
    const out = pasteAdapter({ sourceType: "paste", text })
    expect(out.length).toBe(2)
    expect(out[0].content).toContain("Job A")
    expect(out[1].content).toContain("Job B")
  })

  it("returns single payload without separators", () => {
    const out = pasteAdapter({ sourceType: "paste", text: "Single job description here" })
    expect(out.length).toBe(1)
  })

  it("returns empty for blank input", () => {
    expect(pasteAdapter({ sourceType: "paste", text: "  " })).toEqual([])
  })
})

describe("parseCsv", () => {
  it("parses headers and quoted fields with commas", () => {
    const csv = 'title,company,description\n"Dev, Sr","Acme","Build, ship"\nPM,Beta,Plan'
    const rows = parseCsv(csv)
    expect(rows.length).toBe(2)
    expect(rows[0].title).toBe("Dev, Sr")
    expect(rows[0].description).toBe("Build, ship")
    expect(rows[1].company).toBe("Beta")
  })

  it("returns empty when no data rows", () => {
    expect(parseCsv("title,company")).toEqual([])
  })
})

describe("csvAdapter", () => {
  it("maps rows to payloads", async () => {
    const csv = "title,company,description,url\nDev,Acme,Build stuff,https://www.zhipin.com/job_detail/x9.html"
    const out = await csvAdapter({ sourceType: "csv", text: csv })
    expect(out.length).toBe(1)
    expect(out[0].hints?.title).toBe("Dev")
    expect(out[0].platform).toBe("zhipin")
  })
})

describe("jsonAdapter", () => {
  it("parses an array and a {jobs:[]} shape", async () => {
    const arr = JSON.stringify([{ title: "A", description: "d" }])
    const wrapped = JSON.stringify({ jobs: [{ title: "B", description: "d" }] })
    expect((await jsonAdapter({ sourceType: "json", text: arr })).length).toBe(1)
    expect((await jsonAdapter({ sourceType: "json", text: wrapped })).length).toBe(1)
  })

  it("returns empty for invalid json", async () => {
    expect(await jsonAdapter({ sourceType: "json", text: "not json" })).toEqual([])
  })
})


describe("fileAdapter", () => {
  const files: string[] = []

  afterEach(() => {
    for (const file of files.splice(0)) fs.rmSync(file, { force: true })
  })

  it("imports UTF-8 text files through the same file pipeline", async () => {
    const filePath = path.join(os.tmpdir(), `interview-coder-job-${Date.now()}.txt`)
    files.push(filePath)
    fs.writeFileSync(filePath, "Backend Engineer\nBuild reliable APIs")

    const out = await fileAdapter({ sourceType: "file", filePath })
    expect(out).toHaveLength(1)
    expect(out[0].content).toContain("Build reliable APIs")
    expect(out[0].sourceRef).toBe(path.basename(filePath))
  })
})
