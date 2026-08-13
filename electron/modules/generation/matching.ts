// Pure JD <-> profile matching. Produces a coverage score plus the specific
// gaps (JD keywords not backed by any fact). This is what the plan calls
// "匹配度": it is transparently keyword/fact coverage, NOT a real ATS score,
// and the UI labels it that way. Dependency-free and unit-tested.

import { normalizeForHash } from "../../core/ids"

// Common words we don't want to treat as meaningful skill/keyword tokens.
const STOPWORDS = new Set([
  "the", "and", "for", "with", "you", "your", "our", "are", "will", "have",
  "who", "what", "that", "this", "from", "job", "role", "team", "work",
  "years", "year", "experience", "skills", "ability", "including", "etc",
  "的", "和", "与", "或", "及", "等", "负责", "熟悉", "了解", "具备", "以上",
  "工作", "经验", "能力", "岗位", "职责", "要求", "优先", "相关", "以及"
])

/** Tokenize into candidate keywords: latin words (>=2) and CJK bigrams. */
export function tokenize(text: string): string[] {
  const norm = normalizeForHash(text)
  const latin = norm.match(/[a-z0-9+#.]{2,}/g) || []
  const cjk = norm.match(/[\u4e00-\u9fff]/g) || []
  const cjkBigrams: string[] = []
  const cjkStr = cjk.join("")
  for (let i = 0; i < cjkStr.length - 1; i++) {
    cjkBigrams.push(cjkStr.slice(i, i + 2))
  }
  return [...latin, ...cjkBigrams].filter((t) => !STOPWORDS.has(t))
}

export interface MatchResult {
  /** 0..1 coverage of JD keywords found in the fact corpus. */
  score: number
  matchedKeywords: string[]
  /** JD keywords with no support in the fact corpus (skill gaps). */
  gaps: string[]
}

/**
 * Score how well the profile's fact corpus covers a JD.
 * @param jdText Full job description.
 * @param corpusText Concatenated confirmed-fact text.
 */
export function matchJobToCorpus(jdText: string, corpusText: string): MatchResult {
  const jdTokens = tokenize(jdText)
  const corpus = new Set(tokenize(corpusText))
  // Rank JD tokens by frequency to surface the most important keywords first.
  const freq = new Map<string, number>()
  for (const t of jdTokens) freq.set(t, (freq.get(t) || 0) + 1)
  const uniqueJd = [...freq.keys()]
  if (uniqueJd.length === 0) {
    return { score: 0, matchedKeywords: [], gaps: [] }
  }
  const matched: string[] = []
  const gaps: string[] = []
  for (const token of uniqueJd) {
    if (corpus.has(token)) matched.push(token)
    else gaps.push(token)
  }
  // Weight by frequency so covering common JD terms matters more.
  const totalWeight = uniqueJd.reduce((s, t) => s + (freq.get(t) || 1), 0)
  const matchedWeight = matched.reduce((s, t) => s + (freq.get(t) || 1), 0)
  const score = totalWeight ? matchedWeight / totalWeight : 0
  const byFreqDesc = (a: string, b: string) => (freq.get(b) || 0) - (freq.get(a) || 0)
  return {
    score: Math.round(score * 100) / 100,
    matchedKeywords: matched.sort(byFreqDesc).slice(0, 40),
    gaps: gaps.sort(byFreqDesc).slice(0, 40)
  }
}

/**
 * Group jobs by similarity of their keyword sets so we can reuse interview
 * questions across near-duplicate JDs instead of regenerating for each. Uses a
 * greedy Jaccard clustering, which is enough for tens/hundreds of jobs.
 */
export function clusterJobs(
  jobs: Array<{ id: string; text: string }>,
  threshold = 0.6
): string[][] {
  const sets = jobs.map((j) => ({ id: j.id, set: new Set(tokenize(j.text)) }))
  const clusters: Array<{ rep: Set<string>; ids: string[] }> = []
  for (const item of sets) {
    let placed = false
    for (const cluster of clusters) {
      if (jaccard(item.set, cluster.rep) >= threshold) {
        cluster.ids.push(item.id)
        placed = true
        break
      }
    }
    if (!placed) clusters.push({ rep: item.set, ids: [item.id] })
  }
  return clusters.map((c) => c.ids)
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}
