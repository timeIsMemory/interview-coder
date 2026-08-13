// Prompt builders for CV and Q&A generation. Centralised so prompt changes are
// versioned (PROMPT_VERSION) and feed the run's idempotency key. Every prompt
// hard-constrains the model to the user's confirmed facts and forbids
// fabrication, which is the backbone of the "no invented experience" guarantee.

import type { Fact } from "../profile/types"
import type { NormalizedJob } from "../jobs/types"

export const PROMPT_VERSION = "2026-08-12.1"

function factLines(facts: Fact[]): string {
  return facts
    .map((f, i) => {
      const dates = [f.startDate, f.endDate].filter(Boolean).join(" - ")
      return `[F${i + 1}] (${f.category}) ${f.label}${dates ? ` [${dates}]` : ""}: ${f.detail}`
    })
    .join("\n")
}

const NON_FABRICATION = `STRICT RULES:
- Use ONLY the facts listed. Do NOT invent employers, titles, dates, metrics, or technologies.
- If the JD wants something not in the facts, do NOT claim it. You may note it as a gap in a separate field only when the schema allows.
- Every concrete number or achievement must trace to a fact.`

export function buildCvPrompt(
  job: NormalizedJob,
  facts: Fact[],
  templateSections: string[],
  language: "zh" | "en"
): string {
  const lang = language === "zh" ? "Simplified Chinese" : "English"
  return `You are a resume writer. Write a tailored, ATS-friendly resume in ${lang} for the target job, using ONLY the candidate's confirmed facts.

TARGET JOB:
Title: ${job.title}
Company: ${job.company}
Description:
${job.description.slice(0, 8000)}

CANDIDATE FACTS:
${factLines(facts)}

SECTIONS (in order): ${templateSections.join(", ")}

${NON_FABRICATION}

Return ONLY JSON:
{"html":"<a clean semantic HTML resume, no <html>/<head>, just body content with <section>/<h2>/<ul>>","summary":"1-2 sentence positioning statement grounded in facts","usedFactIds":["F1","F3"],"gaps":["JD requirements not supported by facts"]}`
}

export function buildQuestionsPrompt(job: NormalizedJob): string {
  return `Generate likely interview questions for this job. Mix behavioral, technical and role-specific.

JOB:
Title: ${job.title}
Company: ${job.company}
Description:
${job.description.slice(0, 6000)}

Return ONLY JSON:
{"questions":[{"question":"","category":"behavioral|technical|role-specific"}]}
Generate 12-18 questions, no duplicates.`
}

export function buildAnswersPrompt(
  questions: Array<{ question: string; category: string }>,
  facts: Fact[]
): string {
  return `Answer each interview question for the candidate using ONLY their confirmed facts.

CANDIDATE FACTS:
${factLines(facts)}

QUESTIONS:
${questions.map((q, i) => `${i + 1}. [${q.category}] ${q.question}`).join("\n")}

${NON_FABRICATION}
For behavioral questions use STAR. If facts don't support a strong answer, say so honestly in the answer and suggest what experience to draw on generally, but never fabricate specifics.

Return ONLY JSON:
{"answers":[{"question":"","category":"behavioral|technical|role-specific","shortAnswer":"~30 second spoken answer","detailedAnswer":"~2 minute answer","starPoints":["S","T","A","R"],"followUps":["likely follow-up question"]}]}`
}
