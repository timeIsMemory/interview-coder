import { _electron as electron, expect, test } from "@playwright/test"
import path from "node:path"

test("starts the Electron workspace and exposes the assistant bridge", async () => {
  const app = await electron.launch({
    args: [path.join(process.cwd(), "dist-electron/main.js")],
    env: { ...process.env, NODE_ENV: "production", ELECTRON_DISABLE_SECURITY_WARNINGS: "true" }
  })
  try {
    const window = await app.firstWindow()
    await window.waitForLoadState("domcontentloaded")
    await expect(window.getByText("AI 求职助手")).toBeVisible()
    expect(await window.evaluate(() => typeof window.assistantAPI?.dashboard)).toBe("function")
  } finally {
    await app.close()
  }
})
