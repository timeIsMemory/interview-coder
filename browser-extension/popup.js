const statusEl = document.getElementById("status")
const previewEl = document.getElementById("preview")
const grabBtn = document.getElementById("grab")

function setStatus(text, color) {
  statusEl.textContent = text
  statusEl.style.color = color || "#999"
}

async function ensureContentScript(tabId) {
  // The extension only injects on demand into the active tab.
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] })
  } catch (e) {
    // Already injected or restricted page.
  }
}

grabBtn.addEventListener("click", async () => {
  grabBtn.disabled = true
  setStatus("正在读取页面…")
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (!tab || !tab.id) throw new Error("没有活动标签页")
    await ensureContentScript(tab.id)
    const resp = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_JD" })
    if (!resp || !resp.ok) throw new Error((resp && resp.error) || "抓取失败")
    const job = resp.job
    if (!job.description || job.description.length < 20) {
      setStatus("未能识别到 JD，可先在页面选中正文再抓取。", "#f59e0b")
    }
    previewEl.textContent = `${job.title || "(无标题)"} · ${job.company || "(无公司)"}\n${(job.description || "").slice(0, 300)}`

    const delivery = await chrome.runtime.sendMessage({ type: "DELIVER_JD", job })
    if (delivery && delivery.ok) {
      setStatus(delivery.via === "desktop" ? "已发送到桌面应用" : "已下载 JSON，请在应用中导入", "#22c55e")
    } else {
      setStatus("发送失败：" + ((delivery && delivery.error) || "未知"), "#ef4444")
    }
  } catch (e) {
    setStatus("出错：" + String(e.message || e), "#ef4444")
  } finally {
    grabBtn.disabled = false
  }
})
