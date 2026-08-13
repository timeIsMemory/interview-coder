import { useEffect, useState } from "react"
import { call, api } from "../lib/api"
import { useAsync } from "../lib/hooks"
import { useToast } from "../../contexts/toast"
import { ExtensionPanel } from "./ExtensionPanel"
import { ScraperPanel } from "./ScraperPanel"

const STATUSES = ["new", "saved", "applied", "interviewing", "offer", "rejected"]
const STATUS_LABELS: Record<string, string> = {
  new: "待处理",
  saved: "已收藏",
  applied: "已投递",
  interviewing: "面试中",
  offer: "已 Offer",
  rejected: "已拒绝"
}

export function JobsView() {
  const { showToast } = useToast()
  const jobs = useAsync(() => call(api().jobs.list()), [])
  const [search, setSearch] = useState("")
  const [pasteText, setPasteText] = useState("")
  const [enrich, setEnrich] = useState(false)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState<{ id: string } | null>(null)

  useEffect(() => {
    const unsub = api().jobs.onUpdated(() => jobs.reload())
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const doImport = async (input: { sourceType: string; text?: string; filePath?: string }) => {
    setBusy(true)
    try {
      const summary = await call(api().jobs.import({ ...input, enrichWithAi: enrich }))
      const { run } = summary
      showToast(
        "导入完成",
        `新增 ${run.succeeded - run.duplicates} · 重复 ${run.duplicates} · 失败 ${run.failed}`,
        run.failed ? "neutral" : "success"
      )
      jobs.reload()
    } catch (e) {
      showToast("导入失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const importPaste = () => {
    if (!pasteText.trim()) {
      showToast("提示", "请粘贴 JD 文本（多个用 --- 分隔）", "error")
      return
    }
    doImport({ sourceType: "paste", text: pasteText }).then(() => setPasteText(""))
  }

  const importFile = async (sourceType: string) => {
    const path = await call(api().pickFile(sourceType === "paste" ? "data" : "data"))
    if (!path) return
    doImport({ sourceType, filePath: path })
  }

  const changeStatus = async (id: string, status: string) => {
    await call(api().jobs.updateStatus(id, status))
    jobs.reload()
  }
  const remove = async (id: string) => {
    await call(api().jobs.delete(id))
    if (selected?.id === id) setSelected(null)
    jobs.reload()
  }

  const list = (jobs.data || []).filter((j) => {
    if (!search.trim()) return true
    const hay = `${j.title} ${j.company} ${j.city || ""}`.toLowerCase()
    return hay.includes(search.toLowerCase())
  })

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">岗位库</h1>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-sm font-medium">导入 JD</div>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          placeholder="粘贴一个或多个 JD，多个之间用一行 --- 分隔"
          className="w-full h-28 bg-black/40 border border-white/10 rounded p-2 text-sm resize-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            disabled={busy}
            onClick={importPaste}
            className="text-xs px-3 py-1.5 rounded bg-blue-600/70 hover:bg-blue-600 disabled:opacity-50"
          >
            导入粘贴文本
          </button>
          <button
            disabled={busy}
            onClick={() => importFile("file")}
            className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50"
          >
            文件 (PDF/DOCX/TXT)
          </button>
          <button
            disabled={busy}
            onClick={() => importFile("csv")}
            className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50"
          >
            CSV
          </button>
          <button
            disabled={busy}
            onClick={() => importFile("json")}
            className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50"
          >
            JSON
          </button>
          <label className="flex items-center gap-1.5 text-xs text-neutral-400 ml-auto">
            <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} />
            用 AI 清洗字段（较慢/耗费）
          </label>
        </div>
        <p className="text-[11px] text-neutral-500">
          默认不自动抓取招聘网站。受控爬虫为后续可选功能，请遵守各平台服务条款，仅导入你有权访问的信息。
        </p>
      </div>

      <ExtensionPanel />

      <ScraperPanel onImported={() => jobs.reload()} />

      <div className="flex items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索岗位/公司/城市"
          className="flex-1 bg-black/40 border border-white/10 rounded px-3 py-1.5 text-sm"
        />
        <div className="text-xs text-neutral-500">{list.length} 个岗位</div>
      </div>

      <div className="space-y-2">
        {jobs.loading && <div className="text-neutral-400 text-sm">加载中…</div>}
        {!jobs.loading && list.length === 0 && (
          <div className="text-neutral-500 text-sm">还没有岗位，先在上面导入 JD。</div>
        )}
        {list.map((j) => (
          <div key={j.id} className="rounded border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0 cursor-pointer" onClick={() => setSelected(selected?.id === j.id ? null : j)}>
                <div className="text-sm text-white truncate">
                  {j.title} <span className="text-neutral-500">· {j.company}</span>
                </div>
                <div className="text-xs text-neutral-400">
                  {[j.city, j.salary, j.platform !== "unknown" ? j.platform : null]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
              <select
                value={j.status}
                onChange={(e) => changeStatus(j.id, e.target.value)}
                className="bg-black/40 border border-white/10 rounded px-2 py-1 text-xs"
              >
                {STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
              <button onClick={() => remove(j.id)} className="text-xs text-red-400 hover:text-red-300">
                删除
              </button>
            </div>
            {selected?.id === j.id && (
              <div className="mt-3 text-xs text-neutral-300 whitespace-pre-wrap border-t border-white/10 pt-3 max-h-64 overflow-y-auto">
                {j.description}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
