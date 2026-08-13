import { useState } from "react"
import { call, api } from "../lib/api"
import { useAsync } from "../lib/hooks"
import { useToast } from "../../contexts/toast"

interface Props {
  artifactId: string
  onClose: () => void
  onChanged: () => void
}

export function ArtifactDetail({ artifactId, onClose, onChanged }: Props) {
  const { showToast } = useToast()
  const artifact = useAsync(() => call(api().generation.getArtifact(artifactId)), [artifactId])
  const [editContent, setEditContent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const a = artifact.data
  const content = editContent ?? (a?.content || "")

  const save = async () => {
    setBusy(true)
    try {
      await call(api().generation.updateArtifact(artifactId, content))
      setEditContent(null)
      artifact.reload()
      onChanged()
      showToast("已保存", "已记录修订并重新核对事实", "success")
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const approve = async () => {
    setBusy(true)
    try {
      const res = await call(api().generation.approveArtifact(artifactId))
      if (!res.ok) {
        showToast("无法批准", "仍有未核实的事实声明，请先修改或补充事实。", "error")
      } else {
        artifact.reload()
        onChanged()
        showToast("已批准", "现在可以导出", "success")
      }
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const exportPdf = async () => {
    setBusy(true)
    try {
      const path = await call(api().generation.exportPdf(artifactId))
      if (path) showToast("已导出", path, "success")
    } catch (e) {
      showToast("导出失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const exportDocx = async () => {
    setBusy(true)
    try {
      const path = await call(api().generation.exportDocx(artifactId))
      if (path) showToast("已导出", path, "success")
    } catch (e) {
      showToast("导出失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-6" onClick={onClose}>
      <div
        className="bg-neutral-900 border border-white/10 rounded-lg w-full max-w-3xl max-h-[85vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
          <div className="text-sm font-medium">{a?.kind === "cv" ? "简历详情" : "问答详情"}</div>
          <button onClick={onClose} className="text-neutral-400 hover:text-white text-sm">
            关闭
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {artifact.loading && <div className="text-neutral-400 text-sm">加载中…</div>}
          {a && a.kind === "cv" && (
            <>
              {a.match && (
                <div className="text-xs text-neutral-400">
                  匹配度 {Math.round(a.match.score * 100)}% · 覆盖关键词{" "}
                  {a.match.matchedKeywords.slice(0, 8).join(", ")}
                  {a.match.gaps.length > 0 && (
                    <div className="text-amber-300/80 mt-1">
                      缺口：{a.match.gaps.slice(0, 8).join(", ")}
                    </div>
                  )}
                </div>
              )}
              {a.factCheck && !a.factCheck.supported && (
                <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200 space-y-1">
                  <div className="font-medium">未核实的事实声明（导出前必须解决）：</div>
                  {a.factCheck.issues.map((iss: { claim: string; sentence: string }, i: number) => (
                    <div key={i}>
                      · [{iss.claim}] {iss.sentence}
                    </div>
                  ))}
                </div>
              )}
              <div>
                <div className="text-xs text-neutral-500 mb-1">预览</div>
                <div
                  className="bg-white text-black rounded p-4 text-sm max-h-72 overflow-y-auto"
                  dangerouslySetInnerHTML={{ __html: content }}
                />
              </div>
              <div>
                <div className="text-xs text-neutral-500 mb-1">编辑 HTML</div>
                <textarea
                  value={content}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-40 bg-black/40 border border-white/10 rounded p-2 text-xs font-mono resize-none"
                />
              </div>
            </>
          )}

          {a && a.kind === "qa" && <QaView content={a.content} />}
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-white/10">
          {a?.kind === "cv" && (
            <>
              <button
                disabled={busy || editContent === null}
                onClick={save}
                className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40"
              >
                保存修改
              </button>
              <button
                disabled={busy || a?.approved}
                onClick={approve}
                className="text-xs px-3 py-1.5 rounded bg-green-600/60 hover:bg-green-600/80 disabled:opacity-40"
              >
                {a?.approved ? "已批准" : "核实并批准"}
              </button>
              <button
                disabled={busy || !a?.approved}
                onClick={exportPdf}
                className="text-xs px-3 py-1.5 rounded bg-blue-600/70 hover:bg-blue-600 disabled:opacity-40"
              >
                导出 PDF
              </button>
              <button
                disabled={busy || !a?.approved}
                onClick={exportDocx}
                className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-40"
              >
                导出 DOCX
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

interface QaAnswer {
  question?: string
  category?: string
  shortAnswer?: string
  detailedAnswer?: string
  starPoints?: string[]
  followUps?: string[]
}

function QaView({ content }: { content: string }) {
  let answers: QaAnswer[] = []
  try {
    answers = JSON.parse(content)
  } catch {
    answers = []
  }
  if (!answers.length) return <div className="text-neutral-500 text-sm">没有问答内容。</div>
  return (
    <div className="space-y-3">
      {answers.map((qa, i) => (
        <div key={i} className="rounded border border-white/10 bg-white/[0.02] p-3">
          <div className="text-sm text-white">
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-300 mr-2">
              {qa.category}
            </span>
            {qa.question}
          </div>
          {qa.shortAnswer && (
            <div className="mt-2 text-xs text-neutral-300">
              <span className="text-neutral-500">30 秒版：</span>
              {qa.shortAnswer}
            </div>
          )}
          {qa.detailedAnswer && (
            <div className="mt-1 text-xs text-neutral-400">
              <span className="text-neutral-500">详细版：</span>
              {qa.detailedAnswer}
            </div>
          )}
          {Array.isArray(qa.starPoints) && qa.starPoints.length > 0 && (
            <div className="mt-1 text-[11px] text-neutral-500">STAR：{qa.starPoints.join(" / ")}</div>
          )}
          {Array.isArray(qa.followUps) && qa.followUps.length > 0 && (
            <div className="mt-1 text-[11px] text-neutral-500">可能追问：{qa.followUps.join("；")}</div>
          )}
        </div>
      ))}
    </div>
  )
}
