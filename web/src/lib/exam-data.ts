import { isExamProgression, type ExamProgression } from "@/lib/exam-progression"
import { isExamDifficultySettings, type ExamDifficultySettings } from "@/lib/exam-difficulty"
import { isSacRecord, migrateSacRecords, type SacRecord } from "@/lib/sac"
import { isPerformanceContext, type PerformanceContext } from "@/lib/performance-context"
import { isExamTimerSession, isSacTimerSession, type ExamTimerSession, type SacTimerSession } from "@/lib/ongoing-timers"
import { EMPTY_LEARNING_WORKSPACE, isLearningWorkspace, migrateLearningWorkspace, type LearningWorkspace } from "@/lib/learning-workspace"

export const GENERAL_MISTAKE_CATEGORIES = [
  "Concept",
  "Knowledge recall",
  "Reasoning",
  "Evidence and analysis",
  "Written expression",
  "Process or technique",
  "Accuracy",
  "Interpretation",
  "Time management",
  "Other",
] as const

// Retained for existing logs and subjects where these labels are useful.
export const MATHEMATICS_MISTAKE_CATEGORIES = [
  "Algebra",
  "Arithmetic",
  "Calculator",
] as const

export const MISTAKE_CATEGORIES = [
  ...GENERAL_MISTAKE_CATEGORIES,
  ...MATHEMATICS_MISTAKE_CATEGORIES,
] as const

export type MistakeCategory = (typeof MISTAKE_CATEGORIES)[number]

export type GradeBand = {
  grade: string
  minScore: number | null
  maxScore: number | null
  count: number | null
  percentage: number | null
  sortOrder?: number
}

export type AssessmentReference = {
  id: string
  studyCode?: string
  studyName: string
  displayName?: string
  year: number
  gaCode?: string
  name: string
  maxScore: number
  sourceUrl: string
  gradeBands: GradeBand[]
}

export type ExamAttempt = {
  id: string
  subject: string
  provider: string
  title: string
  examYear: number
  paper: string
  completedAt: string
  rawScore: number
  rawMax: number
  comment?: string
  performanceContext?: PerformanceContext
  questionResults?: QuestionResult[]
  timing?: ExamTiming
  referenceId: string | null
  createdAt: string
  updatedAt: string
}

export type QuestionConfidence = "low" | "medium" | "high"

export type QuestionResult = {
  id: string
  label: string
  marksAwarded: number
  maxMarks: number
  areaOfStudy?: string
  criterion?: string
  confidence: QuestionConfidence
  examinerNote?: string
}

export type ExamTiming = {
  plannedReadingMinutes: number
  plannedWritingMinutes: number
  actualWritingSeconds: number
  overtimeSeconds: number
  pausedSeconds: number
}

export type ReviewRating = "again" | "hard" | "good" | "easy"
export type LegacyReviewResult = "incorrect" | "assisted" | "correct"
export type ReviewResult = ReviewRating | LegacyReviewResult
export type MistakeReviewState = "new" | "learning" | "review" | "relearning"

export type MistakeReview = {
  id: string
  completedAt: string
  result: ReviewResult
  intervalDays?: number
  easeFactor?: number
}

export type MistakeAttachment = {
  id: string
  name: string
  type: string
  size: number
  storagePath: string
}

export type Mistake = {
  id: string
  attemptId: string
  question: string
  questionText?: string
  category: MistakeCategory
  explanation: string
  correction: string
  totalMarks?: number
  marksLost?: number
  areaOfStudy?: string
  criterion?: string
  attachments?: MistakeAttachment[]
  dueAt?: string | null
  reviewHistory?: MistakeReview[]
  reviewState?: MistakeReviewState
  intervalDays?: number
  easeFactor?: number
  repetitions?: number
  lapses?: number
  lastReviewedAt?: string
  suspended?: boolean
  resolved: boolean
  createdAt: string
  updatedAt: string
}

export type MistakeInsight = {
  title: string
  evidence: string
  action: string
}

export type MistakeInsights = {
  summary: string
  biggestErrors: MistakeInsight[]
  otherInsights: string[]
  nextStep: string
  practiceQuestions?: string
  generatedAt: string
  questionsGeneratedAt?: string
}

export type AlternativeMistakeCard = {
  sourceMistakeId: string
  skill: string
  question: string
  answer: string
  marks: number
  generatedAt: string
}

export type AlternativeMistakeDeck = {
  cards: AlternativeMistakeCard[]
  updatedAt: string
}

export type AtarEstimatorRow = {
  id: string
  code: string
  raw: string
  usePrediction: boolean
}

export type SavedAtarEstimate = {
  id: string
  year: number
  rows: AtarEstimatorRow[]
  atarLabel: string
  aggregate: number | null
  savedAt: string
}

export type AppData = {
  examProgression?: ExamProgression
  schemaVersion: 5
  attempts: ExamAttempt[]
  mistakes: Mistake[]
  sacRecords: SacRecord[]
  sacRecordsUpdatedAt: string
  subjects: string[]
  subjectsUpdatedAt: string
  trackedExamIds: string[]
  trackedExamIdsUpdatedAt: string
  completedExamIds: string[]
  completedExamIdsUpdatedAt: string
  activeExamTimer?: ExamTimerSession
  activeExamTimerUpdatedAt: string
  activeSacTimer?: SacTimerSession
  activeSacTimerUpdatedAt: string
  mistakeInsights?: MistakeInsights
  alternativeMistakeDeck?: AlternativeMistakeDeck
  examDifficulty?: ExamDifficultySettings
  atarEstimates: SavedAtarEstimate[]
  atarEstimatesUpdatedAt: string
  learning: LearningWorkspace
}

export const EMPTY_APP_DATA: AppData = {
  schemaVersion: 5,
  attempts: [],
  mistakes: [],
  sacRecords: [],
  sacRecordsUpdatedAt: "1970-01-01T00:00:00.000Z",
  subjects: [],
  subjectsUpdatedAt: "1970-01-01T00:00:00.000Z",
  trackedExamIds: [],
  trackedExamIdsUpdatedAt: "1970-01-01T00:00:00.000Z",
  completedExamIds: [],
  completedExamIdsUpdatedAt: "1970-01-01T00:00:00.000Z",
  activeExamTimerUpdatedAt: "1970-01-01T00:00:00.000Z",
  activeSacTimerUpdatedAt: "1970-01-01T00:00:00.000Z",
  atarEstimates: [],
  atarEstimatesUpdatedAt: "1970-01-01T00:00:00.000Z",
  learning: EMPTY_LEARNING_WORKSPACE,
}

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000
const DEFAULT_EASE_FACTOR = 2.5
const MINIMUM_EASE_FACTOR = 1.3

export type MistakeSchedule = {
  state: MistakeReviewState
  dueAt: string
  intervalDays: number
  easeFactor: number
  repetitions: number
  lapses: number
  resolved: boolean
}

export type MistakeReviewPreview = MistakeSchedule & {
  rating: ReviewRating
}

function normalizeReviewRating(result: ReviewResult): ReviewRating {
  if (result === "incorrect") return "again"
  if (result === "assisted") return "hard"
  if (result === "correct") return "good"
  return result
}

function inferReviewState(mistake: Mistake): MistakeReviewState {
  if (mistake.reviewState) return mistake.reviewState
  const history = mistake.reviewHistory ?? []
  if (!history.length) return mistake.resolved ? "review" : "new"
  const latest = normalizeReviewRating(history.at(-1)!.result)
  if (latest === "again") return history.length === 1 ? "learning" : "relearning"
  if (mistake.resolved || history.filter((review) => ["good", "easy"].includes(normalizeReviewRating(review.result))).length >= 2) return "review"
  return "learning"
}

function inferIntervalDays(mistake: Mistake): number {
  if (typeof mistake.intervalDays === "number" && Number.isFinite(mistake.intervalDays) && mistake.intervalDays >= 0) return mistake.intervalDays
  const latest = mistake.reviewHistory?.at(-1)
  if (typeof latest?.intervalDays === "number" && Number.isFinite(latest.intervalDays) && latest.intervalDays >= 0) return latest.intervalDays
  if (mistake.resolved) return 30
  if (!latest) return 0
  const rating = normalizeReviewRating(latest.result)
  return rating === "again" ? 0 : rating === "hard" ? 1 : rating === "easy" ? 7 : 3
}

function inferCount(mistake: Mistake, key: "repetitions" | "lapses") {
  const explicit = mistake[key]
  if (typeof explicit === "number" && Number.isInteger(explicit) && explicit >= 0) return explicit
  return (mistake.reviewHistory ?? []).filter((review) => {
    const rating = normalizeReviewRating(review.result)
    return key === "lapses" ? rating === "again" : rating !== "again"
  }).length
}

export function getMistakeSchedule(mistake: Mistake): MistakeSchedule {
  const state = inferReviewState(mistake)
  const intervalDays = inferIntervalDays(mistake)
  const easeFactor = typeof mistake.easeFactor === "number" && Number.isFinite(mistake.easeFactor)
    ? Math.max(MINIMUM_EASE_FACTOR, mistake.easeFactor)
    : DEFAULT_EASE_FACTOR
  let dueAt = mistake.dueAt
  if (!dueAt) {
    const base = mistake.lastReviewedAt ?? mistake.reviewHistory?.at(-1)?.completedAt ?? mistake.updatedAt ?? mistake.createdAt
    dueAt = new Date(new Date(base).getTime() + intervalDays * DAY_MS).toISOString()
  }
  return {
    state,
    dueAt,
    intervalDays,
    easeFactor,
    repetitions: inferCount(mistake, "repetitions"),
    lapses: inferCount(mistake, "lapses"),
    resolved: mistake.resolved || state === "review" && intervalDays >= 21,
  }
}

export function previewMistakeReview(
  mistake: Mistake,
  result: ReviewResult,
  completedAt = new Date().toISOString(),
): MistakeReviewPreview {
  const rating = normalizeReviewRating(result)
  const current = getMistakeSchedule(mistake)
  let state: MistakeReviewState
  let intervalDays: number
  let easeFactor = current.easeFactor
  let dueDelay = 0
  let repetitions = current.repetitions
  let lapses = current.lapses

  if (rating === "again") {
    state = current.state === "new" || current.state === "learning" ? "learning" : "relearning"
    intervalDays = current.state === "review" ? Math.max(1, Math.round(current.intervalDays * 0.5)) : current.intervalDays
    easeFactor = Math.max(MINIMUM_EASE_FACTOR, easeFactor - 0.2)
    dueDelay = 10 * MINUTE_MS
    lapses += 1
  } else if (rating === "hard") {
    state = current.state === "new" || current.state === "learning"
      ? "learning"
      : current.state === "relearning"
        ? "relearning"
        : "review"
    intervalDays = state === "learning" || state === "relearning" ? 1 : Math.max(1, Math.round(Math.max(1, current.intervalDays) * 1.2))
    easeFactor = Math.max(MINIMUM_EASE_FACTOR, easeFactor - 0.15)
    dueDelay = intervalDays * DAY_MS
    repetitions += 1
  } else if (rating === "good") {
    state = "review"
    intervalDays = current.state === "new" || current.state === "learning"
      ? 3
      : current.state === "relearning"
        ? Math.max(2, current.intervalDays)
        : Math.max(current.intervalDays + 1, Math.round(Math.max(1, current.intervalDays) * easeFactor))
    dueDelay = intervalDays * DAY_MS
    repetitions += 1
  } else {
    state = "review"
    intervalDays = current.state === "new" || current.state === "learning"
      ? 7
      : Math.max(7, Math.round(Math.max(1, current.intervalDays) * easeFactor * 1.3))
    easeFactor += 0.15
    dueDelay = intervalDays * DAY_MS
    repetitions += 1
  }

  return {
    rating,
    state,
    dueAt: new Date(new Date(completedAt).getTime() + dueDelay).toISOString(),
    intervalDays,
    easeFactor: Math.round(easeFactor * 100) / 100,
    repetitions,
    lapses,
    resolved: state === "review" && intervalDays >= 21,
  }
}

export function recordMistakeReview(
  mistake: Mistake,
  result: ReviewResult,
  completedAt = new Date().toISOString(),
): Mistake {
  const next = previewMistakeReview(mistake, result, completedAt)
  const history = [...(mistake.reviewHistory ?? []), {
    id: crypto.randomUUID(),
    completedAt,
    result: next.rating,
    intervalDays: next.intervalDays,
    easeFactor: next.easeFactor,
  }]
  return {
    ...mistake,
    reviewHistory: history,
    reviewState: next.state,
    intervalDays: next.intervalDays,
    easeFactor: next.easeFactor,
    repetitions: next.repetitions,
    lapses: next.lapses,
    lastReviewedAt: completedAt,
    resolved: next.resolved,
    dueAt: next.dueAt,
    updatedAt: completedAt,
  }
}

export function getDueMistakes(mistakes: Mistake[], now = new Date()): Mistake[] {
  const timestamp = now.getTime()
  return mistakes.filter((mistake) => !mistake.suspended && new Date(getMistakeSchedule(mistake).dueAt).getTime() <= timestamp)
    .toSorted((first, second) => getMistakeSchedule(first).dueAt.localeCompare(getMistakeSchedule(second).dueAt))
}

export type CoverageArea = {
  subject: string
  areaOfStudy: string
  earned: number
  available: number
  percentage: number
  questions: number
}

export function buildCoverage(attempts: ExamAttempt[]): CoverageArea[] {
  const areas = new Map<string, Omit<CoverageArea, "percentage">>()
  for (const attempt of attempts) {
    for (const result of attempt.questionResults ?? []) {
      const areaOfStudy = result.areaOfStudy?.trim()
      if (!areaOfStudy) continue
      const key = `${attempt.subject}\u0000${areaOfStudy}`
      const area = areas.get(key) ?? { subject: attempt.subject, areaOfStudy, earned: 0, available: 0, questions: 0 }
      area.earned += result.marksAwarded
      area.available += result.maxMarks
      area.questions += 1
      areas.set(key, area)
    }
  }
  return [...areas.values()].map((area) => ({
    ...area,
    percentage: area.available ? (area.earned / area.available) * 100 : 0,
  })).toSorted((first, second) => first.percentage - second.percentage || first.areaOfStudy.localeCompare(second.areaOfStudy))
}

export function formatExamTitle(provider: string, examYear: number, subject: string): string {
  return `${provider.trim() || "Other"} ${examYear} ${subject.trim()}`
}

export type AttemptAnalysis = {
  scaledScore: number
  percentage: number
  grade: string | null
  percentile: number | null
}

export type AttemptPoint = {
  grade: string
  percentile: number
  scaledScore: number
  attempt: ExamAttempt
}

export function analyseScore(
  scaledScore: number,
  reference: AssessmentReference,
): Pick<AttemptAnalysis, "grade" | "percentile"> {
  const score = Math.round(scaledScore)
  const band = reference.gradeBands.find(
    ({ minScore, maxScore }) =>
      minScore !== null && maxScore !== null && score >= minScore && score <= maxScore,
  )

  if (!band) return { grade: null, percentile: null }

  const ordered = reference.gradeBands.toSorted(
    (first, second) => (first.minScore ?? 0) - (second.minScore ?? 0),
  )
  const lowerPercentage = ordered
    .slice(0, ordered.indexOf(band))
    .reduce((total, item) => total + (item.percentage ?? 0), 0)
  const bandPercentage = band.percentage ?? null
  const range = (band.maxScore ?? 0) - (band.minScore ?? 0)
  const position = range > 0
    ? Math.min(1, Math.max(0, (scaledScore - (band.minScore ?? 0)) / range))
    : 0.5
  const percentile = bandPercentage === null
    ? null
    : Math.min(100, Math.max(0, lowerPercentage + position * bandPercentage))

  return { grade: band.grade, percentile }
}

export function analyseAttempt(
  attempt: Pick<ExamAttempt, "rawScore" | "rawMax">,
  reference?: AssessmentReference,
): AttemptAnalysis {
  const percentage = (attempt.rawScore / attempt.rawMax) * 100
  const scaledScore = reference
    ? (attempt.rawScore / attempt.rawMax) * reference.maxScore
    : attempt.rawScore
  if (!reference) {
    return { scaledScore, percentage, grade: null, percentile: null }
  }

  return { scaledScore, percentage, ...analyseScore(scaledScore, reference) }
}

export function validateAttempt(
  attempt: Pick<ExamAttempt, "rawScore" | "rawMax">,
): string | null {
  if (!Number.isFinite(attempt.rawMax) || attempt.rawMax <= 0) {
    return "Maximum mark must be greater than zero."
  }
  if (!Number.isFinite(attempt.rawScore) || attempt.rawScore < 0) {
    return "Mark must be zero or greater."
  }
  if (attempt.rawScore > attempt.rawMax) {
    return "Mark cannot exceed the maximum."
  }
  return null
}

export function validateMistakeMarks(totalMarks: number, marksLost: number): string | null {
  if (!Number.isFinite(totalMarks) || totalMarks <= 0) return "Total marks must be greater than zero."
  if (!Number.isFinite(marksLost) || marksLost < 0) return "Marks lost must be zero or greater."
  return marksLost > totalMarks ? "Marks lost cannot exceed total marks." : null
}

export function validateQuestionResults(results: QuestionResult[]): string | null {
  for (const result of results) {
    if (!result.label.trim()) return "Every question needs a label."
    const error = validateAttempt({ rawScore: result.marksAwarded, rawMax: result.maxMarks })
    if (error) return `${result.label}: ${error}`
  }
  return null
}

const normaliseComparisonCache = new Map<string, string>()

export function normaliseComparisonName(value: string) {
  const cached = normaliseComparisonCache.get(value)
  if (cached !== undefined) return cached
  const normalised = value
    .toLowerCase()
    .replace(/\bwritten\b/g, "")
    .replace(/\b(examination|paper)\b/g, "exam")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
  if (normaliseComparisonCache.size > 4000) normaliseComparisonCache.clear()
  normaliseComparisonCache.set(value, normalised)
  return normalised
}

export function formatOrdinal(value: number) {
  const rounded = Math.round(value)
  const mod100 = Math.abs(rounded) % 100
  const suffix = mod100 >= 11 && mod100 <= 13
    ? "th"
    : ({ 1: "st", 2: "nd", 3: "rd" } as const)[Math.abs(rounded) % 10 as 1 | 2 | 3] ?? "th"
  return `${rounded}${suffix}`
}

export function matchesAttemptReference(attempt: Pick<ExamAttempt, "subject" | "paper">, reference: AssessmentReference) {
  return normaliseComparisonName(attempt.subject) === normaliseComparisonName(reference.studyName) &&
    normaliseComparisonName(attempt.paper) === normaliseComparisonName(reference.name)
}

export function getAttemptPoints(
  attempts: ExamAttempt[],
  reference: AssessmentReference,
): AttemptPoint[] {
  return attempts.flatMap((attempt) => {
    if (!matchesAttemptReference(attempt, reference)) return []
    const analysis = analyseAttempt(attempt, reference)
    return analysis.grade && analysis.percentile !== null
      ? [{ grade: analysis.grade, percentile: analysis.percentile, scaledScore: analysis.scaledScore, attempt }]
      : []
  })
}

export type DistributionStats = {
  mean: number
  median: number
  variance: number
  stdDev: number
  meanPercentage: number
}

export type VcaaYearInsight = {
  year: number
  cohortSize: number | null
  maxScore: number
  meanPercentage: number
  medianPercentage: number
  aPlusCutoffPercentage: number | null
  grade: string | null
  percentile: number | null
  sourceUrl: string
}

const distributionStatsCache = new WeakMap<AssessmentReference, DistributionStats>()

export function computeDistributionStats(reference: AssessmentReference): DistributionStats {
  const cached = distributionStatsCache.get(reference)
  if (cached) return cached
  const bands = reference.gradeBands.toSorted(
    (first, second) => (first.minScore ?? 0) - (second.minScore ?? 0),
  )
  let mean = 0
  for (const band of bands) {
    const min = band.minScore ?? band.maxScore ?? 0
    const max = band.maxScore ?? band.minScore ?? 0
    const midpoint = (min + max) / 2
    mean += midpoint * ((band.percentage ?? 0) / 100)
  }

  let variance = 0
  for (const band of bands) {
    const min = band.minScore ?? band.maxScore ?? 0
    const max = band.maxScore ?? band.minScore ?? 0
    const midpoint = (min + max) / 2
    const weight = (band.percentage ?? 0) / 100
    variance += weight * (midpoint - mean) ** 2
  }

  const stdDev = Math.sqrt(variance)
  const meanPercentage = reference.maxScore > 0 ? (mean / reference.maxScore) * 100 : 0
  const medianTarget = bands.reduce((total, band) => total + (band.percentage ?? 0), 0) / 2
  let cumulativePercentage = 0
  let median = mean
  for (const band of bands) {
    const percentage = band.percentage ?? 0
    if (percentage > 0 && cumulativePercentage + percentage >= medianTarget) {
      const min = band.minScore ?? band.maxScore ?? 0
      const max = band.maxScore ?? band.minScore ?? 0
      median = min + ((medianTarget - cumulativePercentage) / percentage) * (max - min)
      break
    }
    cumulativePercentage += percentage
  }

  const stats: DistributionStats = { mean, median, variance, stdDev, meanPercentage }
  distributionStatsCache.set(reference, stats)
  return stats
}

export function buildVcaaYearInsights(
  references: AssessmentReference[],
  scorePercentage: number,
): VcaaYearInsight[] {
  return references.map((reference) => {
    const stats = computeDistributionStats(reference)
    const cohortCounts = reference.gradeBands.map((band) => band.count)
    const cohortSize = cohortCounts.some((count) => count !== null)
      ? cohortCounts.reduce<number>((total, count) => total + (count ?? 0), 0)
      : null
    const aPlus = reference.gradeBands.find((band) => band.grade.trim().toUpperCase() === "A+")
    const analysis = analyseScore((scorePercentage / 100) * reference.maxScore, reference)

    return {
      year: reference.year,
      cohortSize,
      maxScore: reference.maxScore,
      meanPercentage: stats.meanPercentage,
      medianPercentage: reference.maxScore > 0 ? (stats.median / reference.maxScore) * 100 : 0,
      aPlusCutoffPercentage: aPlus?.minScore === null || aPlus?.minScore === undefined
        ? null
        : (aPlus.minScore / reference.maxScore) * 100,
      grade: analysis.grade,
      percentile: analysis.percentile,
      sourceUrl: reference.sourceUrl,
    }
  }).toSorted((first, second) => first.year - second.year)
}

export function getReferencesForAttempt(
  attempt: ExamAttempt,
  references: AssessmentReference[],
): AssessmentReference[] {
  return [...new Set(references.map((reference) => reference.year))]
    .flatMap((year) => findAttemptReferenceForYear(attempt, references, year) ?? [])
    .toSorted((a, b) => b.year - a.year)
}

type ReferenceIndex = {
  references: AssessmentReference[]
  byYear: Map<number, Map<string, AssessmentReference[]>>
  byId: Map<string, AssessmentReference>
}

const referenceIndexCache = new WeakMap<AssessmentReference[], ReferenceIndex>()

function referenceIndexFor(references: AssessmentReference[]): ReferenceIndex {
  let index = referenceIndexCache.get(references)
  if (index) return index
  const byYear = new Map<number, Map<string, AssessmentReference[]>>()
  const byId = new Map<string, AssessmentReference>()
  for (const reference of references) {
    byId.set(reference.id, reference)
    const subjectKey = normaliseComparisonName(reference.studyName)
    const yearBucket = byYear.get(reference.year) ?? new Map<string, AssessmentReference[]>()
    const list = yearBucket.get(subjectKey) ?? []
    list.push(reference)
    yearBucket.set(subjectKey, list)
    byYear.set(reference.year, yearBucket)
  }
  index = { references, byYear, byId }
  referenceIndexCache.set(references, index)
  return index
}

export function findAttemptReferenceForYear(
  attempt: Pick<ExamAttempt, "subject" | "paper">,
  references: AssessmentReference[],
  year: number,
): AssessmentReference | undefined {
  const candidates = referenceIndexFor(references).byYear.get(year)?.get(normaliseComparisonName(attempt.subject)) ?? []
  return candidates.find((reference) => matchesAttemptReference(attempt, reference)) ??
    (candidates.length === 1 ? candidates[0] : undefined)
}

export function findAttemptReferenceById(
  references: AssessmentReference[],
  id: string | null | undefined,
): AssessmentReference | undefined {
  if (!id) return undefined
  return referenceIndexFor(references).byId.get(id)
}

export function findAttemptReference(
  attempt: ExamAttempt,
  references: AssessmentReference[],
): AssessmentReference | undefined {
  return findAttemptReferenceForYear(attempt, references, attempt.examYear) ?? findAttemptReferenceById(references, attempt.referenceId)
}

export type AttemptBenchmark = {
  attempt: ExamAttempt
  reference: AssessmentReference
  percentage: number
  grade: string | null
  percentile: number | null
  vcaaMeanPercentage: number
  aPlusCutoffPercentage: number | null
  gapToAPlus: number | null
}

export function buildAttemptBenchmarks(
  attempts: ExamAttempt[],
  references: AssessmentReference[],
): AttemptBenchmark[] {
  return attempts.flatMap((attempt) => {
    const reference = findAttemptReference(attempt, references)
    if (!reference) return []
    const analysis = analyseAttempt(attempt, reference)
    const aPlus = reference.gradeBands.find((band) => band.grade.trim().toUpperCase() === "A+")
    const aPlusCutoffPercentage = aPlus?.minScore == null
      ? null
      : (aPlus.minScore / reference.maxScore) * 100

    return [{
      attempt,
      reference,
      percentage: analysis.percentage,
      grade: analysis.grade,
      percentile: analysis.percentile,
      vcaaMeanPercentage: computeDistributionStats(reference).meanPercentage,
      aPlusCutoffPercentage,
      gapToAPlus: aPlusCutoffPercentage === null ? null : analysis.percentage - aPlusCutoffPercentage,
    }]
  }).toSorted((first, second) => first.attempt.completedAt.localeCompare(second.attempt.completedAt))
}

export type SubjectBenchmark = {
  subject: string
  attemptCount: number
  linkedCount: number
  averageMark: number
  bestMark: number
  latestMark: number
  averagePercentile: number | null
  vcaaMeanPercentage: number | null
  aPlusCutoffPercentage: number | null
}

export function buildSubjectBenchmarks(
  attempts: ExamAttempt[],
  references: AssessmentReference[],
): SubjectBenchmark[] {
  const benchmarks = buildAttemptBenchmarks(attempts, references)
  const benchmarksByAttempt = new Map(benchmarks.map((item) => [item.attempt.id, item]))
  const buckets = new Map<string, {
    marks: number[]
    linked: AttemptBenchmark[]
    latestDate: string
    latestMark: number
  }>()

  for (const attempt of attempts) {
    const mark = (attempt.rawScore / attempt.rawMax) * 100
    const bucket = buckets.get(attempt.subject) ?? { marks: [], linked: [], latestDate: "", latestMark: mark }
    bucket.marks.push(mark)
    const benchmark = benchmarksByAttempt.get(attempt.id)
    if (benchmark) bucket.linked.push(benchmark)
    if (attempt.completedAt >= bucket.latestDate) {
      bucket.latestDate = attempt.completedAt
      bucket.latestMark = mark
    }
    buckets.set(attempt.subject, bucket)
  }

  const average = (values: number[]) => values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : null

  return [...buckets.entries()].map(([subject, bucket]) => {
    const percentiles = bucket.linked.flatMap((item) => item.percentile === null ? [] : [item.percentile])
    const cutoffs = bucket.linked.flatMap((item) => item.aPlusCutoffPercentage === null ? [] : [item.aPlusCutoffPercentage])
    return {
      subject,
      attemptCount: bucket.marks.length,
      linkedCount: bucket.linked.length,
      averageMark: average(bucket.marks) ?? 0,
      bestMark: Math.max(...bucket.marks),
      latestMark: bucket.latestMark,
      averagePercentile: average(percentiles),
      vcaaMeanPercentage: average(bucket.linked.map((item) => item.vcaaMeanPercentage)),
      aPlusCutoffPercentage: average(cutoffs),
    }
  }).toSorted((first, second) => second.averageMark - first.averageMark)
}

export function formatReferenceName(name: string): string {
  return name.toLowerCase()
    .replace(/\b[a-z]/g, (letter) => letter.toUpperCase())
    .replace(/\b(And|Or)\b/g, (word) => word.toLowerCase())
    .replace(/^Written Examination/, "Exam")
    .trim()
}

export function removeAttempt(data: AppData, attemptId: string): AppData {
  return {
    ...data,
    attempts: data.attempts.filter((attempt) => attempt.id !== attemptId),
    mistakes: data.mistakes.filter((mistake) => mistake.attemptId !== attemptId),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

export function isAppData(value: unknown): value is AppData {
  if (!isRecord(value)) return false
  const data = value as Partial<AppData>
  const attemptsValid =
    Array.isArray(data.attempts) &&
    data.attempts.every(
      (value) => {
        if (!isRecord(value)) return false
        const attempt = value as unknown as ExamAttempt
        return (
          typeof attempt.id === "string" &&
          typeof attempt.subject === "string" &&
          typeof attempt.provider === "string" &&
          typeof attempt.title === "string" &&
          typeof attempt.examYear === "number" &&
          typeof attempt.paper === "string" &&
          typeof attempt.completedAt === "string" &&
          typeof attempt.rawScore === "number" &&
          typeof attempt.rawMax === "number" &&
          (attempt.comment === undefined || typeof attempt.comment === "string") &&
          (attempt.performanceContext === undefined || isPerformanceContext(attempt.performanceContext)) &&
          (attempt.questionResults === undefined || Array.isArray(attempt.questionResults) && attempt.questionResults.every(isQuestionResult)) &&
          (attempt.timing === undefined || isExamTiming(attempt.timing)) &&
          (attempt.referenceId === null || typeof attempt.referenceId === "string") &&
          typeof attempt.createdAt === "string" &&
          typeof attempt.updatedAt === "string" &&
          validateAttempt(attempt) === null
        )
      },
    )
  const attemptIds = new Set(data.attempts?.map((attempt) => attempt.id))
  const mistakesValid =
    Array.isArray(data.mistakes) &&
    data.mistakes.every((value) => {
      if (!isRecord(value)) return false
      const mistake = value as unknown as Mistake
      return (
        typeof mistake.id === "string" &&
        typeof mistake.attemptId === "string" &&
        attemptIds.has(mistake.attemptId) &&
        typeof mistake.question === "string" &&
        (mistake.questionText === undefined || typeof mistake.questionText === "string") &&
        MISTAKE_CATEGORIES.includes(mistake.category) &&
        typeof mistake.explanation === "string" &&
        typeof mistake.correction === "string" &&
        (mistake.totalMarks === undefined || typeof mistake.totalMarks === "number") &&
        (mistake.marksLost === undefined || typeof mistake.marksLost === "number") &&
        (mistake.totalMarks === undefined && mistake.marksLost === undefined || validateMistakeMarks(mistake.totalMarks!, mistake.marksLost!) === null) &&
        (mistake.areaOfStudy === undefined || typeof mistake.areaOfStudy === "string") &&
        (mistake.criterion === undefined || typeof mistake.criterion === "string") &&
        (mistake.attachments === undefined || Array.isArray(mistake.attachments) && mistake.attachments.every((attachment) =>
          isRecord(attachment) &&
          typeof attachment.id === "string" &&
          typeof attachment.name === "string" &&
          typeof attachment.type === "string" &&
          typeof attachment.size === "number" && Number.isFinite(attachment.size) && attachment.size >= 0 &&
          typeof attachment.storagePath === "string"
        )) &&
        (mistake.dueAt === undefined || mistake.dueAt === null || typeof mistake.dueAt === "string") &&
        (mistake.reviewHistory === undefined || Array.isArray(mistake.reviewHistory) && mistake.reviewHistory.every(isMistakeReview)) &&
        (mistake.reviewState === undefined || ["new", "learning", "review", "relearning"].includes(mistake.reviewState)) &&
        (mistake.intervalDays === undefined || typeof mistake.intervalDays === "number" && Number.isFinite(mistake.intervalDays) && mistake.intervalDays >= 0) &&
        (mistake.easeFactor === undefined || typeof mistake.easeFactor === "number" && Number.isFinite(mistake.easeFactor) && mistake.easeFactor >= MINIMUM_EASE_FACTOR) &&
        (mistake.repetitions === undefined || typeof mistake.repetitions === "number" && Number.isInteger(mistake.repetitions) && mistake.repetitions >= 0) &&
        (mistake.lapses === undefined || typeof mistake.lapses === "number" && Number.isInteger(mistake.lapses) && mistake.lapses >= 0) &&
        (mistake.lastReviewedAt === undefined || typeof mistake.lastReviewedAt === "string") &&
        (mistake.suspended === undefined || typeof mistake.suspended === "boolean") &&
        typeof mistake.resolved === "boolean" &&
        typeof mistake.createdAt === "string" &&
        typeof mistake.updatedAt === "string"
      )
    })
  const trackedExamIdsValid =
    Array.isArray(data.trackedExamIds) &&
    data.trackedExamIds.every((value) => typeof value === "string")
  const completedExamIdsValid =
    Array.isArray(data.completedExamIds) &&
    data.completedExamIds.every((value) => typeof value === "string")
  const sacRecordsValid = Array.isArray(data.sacRecords) && data.sacRecords.every(isSacRecord)
  const subjectsValid = Array.isArray(data.subjects) && data.subjects.every((value) => typeof value === "string")
  return (
    data.schemaVersion === 5 &&
    attemptsValid &&
    mistakesValid &&
    sacRecordsValid &&
    typeof data.sacRecordsUpdatedAt === "string" &&
    subjectsValid &&
    typeof data.subjectsUpdatedAt === "string" &&
    trackedExamIdsValid &&
    typeof data.trackedExamIdsUpdatedAt === "string" &&
    completedExamIdsValid &&
    typeof data.completedExamIdsUpdatedAt === "string" &&
    (data.activeExamTimer === undefined || isExamTimerSession(data.activeExamTimer)) &&
    typeof data.activeExamTimerUpdatedAt === "string" &&
    (data.activeSacTimer === undefined || isSacTimerSession(data.activeSacTimer)) &&
    typeof data.activeSacTimerUpdatedAt === "string" &&
    (data.mistakeInsights === undefined || isMistakeInsights(data.mistakeInsights)) &&
    (data.alternativeMistakeDeck === undefined || isAlternativeMistakeDeck(data.alternativeMistakeDeck)) &&
    (data.examDifficulty === undefined || isExamDifficultySettings(data.examDifficulty)) &&
    (data.examProgression === undefined || isExamProgression(data.examProgression)) &&
    Array.isArray(data.atarEstimates) &&
    data.atarEstimates.every(isSavedAtarEstimate) &&
    typeof data.atarEstimatesUpdatedAt === "string" &&
    isLearningWorkspace(data.learning)
  )
}

function isMistakeInsights(value: unknown): value is MistakeInsights {
  if (!isRecord(value)) return false
  return typeof value.summary === "string" &&
    Array.isArray(value.biggestErrors) && value.biggestErrors.every((error) => isRecord(error) && typeof error.title === "string" && typeof error.evidence === "string" && typeof error.action === "string") &&
    Array.isArray(value.otherInsights) && value.otherInsights.every((insight) => typeof insight === "string") &&
    typeof value.nextStep === "string" &&
    (value.practiceQuestions === undefined || typeof value.practiceQuestions === "string") &&
    typeof value.generatedAt === "string" &&
    (value.questionsGeneratedAt === undefined || typeof value.questionsGeneratedAt === "string")
}

function isAlternativeMistakeDeck(value: unknown): value is AlternativeMistakeDeck {
  if (!isRecord(value)) return false
  return Array.isArray(value.cards) && value.cards.every((card) => isRecord(card) &&
    typeof card.sourceMistakeId === "string" &&
    typeof card.skill === "string" &&
    typeof card.question === "string" &&
    typeof card.answer === "string" &&
    typeof card.marks === "number" && Number.isInteger(card.marks) && card.marks > 0 &&
    typeof card.generatedAt === "string") &&
    typeof value.updatedAt === "string"
}

function isAtarEstimatorRow(value: unknown): value is AtarEstimatorRow {
  if (!isRecord(value)) return false
  return typeof value.id === "string" &&
    typeof value.code === "string" &&
    typeof value.raw === "string" &&
    typeof value.usePrediction === "boolean"
}

function isSavedAtarEstimate(value: unknown): value is SavedAtarEstimate {
  if (!isRecord(value)) return false
  return typeof value.id === "string" &&
    typeof value.year === "number" && Number.isInteger(value.year) &&
    Array.isArray(value.rows) && value.rows.every(isAtarEstimatorRow) &&
    typeof value.atarLabel === "string" &&
    (value.aggregate === null || typeof value.aggregate === "number" && Number.isFinite(value.aggregate)) &&
    typeof value.savedAt === "string"
}

function isQuestionResult(value: unknown): value is QuestionResult {
  if (!isRecord(value)) return false
  return typeof value.id === "string" && typeof value.label === "string" &&
    typeof value.marksAwarded === "number" && typeof value.maxMarks === "number" &&
    ["low", "medium", "high"].includes(String(value.confidence)) &&
    (value.areaOfStudy === undefined || typeof value.areaOfStudy === "string") &&
    (value.criterion === undefined || typeof value.criterion === "string") &&
    (value.examinerNote === undefined || typeof value.examinerNote === "string") &&
    validateAttempt({ rawScore: value.marksAwarded, rawMax: value.maxMarks }) === null
}

function isExamTiming(value: unknown): value is ExamTiming {
  if (!isRecord(value)) return false
  return ["plannedReadingMinutes", "plannedWritingMinutes", "actualWritingSeconds", "overtimeSeconds", "pausedSeconds"]
    .every((key) => typeof value[key] === "number" && Number.isFinite(value[key]) && Number(value[key]) >= 0)
}

function isMistakeReview(value: unknown): value is MistakeReview {
  if (!isRecord(value)) return false
  return typeof value.id === "string" && typeof value.completedAt === "string" &&
    ["incorrect", "assisted", "correct", "again", "hard", "good", "easy"].includes(String(value.result)) &&
    (value.intervalDays === undefined || typeof value.intervalDays === "number" && Number.isFinite(value.intervalDays) && value.intervalDays >= 0) &&
    (value.easeFactor === undefined || typeof value.easeFactor === "number" && Number.isFinite(value.easeFactor) && value.easeFactor >= MINIMUM_EASE_FACTOR)
}

export function migrateAppData(value: unknown): AppData | null {
  if (!isRecord(value)) return null
  const data = value as Record<string, unknown>
  const schemaVersion = data.schemaVersion
  if (![1, 2, 3, 4, 5].includes(Number(schemaVersion))) return null
  if (!Array.isArray(data.attempts) || !Array.isArray(data.mistakes)) return null
  const sacRecords = data.sacRecords === undefined ? [] : migrateSacRecords(data.sacRecords)
  if (sacRecords === null) return null
  const migrated = {
    ...data,
    schemaVersion: 5 as const,
    subjects: Array.isArray(data.subjects) ? data.subjects : [],
    subjectsUpdatedAt: typeof data.subjectsUpdatedAt === "string" ? data.subjectsUpdatedAt : "1970-01-01T00:00:00.000Z",
    trackedExamIds: Array.isArray(data.trackedExamIds) ? data.trackedExamIds : [],
    trackedExamIdsUpdatedAt: typeof data.trackedExamIdsUpdatedAt === "string" ? data.trackedExamIdsUpdatedAt : "1970-01-01T00:00:00.000Z",
    completedExamIds: Array.isArray(data.completedExamIds) ? data.completedExamIds : [],
    completedExamIdsUpdatedAt: typeof data.completedExamIdsUpdatedAt === "string" ? data.completedExamIdsUpdatedAt : "1970-01-01T00:00:00.000Z",
    activeExamTimer: isExamTimerSession(data.activeExamTimer) ? data.activeExamTimer : undefined,
    activeExamTimerUpdatedAt: typeof data.activeExamTimerUpdatedAt === "string" ? data.activeExamTimerUpdatedAt : "1970-01-01T00:00:00.000Z",
    activeSacTimer: isSacTimerSession(data.activeSacTimer) ? data.activeSacTimer : undefined,
    activeSacTimerUpdatedAt: typeof data.activeSacTimerUpdatedAt === "string" ? data.activeSacTimerUpdatedAt : "1970-01-01T00:00:00.000Z",
    sacRecords,
    sacRecordsUpdatedAt: typeof data.sacRecordsUpdatedAt === "string" ? data.sacRecordsUpdatedAt : "1970-01-01T00:00:00.000Z",
    atarEstimates: Array.isArray(data.atarEstimates) ? data.atarEstimates : [],
    atarEstimatesUpdatedAt: typeof data.atarEstimatesUpdatedAt === "string" ? data.atarEstimatesUpdatedAt : "1970-01-01T00:00:00.000Z",
    learning: migrateLearningWorkspace(data.learning),
  }
  return isAppData(migrated) ? migrated : null
}
