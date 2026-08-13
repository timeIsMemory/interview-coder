# AI 求职全流程助手 — 功能与开发文档

基于原 Interview Coder（隐身截图解题工具）扩展的本地优先求职助手：
**个人事实库 → JD 导入 → 批量简历/问答生成 → 实时面试辅助 → 录音复盘**。

所有数据（档案、岗位、产物、录音）默认只存本机；仅在你主动触发 AI 生成/转写时才会调用你配置的模型 API。

---

## 1. 功能总览

### 工作台（默认模式）

启动后进入工作台，左侧导航：

| 页面 | 功能 |
| --- | --- |
| 总览 | 岗位漏斗、事实库/产物/成本统计、待核实产物提醒 |
| 事实库 | 手动录入或从旧简历（粘贴/PDF/DOCX）解析事实；AI 解析结果一律为“待确认”，逐条确认后才可用于生成；可冻结不可变版本快照 |
| 岗位 | 粘贴（`---` 分隔多条）、文件、CSV、JSON 导入；浏览器扩展对接；受控抓取 Beta；三级去重（平台+positionId 强键 → 内容 hash → 公司+职位+薪资弱键）；状态跟踪 |
| 生成 | 勾选岗位 → 运行前成本预估 → 批量生成定制简历（HTML 预览 + PDF 导出）和问答稿（30 秒版/2 分钟版/STAR/追问）；支持暂停/继续/取消；相似 JD 聚类复用题目 |
| 复盘 | 创建会话（需确认合规声明）→ 导入音频/视频并用 Whisper 转写，或直接粘贴文稿 → 可编辑分段 → 生成证据化报告（每条建议引用时间段） |

右下角可切换到**实时辅助**（原隐身悬浮窗）。

### 事实约束（防编造）硬门槛

- 生成 Prompt 只注入“已确认”事实，并明确禁止虚构。
- 生成后运行确定性事实核对：简历中的数字/百分比/年限等硬性声明必须能在事实库中找到；未支撑的声明会被列出。
- **存在未核实声明的简历无法批准，未批准的简历无法导出 PDF。** 修改内容或补充事实后可重新核对。

### 实时辅助（面试模式）

- 保留原有截图解题、快捷键（`Ctrl/Cmd+B` 显隐等）与内容保护。
- 新增浮动面板：选择目标岗位后，输入问题优先从该岗位的**预生成问答题库本地检索**（毫秒级、可溯源）；未命中时才调用在线模型补充（明确标注“在线补充”）；事实不足时明确显示“资料不足”，不编造经历。

### 浏览器扩展（browser-extension/）

- Chrome/Edge Manifest V3，仅在你点击时读取**当前打开的**招聘详情页（支持 Boss 直聘/拉勾/猎聘/前程无忧/LinkedIn 及通用回退）。
- 送达方式：优先经 `127.0.0.1:53127` 配对通道直接送入桌面应用（需在“岗位 → 浏览器扩展对接”开启并配置令牌）；桌面端未运行则降级下载 JSON，再用 JSON 导入。
- 不做后台抓取、不采集联系人/聊天等信息。

安装：浏览器扩展管理页 → 开发者模式 → “加载已解压的扩展程序” → 选择 `browser-extension/` 目录。

### 受控抓取（v1.1 Beta）

- 用户粘贴自己有权访问的岗位详情页 URL（每次 ≤10 条），逐条抓取、间隔 5 秒。
- 遇登录墙/验证码/403/429 **立即停止**并提示改用扩展或手动导入；不做任何绕过。
- 每次运行记录日志、内容 hash、适配器版本（`scrape_runs` 表）。

---

## 2. 架构

```
electron/
  core/
    ai/        AiGateway（OpenAI/Gemini/Anthropic 统一接入、视觉输入、并发限流、JSON 解析、成本估算）
    solver/    截图解题流水线的 Prompt 层 + 结构化输出校验 + 错误映射（ProcessingHelper 只做编排）
    db/        SQLite（node:sqlite, WAL）+ 版本化迁移 + 事务写入 + 备份；旧 JSON 库首启自动迁移
    ipc/       集中注册 + 输入校验（长度/类型/路径/文件大小白名单）+ 错误日志脱敏
    security/  safeStorage 加密存储、HTML 消毒器（sanitizeHtml）、密钥脱敏（redact）
  modules/
    profile/   事实库服务 + 事实约束核对（纯函数）+ 模板版本化
    jobs/      适配器（粘贴/文件/CSV/JSON/扩展/抓取）→ 标准化（纯函数）→ 去重 → 仓储；ExtensionBridge；ControlledScraper
    generation/ 匹配分析（纯函数）、Prompt 版本化、批处理引擎（暂停/取消/成本/断点续跑/幂等复用）
    live/      预生成题库检索（纯函数）+ 在线补充
    recording/ TranscriptionProvider（Whisper 云端 / 本地 whisper.cpp / 手动文稿）+ 可解释复盘指标（纯函数）
src/features/  工作台 React UI（dashboard/profile/jobs/generation/recording/live/applications）
browser-extension/  Chrome/Edge 扩展 v0.1
tests/         vitest 单元/集成/安全测试（150+ 用例，不依赖真实网络与 Electron 窗口）
e2e/           Playwright Electron 冒烟测试（应用启动 + assistantAPI 可用）
```

关键设计：

- **渲染进程不接触文件/数据库/模型 SDK**，一切经 `window.assistantAPI`（preload 按领域分组暴露），主进程侧统一做输入校验，返回 `{ok,data}|{ok,error}` 信封；错误信息与日志经密钥脱敏。
- **存储**：`%APPDATA%/interview-coder-v1/assistant.db`（Node 内置 `node:sqlite`，WAL、事务写入、失败回滚、可一键备份）；历史 JSON 库（`assistant-db.json`）在首次启动时自动迁移一次；敏感值走 `assistant-secure.json`（safeStorage 加密）。**运行/构建要求 Node ≥ 22.5**。
- **AI Gateway**：所有任务（含截图解题）共用一个网关（含视觉输入），模型按用途（extraction/solution/debugging/generation）从配置解析；全局并发 3。
- **产物追溯与幂等**：每次批处理记录 `profileVersion + jobVersion + templateVersion + promptVersion + model + 成本`，同一组合的重复请求会复用/续跑已有 run 而不是重复计费；中断的 run 可断点续跑（已完成步骤不重跑）；产物有修订历史（AI 版 + 用户编辑版），CV HTML 在入库与导出前均做 XSS 消毒。

---

## 3. 开发与验证

环境要求：**Node ≥ 22.5**（`node:sqlite` 依赖；CI 亦固定 Node 22）。

```bash
npm install          # 安装依赖（pdf-parse/mammoth 为可选依赖，缺失时对应功能给出友好提示）
npm run dev          # 开发模式（Vite + Electron）
npm test             # vitest 单元/集成/安全测试
npm run test:e2e     # Playwright Electron 冒烟测试（先构建再启动应用）
npm run typecheck    # 渲染进程 + Electron 主进程类型检查（硬性门槛）
npm run build        # 生产构建（渲染进程 + 主进程）
npm run package-win  # Windows 安装包（macOS: package-mac）
```

已验证：单元/集成/安全测试全绿、双 tsc 通过、`npm run build` 全量成功、Windows NSIS 安装包与 `win-unpacked` 可产出。
**尚未完整验证**：Windows 安装包的升级覆盖/卸载/数据保留生命周期，macOS 产物（x64/arm64 DMG/ZIP）的安装冒烟——发布前需在对应平台手动执行。

## 4. 合规与隐私要点

- 不自动抓取招聘网站；抓取 Beta 遇到登录/验证码即停，不绕过。
- 实时辅助定位为个人准备/提词/复盘工具，UI 不承诺“100% 隐身”。
- 简历真实性：事实确认 + 导出前核对是硬门槛。
- 录音复盘要求先确认当地法律与双方同意；音频只存本机，删除会话即删除文件。
- 本项目为 AGPL-3.0 衍生作品，分发时须遵守 AGPL 义务。

## 5. 已知限制 / 后续路线

- 已实现（相对早期文档）：DOCX 导出、应用内麦克风/屏幕音频录制（MediaRecorder → 主进程落盘）、本地 whisper.cpp 转写（需在配置中指定可执行文件与模型路径，暂无设置界面）、`applications` 投递看板 UI、SQLite 存储、Playwright E2E 冒烟。
- 未完成：真正的双轨（麦克风+系统音频）录制与混音方案；whisper.cpp 的图形化设置/校验界面；录音保留期限设置页；可读版 HTML/PDF 复盘报告（当前以 JSON 导出为主）；业务级 E2E 场景（导入→生成→导出全链路）。
- 说话人区分为尽力而为（Whisper 混合音轨默认标为“我”），可在分段编辑中人工修正。
