// Pure fact-constraint checker. Given generated resume/answer text and the
// user's confirmed facts, it flags concrete claims (numbers, percentages,
// durations, and configured named entities) that are NOT supported by the
// fact corpus. This is the hard gate the plan requires: unsupported claims
// block export until the user adds/confirms a fact.
//
// It is intentionally conservative and deterministic (no LLM), so it can run
// offline and be unit tested. It errs toward flagging; the UI lets the user
// resolve each flag by editing the text or confirming a supporting fact.

import { normalizeForHash } from "../../core/ids"

export interface FactCorpusEntry {
  id: string
  text: string
}

export interface UnsupportedClaim {
  sentence: string
  /** The specific token/quantity that isn't supported. */
  claim: string
  reason: "unsupported-number" | "unsupported-entity"
}

export interface FactCheckResult {
  supported: boolean
  issues: UnsupportedClaim[]
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。！？;；\n])/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

// Numbers that assert a measurable claim: percentages, multipliers, money,
// durations, and standalone quantities >= 2 digits. Single small digits like
// "1 team" are ignored to reduce noise.
const NUMBER_CLAIM = /(\d+(?:[.,]\d+)?\s*%|\d+(?:[.,]\d+)?\s*[xX倍]|[$￥€]\s*\d[\d,.]*|\d[\d,.]*\s*(?:万|k|K|M|w)|\b\d{2,}(?:[.,]\d+)?\b|\d+(?:[.,]\d+)?\s*(?:years?|yrs?|年|months?|个月))/g

function extractNumberClaims(sentence: string): string[] {
  const matches = sentence.match(NUMBER_CLAIM)
  return matches ? matches.map((m) => m.trim()) : []
}

function numberIsSupported(claim: string, corpus: string): boolean {
  // Compare on digits only so "30%" matches "30 percent" in the corpus.
  const digits = claim.replace(/[^\d]/g, "")
  if (!digits) return true
  return corpus.replace(/[^\d]/g, " ").split(/\s+/).includes(digits)
}

export interface FactCheckOptions {
  /** Named entities (companies, products) that must appear in the corpus. */
  knownEntities?: string[]
}

/**
 * Check generated text against the fact corpus.
 * @param text Generated resume/answer content.
 * @param corpusEntries The user's confirmed facts (id + text).
 */
export function checkFactSupport(
  text: string,
  corpusEntries: FactCorpusEntry[],
  options: FactCheckOptions = {}
): FactCheckResult {
  const corpus = normalizeForHash(corpusEntries.map((e) => e.text).join(" \n "))
  const issues: UnsupportedClaim[] = []

  for (const sentence of splitSentences(text)) {
    for (const claim of extractNumberClaims(sentence)) {
      if (!numberIsSupported(claim, corpus)) {
        issues.push({ sentence, claim, reason: "unsupported-number" })
      }
    }
    if (options.knownEntities && options.knownEntities.length) {
      const normSentence = normalizeForHash(sentence)
      for (const entity of options.knownEntities) {
        const normEntity = normalizeForHash(entity)
        if (normEntity && normSentence.includes(normEntity) && !corpus.includes(normEntity)) {
          issues.push({ sentence, claim: entity, reason: "unsupported-entity" })
        }
      }
    }
  }

  return { supported: issues.length === 0, issues }
}
