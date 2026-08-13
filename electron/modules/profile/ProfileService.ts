// Profile / fact-bank service. Owns the single source of truth about the user:
// confirmed facts, versions and resume templates. Generation reads confirmed
// facts from here; nothing else may invent user information.

import { getDatabase } from "../../core/db/Database"
import { aiGateway } from "../../core/ai/AiGateway"
import type {
  Fact,
  FactCategory,
  Profile,
  ProfileVersionSnapshot,
  ResumeTemplate,
  SensitivityLevel
} from "./types"
import type { FactCorpusEntry } from "./factConstraint"

const nowIso = () => new Date().toISOString()

export class ProfileService {
  private profiles() {
    return getDatabase().table<Profile>("profiles")
  }
  private facts() {
    return getDatabase().table<Fact>("facts")
  }
  private versions() {
    return getDatabase().table<ProfileVersionSnapshot>("profile_versions")
  }
  private evidence() {
    return getDatabase().table<import("./types").FactEvidence>("fact_evidence")
  }
  private templates() {
    return getDatabase().table<ResumeTemplate>("resume_templates")
  }

  /** There is exactly one profile in this local single-user app. */
  getOrCreateDefaultProfile(): Profile {
    const existing = this.profiles().all()[0]
    if (existing) return existing
    const ts = nowIso()
    return this.profiles().insert({
      name: "My Profile",
      currentVersion: 0,
      createdAt: ts,
      updatedAt: ts
    })
  }

  updateProfile(patch: Partial<Profile>): Profile {
    const profile = this.getOrCreateDefaultProfile()
    return this.profiles().update(profile.id, { ...patch, updatedAt: nowIso() }) as Profile
  }

  listFacts(profileId?: string): Fact[] {
    const pid = profileId ?? this.getOrCreateDefaultProfile().id
    return this.facts().find({
      where: (f) => f.profileId === pid,
      sort: (a, b) => a.category.localeCompare(b.category) || a.createdAt.localeCompare(b.createdAt)
    })
  }

  addFact(input: {
    category: FactCategory
    label: string
    detail: string
    startDate?: string
    endDate?: string
    tags?: string[]
    sensitivity?: SensitivityLevel
    confirmed?: boolean
    source?: string
    sourceSnippet?: string
  }): Fact {
    const profile = this.getOrCreateDefaultProfile()
    const ts = nowIso()
    const fact = this.facts().insert({
      profileId: profile.id,
      category: input.category,
      label: input.label,
      detail: input.detail,
      startDate: input.startDate,
      endDate: input.endDate,
      tags: input.tags ?? [],
      sensitivity: input.sensitivity ?? "public",
      confirmed: input.confirmed ?? true,
      createdAt: ts,
      updatedAt: ts
    })
    this.evidence().insert({
      factId: fact.id,
      source: input.source || "manual",
      snippet: input.sourceSnippet || input.detail,
      createdAt: ts
    })
    return fact
  }

  updateFact(id: string, patch: Partial<Fact>): Fact | null {
    return this.facts().update(id, { ...patch, updatedAt: nowIso() })
  }

  confirmFact(id: string): Fact | null {
    return this.facts().update(id, { confirmed: true, updatedAt: nowIso() })
  }

  deleteFact(id: string): boolean {
    this.evidence().deleteWhere((e) => e.factId === id)
    return this.facts().delete(id)
  }

  listEvidence(factId: string): import("./types").FactEvidence[] {
    return this.evidence().find({ where: (e) => e.factId === factId })
  }

  /** Confirmed facts as a corpus for the fact-constraint checker. */
  getFactCorpus(profileId?: string): FactCorpusEntry[] {
    return this.listFacts(profileId)
      .filter((f) => f.confirmed)
      .map((f) => ({ id: f.id, text: `${f.label}. ${f.detail}` }))
  }

  /** Freeze current confirmed facts as an immutable version snapshot. */
  createVersion(): ProfileVersionSnapshot {
    const profile = this.getOrCreateDefaultProfile()
    const version = (profile.currentVersion || 0) + 1
    const facts = this.listFacts(profile.id).filter((f) => f.confirmed)
    this.profiles().update(profile.id, { currentVersion: version, updatedAt: nowIso() })
    return this.versions().insert({
      profileId: profile.id,
      version,
      snapshot: { profile: { ...profile, currentVersion: version }, facts },
      createdAt: nowIso()
    })
  }

  getVersion(version: number): ProfileVersionSnapshot | null {
    return this.versions().findOne((v) => v.version === version)
  }

  listVersions(): ProfileVersionSnapshot[] {
    return this.versions().find({ sort: (a, b) => b.version - a.version })
  }

  listTemplates(): ResumeTemplate[] {
    const all = this.templates().all()
    if (all.length) {
      // Backfill templates created before versioning existed.
      return all.map((t) =>
        t.version ? t : (this.templates().update(t.id, { version: 1 }) as ResumeTemplate)
      )
    }
    // Seed a couple of sensible defaults on first use.
    const ts = nowIso()
    this.templates().insert({
      name: "Standard (中文)",
      language: "zh",
      sections: ["个人信息", "工作经历", "项目经历", "技能", "教育背景"],
      version: 1,
      createdAt: ts
    })
    this.templates().insert({
      name: "Standard (English)",
      language: "en",
      sections: ["Summary", "Experience", "Projects", "Skills", "Education"],
      version: 1,
      createdAt: ts
    })
    return this.templates().all()
  }

  /** Any change to a template bumps its version so runs stay reproducible. */
  updateTemplate(
    id: string,
    patch: Partial<Pick<ResumeTemplate, "name" | "language" | "sections">>
  ): ResumeTemplate | null {
    const existing = this.templates().get(id)
    if (!existing) return null
    return this.templates().update(id, {
      ...patch,
      version: (existing.version || 1) + 1
    })
  }

  /**
   * Parse an imported resume's raw text into DRAFT (unconfirmed) facts using
   * the AI gateway. Nothing is auto-confirmed: the user must review each one.
   */
  async importResumeText(rawText: string, source = "pasted-resume"): Promise<Fact[]> {
    const profile = this.getOrCreateDefaultProfile()
    const prompt = `You extract structured facts from a resume. Return ONLY JSON:
{"facts":[{"category":"experience|education|project|skill|achievement|basic","label":"short label","detail":"full factual detail","startDate":"YYYY-MM optional","endDate":"YYYY-MM optional","tags":["..."]}]}
Rules: Only extract information explicitly present. Do NOT invent metrics, employers, or dates. If a field is unknown, omit it.

RESUME:
${rawText.slice(0, 15000)}`

    const result = await aiGateway.completeJson<{
      facts?: Array<{
        category?: string
        label?: string
        detail?: string
        startDate?: string
        endDate?: string
        tags?: string[]
      }>
    }>(
      [{ role: "user", text: prompt }],
      { purpose: "extraction", temperature: 0 }
    )
    const drafts: Fact[] = []
    for (const f of result.data.facts || []) {
      if (!f || !f.detail) continue
      const ts = nowIso()
      const fact = this.facts().insert({
          profileId: profile.id,
          category: (f.category as FactCategory) || "experience",
          label: String(f.label || f.detail).slice(0, 120),
          detail: String(f.detail),
          startDate: f.startDate,
          endDate: f.endDate,
          tags: Array.isArray(f.tags) ? f.tags : [],
          sensitivity: "public",
          confirmed: false,
          createdAt: ts,
          updatedAt: ts
        })
      this.evidence().insert({
        factId: fact.id,
        source,
        snippet: String(f.detail).slice(0, 1000),
        createdAt: ts
      })
      drafts.push(fact)
    }
    return drafts
  }
}

export const profileService = new ProfileService()
