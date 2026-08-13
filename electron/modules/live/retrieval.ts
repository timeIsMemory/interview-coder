// Pure retrieval scoring for live assist: match a spoken/typed question against
// the pre-generated question bank so we can answer instantly from local data
// before falling back to an online model call. Dependency-free + unit tested.

import { jaccard, tokenize } from "../generation/matching"
import type { PreparedAnswer } from "../generation/types"

export interface RankedAnswer {
  answer: PreparedAnswer
  score: number
}

export function rankAnswers(query: string, answers: PreparedAnswer[]): RankedAnswer[] {
  const q = new Set(tokenize(query))
  return answers
    .map((answer) => ({
      answer,
      score: jaccard(q, new Set(tokenize(answer.question)))
    }))
    .sort((a, b) => b.score - a.score)
}

export function bestMatch(
  query: string,
  answers: PreparedAnswer[],
  threshold = 0.34
): RankedAnswer | null {
  const ranked = rankAnswers(query, answers)
  if (ranked.length && ranked[0].score >= threshold) return ranked[0]
  return null
}
