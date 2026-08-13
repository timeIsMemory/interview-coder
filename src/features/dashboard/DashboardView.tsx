import { call, api } from "../lib/api"
import { useAsync } from "../lib/hooks"

const STATUS_LABELS: Record<string, string> = {
  new: "待处理",
  saved: "已收藏",
  applied: "已投递",
  interviewing: "面试中",
  offer: "已 Offer",
  rejected: "已拒绝"
}

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
      <div className="text-2xl font-semibold text-white">{value}</div>
      <div className="text-xs text-neutral-400 mt-1">{label}</div>
      {sub && <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  )
}

export function DashboardView({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const { data, loading, error, reload } = useAsync(() => call(api().dashboard()), [])

  if (loading) return <div className="text-neutral-400 text-sm">加载中…</div>
  if (error) return <div className="text-red-400 text-sm">加载失败：{error}</div>
  if (!data) return null

  const funnel = ["new", "saved", "applied", "interviewing", "offer", "rejected"]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">求职总览</h1>
        <button onClick={reload} className="text-xs text-neutral-400 hover:text-white">
          刷新
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat label="岗位总数" value={data.jobs.total} />
        <Stat
          label="事实条目"
          value={data.facts.total}
          sub={`已确认 ${data.facts.confirmed}`}
        />
        <Stat
          label="生成产物"
          value={data.artifacts.total}
          sub={`简历 ${data.artifacts.cv} · 问答 ${data.artifacts.qa}`}
        />
        <Stat
          label="累计成本"
          value={`$${data.runs.totalCostUsd}`}
          sub={`${data.runs.total} 次批处理`}
        />
      </div>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4">
        <div className="text-sm font-medium mb-3">投递漏斗</div>
        <div className="space-y-2">
          {funnel.map((s) => {
            const count = data.jobs.byStatus[s] || 0
            const pct = data.jobs.total ? Math.round((count / data.jobs.total) * 100) : 0
            return (
              <div key={s} className="flex items-center gap-3">
                <div className="w-16 text-xs text-neutral-400">{STATUS_LABELS[s]}</div>
                <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden">
                  <div className="h-full bg-blue-500/60" style={{ width: `${pct}%` }} />
                </div>
                <div className="w-10 text-right text-xs text-neutral-300">{count}</div>
              </div>
            )
          })}
        </div>
      </div>

      {data.artifacts.needsReview > 0 && (
        <div
          className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200 cursor-pointer"
          onClick={() => onNavigate("generate")}
        >
          有 {data.artifacts.needsReview} 份产物存在未核实的事实声明，需人工确认后才能导出。
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onNavigate("jobs")}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06]"
        >
          <div className="text-sm font-medium">导入岗位</div>
          <div className="text-xs text-neutral-400 mt-1">粘贴 / 文件 / CSV / JSON / 扩展</div>
        </button>
        <button
          onClick={() => onNavigate("generate")}
          className="rounded-lg border border-white/10 bg-white/[0.03] p-4 text-left hover:bg-white/[0.06]"
        >
          <div className="text-sm font-medium">批量生成</div>
          <div className="text-xs text-neutral-400 mt-1">定制简历与岗位问答稿</div>
        </button>
      </div>
    </div>
  )
}
