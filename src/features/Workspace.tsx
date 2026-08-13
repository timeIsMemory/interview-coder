import { useState } from "react"
import { ApplicationsView } from "./applications/ApplicationsView"
import { DashboardView } from "./dashboard/DashboardView"
import { GenerateView } from "./generation/GenerateView"
import { JobsView } from "./jobs/JobsView"
import { ProfileView } from "./profile/ProfileView"
import { RecordingView } from "./recording/RecordingView"

type Tab = "dashboard" | "profile" | "jobs" | "applications" | "generate" | "recording"

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: "dashboard", label: "总览", hint: "求职进度看板" },
  { id: "profile", label: "事实库", hint: "个人真实资料" },
  { id: "jobs", label: "岗位", hint: "导入并管理 JD" },
  { id: "applications", label: "投递", hint: "跟进状态与下一步" },
  { id: "generate", label: "生成", hint: "批量简历与问答" },
  { id: "recording", label: "复盘", hint: "录音转写与评估" }
]

interface WorkspaceProps {
  onOpenSettings: () => void
  onSwitchToLive: () => void
  hasApiKey: boolean
}

export function Workspace({ onOpenSettings, onSwitchToLive, hasApiKey }: WorkspaceProps) {
  const [tab, setTab] = useState<Tab>("dashboard")
  return (
    <div className="flex min-h-screen w-full bg-neutral-950 text-neutral-100">
      <aside className="flex w-52 shrink-0 flex-col border-r border-white/10">
        <div className="border-b border-white/10 px-4 py-4"><div className="text-sm font-semibold">AI 求职助手</div><div className="mt-0.5 text-[11px] text-neutral-500">本地优先 · 全流程</div></div>
        <nav className="flex-1 py-2">
          {TABS.map((item) => <button key={item.id} onClick={() => setTab(item.id)} className={`w-full px-4 py-2.5 text-left transition-colors ${tab === item.id ? "bg-white/10 text-white" : "text-neutral-400 hover:bg-white/5"}`}><div className="text-sm">{item.label}</div><div className="text-[11px] text-neutral-500">{item.hint}</div></button>)}
        </nav>
        <div className="space-y-2 border-t border-white/10 p-3"><button onClick={onSwitchToLive} className="w-full rounded bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10">切换到实时辅助</button><button onClick={onOpenSettings} className="w-full rounded bg-white/5 px-3 py-2 text-xs text-neutral-200 hover:bg-white/10">设置 / API Key</button></div>
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        {!hasApiKey && <div className="border-b border-amber-500/30 bg-amber-500/10 px-6 py-2 text-xs text-amber-200">尚未配置 API Key。导入与管理仍可使用，生成、AI 解析和转写需要先完成设置。</div>}
        <div className="mx-auto max-w-5xl p-6">
          {tab === "dashboard" && <DashboardView onNavigate={(next) => setTab(next as Tab)} />}
          {tab === "profile" && <ProfileView />}
          {tab === "jobs" && <JobsView />}
          {tab === "applications" && <ApplicationsView />}
          {tab === "generate" && <GenerateView />}
          {tab === "recording" && <RecordingView />}
        </div>
      </main>
    </div>
  )
}
