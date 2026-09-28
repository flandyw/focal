import type { ExamAttempt } from "@/lib/exam-data"

export const DEFAULT_PROVIDER_DIFFICULTY = [
  "Kilbaha",
  "VCAA NHT",
  "VCAA",
  "NEAP",
  "Insight",
  "TSSM",
] as const

export const MATHEMATICS_PROVIDER_DIFFICULTY = [
  "iTute",
  "MAV",
  "Kilbaha",
  "VCAA NHT",
  "VCAA",
  "NEAP",
  "Insight",
  "Heffernan",
  "TSSM",
] as const

export type DifficultyStrength = "light" | "balanced" | "strong"

export type ExamDifficultySettings = {
  enabled: boolean
  providerOrder: string[]
  strength: DifficultyStrength
  updatedAt: string
}

export const DEFAULT_EXAM_DIFFICULTY: ExamDifficultySettings = {
  enabled: true,
  providerOrder: [...DEFAULT_PROVIDER_DIFFICULTY],
  strength: "balanced",
  updatedAt: "1970-01-01T00:00:00.000Z",
}

const POINTS_PER_RANK: Record<DifficultyStrength, number> = {
  light: 1,
  balanced: 1.5,
  strong: 2,
}

function normalise(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()
}

export function identifyDifficultyProvider(
  attempt: Pick<ExamAttempt, "provider" | "title" | "paper">,
  providerOrder: readonly string[] = DEFAULT_PROVIDER_DIFFICULTY,
): string | null {
  const provider = normalise(attempt.provider)
  const combined = normalise(`${attempt.provider} ${attempt.title} ${attempt.paper}`)
  if (/\b(nht|northern hemisphere)\b/.test(combined)) return "VCAA NHT"
  if (/\bitute\b/.test(provider)) return "iTute"
  if (/\bmav\b|mathematical association of victoria/.test(provider)) return "MAV"
  if (/\bkilbaha\b/.test(provider)) return "Kilbaha"
  if (/\bvcaa\b|victorian curriculum and assessment authority/.test(provider)) return "VCAA"
  if (/\bneap\b/.test(provider)) return "NEAP"
  if (/\binsight\b/.test(provider)) return "Insight"
  if (/\b(?:heffernan|hefferman)\b/.test(provider)) return "Heffernan"
  if (/\btssm\b/.test(provider)) return "TSSM"
  return providerOrder.find((candidate) => normalise(candidate) === provider) ?? null
}

export function resolveDifficultySettings(settings?: ExamDifficultySettings): ExamDifficultySettings {
  if (!settings) return DEFAULT_EXAM_DIFFICULTY
  const seen = new Set<string>()
  const unique = settings.providerOrder.filter((provider) => {
    const key = normalise(provider)
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
  if (!seen.has("vcaa")) unique.push("VCAA")
  return { ...settings, providerOrder: unique }
}

export type AttemptPerformance = {
  rawPercentage: number
  alignedPercentage: number
  adjustment: number
  relevanceWeight: number
  provider: string | null
}

export function getAttemptPerformance(attempt: ExamAttempt, settings?: ExamDifficultySettings): AttemptPerformance {
  const rawPercentage = attempt.rawMax > 0 ? attempt.rawScore / attempt.rawMax * 100 : 0
  const resolved = resolveDifficultySettings(settings)
  const provider = identifyDifficultyProvider(attempt, resolved.providerOrder)
  if (!resolved.enabled) {
    return { rawPercentage, alignedPercentage: rawPercentage, adjustment: 0, relevanceWeight: 1, provider }
  }
  if (!provider) {
    return { rawPercentage, alignedPercentage: rawPercentage, adjustment: 0, relevanceWeight: 0.55, provider }
  }

  const baseline = resolved.providerOrder.indexOf("VCAA")
  const rank = resolved.providerOrder.indexOf(provider)
  if (baseline < 0 || rank < 0) {
    return { rawPercentage, alignedPercentage: rawPercentage, adjustment: 0, relevanceWeight: 0.55, provider }
  }

  // Harder papers sit above VCAA and receive a positive adjustment. The cap keeps
  // this a conservative comparison aid rather than a claimed score conversion.
  const adjustment = Math.max(-8, Math.min(8, (baseline - rank) * POINTS_PER_RANK[resolved.strength]))
  const alignedPercentage = Math.max(0, Math.min(100, rawPercentage + adjustment))
  const distance = Math.abs(baseline - rank)
  const relevanceWeight = provider === "VCAA" ? 1 : provider === "VCAA NHT" ? 0.9 : Math.max(0.4, 1 - distance * 0.12)
  return { rawPercentage, alignedPercentage, adjustment: alignedPercentage - rawPercentage, relevanceWeight, provider }
}

export function weightedPerformanceAverage(attempts: ExamAttempt[], settings?: ExamDifficultySettings) {
  if (!attempts.length) return 0
  const values = attempts.map((attempt) => getAttemptPerformance(attempt, settings))
  const totalWeight = values.reduce((total, value) => total + value.relevanceWeight, 0)
  return values.reduce((total, value) => total + value.alignedPercentage * value.relevanceWeight, 0) / totalWeight
}

export function isExamDifficultySettings(value: unknown): value is ExamDifficultySettings {
  if (!value || typeof value !== "object") return false
  const settings = value as Partial<ExamDifficultySettings>
  return typeof settings.enabled === "boolean" &&
    Array.isArray(settings.providerOrder) && settings.providerOrder.every((provider) => typeof provider === "string") &&
    ["light", "balanced", "strong"].includes(String(settings.strength)) &&
    typeof settings.updatedAt === "string"
}
