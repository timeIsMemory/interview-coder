import { useState } from "react"
import { call, api } from "../lib/api"
import { useAsync } from "../lib/hooks"
import { useToast } from "../../contexts/toast"

const CATEGORIES: Array<{ id: string; label: string }> = [
  { id: "basic", label: "基本信息" },
  { id: "education", label: "教育" },
  { id: "experience", label: "工作经历" },
  { id: "project", label: "项目" },
  { id: "skill", label: "技能" },
  { id: "achievement", label: "成果" },
  { id: "preference", label: "偏好" },
  { id: "private", label: "私密" }
]

const SENSITIVITY_LABELS: Record<string, string> = {
  public: "公开",
  internal: "内部",
  private: "私密"
}

export function ProfileView() {
  const { showToast } = useToast()
  const facts = useAsync(() => call(api().profile.listFacts()), [])
  const versions = useAsync(() => call(api().profile.listVersions()), [])
  const [importText, setImportText] = useState("")
  const [busy, setBusy] = useState(false)

  const [form, setForm] = useState({ category: "experience", label: "", detail: "" })

  const addFact = async () => {
    if (!form.label.trim() || !form.detail.trim()) {
      showToast("提示", "请填写标签和内容", "error")
      return
    }
    try {
      await call(api().profile.addFact({ ...form, confirmed: true }))
      setForm({ category: form.category, label: "", detail: "" })
      facts.reload()
      showToast("成功", "已添加事实", "success")
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    }
  }

  const importResume = async (fromFile: boolean) => {
    setBusy(true)
    try {
      let drafts: unknown[]
      if (fromFile) {
        const path = await call(api().pickFile("resume"))
        if (!path) return
        drafts = await call(api().profile.importResumeFile(path))
      } else {
        if (!importText.trim()) {
          showToast("提示", "请粘贴简历文本", "error")
          return
        }
        drafts = await call(api().profile.importResume(importText))
      }
      setImportText("")
      facts.reload()
      showToast("解析完成", `提取到 ${drafts.length} 条待确认事实，请逐条核对`, "success")
    } catch (e) {
      showToast("解析失败", (e as Error).message, "error")
    } finally {
      setBusy(false)
    }
  }

  const confirmFact = async (id: string) => {
    await call(api().profile.confirmFact(id))
    facts.reload()
  }
  const deleteFact = async (id: string) => {
    await call(api().profile.deleteFact(id))
    facts.reload()
  }
  const createVersion = async () => {
    try {
      const v = await call(api().profile.createVersion())
      versions.reload()
      showToast("已快照", `事实库版本 v${v.version} 已冻结`, "success")
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    }
  }

  const list = facts.data || []
  const unconfirmed = list.filter((f) => !f.confirmed)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">个人事实库</h1>
        <button
          onClick={createVersion}
          className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10"
        >
          冻结当前版本
        </button>
      </div>

      <p className="text-xs text-neutral-400">
        这里是你唯一需要维护的真实资料。生成简历和问答时，AI 只能引用这里“已确认”的事实，不会编造。
      </p>

      {/* Import */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-sm font-medium">从旧简历导入</div>
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          placeholder="粘贴简历文本，AI 会解析为待确认事实（不会自动确认）"
          className="w-full h-24 bg-black/40 border border-white/10 rounded p-2 text-sm resize-none"
        />
        <div className="flex gap-2">
          <button
            disabled={busy}
            onClick={() => importResume(false)}
            className="text-xs px-3 py-1.5 rounded bg-blue-600/70 hover:bg-blue-600 disabled:opacity-50"
          >
            解析粘贴文本
          </button>
          <button
            disabled={busy}
            onClick={() => importResume(true)}
            className="text-xs px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 disabled:opacity-50"
          >
            从文件导入 (PDF/DOCX)
          </button>
        </div>
      </div>

      {/* Unconfirmed review queue */}
      {unconfirmed.length > 0 && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 space-y-2">
          <div className="text-sm font-medium text-amber-200">
            待确认 ({unconfirmed.length}) — 请核对后确认，未确认的事实不会用于生成
          </div>
          {unconfirmed.map((f) => (
            <div key={f.id} className="flex items-start gap-2 text-sm">
              <div className="flex-1">
                <span className="text-amber-100">{f.label}</span>
                <span className="text-neutral-400"> — {f.detail}</span>
              </div>
              <button onClick={() => confirmFact(f.id)} className="text-xs text-green-400 hover:text-green-300">
                确认
              </button>
              <button onClick={() => deleteFact(f.id)} className="text-xs text-red-400 hover:text-red-300">
                删除
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add fact */}
      <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-3">
        <div className="text-sm font-medium">手动添加事实</div>
        <div className="flex gap-2">
          <select
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
            className="bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm"
          >
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <input
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
            placeholder="标签，如：后端工程师 @ Acme"
            className="flex-1 bg-black/40 border border-white/10 rounded px-2 py-1.5 text-sm"
          />
        </div>
        <textarea
          value={form.detail}
          onChange={(e) => setForm({ ...form, detail: e.target.value })}
          placeholder="详细内容（真实、可核验）"
          className="w-full h-20 bg-black/40 border border-white/10 rounded p-2 text-sm resize-none"
        />
        <button onClick={addFact} className="text-xs px-3 py-1.5 rounded bg-blue-600/70 hover:bg-blue-600">
          添加
        </button>
      </div>

      {/* Confirmed facts grouped */}
      <div className="space-y-4">
        {CATEGORIES.map((cat) => {
          const items = list.filter((f) => f.confirmed && f.category === cat.id)
          if (!items.length) return null
          return (
            <div key={cat.id}>
              <div className="text-xs uppercase tracking-wide text-neutral-500 mb-2">{cat.label}</div>
              <div className="space-y-2">
                {items.map((f) => (
                  <div
                    key={f.id}
                    className="rounded border border-white/10 bg-white/[0.02] p-3 flex items-start gap-3"
                  >
                    <div className="flex-1">
                      <div className="text-sm text-white">
                        {f.label}
                        {f.sensitivity !== "public" && (
                          <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-white/10 text-neutral-300">
                            {SENSITIVITY_LABELS[f.sensitivity]}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-neutral-400 mt-1 whitespace-pre-wrap">{f.detail}</div>
                    </div>
                    <button onClick={() => deleteFact(f.id)} className="text-xs text-red-400 hover:text-red-300">
                      删除
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>

      {(versions.data || []).length > 0 && (
        <div className="text-xs text-neutral-500">
          历史版本：{(versions.data || []).map((v) => `v${v.version}`).join(" · ")}
        </div>
      )}
    </div>
  )
}
