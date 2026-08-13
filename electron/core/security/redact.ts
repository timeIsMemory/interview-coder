// Secret redaction for logs and user-facing error messages. Provider SDK
// errors can embed the request URL (Gemini puts the API key in the query
// string) or echo auth headers; nothing that reaches console/log files or the
// renderer may contain a usable credential.

const PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // OpenAI / Anthropic style keys, longest prefix first.
  { pattern: /sk-ant-[a-zA-Z0-9_-]{10,}/g, replacement: "sk-ant-***" },
  { pattern: /sk-[a-zA-Z0-9_-]{10,}/g, replacement: "sk-***" },
  // Google API keys.
  { pattern: /AIza[a-zA-Z0-9_-]{20,}/g, replacement: "AIza***" },
  // key=... in query strings (Gemini) and generic token/apiKey params.
  { pattern: /([?&](?:key|api_key|apikey|token|access_token)=)[^&\s"']+/gi, replacement: "$1***" },
  // Authorization headers.
  { pattern: /(bearer\s+)[a-zA-Z0-9._~+/-]{8,}=*/gi, replacement: "$1***" },
  { pattern: /(x-api-key['"]?\s*[:=]\s*['"]?)[a-zA-Z0-9_-]{8,}/gi, replacement: "$1***" }
]

/** Mask credentials inside an arbitrary string. */
export function redactSecrets(text: string): string {
  if (!text) return text
  let out = text
  for (const { pattern, replacement } of PATTERNS) {
    out = out.replace(pattern, replacement)
  }
  return out
}

/** Redact an unknown error into a safe printable string (message + stack). */
export function redactError(err: unknown): string {
  if (err instanceof Error) {
    return redactSecrets(`${err.message}${err.stack ? `\n${err.stack}` : ""}`)
  }
  try {
    return redactSecrets(typeof err === "string" ? err : JSON.stringify(err))
  } catch {
    return redactSecrets(String(err))
  }
}
