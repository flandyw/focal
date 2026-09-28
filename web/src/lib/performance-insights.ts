import { getMistakeSchedule, type ExamAttempt, type Mistake } from "@/lib/exam-data"
import { getAttemptPerformance, type ExamDifficultySettings } from "@/lib/exam-difficulty"
import { getMathsExamPaper, isTechSplitMathsSubject } from "@/lib/mistake-filters"

const DAY_MS = 24 * 60 * 60 * 1000

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value))
}

function average(values: number[]) {
  return values.length ? values.reduce((total, value) => total + value, 0) / values.length : 0
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0
  const mean = average(values)
  return Math.sqrt(average(values.map((value) => (value - mean) ** 2)))
}

export type SubjectOutlook = {
  subject: string
  attempts: number
  currentAverage: number
  projectedNext: number
  predictionLow: number
  predictionHigh: number
  momentum: number
  spread: number
  confidence: "low" | "medium" | "high"
}

function buildOutlook(subject: string, attempts: ExamAttempt[], settings?: ExamDifficultySettings): SubjectOutlook {
  const performances = attempts
    .toSorted((first, second) => first.completedAt.localeCompare(second.completedAt))
    .map((attempt) => getAttemptPerformance(attempt, settings))
  const scores = performances.map((performance) => performance.alignedPercentage)
  const relevance = performances.map((performance) => performance.relevanceWeight)
  const recent = scores.slice(-3)
  const previous = scores.slice(-6, -3)
  const weighted = (values: number[], weights: number[]) => {
    const total = weights.reduce((sum, weight) => sum + weight, 0)
    return total ? values.reduce((sum, value, index) => sum + value * weights[index], 0) / total : average(values)
  }
  const recentWeights = relevance.slice(-3)
  const previousWeights = relevance.slice(-6, -3)
  const currentAverage = weighted(recent, recentWeights)
  const momentum = previous.length ? currentAverage - weighted(previous, previousWeights) : scores.length >= 2 ? scores.at(-1)! - scores.at(-2)! : 0
  const spread = standardDeviation(scores.slice(-5))

  if (scores.length < 2) {
    return {
      subject,
      attempts: scores.length,
      currentAverage,
      projectedNext: currentAverage,
      predictionLow: clamp(currentAverage - 10),
      predictionHigh: clamp(currentAverage + 10),
      momentum,
      spread,
      confidence: "low",
    }
  }

  // A recency-weighted least-squares trend reduces the influence of old papers while
  // retaining more evidence than a simple latest-vs-previous comparison.
  const weights = scores.map((_, index) => 0.78 ** (scores.length - index - 1) * relevance[index])
  const weightTotal = weights.reduce((total, value) => total + value, 0)
  const meanX = scores.reduce((total, _, index) => total + index * weights[index], 0) / weightTotal
  const meanY = scores.reduce((total, score, index) => total + score * weights[index], 0) / weightTotal
  const denominator = scores.reduce((total, _, index) => total + weights[index] * (index - meanX) ** 2, 0)
  const slope = denominator
    ? scores.reduce((total, score, index) => total + weights[index] * (index - meanX) * (score - meanY), 0) / denominator
    : 0
  const intercept = meanY - slope * meanX
  const predicted = intercept + slope * scores.length
  const residualError = Math.sqrt(scores.reduce((total, score, index) => {
    const residual = score - (intercept + slope * index)
    return total + weights[index] * residual ** 2
  }, 0) / weightTotal)
  const uncertainty = Math.max(3, residualError * 1.65, scores.length < 4 ? 7 : 0)

  return {
    subject,
    attempts: scores.length,
    currentAverage,
    projectedNext: clamp(predicted),
    predictionLow: clamp(predicted - uncertainty),
    predictionHigh: clamp(predicted + uncertainty),
    momentum,
    spread,
    confidence: scores.length >= 6 ? "high" : scores.length >= 3 ? "medium" : "low",
  }
}

export function buildSubjectOutlooks(attempts: ExamAttempt[], settings?: ExamDifficultySettings): SubjectOutlook[] {
  const grouped = new Map<string, ExamAttempt[]>()
  for (const attempt of attempts) {
    grouped.set(attempt.subject, [...(grouped.get(attempt.subject) ?? []), attempt])
  }
  return [...grouped.entries()]
    .map(([subject, subjectAttempts]) => buildOutlook(subject, subjectAttempts, settings))
    .toSorted((first, second) => first.projectedNext - second.projectedNext || second.attempts - first.attempts)
}

export type FocusPriority = {
  subject: string
  paper: string | null
  areaOfStudy: string
  priorityScore: number
  mastery: number | null
  missedMarks: number
  availableMarks: number
  questionCount: number
  confidenceRisk: number
  unresolvedMistakes: number
  lapses: number
}

type FocusBucket = Omit<FocusPriority, "priorityScore" | "mastery" | "confidenceRisk"> & {
  earnedMarks: number
  lowConfidence: number
  mediumConfidence: number
}

export function buildFocusPriorities(
  attempts: ExamAttempt[],
  mistakes: Mistake[],
  options: { bucketByPaper?: boolean } = {},
): FocusPriority[] {
  const buckets = new Map<string, FocusBucket>()
  const attemptDetails = new Map(attempts.map((attempt) => [attempt.id, attempt]))

  for (const attempt of attempts) {
    for (const result of attempt.questionResults ?? []) {
      const areaOfStudy = result.areaOfStudy?.trim()
      if (!areaOfStudy) continue
      const paper = options.bucketByPaper ? attempt.paper.trim() || "Unspecified paper" : null
      const key = `${attempt.subject}\u0000${paper ?? ""}\u0000${areaOfStudy}`
      const bucket = buckets.get(key) ?? {
        subject: attempt.subject,
        paper,
        areaOfStudy,
        earnedMarks: 0,
        missedMarks: 0,
        availableMarks: 0,
        questionCount: 0,
        lowConfidence: 0,
        mediumConfidence: 0,
        unresolvedMistakes: 0,
        lapses: 0,
      }
      bucket.earnedMarks += result.marksAwarded
      bucket.missedMarks += Math.max(0, result.maxMarks - result.marksAwarded)
      bucket.availableMarks += result.maxMarks
      bucket.questionCount += 1
      if (result.confidence === "low") bucket.lowConfidence += 1
      if (result.confidence === "medium") bucket.mediumConfidence += 1
      buckets.set(key, bucket)
    }
  }

  for (const mistake of mistakes) {
    const areaOfStudy = mistake.areaOfStudy?.trim()
    const attempt = attemptDetails.get(mistake.attemptId)
    if (!areaOfStudy || !attempt || mistake.suspended) continue
    const paper = options.bucketByPaper ? attempt.paper.trim() || "Unspecified paper" : null
    const key = `${attempt.subject}\u0000${paper ?? ""}\u0000${areaOfStudy}`
    const bucket = buckets.get(key) ?? {
      subject: attempt.subject,
      paper,
      areaOfStudy,
      earnedMarks: 0,
      missedMarks: 0,
      availableMarks: 0,
      questionCount: 0,
      lowConfidence: 0,
      mediumConfidence: 0,
      unresolvedMistakes: 0,
      lapses: 0,
    }
    const schedule = getMistakeSchedule(mistake)
    if (!schedule.resolved) bucket.unresolvedMistakes += 1
    bucket.lapses += schedule.lapses
    buckets.set(key, bucket)
  }

  return [...buckets.values()].map((bucket) => {
    const mastery = bucket.availableMarks ? bucket.earnedMarks / bucket.availableMarks * 100 : null
    const confidenceRisk = bucket.questionCount
      ? (bucket.lowConfidence + bucket.mediumConfidence * 0.5) / bucket.questionCount * 100
      : 0
    const markRisk = mastery === null ? (bucket.unresolvedMistakes ? 50 : 0) : 100 - mastery
    const reviewRisk = Math.min(100, bucket.unresolvedMistakes * 25 + bucket.lapses * 10)
    const priorityScore = clamp(markRisk * 0.6 + confidenceRisk * 0.25 + reviewRisk * 0.15)
    return {
      subject: bucket.subject,
      paper: bucket.paper,
      areaOfStudy: bucket.areaOfStudy,
      priorityScore,
      mastery,
      missedMarks: bucket.missedMarks,
      availableMarks: bucket.availableMarks,
      questionCount: bucket.questionCount,
      confidenceRisk,
      unresolvedMistakes: bucket.unresolvedMistakes,
      lapses: bucket.lapses,
    }
  }).filter((priority) => priority.questionCount > 0 || priority.unresolvedMistakes > 0)
    .toSorted((first, second) => second.priorityScore - first.priorityScore || second.missedMarks - first.missedMarks)
}

export type PaperEvidenceConfidence = "low" | "medium" | "high"
export type PaperTrend = "improving" | "flat" | "deteriorating" | "insufficient"

export type PaperQuestionEvidence = {
  attemptId: string
  attemptTitle: string
  provider: string
  examYear: number
  completedAt: string
  question: string
  earnedMarks: number
  availableMarks: number
  missedMarks: number
  confidence: "low" | "medium" | "high"
  mistakeCategories: string[]
}

export type PaperPerformanceCell = {
  paper: 1 | 2
  mastery: number | null
  earnedMarks: number
  missedMarks: number
  availableMarks: number
  questionCount: number
  lowConfidence: number
  mediumConfidence: number
  highConfidence: number
  confidenceRisk: number
  evidenceConfidence: PaperEvidenceConfidence
  mistakeCount: number
  repeatMistakes: number
  trendPoints: number | null
  trend: PaperTrend
  questions: PaperQuestionEvidence[]
}

export type PaperWeaknessDiagnosis = "tech-free fragile" | "tech-active fragile" | "general weakness" | "secure" | "stable" | "insufficient evidence"

export type PaperWeaknessRow = {
  areaOfStudy: string
  exam1: PaperPerformanceCell
  exam2: PaperPerformanceCell
  gap: number | null
  diagnosis: PaperWeaknessDiagnosis
}

type PaperCellBucket = Omit<PaperPerformanceCell, "mastery" | "confidenceRisk" | "evidenceConfidence" | "repeatMistakes" | "trendPoints" | "trend"> & {
  mistakeSignatures: string[]
  performances: Map<string, { completedAt: string; earned: number; available: number }>
}

function emptyPaperCell(paper: 1 | 2): PaperCellBucket {
  return {
    paper,
    earnedMarks: 0,
    missedMarks: 0,
    availableMarks: 0,
    questionCount: 0,
    lowConfidence: 0,
    mediumConfidence: 0,
    highConfidence: 0,
    mistakeCount: 0,
    questions: [],
    mistakeSignatures: [],
    performances: new Map(),
  }
}

function normaliseQuestionLabel(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "")
}

function evidenceConfidence(questionCount: number, availableMarks: number): PaperEvidenceConfidence {
  if (questionCount >= 10 && availableMarks >= 30) return "high"
  if (questionCount >= 4 && availableMarks >= 10) return "medium"
  return "low"
}

function finishPaperCell(bucket: PaperCellBucket): PaperPerformanceCell {
  const mastery = bucket.availableMarks ? bucket.earnedMarks / bucket.availableMarks * 100 : null
  const confidenceRisk = bucket.questionCount
    ? (bucket.lowConfidence + bucket.mediumConfidence * 0.5) / bucket.questionCount * 100
    : 0
  const signatureCounts = new Map<string, number>()
  for (const signature of bucket.mistakeSignatures) signatureCounts.set(signature, (signatureCounts.get(signature) ?? 0) + 1)
  const repeatMistakes = [...signatureCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0)
  const performances = [...bucket.performances.values()].toSorted((first, second) => first.completedAt.localeCompare(second.completedAt))
  let trendPoints: number | null = null
  if (performances.length >= 2) {
    const split = Math.ceil(performances.length / 2)
    const prior = performances.slice(0, split)
    const recent = performances.slice(split)
    const percentage = (values: typeof performances) => {
      const available = values.reduce((total, value) => total + value.available, 0)
      return available ? values.reduce((total, value) => total + value.earned, 0) / available * 100 : 0
    }
    trendPoints = percentage(recent) - percentage(prior)
  }
  const trend: PaperTrend = trendPoints === null
    ? "insufficient"
    : trendPoints >= 3
      ? "improving"
      : trendPoints <= -3
        ? "deteriorating"
        : "flat"
  return {
    paper: bucket.paper,
    mastery,
    earnedMarks: bucket.earnedMarks,
    missedMarks: bucket.missedMarks,
    availableMarks: bucket.availableMarks,
    questionCount: bucket.questionCount,
    lowConfidence: bucket.lowConfidence,
    mediumConfidence: bucket.mediumConfidence,
    highConfidence: bucket.highConfidence,
    confidenceRisk,
    evidenceConfidence: evidenceConfidence(bucket.questionCount, bucket.availableMarks),
    mistakeCount: bucket.mistakeCount,
    repeatMistakes,
    trendPoints,
    trend,
    questions: bucket.questions.toSorted((first, second) => second.completedAt.localeCompare(first.completedAt) || first.question.localeCompare(second.question)),
  }
}

function diagnosePaperGap(exam1: PaperPerformanceCell, exam2: PaperPerformanceCell): PaperWeaknessDiagnosis {
  if (exam1.mastery === null || exam2.mastery === null) return "insufficient evidence"
  if (exam1.mastery < 85 && exam2.mastery < 85) return "general weakness"
  const gap = exam2.mastery - exam1.mastery
  if (gap >= 5) return "tech-free fragile"
  if (gap <= -5) return "tech-active fragile"
  if (exam1.mastery >= 85 && exam2.mastery >= 85) return "secure"
  return "stable"
}

export function buildPaperWeaknessMatrix(attempts: ExamAttempt[], mistakes: Mistake[], subject: string): PaperWeaknessRow[] {
  const subjectAttempts = attempts.filter((attempt) => attempt.subject === subject && isTechSplitMathsSubject(attempt.subject))
  const attemptMap = new Map(subjectAttempts.map((attempt) => [attempt.id, attempt]))
  const buckets = new Map<string, { exam1: PaperCellBucket; exam2: PaperCellBucket }>()
  const questionIndex = new Map<string, PaperQuestionEvidence>()

  for (const attempt of subjectAttempts) {
    const paper = getMathsExamPaper(attempt.paper)
    if (!paper) continue
    for (const result of attempt.questionResults ?? []) {
      const areaOfStudy = result.areaOfStudy?.trim()
      if (!areaOfStudy) continue
      const row = buckets.get(areaOfStudy) ?? { exam1: emptyPaperCell(1), exam2: emptyPaperCell(2) }
      const bucket = paper === 1 ? row.exam1 : row.exam2
      const missedMarks = Math.max(0, result.maxMarks - result.marksAwarded)
      bucket.earnedMarks += result.marksAwarded
      bucket.missedMarks += missedMarks
      bucket.availableMarks += result.maxMarks
      bucket.questionCount += 1
      if (result.confidence === "low") bucket.lowConfidence += 1
      else if (result.confidence === "medium") bucket.mediumConfidence += 1
      else bucket.highConfidence += 1
      const performance = bucket.performances.get(attempt.id) ?? { completedAt: attempt.completedAt, earned: 0, available: 0 }
      performance.earned += result.marksAwarded
      performance.available += result.maxMarks
      bucket.performances.set(attempt.id, performance)
      const evidence: PaperQuestionEvidence = {
        attemptId: attempt.id,
        attemptTitle: attempt.title,
        provider: attempt.provider,
        examYear: attempt.examYear,
        completedAt: attempt.completedAt,
        question: result.label,
        earnedMarks: result.marksAwarded,
        availableMarks: result.maxMarks,
        missedMarks,
        confidence: result.confidence,
        mistakeCategories: [],
      }
      bucket.questions.push(evidence)
      questionIndex.set(`${attempt.id}\u0000${normaliseQuestionLabel(result.label)}`, evidence)
      buckets.set(areaOfStudy, row)
    }
  }

  for (const mistake of mistakes) {
    const attempt = attemptMap.get(mistake.attemptId)
    const paper = attempt ? getMathsExamPaper(attempt.paper) : null
    const areaOfStudy = mistake.areaOfStudy?.trim()
    if (!attempt || !paper || !areaOfStudy || mistake.suspended) continue
    const row = buckets.get(areaOfStudy) ?? { exam1: emptyPaperCell(1), exam2: emptyPaperCell(2) }
    const bucket = paper === 1 ? row.exam1 : row.exam2
    bucket.mistakeCount += 1
    const signature = (mistake.criterion?.trim() || mistake.category).toLowerCase()
    bucket.mistakeSignatures.push(signature)
    const evidence = questionIndex.get(`${attempt.id}\u0000${normaliseQuestionLabel(mistake.question)}`)
    if (evidence && !evidence.mistakeCategories.includes(mistake.category)) evidence.mistakeCategories.push(mistake.category)
    buckets.set(areaOfStudy, row)
  }

  return [...buckets.entries()].map(([areaOfStudy, bucketsForArea]) => {
    const exam1 = finishPaperCell(bucketsForArea.exam1)
    const exam2 = finishPaperCell(bucketsForArea.exam2)
    return {
      areaOfStudy,
      exam1,
      exam2,
      gap: exam1.mastery === null || exam2.mastery === null ? null : exam2.mastery - exam1.mastery,
      diagnosis: diagnosePaperGap(exam1, exam2),
    }
  }).toSorted((first, second) => {
    const firstRisk = first.gap === null ? -1 : Math.abs(first.gap)
    const secondRisk = second.gap === null ? -1 : Math.abs(second.gap)
    return secondRisk - firstRisk || first.areaOfStudy.localeCompare(second.areaOfStudy)
  })
}

export type LostMarksCategory = {
  category: string
  marks: number
  exam1: number
  exam2: number
  other: number
}

export type LostMarksAttribution = {
  subject: string
  attemptCount: number
  totalLost: number
  attributedMarks: number
  unattributedMarks: number
  categories: LostMarksCategory[]
}

export function buildLostMarksAttribution(attempts: ExamAttempt[], mistakes: Mistake[], subject: string, limit = 10): LostMarksAttribution {
  const recentAttempts = attempts
    .filter((attempt) => attempt.subject === subject)
    .toSorted((first, second) => second.completedAt.localeCompare(first.completedAt))
    .slice(0, limit)
  const attemptMap = new Map(recentAttempts.map((attempt) => [attempt.id, attempt]))
  const mistakesByQuestion = new Map<string, Mistake[]>()
  for (const mistake of mistakes) {
    if (!attemptMap.has(mistake.attemptId) || mistake.suspended) continue
    const key = `${mistake.attemptId}\u0000${normaliseQuestionLabel(mistake.question)}`
    mistakesByQuestion.set(key, [...(mistakesByQuestion.get(key) ?? []), mistake])
  }
  const questionLoss = new Map<string, number>()
  for (const attempt of recentAttempts) {
    for (const result of attempt.questionResults ?? []) {
      questionLoss.set(`${attempt.id}\u0000${normaliseQuestionLabel(result.label)}`, Math.max(0, result.maxMarks - result.marksAwarded))
    }
  }
  const categories = new Map<string, LostMarksCategory>()
  let attributedMarks = 0
  const attributedByPaper = { exam1: 0, exam2: 0, other: 0 }
  for (const [key, relatedMistakes] of mistakesByQuestion) {
    const fallbackShare = (questionLoss.get(key) ?? 0) / relatedMistakes.length
    for (const mistake of relatedMistakes) {
      const marks = Math.max(0, mistake.marksLost ?? fallbackShare)
      if (!marks) continue
      const attempt = attemptMap.get(mistake.attemptId)!
      const paper = getMathsExamPaper(attempt.paper)
      const row = categories.get(mistake.category) ?? { category: mistake.category, marks: 0, exam1: 0, exam2: 0, other: 0 }
      row.marks += marks
      if (paper === 1) {
        row.exam1 += marks
        attributedByPaper.exam1 += marks
      } else if (paper === 2) {
        row.exam2 += marks
        attributedByPaper.exam2 += marks
      } else {
        row.other += marks
        attributedByPaper.other += marks
      }
      attributedMarks += marks
      categories.set(mistake.category, row)
    }
  }
  const totalLost = recentAttempts.reduce((total, attempt) => total + Math.max(0, attempt.rawMax - attempt.rawScore), 0)
  const rawLossByPaper = recentAttempts.reduce((total, attempt) => {
    const lost = Math.max(0, attempt.rawMax - attempt.rawScore)
    const paper = getMathsExamPaper(attempt.paper)
    if (paper === 1) total.exam1 += lost
    else if (paper === 2) total.exam2 += lost
    else total.other += lost
    return total
  }, { exam1: 0, exam2: 0, other: 0 })
  const unattributed = {
    exam1: Math.max(0, rawLossByPaper.exam1 - attributedByPaper.exam1),
    exam2: Math.max(0, rawLossByPaper.exam2 - attributedByPaper.exam2),
    other: Math.max(0, rawLossByPaper.other - attributedByPaper.other),
  }
  const unattributedMarks = unattributed.exam1 + unattributed.exam2 + unattributed.other
  if (unattributedMarks > 0) categories.set("Unattributed", { category: "Unattributed", marks: unattributedMarks, ...unattributed })
  return {
    subject,
    attemptCount: recentAttempts.length,
    totalLost: Math.max(totalLost, attributedMarks),
    attributedMarks,
    unattributedMarks,
    categories: [...categories.values()].toSorted((first, second) => second.marks - first.marks || first.category.localeCompare(second.category)),
  }
}

export type ReviewForecastDay = {
  date: string
  label: string
  due: number
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatLocalDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function buildReviewForecast(mistakes: Mistake[], now = new Date(), days = 14): ReviewForecastDay[] {
  const start = startOfLocalDay(now)
  const result = Array.from({ length: days }, (_, index) => {
    const date = new Date(start.getTime() + index * DAY_MS)
    return {
      date: formatLocalDate(date),
      label: index === 0 ? "Today" : date.toLocaleDateString("en-AU", { day: "numeric", month: "short" }),
      due: 0,
    }
  })
  if (!result.length) return result

  for (const mistake of mistakes) {
    if (mistake.suspended) continue
    const dueAt = new Date(getMistakeSchedule(mistake).dueAt)
    const dueDay = startOfLocalDay(dueAt)
    const index = Math.floor((dueDay.getTime() - start.getTime()) / DAY_MS)
    if (index < 0) result[0].due += 1
    else if (index < result.length) result[index].due += 1
  }
  return result
}
