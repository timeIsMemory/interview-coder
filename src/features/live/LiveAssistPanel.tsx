import { useEffect, useState } from "react"
import { call, api } from "../lib/api"

interface LiveAnswer {
  source: string
  shortAnswer: string
  detailedAnswer?: string
  followUps?: string[]
  latencyMs?: number
}

// Compact live-assist overlay used during a real interview. Retrieval-first:
// answers come from the pre-generated bank instantly; online is a labelled
// fallback. Rendered inside the stealth window so content protection applies.
export function LiveAssistPanel() {
  const [collapsed, setCollapsed] = useState(false)
  const [jobs, setJobs] = useState<Array<{ id: string; title: string; company: string }>>([])
  const [jobId, setJobId] = useState("")
  const [question, setQuestion] = useState("")
  const [answer, setAnswer] = useState<LiveAnswer | null>(null)
  const [suggestions, setSuggestions] = useState<Array<{ question: string }>>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    call(api().jobs.list())
      .then((list) => {
        setJobs(list)
        if (list[0]) setJobId(list[0].id)
      })
      .catch(() => setJobs([]))
  }, [])

  useEffect(() => {
    if (!jobId) return
    call(api().live.suggest(jobId, ""))
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
  }, [jobId])

  const ask = async (q?: string) => {
    const query = q ?? question
    if (!jobId || !query.trim()) return
    setLoading(true)
    setAnswer(null)
    try {
      const res = await call(api().live.answer(jobId, query))
      setAnswer(res)
    } catch (e) {
      setAnswer({ source: "insufficient", shortAnswer: (e as Error).message })
    } finally {
      setLoading(false)
    }
  }

  const sourceBadge = (source: string) => {
    if (source === "local") return { text: "本地题库", cls: "text-green-400" }
    if (source === "online") return { text: "在线补充", cls: "text-blue-400" }
    return { text: "资料不足", cls: "text-amber-400" }
  }

  if (collapsed) {
    return (
      <button
        onClick={() => setCollapsed(false)}
        className="fixed top-2 right-2 z-50 text-[11px] px-2 py-1 rounded bg-black/70 text-white/70 hover:text-white border border-white/10"
      >
        实时辅助
      </button>
    )
  }

  return (
    <div className="fixed top-2 right-2 z-50 w-80 max-h-[80vh] overflow-y-auto bg-black/85 backdrop-blur border border-white/10 rounded-lg p-3 text-neutral-100">
      <div className="flex items-center justify-between mb-2">
        <div className="text-xs font-medium">实时辅助</div>
        <button onClick={() => setCollapsed(true)} className="text-[11px] text-neutral-400 hover:text-white">
          收起
        </button>
      </div>

      <select
        value={jobId}
        onChange={(e) => setJobId(e.target.value)}
        className="w-full bg-black/50 border border-white/10 rounded px-2 py-1 text-xs mb-2"
      >
        <option value="">选择目标岗位</option>
        {jobs.map((j) => (
          <option key={j.id} value={j.id}>
            {j.title} · {j.company}
          </option>
        ))}
      </select>

      <div className="flex gap-1 mb-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && ask()}
          placeholder="输入面试官的问题…"
          className="flex-1 bg-black/50 border border-white/10 rounded px-2 py-1 text-xs"
        />
        <button
          onClick={() => ask()}
          disabled={loading}
          className="text-[11px] px-2 py-1 rounded bg-blue-600/70 hover:bg-blue-600 disabled:opacity-50"
        >
          {loading ? "…" : "回答"}
        </button>
      </div>

      {answer && (
        <div className="rounded border border-white/10 bg-white/[0.03] p-2 mb-2 text-xs space-y-1">
          <div className="flex items-center justify-between">
            <span className={sourceBadge(answer.source).cls}>{sourceBadge(answer.source).text}</span>
            {answer.latencyMs != null && (
              <span className="text-neutral-500">{answer.latencyMs}ms</span>
            )}
          </div>
          <div className="text-neutral-100">{answer.shortAnswer}</div>
          {answer.detailedAnswer && (
            <div className="text-neutral-400 border-t border-white/10 pt-1">{answer.detailedAnswer}</div>
          )}
          {Array.isArray(answer.followUps) && answer.followUps.length > 0 && (
            <div className="text-neutral-500">可能追问：{answer.followUps.join("；")}</div>
          )}
        </div>
      )}

      {suggestions.length > 0 && (
        <div className="space-y-1">
          <div className="text-[11px] text-neutral-500">预生成问题（点击回答）</div>
          {suggestions.slice(0, 8).map((s, i) => (
            <button
              key={i}
              onClick={() => {
                setQuestion(s.question)
                ask(s.question)
              }}
              className="w-full text-left text-[11px] text-neutral-300 hover:text-white truncate"
            >
              · {s.question}
            </button>
          ))}
        </div>
      )}
      {jobId && suggestions.length === 0 && (
        <div className="text-[11px] text-neutral-500">
          该岗位还没有预生成问答。到工作台“生成”里为它生成问答稿，实时回答会更快更贴合事实。
        </div>
      )}
    </div>
  )
}
