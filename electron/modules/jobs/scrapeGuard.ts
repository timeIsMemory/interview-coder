// Pure guard logic for the controlled scraper (v1.1 Beta). Decides whether a
// response indicates login walls / captcha / blocking, in which case the run
// must stop and degrade to extension or manual import. We never attempt to
// bypass captchas or authentication.

export type BlockReason = "auth" | "captcha" | "rate-limit" | "forbidden" | null

const CAPTCHA_MARKERS = [
  "captcha",
  "geetest",
  "verify-slider",
  "security check",
  "cf-challenge",
  "challenge-platform",
  "验证码",
  "安全验证",
  "人机验证",
  "滑动验证"
]

const LOGIN_MARKERS = [
  "please log in",
  "sign in to continue",
  "请登录",
  "登录后查看",
  "login-form",
  "passport.zhipin",
  "login.zhipin"
]

export function detectBlocking(status: number, body: string, finalUrl = ""): BlockReason {
  if (status === 401) return "auth"
  if (status === 403) return "forbidden"
  if (status === 429) return "rate-limit"
  const hay = `${body.slice(0, 20000)}\n${finalUrl}`.toLowerCase()
  if (CAPTCHA_MARKERS.some((m) => hay.includes(m))) return "captcha"
  if (LOGIN_MARKERS.some((m) => hay.includes(m))) return "auth"
  return null
}

export const BLOCK_MESSAGES: Record<Exclude<BlockReason, null>, string> = {
  auth: "目标页面需要登录。已停止抓取，请改用浏览器扩展（在已登录页面上抓取）或手动导入。",
  captcha: "遇到验证码/人机校验。按照产品规则不做绕过，已停止抓取，请改用扩展或手动导入。",
  "rate-limit": "触发目标站点频率限制。已停止本次运行，请稍后再试或降低频率。",
  forbidden: "访问被拒绝 (403)。已停止抓取，请确认你有权访问该页面，或改用扩展/手动导入。"
}

/** Minimal per-run policy: few URLs, slow cadence, hard cap. */
export const SCRAPE_POLICY = {
  maxUrlsPerRun: 10,
  delayBetweenRequestsMs: 5000,
  requestTimeoutMs: 20000
}
