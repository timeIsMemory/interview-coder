// Content script: extract a JD from the CURRENT, user-opened page only. It runs
// on demand (triggered from the popup), never on a schedule, and only reads the
// visible page the user already navigated to. No login/contact scraping.

function text(el) {
  return (el && el.textContent ? el.textContent : "").replace(/\s+/g, " ").trim()
}

function firstText(selectors) {
  for (const sel of selectors) {
    const el = document.querySelector(sel)
    if (el) {
      const t = text(el)
      if (t) return t
    }
  }
  return ""
}

function extractByHost() {
  const host = location.hostname
  if (host.includes("zhipin.com")) {
    return {
      title: firstText([".job-primary .name h1", ".job-banner .name", "h1"]),
      company: firstText([".company-info .name", ".sider-company .name", ".company-name"]),
      salary: firstText([".job-primary .salary", ".salary"]),
      city: firstText([".job-primary .location", ".text-city"]),
      description: firstText([".job-sec-text", ".job-detail-section", ".detail-content"])
    }
  }
  if (host.includes("lagou.com")) {
    return {
      title: firstText([".position-head .name", ".job-name", "h1"]),
      company: firstText([".company", ".job_company .company"]),
      salary: firstText([".salary", ".job_request .salary"]),
      city: firstText([".job_request .city", ".work_addr"]),
      description: firstText([".job_bt", ".job-detail", ".content"])
    }
  }
  if (host.includes("liepin.com")) {
    return {
      title: firstText([".job-title-box .name", ".title-info h1", "h1"]),
      company: firstText([".company-name", ".company-info .name"]),
      salary: firstText([".job-salary", ".salary"]),
      city: firstText([".job-properties", ".job-labels"]),
      description: firstText([".job-intro-content", ".paragraph", ".job-description"])
    }
  }
  if (host.includes("linkedin.com")) {
    return {
      title: firstText([".job-details-jobs-unified-top-card__job-title", "h1"]),
      company: firstText([".job-details-jobs-unified-top-card__company-name", ".jobs-unified-top-card__company-name"]),
      salary: "",
      city: firstText([".job-details-jobs-unified-top-card__primary-description-container"]),
      description: firstText([".jobs-description__content", ".jobs-box__html-content", "#job-details"])
    }
  }
  return { title: "", company: "", salary: "", city: "", description: "" }
}

function extract() {
  const byHost = extractByHost()
  // Fallbacks: user text selection, then <main>/<article>, then title tags.
  const selection = (window.getSelection && window.getSelection().toString().trim()) || ""
  const description =
    byHost.description ||
    selection ||
    text(document.querySelector("main")) ||
    text(document.querySelector("article")) ||
    ""
  return {
    title: byHost.title || text(document.querySelector("h1")) || document.title,
    company: byHost.company || "",
    salary: byHost.salary || "",
    city: byHost.city || "",
    description,
    url: location.href
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === "EXTRACT_JD") {
    try {
      sendResponse({ ok: true, job: extract() })
    } catch (e) {
      sendResponse({ ok: false, error: String(e) })
    }
  }
  return true
})
