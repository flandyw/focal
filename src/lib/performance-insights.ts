import { getMistakeSchedule, localDayDifference, type ExamAttempt, type Mistake, type QuestionResult } from "./exam-data.js"
import { getAttemptPerformance, type ExamDifficultySettings } from "./exam-difficulty.js"
import type { CurriculumArea } from "./learning-workspace"
import { getAttemptMathsPaper, isTechSplitMathsSubject } from "./mistake-filters.js"
import { expectedRawMax, paperTypeOf, rawMaxWarning, trustedRawMax } from "./paper-types.js"
import { inferTopic, topicConfigFor, topicOfMistake, type SubjectTopics } from "./topics.js"

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
    const bucket = grouped.get(attempt.subject) ?? []
    bucket.push(attempt)
    grouped.set(attempt.subject, bucket)
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

type PaperEvidenceConfidence = "low" | "medium" | "high"
type PaperTrend = "improving" | "flat" | "deteriorating" | "insufficient"

type PaperQuestionEvidence = {
  attemptId: string
  attemptTitle: string
  provider: string
  examYear: number
  completedAt: string
  question: string
  earnedMarks: number
  availableMarks: number
  missedMarks: number
  /** Null for evidence taken from a logged mistake, which does not record confidence. */
  confidence: "low" | "medium" | "high" | null
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
  /** Sum of `marksLost` on the logged mistake cards for this topic and paper (suspended cards excluded). */
  marksLost: number
  /** Cards here with no `marksLost`, so their loss is invisible in `marksLost`. */
  cardsWithoutMarks: number
  /** The category that lost the most marks (most cards when no card has marks). */
  dominantCategory: string | null
  /** The split of this paper's mistake cards by category, biggest loss first. */
  lostByCategory: Array<{ category: string; marks: number; cards: number }>
  /** Marks lost to this area per 100 marks of this paper sat (mistake-based rows only). */
  lostPer100: number | null
  trendPoints: number | null
  trend: PaperTrend
  questions: PaperQuestionEvidence[]
}

/**
 * Marked-question rows (basis "results") read: tech-free fragile, tech-active fragile, general weakness, secure, stable.
 * Mistake rows (basis "mistakes") read: the "gap"/"weakness" states below, or "mistake-only evidence" while there is too little to call.
 * "-only gap" means the loss is on that paper alone or at least `dominanceRatio` times heavier there (per 100 marks).
 */
export type PaperWeaknessDiagnosis =
  | "tech-free fragile" | "tech-active fragile" | "general weakness" | "secure" | "stable"
  | "mistake-only evidence" | "exam-1-only gap" | "exam-2-only gap" | "shared weakness" | "no evidence"

export const WEAKNESS_THRESHOLDS = {
  /** Cards on a topic, both papers together, before a gap is called; fewer is "mistake-only evidence". */
  minCards: 3,
  /** Marks lost on one paper before that paper counts as having a gap. */
  minMarksLostPerPaper: 2,
  /** When both papers have a gap, one this many times heavier (per 100 marks) is called the "-only gap". */
  dominanceRatio: 3,
  /** Marked-question mastery under this is weak. */
  weakMasteryPercent: 85,
  /** Mastery difference between papers, in points, before it is a technology gap. */
  masteryGapPoints: 5,
} as const

export type PaperWeaknessRow = {
  /** The row's label: a canonical topic when `groupBy` is "topic", else the free-text area of study. */
  areaOfStudy: string
  groupBy: MatrixGrouping
  /** "results": mastery from marked questions. "mistakes": marks lost, from logged mistakes. */
  basis: "results" | "mistakes"
  exam1: PaperPerformanceCell
  exam2: PaperPerformanceCell
  gap: number | null
  diagnosis: PaperWeaknessDiagnosis
}

type PaperCellBucket = Omit<PaperPerformanceCell, "mastery" | "confidenceRisk" | "evidenceConfidence" | "repeatMistakes" | "lostPer100" | "trendPoints" | "trend" | "dominantCategory" | "lostByCategory"> & {
  mistakeSignatures: string[]
  categoryTally: Map<string, { marks: number; cards: number }>
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
    marksLost: 0,
    cardsWithoutMarks: 0,
    questions: [],
    mistakeSignatures: [],
    categoryTally: new Map(),
    performances: new Map(),
  }
}

function tallyCard(bucket: PaperCellBucket, mistake: Mistake) {
  const marks = mistake.marksLost ?? 0
  bucket.mistakeCount += 1
  bucket.marksLost += marks
  if (mistake.marksLost === undefined) bucket.cardsWithoutMarks += 1
  bucket.mistakeSignatures.push(mistake.category.toLowerCase())
  const tally = bucket.categoryTally.get(mistake.category) ?? { marks: 0, cards: 0 }
  tally.marks += marks
  tally.cards += 1
  bucket.categoryTally.set(mistake.category, tally)
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
  const lostByCategory = [...bucket.categoryTally].map(([category, tally]) => ({ category, ...tally }))
    .toSorted((first, second) => second.marks - first.marks || second.cards - first.cards || first.category.localeCompare(second.category))
  return {
    paper: bucket.paper,
    mastery,
    marksLost: bucket.marksLost,
    cardsWithoutMarks: bucket.cardsWithoutMarks,
    dominantCategory: lostByCategory[0]?.category ?? null,
    lostByCategory,
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
    lostPer100: null,
    trendPoints,
    trend,
    questions: bucket.questions.toSorted((first, second) => second.completedAt.localeCompare(first.completedAt) || first.question.localeCompare(second.question)),
  }
}

function diagnosePaperGap(exam1: PaperPerformanceCell, exam2: PaperPerformanceCell): PaperWeaknessDiagnosis {
  const { weakMasteryPercent, masteryGapPoints } = WEAKNESS_THRESHOLDS
  if (exam1.mastery === null && exam2.mastery === null) return exam1.mistakeCount + exam2.mistakeCount ? "mistake-only evidence" : "no evidence"
  if (exam1.mastery === null || exam2.mastery === null) {
    if ((exam1.mastery ?? exam2.mastery!) >= weakMasteryPercent) return "stable"
    return exam1.mastery === null ? "exam-2-only gap" : "exam-1-only gap"
  }
  if (exam1.mastery < weakMasteryPercent && exam2.mastery < weakMasteryPercent) return "general weakness"
  const gap = exam2.mastery - exam1.mastery
  if (gap >= masteryGapPoints) return "tech-free fragile"
  if (gap <= -masteryGapPoints) return "tech-active fragile"
  if (exam1.mastery >= weakMasteryPercent && exam2.mastery >= weakMasteryPercent) return "secure"
  return "stable"
}

export type MatrixGrouping = "topic" | "areaOfStudy"

/** Rows are canonical topics when the subject has a topic list (see `topics.ts`), else the free-text area of study. */
export function buildPaperWeaknessMatrix(attempts: ExamAttempt[], mistakes: Mistake[], subject: string, curriculumAreas: CurriculumArea[] = [], groupBy: MatrixGrouping = "topic"): PaperWeaknessRow[] {
  const config = groupBy === "topic" ? topicConfigFor(subject) : undefined
  const subjectAttempts = attempts.filter((attempt) => attempt.subject === subject && isTechSplitMathsSubject(attempt.subject))
  const attemptMap = new Map(subjectAttempts.map((attempt) => [attempt.id, attempt]))
  const buckets: PaperBuckets = new Map()
  const questionIndex = new Map<string, PaperQuestionEvidence>()
  addEmptyTopics(buckets, config)

  for (const attempt of subjectAttempts) {
    const paper = getAttemptMathsPaper(attempt)
    if (!paper) continue
    for (const result of attempt.questionResults ?? []) {
      const areaOfStudy = config ? topicOfResult(config, result) : result.areaOfStudy?.trim()
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
    const paper = attempt ? getAttemptMathsPaper(attempt) : null
    const areaOfStudy = config ? topicOfMistake(config, mistake) : mistake.areaOfStudy?.trim()
    if (!attempt || !paper || !areaOfStudy || mistake.suspended) continue
    const row = buckets.get(areaOfStudy) ?? { exam1: emptyPaperCell(1), exam2: emptyPaperCell(2) }
    const bucket = paper === 1 ? row.exam1 : row.exam2
    tallyCard(bucket, mistake)
    const evidence = questionIndex.get(`${attempt.id}\u0000${normaliseQuestionLabel(mistake.question)}`)
    if (evidence && !evidence.mistakeCategories.includes(mistake.category)) evidence.mistakeCategories.push(mistake.category)
    buckets.set(areaOfStudy, row)
  }

  const rows = [...buckets.entries()].map(([areaOfStudy, bucketsForArea]) => {
    const exam1 = finishPaperCell(bucketsForArea.exam1)
    const exam2 = finishPaperCell(bucketsForArea.exam2)
    return {
      areaOfStudy,
      groupBy: config ? "topic" as const : "areaOfStudy" as const,
      basis: "results" as const,
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
  // Mastery needs marked questions on both papers. Without that, the logged mistakes
  // (which already name the paper, the marks lost and the skill) are the better evidence.
  const hasComparableResults = rows.some((row) => row.exam1.mastery !== null && row.exam2.mastery !== null)
  return hasComparableResults ? rows : buildMistakeWeaknessMatrix(subjectAttempts, mistakes, curriculumAreas, config)
}

type PaperBuckets = Map<string, { exam1: PaperCellBucket; exam2: PaperCellBucket }>

/** Every topic gets a row, so a topic with nothing logged reads as "no evidence" instead of vanishing. */
function addEmptyTopics(buckets: PaperBuckets, config: SubjectTopics | undefined) {
  for (const topic of config?.topics ?? []) if (topic !== config!.fallback) buckets.set(topic, { exam1: emptyPaperCell(1), exam2: emptyPaperCell(2) })
}

function topicOfResult(config: SubjectTopics, result: QuestionResult) {
  const stored = result.topic && config.topics.find((name) => name.toLowerCase() === result.topic!.trim().toLowerCase())
  return stored || inferTopic(config, [result.areaOfStudy, result.label].filter(Boolean).join(" ")).topic
}

/** "Units 3 & 4 AOS 2 – Algebra (laws and solving equations)" -> "AOS 2 – Algebra". */
function areaOfStudyHeading(group: string) {
  return group.replace(/\s*\([^)]*\)\s*$/, "").replace(/^Units?\s+[\d\s&]+(?=AOS)/i, "").trim()
}

function diagnoseMistakeLoss(exam1: PaperPerformanceCell, exam2: PaperPerformanceCell): PaperWeaknessDiagnosis {
  const { minCards, minMarksLostPerPaper, dominanceRatio } = WEAKNESS_THRESHOLDS
  const cards = exam1.mistakeCount + exam2.mistakeCount
  if (cards === 0) return "no evidence"
  const gap1 = exam1.marksLost >= minMarksLostPerPaper
  const gap2 = exam2.marksLost >= minMarksLostPerPaper
  if (cards < minCards || !gap1 && !gap2) return "mistake-only evidence"
  if (gap1 && gap2) {
    const rate1 = exam1.lostPer100 ?? 0
    const rate2 = exam2.lostPer100 ?? 0
    if (rate1 > 0 && rate1 >= rate2 * dominanceRatio) return "exam-1-only gap"
    if (rate2 > 0 && rate2 >= rate1 * dominanceRatio) return "exam-2-only gap"
    return "shared weakness"
  }
  return gap1 ? "exam-1-only gap" : "exam-2-only gap"
}

function buildMistakeWeaknessMatrix(subjectAttempts: ExamAttempt[], mistakes: Mistake[], curriculumAreas: CurriculumArea[], config?: SubjectTopics): PaperWeaknessRow[] {
  const attemptMap = new Map(subjectAttempts.map((attempt) => [attempt.id, attempt]))
  const groupByItem = new Map(curriculumAreas.filter((item) => item.group).map((item) => [item.id, areaOfStudyHeading(item.group!)]))
  const paperMarks = { 1: 0, 2: 0 }
  for (const attempt of subjectAttempts) {
    const paper = getAttemptMathsPaper(attempt)
    if (paper) paperMarks[paper] += trustedRawMax(attempt)
  }
  const buckets: PaperBuckets = new Map()
  addEmptyTopics(buckets, config)
  for (const mistake of mistakes) {
    const attempt = attemptMap.get(mistake.attemptId)
    const paper = attempt ? getAttemptMathsPaper(attempt) : null
    if (!attempt || !paper || mistake.suspended) continue
    const areaOfStudy = config ? topicOfMistake(config, mistake) : mistake.itemIds?.map((id) => groupByItem.get(id)).find(Boolean) ?? mistake.areaOfStudy?.trim()
    if (!areaOfStudy) continue
    const row = buckets.get(areaOfStudy) ?? { exam1: emptyPaperCell(1), exam2: emptyPaperCell(2) }
    const bucket = paper === 1 ? row.exam1 : row.exam2
    const lost = mistake.marksLost ?? 0
    bucket.missedMarks += lost
    bucket.questionCount += 1
    tallyCard(bucket, mistake)
    bucket.questions.push({
      attemptId: attempt.id,
      attemptTitle: attempt.title,
      provider: attempt.provider,
      examYear: attempt.examYear,
      completedAt: attempt.completedAt,
      question: mistake.question,
      earnedMarks: Math.max(0, (mistake.totalMarks ?? lost) - lost),
      availableMarks: mistake.totalMarks ?? lost,
      missedMarks: lost,
      confidence: null,
      mistakeCategories: [mistake.category],
    })
    buckets.set(areaOfStudy, row)
  }
  const finish = (bucket: PaperCellBucket): PaperPerformanceCell => {
    const base = finishPaperCell(bucket)
    const marks = paperMarks[bucket.paper]
    return {
      ...base,
      availableMarks: marks,
      lostPer100: marks ? bucket.missedMarks / marks * 100 : null,
      evidenceConfidence: bucket.mistakeCount >= 6 ? "high" : bucket.mistakeCount >= 3 ? "medium" : "low",
    }
  }
  return [...buckets.entries()].map(([areaOfStudy, row]) => {
    const exam1 = finish(row.exam1)
    const exam2 = finish(row.exam2)
    return {
      areaOfStudy,
      groupBy: config ? "topic" as const : "areaOfStudy" as const,
      basis: "mistakes" as const,
      exam1,
      exam2,
      gap: exam1.lostPer100 === null || exam2.lostPer100 === null ? null : exam2.lostPer100 - exam1.lostPer100,
      diagnosis: diagnoseMistakeLoss(exam1, exam2),
    }
  }).toSorted((first, second) =>
    second.exam1.missedMarks + second.exam2.missedMarks - first.exam1.missedMarks - first.exam2.missedMarks ||
    first.areaOfStudy.localeCompare(second.areaOfStudy))
}

type PaperLostMarks = { papers: number; marksLost: number; attributed: number; unattributedMarks: number }

export type PaperDataQuality = {
  attempts: number
  attemptsWithoutQuestionResults: number
  papersWithRawMaxMismatch: Array<{ id: string; title: string; paper: string; rawMax: number; expected: number[] }>
  /** Active cards on this subject's papers. */
  cards: number
  /** Cards with no stored topic (the matrix infers one for them). Null when the subject has no topic list. */
  cardsWithoutTopic: number | null
  cardsWithoutMarksLost: number
  /** Cards on a paper that is neither Exam 1 nor Exam 2 (combined, unnamed), so outside the matrix columns. */
  cardsOnOtherPapers: number
  /**
   * Per paper: marks lost on the score sheet (rawMax - rawScore) against marks the cards account for, per attempt.
   * Papers with a wrong-looking rawMax are left out: their totals cannot be trusted.
   */
  lostMarks: { exam1: PaperLostMarks; exam2: PaperLostMarks; other: PaperLostMarks }
  warnings: string[]
}

/** What the matrix is NOT seeing, so thin or odd data reads as a data problem and not as a student strength. */
export function buildPaperDataQuality(attempts: ExamAttempt[], mistakes: Mistake[], subject: string): PaperDataQuality {
  const subjectAttempts = attempts.filter((attempt) => attempt.subject === subject)
  const attemptMap = new Map(subjectAttempts.map((attempt) => [attempt.id, attempt]))
  const cards = mistakes.filter((mistake) => attemptMap.has(mistake.attemptId) && !mistake.suspended)
  const config = topicConfigFor(subject)
  const mismatched = subjectAttempts.filter((attempt) => rawMaxWarning(attempt))
  const bad = new Set(mismatched.map((attempt) => attempt.id))
  const lostMarks = { exam1: emptyLostMarks(), exam2: emptyLostMarks(), other: emptyLostMarks() }
  for (const attempt of subjectAttempts) {
    if (bad.has(attempt.id)) continue
    const paper = getAttemptMathsPaper(attempt)
    const row = lostMarks[paper === 1 ? "exam1" : paper === 2 ? "exam2" : "other"]
    const lost = Math.max(0, attempt.rawMax - attempt.rawScore)
    const attributed = cards.filter((card) => card.attemptId === attempt.id).reduce((total, card) => total + (card.marksLost ?? 0), 0)
    row.papers += 1
    row.marksLost += lost
    row.attributed += attributed
    row.unattributedMarks += Math.max(0, lost - attributed)
  }
  const quality: PaperDataQuality = {
    attempts: subjectAttempts.length,
    attemptsWithoutQuestionResults: subjectAttempts.filter((attempt) => !attempt.questionResults?.length).length,
    papersWithRawMaxMismatch: mismatched.map((attempt) => ({
      id: attempt.id, title: attempt.title, paper: attempt.paper, rawMax: attempt.rawMax, expected: [...expectedRawMax(attempt.subject, paperTypeOf(attempt)!)!],
    })),
    cards: cards.length,
    cardsWithoutTopic: config ? cards.filter((card) => !card.topic?.trim()).length : null,
    cardsWithoutMarksLost: cards.filter((card) => card.marksLost === undefined).length,
    cardsOnOtherPapers: cards.filter((card) => !getAttemptMathsPaper(attemptMap.get(card.attemptId)!)).length,
    lostMarks,
    warnings: [],
  }
  const unattributed = lostMarks.exam1.unattributedMarks + lostMarks.exam2.unattributedMarks + lostMarks.other.unattributedMarks
  const notes: Array<[boolean, string]> = [
    [quality.attemptsWithoutQuestionResults > 0, `${quality.attemptsWithoutQuestionResults} of ${quality.attempts} papers have no question results, so mastery and trend are unavailable and the matrix is built from logged mistakes.`],
    [mismatched.length > 0, `${mismatched.length} papers have a rawMax that does not fit their paper type; fix them with save_exam (id, rawScore, rawMax, or paperType "combined"). They are left out of lostMarks.`],
    [!!quality.cardsWithoutTopic, `${quality.cardsWithoutTopic} cards have no stored topic; the matrix infers one. Run backfill_topics to store it.`],
    [quality.cardsWithoutMarksLost > 0, `${quality.cardsWithoutMarksLost} cards have no marksLost, so their loss is not counted.`],
    [quality.cardsOnOtherPapers > 0, `${quality.cardsOnOtherPapers} cards are on papers that are neither Exam 1 nor Exam 2 and sit outside the matrix columns.`],
    [unattributed > 0, `${round1(unattributed)} marks lost on score sheets have no mistake card behind them (unattributedMarks).`],
  ]
  quality.warnings = notes.filter(([on]) => on).map(([, message]) => message)
  return quality
}

const emptyLostMarks = (): PaperLostMarks => ({ papers: 0, marksLost: 0, attributed: 0, unattributedMarks: 0 })
const round1 = (value: number) => Math.round(value * 10) / 10

type LostMarksCategory = {
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
    const bucket = mistakesByQuestion.get(key) ?? []
    bucket.push(mistake)
    mistakesByQuestion.set(key, bucket)
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
      const paper = getAttemptMathsPaper(attempt)
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
    const paper = getAttemptMathsPaper(attempt)
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
    // Calendar days from the month/day, so a daylight-saving 23- or 25-hour day stays one bucket.
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index)
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
    const index = localDayDifference(dueAt, start)
    if (index < 0) result[0].due += 1
    else if (index < result.length) result[index].due += 1
  }
  return result
}
