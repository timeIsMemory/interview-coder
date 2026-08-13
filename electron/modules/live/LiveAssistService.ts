// Live assist: job-context-aware answering during a real interview. Retrieval
// from the pre-generated question bank comes first (instant, offline, traceable
// to a fact-checked artifact); an online model call is only a fallback and is
// clearly labelled. If the fact base can't support an answer, we say so instead
// of inventing experience.

import { getDatabase } from "../../core/db/Database"
import { aiGateway } from "../../core/ai/AiGateway"
import { profileService } from "../profile/ProfileService"
import { jobService } from "../jobs/JobService"
import { bestMatch, rankAnswers } from "./retrieval"
import type { PreparedAnswer, QuestionSet } from "../generation/types"

export interface LiveAnswer {
  source: "local" | "online" | "insufficient"
  question: string
  shortAnswer: string
  detailedAnswer?: string
  starPoints?: string[]
  followUps?: string[]
  score?: number
  latencyMs: number
}

export class LiveAssistService {
  private questionSets() {
    return getDatabase().table<QuestionSet>("question_sets")
  }

  private answersForJob(jobId: string): PreparedAnswer[] {
    const sets = this.questionSets().find({ where: (s) => s.jobId === jobId })
    return sets.flatMap((s) => s.answers || [])
  }

  /** Top prepared questions for a job, for a browsable cheat-sheet. */
  suggest(jobId: string, query = ""): PreparedAnswer[] {
    const answers = this.answersForJob(jobId)
    if (!query.trim()) return answers.slice(0, 20)
    return rankAnswers(query, answers).slice(0, 8).map((r) => r.answer)
  }

  async answer(jobId: string, question: string): Promise<LiveAnswer> {
    const started = Date.now()
    const prepared = this.answersForJob(jobId)

    // 1) Local retrieval first.
    const match = bestMatch(question, prepared)
    if (match) {
      return {
        source: "local",
        question: match.answer.question,
        shortAnswer: match.answer.shortAnswer,
        detailedAnswer: match.answer.detailedAnswer,
        starPoints: match.answer.starPoints,
        followUps: match.answer.followUps,
        score: match.score,
        latencyMs: Date.now() - started
      }
    }

    // 2) Online fallback, grounded in facts + JD, never fabricating.
    const facts = profileService.listFacts().filter((f) => f.confirmed)
    if (!facts.length || !aiGateway.isConfigured()) {
      return {
        source: "insufficient",
        question,
        shortAnswer:
          facts.length === 0
            ? "资料不足：事实库为空，无法基于你的真实经历作答。请先在事实库补充相关经历。"
            : "资料不足：未配置 AI，且没有匹配的预生成答案。",
        latencyMs: Date.now() - started
      }
    }

    const job = jobService.getJob(jobId)
    const factText = facts
      .map((f, i) => `[F${i + 1}] (${f.category}) ${f.label}: ${f.detail}`)
      .join("\n")
    const prompt = `You are helping the candidate answer a live interview question using ONLY their confirmed facts. Do not invent experience. If the facts don't support a strong answer, say so honestly.

TARGET JOB: ${job ? `${job.title} @ ${job.company}` : "(not specified)"}

CANDIDATE FACTS:
${factText}

QUESTION: ${question}

Return ONLY JSON:
{"shortAnswer":"~30s spoken answer grounded in facts","detailedAnswer":"~2 min answer","starPoints":["S","T","A","R"],"followUps":["likely follow-up"],"factsSufficient":true}`

    try {
      const res = await aiGateway.completeJson<{
        shortAnswer?: string
        detailedAnswer?: string
        starPoints?: string[]
        followUps?: string[]
        factsSufficient?: boolean
      }>([{ role: "user", text: prompt }], {
        purpose: "generation",
        temperature: 0.3
      })
      if (res.data.factsSufficient === false) {
        return {
          source: "insufficient",
          question,
          shortAnswer:
            res.data.shortAnswer ||
            "资料不足：事实库缺少与该问题相关的经历，建议如实说明或补充事实后再作答。",
          latencyMs: Date.now() - started
        }
      }
      return {
        source: "online",
        question,
        shortAnswer: res.data.shortAnswer || "",
        detailedAnswer: res.data.detailedAnswer,
        starPoints: res.data.starPoints,
        followUps: res.data.followUps,
        latencyMs: Date.now() - started
      }
    } catch (err) {
      return {
        source: "insufficient",
        question,
        shortAnswer: `在线作答失败：${(err as Error).message}`,
        latencyMs: Date.now() - started
      }
    }
  }
}

export const liveAssistService = new LiveAssistService()
