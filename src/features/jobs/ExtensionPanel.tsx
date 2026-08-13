import { call, api } from "../lib/api"
import { useAsync } from "../lib/hooks"
import { useToast } from "../../contexts/toast"

export function ExtensionPanel() {
  const { showToast } = useToast()
  const status = useAsync(() => call(api().extension.status()), [])

  const toggle = async () => {
    try {
      if (status.data?.enabled) {
        await call(api().extension.disable())
      } else {
        await call(api().extension.enable())
      }
      status.reload()
    } catch (e) {
      showToast("失败", (e as Error).message, "error")
    }
  }

  const s = status.data
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-4 space-y-2">
      <div className="flex items-center justify-between">
        <div className="text-sm font-medium">浏览器扩展对接（可选）</div>
        <button
          onClick={toggle}
          className={`text-xs px-3 py-1.5 rounded ${
            s?.enabled ? "bg-red-600/50 hover:bg-red-600/70" : "bg-white/5 hover:bg-white/10"
          }`}
        >
          {s?.enabled ? "关闭本地对接" : "开启本地对接"}
        </button>
      </div>
      <p className="text-[11px] text-neutral-500">
        开启后，扩展可通过本机回环地址（127.0.0.1:{s?.port || 53127}）把当前页面的 JD 直接送入应用。仅监听本机，需配对令牌。未开启时扩展会下载 JSON，你可用上方 JSON 导入。
      </p>
      {s?.enabled && s.token && (
        <div className="text-[11px] text-neutral-400">
          配对令牌（粘贴到扩展存储 <code>pairingToken</code>）：
          <code className="ml-1 px-1.5 py-0.5 rounded bg-black/50 text-neutral-200 break-all">{s.token}</code>
        </div>
      )}
    </div>
  )
}
