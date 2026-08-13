// Dependency-free HTML sanitizer for AI-generated / user-edited resume HTML.
// Model output and user edits are untrusted: they are rendered with
// dangerouslySetInnerHTML in the renderer and loaded into a BrowserWindow for
// PDF export, so anything executable must be stripped before persistence.

const DROP_WITH_CONTENT = ["script", "style", "iframe", "object", "embed", "template", "noscript"]
const DROP_TAG_ONLY = ["link", "meta", "base", "form", "input", "button", "select", "textarea"]

/** Remove executable content and event handlers, keep benign markup. */
export function sanitizeHtml(input: string): string {
  if (!input) return ""
  let html = input

  // Remove comments (can hide payloads like conditional IE tricks).
  html = html.replace(/<!--[\s\S]*?-->/g, "")

  // Drop dangerous elements together with their content.
  for (const tag of DROP_WITH_CONTENT) {
    const pair = new RegExp(`<\\s*${tag}[^>]*>[\\s\\S]*?<\\s*/\\s*${tag}\\s*>`, "gi")
    const solo = new RegExp(`<\\s*${tag}[^>]*/?>`, "gi")
    html = html.replace(pair, "").replace(solo, "")
  }
  // Drop dangerous void/formish elements (keep any inner text they wrapped).
  for (const tag of DROP_TAG_ONLY) {
    const open = new RegExp(`<\\s*${tag}[^>]*>`, "gi")
    const close = new RegExp(`<\\s*/\\s*${tag}\\s*>`, "gi")
    html = html.replace(open, "").replace(close, "")
  }

  // Strip inline event handlers: onclick=, onerror=, onload=, ...
  html = html.replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, "")
  html = html.replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, "")
  html = html.replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, "")

  // Neutralize javascript:/vbscript:/data: URLs in href/src/srcset/action.
  html = html.replace(
    /\s+(href|src|srcset|action|formaction|xlink:href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi,
    (match: string, attr: string, dq?: string, sq?: string, bare?: string) => {
      const value = (dq ?? sq ?? bare ?? "").trim()
      // Remove whitespace and control characters so "jav\tascript:" tricks fail.
      const lowered = Array.from(value.toLowerCase())
        .filter((ch) => ch.charCodeAt(0) > 0x20)
        .join("")
      if (
        lowered.startsWith("javascript:") ||
        lowered.startsWith("vbscript:") ||
        (lowered.startsWith("data:") && !lowered.startsWith("data:image/"))
      ) {
        return ` ${attr}="#"`
      }
      return match
    }
  )

  return html
}
