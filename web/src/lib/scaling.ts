import { normaliseComparisonName } from "@/lib/exam-data"

export type ScalingPoint = {
  rawScore: number
  scaledScore: number
}

export type ScalingReference = {
  id: string
  code: string
  studyName: string
  year: number
  mean: number
  standardDeviation: number
  sourceUrl: string
  points: ScalingPoint[]
}

export type ScaledStudyScorePrediction = {
  scaledScore: number
  minimum: number
  maximum: number
  yearEstimates: Array<{
    year: number
    scaledScore: number
    sourceUrl: string
  }>
}

const SCALING_STUDY_ALIASES = new Map([
  ["english eal", "english as an additional language"],
  ["english esl", "english as an additional language"],
  ["english sl", "english"],
  ["further mathematics", "general mathematics"],
  ["mathematical methods cas", "mathematical methods"],
])

const scalingNameCache = new Map<string, string>()

export function normaliseScalingStudyName(value: string): string {
  const cached = scalingNameCache.get(value)
  if (cached !== undefined) return cached
  const normalised = normaliseScalingStudyNameUncached(value)
  if (scalingNameCache.size > 2000) scalingNameCache.clear()
  scalingNameCache.set(value, normalised)
  return normalised
}

function normaliseScalingStudyNameUncached(value: string): string {
  const original = normaliseComparisonName(value)
  const name = original
    .replace(/\bfl\b/g, "first language")
    .replace(/\bsl advanced\b/g, "second language advanced")
    .replace(/\bsl\b/g, "second language")
    .replace(/\s+/g, " ")
    .trim()
  return SCALING_STUDY_ALIASES.get(original) ?? name
}

export function interpolateScaledScore(rawScore: number, points: ScalingPoint[]): number | null {
  if (!Number.isFinite(rawScore) || rawScore < 20 || rawScore > 50 || points.length < 2) return null
  const ordered = points.toSorted((first, second) => first.rawScore - second.rawScore)
  const exact = ordered.find((point) => point.rawScore === rawScore)
  if (exact) return exact.scaledScore
  const upperIndex = ordered.findIndex((point) => point.rawScore > rawScore)
  if (upperIndex <= 0) return null
  const lower = ordered[upperIndex - 1]
  const upper = ordered[upperIndex]
  const position = (rawScore - lower.rawScore) / (upper.rawScore - lower.rawScore)
  return lower.scaledScore + position * (upper.scaledScore - lower.scaledScore)
}

export function predictScaledStudyScore(
  rawScore: number,
  subject: string,
  references: ScalingReference[],
  year?: number | null,
): ScaledStudyScorePrediction | null {
  const subjectKey = normaliseScalingStudyName(subject)
  const yearEstimates = references
    .filter((reference) =>
      normaliseScalingStudyName(reference.studyName) === subjectKey &&
      (year == null || reference.year === year),
    )
    .flatMap((reference) => {
      const scaledScore = interpolateScaledScore(rawScore, reference.points)
      return scaledScore === null ? [] : [{ year: reference.year, scaledScore, sourceUrl: reference.sourceUrl }]
    })
    .toSorted((first, second) => first.year - second.year)
  if (yearEstimates.length === 0) return null
  const values = yearEstimates.map((estimate) => estimate.scaledScore)
  return {
    scaledScore: values.reduce((total, value) => total + value, 0) / values.length,
    minimum: Math.min(...values),
    maximum: Math.max(...values),
    yearEstimates,
  }
}
