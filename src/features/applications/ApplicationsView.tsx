import { useMemo, useState } from "react"
import { CalendarClock, History, Save } from "lucide-react"
import { api, call } from "../lib/api"
import { useAsync } from "../lib/hooks"
import { useToast } from "../../contexts/toast"

const STATUS_LABELS: Record<string, string> = {
  applied: "已投递",
  interviewing: "面试中",
  offer: "已获 Offer",
  rejected: "已结束"
}

export function ApplicationsView() {
  const { showToast } = useToast()
  const applications = useAsync(() => call(api().applications.list()), [])
  const jobs = useAsync(() => call(api().jobs.list()), [])
  const [editing, setEditing] = useState<Record<string, { notes: string; nextAction: string; nextActionAt: string }>>({})
  const [historyId, setHistoryId] = useState<string | null>(null)
  const events = useAsync(() => historyId ? call(api().applications.events(historyId)) : Promise.resolve([]), [historyId])
  const jobsById = useMemo(() => new Map((jobs.data || []).map((job) => [job.id, job])), [jobs.data])

  const save = async (item: {
    id: string
    jobId: string
    status: string
    notes?: string
    nextAction?: string
    nextActionAt?: string
  }) => {
    const draft = editing[item.id] || item
    try {
      await call(api().applications.upsert({ jobId: item.jobId, status: item.status, notes: draft.notes || "", nextAction: draft.nextAction || "", nextActionAt: draft.nextActionAt || "" }))
      applications.reload()
      showToast("已保存", "跟进计划和备注已更新", "success")
    } catch (error) {
      showToast("保存失败", (error as Error).message, "error")
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold">投递跟踪</h1>
        <p className="mt-1 text-xs text-neutral-400">岗位状态进入已投递、面试、Offer 或结束后会自动出现在这里。</p>
      </div>
      {(applications.data || []).length === 0 ? (
        <div className="border border-white/10 p-6 text-sm text-neutral-400">暂无投递记录。先在岗位库更新目标岗位状态。</div>
      ) : (
        <div className="divide-y divide-white/10 border-y border-white/10">
          {(applications.data || []).map((item) => {
            const job = jobsById.get(item.jobId)
            const draft = editing[item.id] || { notes: item.notes || "", nextAction: item.nextAction || "", nextActionAt: item.nextActionAt || "" }
            return (
              <section key={item.id} className="py-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-48 flex-1"><div className="text-sm font-medium text-white">{job?.title || "已删除岗位"}</div><div className="mt-0.5 text-xs text-neutral-500">{job?.company || item.jobId}</div></div>
                  <span className="text-xs text-blue-300">{STATUS_LABELS[item.status] || item.status}</span>
                  <button title="查看时间线" onClick={() => setHistoryId(historyId === item.id ? null : item.id)} className="p-1.5 text-neutral-400 hover:text-white"><History size={15} /></button>
                </div>
                <div className="mt-3 grid gap-2 md:grid-cols-[1fr_160px_auto]">
                  <input value={draft.nextAction} onChange={(event) => setEditing({ ...editing, [item.id]: { ...draft, nextAction: event.target.value } })} placeholder="下一步，如：准备系统设计面试" className="border border-white/10 bg-black/40 px-2 py-1.5 text-xs" />
                  <label className="relative"><CalendarClock size={14} className="absolute left-2 top-2 text-neutral-500" /><input type="date" value={draft.nextActionAt} onChange={(event) => setEditing({ ...editing, [item.id]: { ...draft, nextActionAt: event.target.value } })} className="w-full border border-white/10 bg-black/40 py-1.5 pl-7 pr-2 text-xs" /></label>
                  <button title="保存" onClick={() => save(item)} className="p-1.5 text-blue-300 hover:text-blue-200"><Save size={16} /></button>
                </div>
                <textarea value={draft.notes} onChange={(event) => setEditing({ ...editing, [item.id]: { ...draft, notes: event.target.value } })} placeholder="面试反馈、联系人或后续备注" className="mt-2 h-16 w-full resize-none border border-white/10 bg-black/30 p-2 text-xs" />
                {historyId === item.id && <div className="mt-3 space-y-1 border-t border-white/10 pt-3 text-xs text-neutral-400">{(events.data || []).map((event) => <div key={event.id} className="flex gap-3"><time className="w-36 shrink-0 text-neutral-600">{new Date(event.createdAt).toLocaleString()}</time><span>{event.detail}</span></div>)}</div>}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}
