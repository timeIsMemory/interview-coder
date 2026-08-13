export type FactCategory =
  | "basic"
  | "education"
  | "experience"
  | "project"
  | "skill"
  | "achievement"
  | "preference"
  | "private"

export type SensitivityLevel = "public" | "internal" | "private"

export interface FactEvidence {
  id: string
  factId: string
  /** Where this fact came from: imported resume filename, manual entry, etc. */
  source: string
  /** Optional verbatim snippet supporting the fact. */
  snippet?: string
  createdAt: string
}

export interface Fact {
  id: string
  profileId: string
  category: FactCategory
  /** Short label, e.g. "Backend Engineer @ Acme". */
  label: string
  /** Full text of the fact used for matching and generation. */
  detail: string
  startDate?: string
  endDate?: string
  tags?: string[]
  sensitivity: SensitivityLevel
  /** True once the user has confirmed this fact (vs. AI-suggested draft). */
  confirmed: boolean
  createdAt: string
  updatedAt: string
  source?: string
  sourceSnippet?: string
}

export interface Profile {
  id: string
  name: string
  headline?: string
  email?: string
  phone?: string
  location?: string
  /** Expected salary / role preferences kept private by default. */
  expectations?: string
  currentVersion: number
  createdAt: string
  updatedAt: string
}

export interface ProfileVersionSnapshot {
  id: string
  profileId: string
  version: number
  /** Frozen copy of profile + confirmed facts at this version. */
  snapshot: {
    profile: Profile
    facts: Fact[]
  }
  createdAt: string
}

export interface ResumeTemplate {
  id: string
  name: string
  language: "zh" | "en"
  /** Section order and style hints handed to the generator. */
  sections: string[]
  /** Bumped on every template change; part of the generation version chain. */
  version: number
  createdAt: string
}
