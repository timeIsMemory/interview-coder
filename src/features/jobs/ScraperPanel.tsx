import { useState } from "react"
import { call, api } from "../lib/api"
import { useToast } from "../../contexts/toast"

// v1.1 Beta: user-triggered, low-frequency URL fetcher. Blocks (login/captcha/
// 403) stop the run and surface a degradation hint; no bypass is attempted.
interface ScrapeRunResult {
  succeeded: number
  failed: number
  blocked?: boolean
  degradeHint?: string
  log?: Array<{ status: string; url: string }>
}

export function ScraperPanel({ onImported }: { onImported: () => void }) {
  const { showToast } = useToast()
  const [urls, setUrls] = useState("")
  const [running, setRunning] = useState(false)
  const [lastRun, setLastRun] = useState<ScrapeRunResult | null>(null)

  const run = async () => {
    const list = urls
      .split(/\n+/)
      .map((u) => u.trim())
      .filter(Boolean)
    if (!list.length) {
      showToast("提示", "请粘贴岗位详情页 URL（每行一个，最多 10 个）", "error")
      return
    }
    setRunning(true)
    try {
      const result = await call(api().scrape.run(list))
      setLastRun(result)
      onImported()
      if (result.blocked) {
        showToast("已停止", result.degradeHint || "遇到限制，已降级", "neutral")
      } else {
        showToast("完成", `成功 ${result.succeeded} · 失败 ${result.failed}`, "success")
      }
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">
          受控抓取 <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/20 text-purple-300">Beta</span>
        </div>
        <button
          disabled={running}
          onClick={run}
          className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50"
        >
          {running ? "抓取中（低频）…" : "开始抓取"}
        </button>
      </div>
      <textarea
        value={urls}
        onChange={(e) => setUrls(e.target.value)}
        placeholder={"粘贴你有权访问的岗位详情页 URL，每行一个（≤10）\n每次请求间隔 5 秒；遇到登录/验证码/403 会立即停止并提示改用扩展或手动导入"}
        className="w-full h-20 bg-black/40 border border-white/10 rounded p-2 text-xs resize-none"
      />
      {lastRun && (
        <div className="text-[11px] text-neutral-400 space-y-1">
          <div>
            上次运行：成功 {lastRun.succeeded} · 失败 {lastRun.failed}
            {lastRun.blocked && <span className="text-amber-400"> · 已因限制停止</span>}
          </div>
          {lastRun.degradeHint && <div className="text-amber-300/90">{lastRun.degradeHint}</div>}
          {(lastRun.log || []).slice(0, 5).map((l, i) => (
            <div key={i} className="truncate text-neutral-500">
              {l.status} · {l.url}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
