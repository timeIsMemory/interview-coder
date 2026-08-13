// Service worker: given an extracted job, try to hand it to the desktop app via
// a paired localhost channel; if that fails (app not running / no pairing),
// fall back to downloading a JSON file the user imports via the JSON importer.

const DESKTOP_ENDPOINT = "http://127.0.0.1:53127/import"

async function sendToDesktop(job) {
  const token = (await chrome.storage.local.get("pairingToken")).pairingToken || ""
  const res = await fetch(DESKTOP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Pair-Token": token },
    body: JSON.stringify({ jobs: [job] })
  })
  if (!res.ok) throw new Error("desktop rejected")
  return true
}

function downloadJson(job) {
  const payload = JSON.stringify({ jobs: [job] }, null, 2)
  const url = "data:application/json;charset=utf-8," + encodeURIComponent(payload)
  const safeCompany = (job.company || "job").replace(/[^\w\u4e00-\u9fff-]+/g, "_").slice(0, 40)
  return chrome.downloads.download({
    url,
    filename: `jd-${safeCompany}-${Date.now()}.json`,
    saveAs: false
  })
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "DELIVER_JD") {
    ;(async () => {
      try {
        await sendToDesktop(msg.job)
        sendResponse({ ok: true, via: "desktop" })
      } catch (e) {
        try {
          await downloadJson(msg.job)
          sendResponse({ ok: true, via: "download" })
        } catch (e2) {
          sendResponse({ ok: false, error: String(e2) })
        }
      }
    })()
    return true
  }
  return true
})
