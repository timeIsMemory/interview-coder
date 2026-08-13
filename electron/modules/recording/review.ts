// Pure, explainable recording-review metrics. Every metric is deterministic and
// cites transcript time ranges as evidence. We deliberately avoid unfounded
// inferences (emotion, personality, hireability); only observable properties of
// the answer are scored. Dependency-free and unit tested.

import { tokenize } from "../generation/matching"
import type { ReviewMetric, TranscriptSegment } from "./types"

const FILLERS_EN = ["um", "uh", "like", "you know", "actually", "basically", "sort of"]
const FILLERS_ZH = ["嗯", "呃", "然后", "就是", "那个", "反正"]
const STRUCTURE_MARKERS = [
  "first", "second", "finally", "for example", "as a result", "because",
  "首先", "其次", "然后", "最后", "例如", "比如", "因此", "结果"
]

function candidateSegments(segments: TranscriptSegment[]): TranscriptSegment[] {
  const cand = segments.filter((s) => s.speaker === "candidate")
  // If speaker separation failed, fall back to all segments.
  return cand.length ? cand : segments
}

function countOccurrences(text: string, needles: string[]): number {
  const lower = text.toLowerCase()
  return needles.reduce((sum, n) => {
    const re = new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")
    return sum + (lower.match(re)?.length || 0)
  }, 0)
}

function wordCount(text: string): number {
  const latin = (text.match(/[a-zA-Z0-9']+/g) || []).length
  const cjk = (text.match(/[\u4e00-\u9fff]/g) || []).length
  return latin + cjk
}

function clamp(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)))
}

export function structureMetric(segments: TranscriptSegment[]): ReviewMetric {
  const cand = candidateSegments(segments)
  const evidence: ReviewMetric["evidence"] = []
  let markerSegments = 0
  for (const s of cand) {
    if (countOccurrences(s.text, STRUCTURE_MARKERS) > 0) {
      markerSegments++
      evidence.push({ start: s.start, end: s.end, note: "使用了结构化衔接词" })
    }
  }
  const ratio = cand.length ? markerSegments / cand.length : 0
  return {
    key: "structure",
    label: "回答结构",
    score: clamp(ratio * 140),
    detail: `在 ${cand.length} 段回答中，有 ${markerSegments} 段使用了明确的结构化表达。`,
    evidence: evidence.slice(0, 6)
  }
}

export function concisenessMetric(segments: TranscriptSegment[]): ReviewMetric {
  const cand = candidateSegments(segments)
  const evidence: ReviewMetric["evidence"] = []
  let totalWords = 0
  let totalFillers = 0
  for (const s of cand) {
    const w = wordCount(s.text)
    const f = countOccurrences(s.text, FILLERS_EN) + countOccurrences(s.text, FILLERS_ZH)
    totalWords += w
    totalFillers += f
    if (f >= 3) {
      evidence.push({ start: s.start, end: s.end, note: `口头禅偏多（${f} 次）` })
    }
  }
  const fillerRatio = totalWords ? totalFillers / totalWords : 0
  return {
    key: "conciseness",
    label: "表达简洁度",
    score: clamp(100 - fillerRatio * 100 * 8),
    detail: `口头禅占比约 ${(fillerRatio * 100).toFixed(1)}%（共 ${totalFillers} 次）。`,
    evidence: evidence.slice(0, 6)
  }
}

export function paceMetric(segments: TranscriptSegment[]): ReviewMetric {
  const cand = candidateSegments(segments)
  const evidence: ReviewMetric["evidence"] = []
  let words = 0
  let seconds = 0
  for (const s of cand) {
    const dur = Math.max(0.1, s.end - s.start)
    const w = wordCount(s.text)
    words += w
    seconds += dur
    const wpm = (w / dur) * 60
    if (wpm > 320 || wpm < 60) {
      evidence.push({
        start: s.start,
        end: s.end,
        note: `语速 ${Math.round(wpm)} 字/分（偏${wpm > 320 ? "快" : "慢"}）`
      })
    }
  }
  const wpm = seconds ? (words / seconds) * 60 : 0
  // Ideal spoken pace ~120-220 wpm; score falls off outside that band.
  const distance = wpm < 120 ? 120 - wpm : wpm > 220 ? wpm - 220 : 0
  return {
    key: "pace",
    label: "语速与停顿",
    score: clamp(100 - distance * 0.6),
    detail: `整体语速约 ${Math.round(wpm)} 字/分。`,
    evidence: evidence.slice(0, 6)
  }
}

export function relevanceMetric(
  segments: TranscriptSegment[],
  jobText?: string
): ReviewMetric {
  const cand = candidateSegments(segments)
  if (!jobText) {
    return {
      key: "relevance",
      label: "岗位相关性",
      score: 0,
      detail: "未关联岗位，无法评估相关性。",
      evidence: []
    }
  }
  const jd = new Set(tokenize(jobText))
  const evidence: ReviewMetric["evidence"] = []
  let hitSegments = 0
  for (const s of cand) {
    const toks = new Set(tokenize(s.text))
    let hits = 0
    for (const t of toks) if (jd.has(t)) hits++
    if (hits >= 2) {
      hitSegments++
      evidence.push({ start: s.start, end: s.end, note: `命中岗位关键词 ${hits} 个` })
    }
  }
  const ratio = cand.length ? hitSegments / cand.length : 0
  return {
    key: "relevance",
    label: "岗位相关性",
    score: clamp(ratio * 130),
    detail: `${hitSegments}/${cand.length} 段回答与岗位关键词相关。`,
    evidence: evidence.slice(0, 6)
  }
}

export function factSupportMetric(
  segments: TranscriptSegment[],
  corpusText?: string
): ReviewMetric {
  const cand = candidateSegments(segments)
  if (!corpusText) {
    return {
      key: "fact-support",
      label: "事实支撑",
      score: 0,
      detail: "未关联事实库，无法评估支撑度。",
      evidence: []
    }
  }
  const corpus = new Set(tokenize(corpusText))
  const evidence: ReviewMetric["evidence"] = []
  let supported = 0
  for (const s of cand) {
    const toks = tokenize(s.text)
    if (!toks.length) continue
    const overlap = toks.filter((t) => corpus.has(t)).length / toks.length
    if (overlap >= 0.15) supported++
    else if (wordCount(s.text) > 15) {
      evidence.push({ start: s.start, end: s.end, note: "该段与事实库重合度较低" })
    }
  }
  const ratio = cand.length ? supported / cand.length : 0
  return {
    key: "fact-support",
    label: "事实支撑",
    score: clamp(ratio * 120),
    detail: `${supported}/${cand.length} 段回答能对应到事实库内容。`,
    evidence: evidence.slice(0, 6)
  }
}

export function buildReview(
  segments: TranscriptSegment[],
  context: { jobText?: string; corpusText?: string } = {}
): { overallScore: number; metrics: ReviewMetric[] } {
  const metrics = [
    structureMetric(segments),
    factSupportMetric(segments, context.corpusText),
    relevanceMetric(segments, context.jobText),
    concisenessMetric(segments),
    paceMetric(segments)
  ]
  const scored = metrics.filter((m) => m.score > 0 || m.evidence.length > 0)
  const overallScore = scored.length
    ? Math.round(scored.reduce((s, m) => s + m.score, 0) / scored.length)
    : 0
  return { overallScore, metrics }
}
