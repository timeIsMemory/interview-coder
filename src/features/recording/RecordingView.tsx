import { useRef, useState } from "react"
import { call, api } from "../lib/api"
import { useAsync } from "../lib/hooks"
import { useToast } from "../../contexts/toast"

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${s.toString().padStart(2, "0")}`
}

export function RecordingView() {
  const { showToast } = useToast()
  const sessions = useAsync(() => call(api().recording.listSessions()), [])
  const jobs = useAsync(() => call(api().jobs.list()), [])
  const [openId, setOpenId] = useState<string | null>(null)

  const [title, setTitle] = useState("")
  const [jobId, setJobId] = useState("")
  const [consent, setConsent] = useState(false)

  const createSession = async () => {
    if (!consent) {
      showToast("需要确认", "请先确认合规与双方同意声明", "error")
      return
    }
    try {
      const s = await call(
        api().recording.createSession({ title: title || "面试复盘", jobId: jobId || undefined, consentAcknowledged: true })
      )
      setTitle("")
      setConsent(false)
      sessions.reload()
      setOpenId(s.id)
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold">录音复盘</h1>

      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-sm font-medium">新建复盘会话</div>
        <div className="flex gap-2">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="会话标题"
            className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm"
          />
          <select
            value={jobId}
            onChange={(e) => setJobId(e.target.value)}
            className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm"
          >
            <option value="">不关联岗位</option>
            {(jobs.data || []).map((j) => (
              <option key={j.id} value={j.id}>
                {j.title} · {j.company}
              </option>
            ))}
          </select>
        </div>
        <label className="flex items-start gap-2 text-xs text-neutral-400">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
          我已了解并遵守当地法律，录音/导入已获得相关方同意。分析仅针对回答内容，不做无依据的主观推断。
        </label>
        <button onClick={createSession} className="text-xs px-3 py-1.5 rounded bg-blue-600/70 hover:bg-blue-600">
          创建会话
        </button>
      </div>

      <div className="space-y-2">
        {(sessions.data || []).map((s) => (
          <div key={s.id} className="rounded border border-white/10 bg-white/[0.02]">
            <div className="flex items-center gap-3 p-3">
              <button className="flex-1 text-left" onClick={() => setOpenId(openId === s.id ? null : s.id)}>
                <div className="text-sm text-white">{s.title}</div>
                <div className="text-xs text-neutral-500">
                  {s.transcribedAt ? `已转写 · ${fmtTime(s.durationSec || 0)}` : "未转写"}
                </div>
              </button>
              <button
                onClick={async () => {
                  await call(api().recording.deleteSession(s.id))
                  if (openId === s.id) setOpenId(null)
                  sessions.reload()
                }}
                className="text-xs text-red-400 hover:text-red-300"
              >
                删除
              </button>
            </div>
            {openId === s.id && <SessionDetail sessionId={s.id} />}
          </div>
        ))}
        {(sessions.data || []).length === 0 && (
          <div className="text-neutral-500 text-sm">还没有复盘会话。</div>
        )}
      </div>
    </div>
  )
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const { showToast } = useToast()
  const segments = useAsync(() => call(api().recording.segments(sessionId)), [sessionId])
  const report = useAsync(() => call(api().recording.getReport(sessionId)), [sessionId])
  const [transcriptText, setTranscriptText] = useState("")
  const [busy, setBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])

  const startCapture = async (source: "microphone" | "system") => {
    try {
      const stream = source === "microphone"
        ? await navigator.mediaDevices.getUserMedia({ audio: true })
        : await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      if (!stream.getAudioTracks().length) {
        stream.getTracks().forEach((track) => track.stop())
        throw new Error("所选来源没有可用音轨")
      }
      chunksRef.current = []
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" })
      recorder.ondataavailable = (event) => event.data.size && chunksRef.current.push(event.data)
      recorder.onstop = async () => {
        try {
          const bytes = new Uint8Array(await new Blob(chunksRef.current, { type: "audio/webm" }).arrayBuffer())
          await call(api().recording.saveCapture(sessionId, bytes, ".webm"))
          showToast("录制已保存", "可以继续执行转写", "success")
        } catch (error) {
          showToast("保存失败", (error as Error).message, "error")
        } finally {
          stream.getTracks().forEach((track) => track.stop())
          setRecording(false)
        }
      }
      recorderRef.current = recorder
      recorder.start(1000)
      setRecording(true)
    } catch (error) {
      showToast("录制启动失败", (error as Error).message, "error")
    }
  }

  const stopCapture = () => recorderRef.current?.state === "recording" && recorderRef.current.stop()

  const importMedia = async () => {
    setBusy(true)
    try {
      const path = await call(api().pickFile("audio"))
      if (!path) return
      await call(api().recording.importMedia(sessionId, path))
      showToast("已导入", "音频已附加，可点击转写", "success")
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const transcribe = async () => {
    setBusy(true)
    try {
      await call(api().recording.transcribe(sessionId))
      segments.reload()
      showToast("转写完成", "可编辑分段后生成报告", "success")
    } catch (e) {
      showToast("转写失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const importTranscript = async () => {
    if (!transcriptText.trim()) return
    setBusy(true)
    try {
      await call(api().recording.importTranscript(sessionId, transcriptText))
      setTranscriptText("")
      segments.reload()
      showToast("已导入文稿", "可生成报告", "success")
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const buildReport = async () => {
    setBusy(true)
    try {
      await call(api().recording.buildReport(sessionId))
      report.reload()
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const segs = segments.data || []

  return (
    <div className="border-t border-white/10 p-3 space-y-4">
      <div className="flex flex-wrap gap-2">
        {!recording ? (
          <>
            <button disabled={busy} onClick={() => startCapture("microphone")} className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50">录制麦克风</button>
            <button disabled={busy} onClick={() => startCapture("system")} className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50">录制系统音频</button>
          </>
        ) : (
          <button onClick={stopCapture} className="text-xs px-3 py-1.5 rounded bg-red-600/60 hover:bg-red-600/80">停止并保存</button>
        )}
        <button disabled={busy} onClick={importMedia} className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50">
          导入音频/视频
        </button>
        <button disabled={busy} onClick={transcribe} className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50">
          转写 (Whisper)
        </button>
        <button disabled={busy || !segs.length} onClick={buildReport} className="text-xs px-3 py-1.5 rounded bg-blue-600/70 hover:bg-blue-600 disabled:opacity-50">
          生成复盘报告
        </button>
      </div>

      <div className="space-y-2">
        <div className="text-xs text-neutral-500">或直接粘贴文稿（用“面试官:”“我:”标注说话人）</div>
        <textarea
          value={transcriptText}
          onChange={(e) => setTranscriptText(e.target.value)}
          className="w-full h-20 bg-black/40 border border-white/10 rounded p-2 text-xs resize-none"
        />
        <button disabled={busy} onClick={importTranscript} className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50">
          导入文稿
        </button>
      </div>

      {report.data && <ReportView report={report.data} />}
      {report.data && (
        <button
          onClick={async () => {
            const path = await call(api().recording.exportReport(sessionId))
            if (path) showToast("报告已导出", path, "success")
          }}
          className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10"
        >
          导出报告 JSON
        </button>
      )}

      {segs.length > 0 && (
        <div>
          <div className="text-xs text-neutral-500 mb-1">转写分段（可编辑）</div>
          <div className="space-y-1 max-h-64 overflow-y-auto">
            {segs.map((seg) => (
              <SegmentRow key={seg.id} seg={seg} onSaved={() => segments.reload()} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface SegmentItem {
  id: string
  start: number
  end: number
  speaker: string
  text: string
}

function SegmentRow({ seg, onSaved }: { seg: SegmentItem; onSaved: () => void }) {
  const [text, setText] = useState(seg.text)
  const [dirty, setDirty] = useState(false)
  return (
    <div className="flex items-start gap-2 text-xs">
      <span className="text-neutral-600 w-16 shrink-0">
        {fmtTime(seg.start)}-{fmtTime(seg.end)}
      </span>
      <span className={`w-14 shrink-0 ${seg.speaker === "interviewer" ? "text-purple-400" : "text-blue-400"}`}>
        {seg.speaker === "interviewer" ? "面试官" : seg.speaker === "candidate" ? "我" : "?"}
      </span>
      <input
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setDirty(true)
        }}
        onBlur={async () => {
          if (dirty) {
            await call(api().recording.updateSegment(seg.id, { text }))
            setDirty(false)
            onSaved()
          }
        }}
        className="flex-1 bg-transparent border-b border-white/5 focus:border-white/20 outline-none text-neutral-300"
      />
    </div>
  )
}

interface ReportMetric {
  key: string
  label: string
  score: number
  detail: string
  evidence: Array<{ start: number; end: number; note: string }>
}

function ReportView({ report }: { report: { overallScore: number; metrics: ReportMetric[] } }) {
  return (
    <div className="rounded border border-white/10 bg-white/[0.02] p-3 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">复盘报告</div>
        <div className="text-lg font-semibold text-blue-400">{report.overallScore}</div>
      </div>
      {report.metrics.map((m) => (
        <div key={m.key}>
          <div className="flex items-center gap-2">
            <div className="w-20 text-xs text-neutral-400">{m.label}</div>
            <div className="flex-1 h-2 bg-white/5 rounded overflow-hidden">
              <div className="h-full bg-blue-500/60" style={{ width: `${m.score}%` }} />
            </div>
            <div className="w-8 text-right text-xs text-neutral-300">{m.score}</div>
          </div>
          <div className="text-[11px] text-neutral-500 ml-20">{m.detail}</div>
          {m.evidence.map((ev, i) => (
            <div key={i} className="text-[11px] text-neutral-600 ml-20">
              · {fmtTime(ev.start)}-{fmtTime(ev.end)} {ev.note}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}
