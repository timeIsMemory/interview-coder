import { useEffect, useState } from "react"
import { call, api } from "../lib/api"
import { useAsync } from "../lib/hooks"
import { useToast } from "../../contexts/toast"
import { ArtifactDetail } from "./ArtifactDetail"

interface GenerationEstimate {
  calls: number
  totalInputTokens: number
  totalOutputTokens: number
  estimatedCostUsd: number
}

interface RunProgress {
  runId: string
  status: string
  completedSteps: number
  totalSteps: number
  actualCostUsd?: number
}

export function GenerateView() {
  const { showToast } = useToast()
  const jobs = useAsync(() => call(api().jobs.list()), [])
  const artifacts = useAsync(() => call(api().generation.listArtifacts()), [])
  const runs = useAsync(() => call(api().generation.listRuns()), [])
  const [selected, setSelected] = useState<Record<string, boolean>>({})
  const [estimate, setEstimate] = useState<GenerationEstimate | null>(null)
  const [estimateKind, setEstimateKind] = useState<string>("")
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [activeRunId, setActiveRunId] = useState<string | null>(null)
  const [openArtifactId, setOpenArtifactId] = useState<string | null>(null)

  useEffect(() => {
    const unsub = api().generation.onProgress((p) => {
      setProgress(p)
      if (p.status === "completed" || p.status === "cancelled" || p.status === "failed") {
        artifacts.reload()
        if (p.status !== "running") setActiveRunId((cur) => (cur === p.runId ? null : cur))
      }
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const jobList = jobs.data || []
  const selectedIds = Object.keys(selected).filter((id) => selected[id])

  const toggle = (id: string) => setSelected((s) => ({ ...s, [id]: !s[id] }))
  const selectAll = () => {
    const all: Record<string, boolean> = {}
    jobList.forEach((j) => (all[j.id] = true))
    setSelected(all)
  }
  const clearSel = () => setSelected({})

  const runEstimate = async (kind: string) => {
    if (!selectedIds.length) {
      showToast("提示", "请先选择岗位", "error")
      return
    }
    try {
      const est = await call(api().generation.estimate(kind, selectedIds))
      setEstimate(est)
      setEstimateKind(kind)
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    }
  }

  const startBatch = async (kind: "cv" | "qa") => {
    if (!selectedIds.length) {
      showToast("提示", "请先选择岗位", "error")
      return
    }
    try {
      const run =
        kind === "cv"
          ? await call(api().generation.cvBatch(selectedIds))
          : await call(api().generation.qaBatch(selectedIds))
      setActiveRunId(run.id)
      setProgress({
        runId: run.id,
        status: "running",
        completedSteps: 0,
        totalSteps: run.totalSteps,
        actualCostUsd: 0
      })
      showToast("已开始", `批处理运行中（${run.totalSteps} 个岗位）`, "success")
    } catch (e) {
      showToast("启动失败", (e as Error).message, "error")
    }
  }

  const control = async (action: string) => {
    if (!activeRunId) return
    await call(api().generation.control(activeRunId, action))
  }

  const retryRun = async (runId: string) => {
    try {
      const run = await call(api().generation.retryFailed(runId))
      setActiveRunId(run.id)
      setProgress({ runId: run.id, status: "running", completedSteps: 0, totalSteps: run.totalSteps, actualCostUsd: 0 })
      runs.reload()
      showToast("已重试", "只会重新执行失败或被中断的岗位", "success")
    } catch (e) {
      showToast("重试失败", (e as Error).message, "error")
    }
  }

  const cvArtifacts = (artifacts.data || []).filter((a) => a.kind === "cv")
  const qaArtifacts = (artifacts.data || []).filter((a) => a.kind === "qa")

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">批量生成</h1>

      {/* Selection */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">选择岗位（已选 {selectedIds.length}）</div>
          <div className="flex gap-2">
            <button onClick={selectAll} className="text-xs text-neutral-400 hover:text-white">
              全选
            </button>
            <button onClick={clearSel} className="text-xs text-neutral-400 hover:text-white">
              清空
            </button>
          </div>
        </div>
        <div className="max-h-52 overflow-y-auto space-y-1">
          {jobList.length === 0 && <div className="text-xs text-neutral-500">先到“岗位”页导入 JD。</div>}
          {jobList.map((j) => (
            <label key={j.id} className="flex items-center gap-2 text-sm py-1 cursor-pointer">
              <input type="checkbox" checked={!!selected[j.id]} onChange={() => toggle(j.id)} />
              <span className="truncate">
                {j.title} <span className="text-neutral-500">· {j.company}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-2 border-t border-white/10">
          <button onClick={() => runEstimate("cv-batch")} className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10">
            估算简历成本
          </button>
          <button onClick={() => runEstimate("qa-batch")} className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10">
            估算问答成本
          </button>
          <button onClick={() => startBatch("cv")} className="text-xs px-3 py-1.5 rounded bg-blue-600/70 hover:bg-blue-600">
            生成定制简历
          </button>
          <button onClick={() => startBatch("qa")} className="text-xs px-3 py-1.5 rounded bg-blue-600/70 hover:bg-blue-600">
            生成问答稿
          </button>
        </div>
        {estimate && (
          <div className="text-xs text-neutral-400">
            预计 {estimateKind === "cv-batch" ? "简历" : "问答"}：{estimate.calls} 次调用 · 约{" "}
            {Math.round(estimate.totalInputTokens / 1000)}k 输入 /{" "}
            {Math.round(estimate.totalOutputTokens / 1000)}k 输出 tokens · 约 $
            {estimate.estimatedCostUsd.toFixed(3)}
          </div>
        )}
      </div>

      {/* Progress */}
      {progress && (
        <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">
              批处理 {progress.status === "running" ? "进行中" : progress.status}
            </div>
            <div className="text-xs text-neutral-400">
              {progress.completedSteps}/{progress.totalSteps} · ${Number(progress.actualCostUsd || 0).toFixed(3)}
            </div>
          </div>
          <div className="h-2 bg-white/5 rounded overflow-hidden">
            <div
              className="h-full bg-blue-500/70 transition-all"
              style={{
                width: `${progress.totalSteps ? (progress.completedSteps / progress.totalSteps) * 100 : 0}%`
              }}
            />
          </div>
          {activeRunId && progress.status !== "completed" && (
            <div className="flex gap-2">
              <button onClick={() => control("pause")} className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10">
                暂停
              </button>
              <button onClick={() => control("resume")} className="text-xs px-2 py-1 rounded bg-white/5 hover:bg-white/10">
                继续
              </button>
              <button onClick={() => control("cancel")} className="text-xs px-2 py-1 rounded bg-red-600/50 hover:bg-red-600/70">
                取消
              </button>
            </div>
          )}
        </div>
      )}

      {(runs.data || []).some((run) => run.recoverable || run.status === "failed") && (
        <div className="border-y border-white/10 py-3">
          <div className="mb-2 text-sm font-medium">可恢复任务</div>
          <div className="space-y-2">
            {(runs.data || []).filter((run) => run.recoverable || run.status === "failed").slice(0, 5).map((run) => (
              <div key={run.id} className="flex items-center gap-3 text-xs">
                <span className="flex-1 text-neutral-400">{run.kind} · {run.completedSteps}/{run.totalSteps} · {run.error || "存在失败项"}</span>
                <button onClick={() => retryRun(run.id)} className="rounded bg-white/5 px-2 py-1 text-blue-300 hover:bg-white/10">重试未完成项</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Artifacts */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <div className="text-sm font-medium mb-2">简历产物 ({cvArtifacts.length})</div>
          <div className="space-y-2">
            {cvArtifacts.map((a) => (
              <ArtifactCard key={a.id} artifact={a} jobs={jobList} onOpen={() => setOpenArtifactId(a.id)} />
            ))}
          </div>
        </div>
        <div>
          <div className="text-sm font-medium mb-2">问答产物 ({qaArtifacts.length})</div>
          <div className="space-y-2">
            {qaArtifacts.map((a) => (
              <ArtifactCard key={a.id} artifact={a} jobs={jobList} onOpen={() => setOpenArtifactId(a.id)} />
            ))}
          </div>
        </div>
      </div>

      {openArtifactId && (
        <ArtifactDetail
          artifactId={openArtifactId}
          onClose={() => setOpenArtifactId(null)}
          onChanged={() => artifacts.reload()}
        />
      )}
    </div>
  )
}

interface ArtifactSummary {
  id: string
  jobId: string
  kind: string
  approved?: boolean
  match?: { score: number }
  factCheck?: { supported: boolean; issues: unknown[] }
}

interface JobSummary {
  id: string
  title: string
  company: string
}

function ArtifactCard({
  artifact,
  jobs,
  onOpen
}: {
  artifact: ArtifactSummary
  jobs: JobSummary[]
  onOpen: () => void
}) {
  const job = jobs.find((j) => j.id === artifact.jobId)
  const needsReview = artifact.factCheck && !artifact.factCheck.supported
  return (
    <button
      onClick={onOpen}
      className="w-full text-left rounded border border-white/10 bg-white/[0.02] p-3 hover:bg-white/[0.05]"
    >
      <div className="text-sm text-white truncate">{job ? `${job.title} · ${job.company}` : artifact.jobId}</div>
      <div className="flex items-center gap-2 mt-1">
        {artifact.kind === "cv" && artifact.match && (
          <span className="text-[11px] text-neutral-400">匹配度 {Math.round(artifact.match.score * 100)}%</span>
        )}
        {artifact.approved ? (
          <span className="text-[11px] text-green-400">已批准</span>
        ) : needsReview ? (
          <span className="text-[11px] text-amber-400">待核实 {artifact.factCheck?.issues.length ?? 0}</span>
        ) : (
          <span className="text-[11px] text-neutral-500">待批准</span>
        )}
      </div>
    </button>
  )
}
