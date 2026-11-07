import type { ExamAttempt } from "./exam-data"
import type { SacRecord } from "./sac"

export type ContextRating = 1 | 2 | 3 | 4 | 5

export type PerformanceContext = {
  sleepHours?: number
  energy?: ContextRating
  focus?: ContextRating
  stress?: ContextRating
  confidence?: ContextRating
  preparedness?: ContextRating
}

type ContextFactorKey = keyof PerformanceContext

type ContextFactorInsight = {
  key: ContextFactorKey
  label: string
  sampleSize: number
  average: number
  favourableChange: number
  correlation: number
  condition: string
  action: string
}

export type PerformanceContextAnalysis = {
  completedAssessments: number
  recordedAssessments: number
  insights: ContextFactorInsight[]
}

const RATING_KEYS = ["energy", "focus", "stress", "confidence", "preparedness"] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

export function isPerformanceContext(value: unknown): value is PerformanceContext {
  if (!isRecord(value)) return false
  if (value.sleepHours !== undefined && (
    typeof value.sleepHours !== "number" || !Number.isFinite(value.sleepHours) || value.sleepHours < 0 || value.sleepHours > 24
  )) return false
  return RATING_KEYS.every((key) => value[key] === undefined || (
    typeof value[key] === "number" && Number.isInteger(value[key]) && value[key] >= 1 && value[key] <= 5
  ))
}

export function hasPerformanceContext(value?: PerformanceContext): boolean {
  return Boolean(value && Object.values(value).some((item) => item !== undefined))
}

function average(values: number[]) {
  return values.reduce((total, value) => total + value, 0) / values.length
}

const FACTORS: Array<{
  key: ContextFactorKey
  label: string
  favourableDirection: 1 | -1
  comparisonStep: number
  condition: string
  action: string
}> = [
  { key: "sleepHours", label: "Sleep", favourableDirection: 1, comparisonStep: 1, condition: "an extra hour of sleep", action: "Protect a consistent sleep window before important assessments." },
  { key: "energy", label: "Energy", favourableDirection: 1, comparisonStep: 2, condition: "2 points more energy", action: "Schedule practice at your higher-energy time and eat and hydrate beforehand." },
  { key: "focus", label: "Focus", favourableDirection: 1, comparisonStep: 2, condition: "2 points more focus", action: "Use a short phone-free settling routine before starting." },
  { key: "stress", label: "Stress", favourableDirection: -1, comparisonStep: 2, condition: "2 points less stress", action: "Use gradual exam-condition exposure and a repeatable pre-start breathing routine." },
  { key: "confidence", label: "Confidence", favourableDirection: 1, comparisonStep: 2, condition: "2 points more confidence", action: "Do a brief retrieval warm-up to surface what you know before starting." },
  { key: "preparedness", label: "Preparedness", favourableDirection: 1, comparisonStep: 2, condition: "2 points more preparedness", action: "Use a ready-to-sit checklist for content, materials, timing, and likely question types." },
]

export function buildPerformanceContextAnalysis(
  attempts: ExamAttempt[],
  sacRecords: SacRecord[],
): PerformanceContextAnalysis {
  const completed = [
    ...attempts.filter((attempt) => attempt.rawMax > 0).map((attempt) => ({
      score: (attempt.rawScore / attempt.rawMax) * 100,
      context: attempt.performanceContext,
      group: `exam\u0000${attempt.subject.trim().toLowerCase()}`,
    })),
    ...sacRecords.filter((record) => record.score !== undefined && record.maxScore !== undefined && record.maxScore > 0).map((record) => ({
      score: (record.score! / record.maxScore!) * 100,
      context: record.performanceContext,
      group: `sac\u0000${record.subject.trim().toLowerCase()}`,
    })),
  ]
  const groupScores = new Map<string, number[]>()
  for (const item of completed) {
    const bucket = groupScores.get(item.group) ?? []
    bucket.push(item.score)
    groupScores.set(item.group, bucket)
  }
  const groupMeans = new Map([...groupScores].map(([group, scores]) => [group, average(scores)]))
  const normalised = completed.map((item) => ({
    ...item,
    score: item.score - groupMeans.get(item.group)!,
  }))
  const recordedAssessments = completed.filter((item) => hasPerformanceContext(item.context)).length
  const insights = FACTORS.flatMap((factor) => {
    const observations = normalised.flatMap((item) => {
      const value = item.context?.[factor.key]
      return value === undefined ? [] : [{ value, score: item.score }]
    })
    if (observations.length < 3 || new Set(observations.map((item) => item.value)).size < 2) return []
    const valueMean = observations.reduce((total, item) => total + item.value, 0) / observations.length
    const scoreMean = observations.reduce((total, item) => total + item.score, 0) / observations.length
    let covariance = 0, valueVariance = 0, scoreVariance = 0
    for (const { value, score } of observations) {
      const valueDelta = value - valueMean, scoreDelta = score - scoreMean
      covariance += valueDelta * scoreDelta
      valueVariance += valueDelta ** 2
      scoreVariance += scoreDelta ** 2
    }
    const spread = Math.sqrt(valueVariance) * Math.sqrt(scoreVariance)
    const correlation = spread ? covariance / spread : 0
    const slope = valueVariance ? covariance / valueVariance : 0
    return [{
      key: factor.key,
      label: factor.label,
      sampleSize: observations.length,
      average: valueMean,
      favourableChange: slope * factor.comparisonStep * factor.favourableDirection,
      correlation,
      condition: factor.condition,
      action: factor.action,
    }]
  }).sort((first, second) => Math.abs(second.favourableChange) - Math.abs(first.favourableChange))

  return { completedAssessments: completed.length, recordedAssessments, insights }
}
