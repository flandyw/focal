import {
  analyseAttempt,
  findAttemptReferenceById,
  normaliseComparisonName,
  type AssessmentReference,
  type ExamAttempt,
} from "@/lib/exam-data"
import { normaliseScalingStudyName } from "@/lib/scaling"

export type StudyScoreEvidence = {
  attempt: ExamAttempt
  percentile: number
  weight: number
  referenceYear: number
  exactReferenceYear: boolean
}

export type StudyScoreComponent = {
  label: string
  percentile: number
  weightPercent: number
  evidenceCount: number
  projected: boolean
}

export type StudyScorePrediction = {
  studyScore: number
  low: number
  high: number
  combinedPercentile: number
  examPercentile: number
  observedExamPercentile: number
  sacPercentile: number
  examWeightPercent: number
  confidence: "Low" | "Medium" | "High"
  evidence: StudyScoreEvidence[]
  components: StudyScoreComponent[]
  approximatedEvidenceCount: number
  excludedAttemptCount: number
}

export type StudyScoreTrendPoint = {
  attempt: ExamAttempt
  timestamp: number
  dateLabel: string
  studyScore: number
  low: number
  high: number
  evidenceCount: number
  referenceYear: number
  exactReferenceYear: boolean
}

type UnweightedEvidence = Omit<StudyScoreEvidence, "weight">

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

// Peter J. Acklam's inverse-normal approximation. It is accurate well beyond
// the precision justified by a VCE study-score estimate.
export function inverseNormalCdf(probability: number): number {
  const p = clamp(probability, 0.0001, 0.9999)
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924]
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857]
  const c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878]
  const d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742]
  const lower = 0.02425
  const upper = 1 - lower

  if (p < lower) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > upper) {
    const q = Math.sqrt(-2 * Math.log(1 - p))
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }

  const q = p - 0.5
  const r = q * q
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

export function percentileToRawStudyScore(percentile: number): number {
  return clamp(30 + 7 * inverseNormalCdf(clamp(percentile, 0.1, 99.9) / 100), 0, 50)
}

export function defaultExamWeight(subject: string): number {
  return /mathematical methods|specialist mathematics/i.test(subject) ? 60 : 50
}

function isTwoPaperMathematics(subject: string) {
  return /mathematical methods|specialist mathematics/i.test(subject)
}

function paperNumber(paper: string): 1 | 2 | null {
  const match = paper.match(/(?:exam(?:ination)?|paper)\s*([12])\b/i)
  return match?.[1] === "1" ? 1 : match?.[1] === "2" ? 2 : null
}

function sameStudy(first: string, second: string) {
  return normaliseScalingStudyName(first) === normaliseScalingStudyName(second)
}

function compatibleReferences(attempt: ExamAttempt, references: AssessmentReference[], distributionYear?: number | null) {
  const subjectReferences = references.filter((reference) => sameStudy(reference.studyName, attempt.subject))
  const availableReferences = distributionYear == null
    ? subjectReferences
    : subjectReferences.filter((reference) => reference.year === distributionYear)

  const explicitlyLinked = findAttemptReferenceById(references, attempt.referenceId)

  const paper = normaliseComparisonName(attempt.paper)
  const paperMatches = availableReferences.filter(
    (reference) => normaliseComparisonName(reference.name) === paper,
  )
  if (paperMatches.length) return paperMatches

  // Keep matching by paper number when a user-entered label contains extra
  // words (for example, "Exam 1 - calculator allowed").
  const number = paperNumber(attempt.paper)
  if (number !== null) {
    const numberedMatches = availableReferences.filter((reference) => paperNumber(reference.name) === number)
    if (numberedMatches.length) return numberedMatches
  }

  // A saved link is the most reliable fallback. This also preserves attempts
  // whose paper was recorded with a generic label such as "Exam".
  if (explicitlyLinked) return [explicitlyLinked]

  const countByYear = new Map<number, number>()
  for (const reference of availableReferences) {
    countByYear.set(reference.year, (countByYear.get(reference.year) ?? 0) + 1)
  }
  return availableReferences.filter((reference) => countByYear.get(reference.year) === 1)
}

function findStudyScoreReference(attempt: ExamAttempt, references: AssessmentReference[], distributionYear?: number | null) {
  const candidates = compatibleReferences(attempt, references, distributionYear)
  if (candidates.length === 0) return undefined

  const exact = candidates.find((reference) => reference.year === attempt.examYear)
  if (exact) return exact

  return candidates.toSorted((first, second) =>
    Math.abs(first.year - attempt.examYear) - Math.abs(second.year - attempt.examYear) ||
    second.year - first.year
  )[0]
}

function compareAttempts(first: ExamAttempt, second: ExamAttempt) {
  return first.completedAt.localeCompare(second.completedAt) ||
    first.createdAt.localeCompare(second.createdAt) ||
    first.id.localeCompare(second.id)
}

function weightEvidence(items: UnweightedEvidence[]): StudyScoreEvidence[] {
  return items
    .toSorted((first, second) => compareAttempts(first.attempt, second.attempt))
    .map((item, index) => ({
      ...item,
      weight: 0.82 ** (items.length - index - 1),
    }))
}

function summariseEvidence(evidence: StudyScoreEvidence[]) {
  const weightTotal = evidence.reduce((total, item) => total + item.weight, 0)
  const percentile = evidence.reduce(
    (total, item) => total + item.percentile * item.weight,
    0,
  ) / weightTotal
  const variance = evidence.reduce(
    (total, item) => total + item.weight * (item.percentile - percentile) ** 2,
    0,
  ) / weightTotal
  const effectiveSampleSize = weightTotal ** 2 /
    evidence.reduce((total, item) => total + item.weight ** 2, 0)
  const uncertainty = clamp(
    (12 + Math.sqrt(variance)) / Math.sqrt(effectiveSampleSize),
    3,
    18,
  )
  return { percentile, variance, uncertainty }
}

export function predictStudyScore({
  subject,
  attempts,
  references,
  sacPercentile,
  examWeightPercent = defaultExamWeight(subject),
  distributionYear,
}: {
  subject: string
  attempts: ExamAttempt[]
  references: AssessmentReference[]
  sacPercentile?: number | null
  examWeightPercent?: number
  distributionYear?: number | null
}): StudyScorePrediction | null {
  const subjectAttempts = attempts.filter((attempt) => sameStudy(attempt.subject, subject))
  const linked = subjectAttempts.flatMap((attempt) => {
    const reference = findStudyScoreReference(attempt, references, distributionYear)
    if (!reference) return []
    const percentile = analyseAttempt(attempt, reference).percentile
    return percentile === null ? [] : [{
      attempt,
      percentile,
      referenceYear: reference.year,
      exactReferenceYear: reference.year === attempt.examYear,
    }]
  })

  if (linked.length === 0) return null

  const allEvidence = weightEvidence(linked)
  const overall = summariseEvidence(allEvidence)
  let evidence = allEvidence
  let examPercentile = overall.percentile
  let combinedExamContribution = 0
  let examUncertainty = 0
  let resolvedExamWeightPercent = clamp(examWeightPercent, 0, 100)
  let components: StudyScoreComponent[] = []

  if (isTwoPaperMathematics(subject)) {
    const definitions = [
      { number: 1 as const, label: "Exam 1", weightPercent: 20 },
      { number: 2 as const, label: "Exam 2", weightPercent: 40 },
    ]
    const componentEvidence = definitions.map((definition) => {
      const matched = weightEvidence(linked.filter((item) => paperNumber(item.attempt.paper) === definition.number))
      const summary = matched.length ? summariseEvidence(matched) : overall
      return { ...definition, matched, summary }
    })
    evidence = componentEvidence.flatMap((component) => component.matched)
    if (evidence.length < linked.length) evidence = allEvidence
    components = componentEvidence.map((component) => ({
      label: component.label,
      percentile: component.summary.percentile,
      weightPercent: component.weightPercent,
      evidenceCount: component.matched.length,
      projected: component.matched.length === 0,
    }))
    resolvedExamWeightPercent = 60
    combinedExamContribution = componentEvidence.reduce(
      (total, component) => total + component.summary.percentile * component.weightPercent / 100,
      0,
    )
    examPercentile = combinedExamContribution / 0.6
    examUncertainty = Math.sqrt(componentEvidence.reduce(
      (total, component) => total + (component.summary.uncertainty * component.weightPercent / 100) ** 2,
      0,
    ))
  } else {
    components = [{
      label: "Final examination",
      percentile: overall.percentile,
      weightPercent: resolvedExamWeightPercent,
      evidenceCount: linked.length,
      projected: false,
    }]
    combinedExamContribution = overall.percentile * resolvedExamWeightPercent / 100
    examUncertainty = overall.uncertainty * resolvedExamWeightPercent / 100
  }

  // Keep the point estimate centred on the student's actual weighted results.
  // Limited evidence belongs in the uncertainty range, not as a systematic
  // bias that drags strong or weak students towards the statewide median.
  const resolvedSacPercentile = sacPercentile == null
    ? examPercentile
    : clamp(sacPercentile, 0.1, 99.9)
  const sacWeightPercent = 100 - resolvedExamWeightPercent
  const combinedPercentile = combinedExamContribution + resolvedSacPercentile * sacWeightPercent / 100
  const lowPercentile = clamp(combinedPercentile - examUncertainty, 0.1, 99.9)
  const highPercentile = clamp(combinedPercentile + examUncertainty, 0.1, 99.9)
  const confidence = linked.length >= 5 && Math.sqrt(overall.variance) <= 15 && components.every((item) => !item.projected)
    ? "High"
    : linked.length >= 2
      ? "Medium"
      : "Low"

  return {
    studyScore: Math.round(percentileToRawStudyScore(combinedPercentile)),
    low: Math.max(0, Math.floor(percentileToRawStudyScore(lowPercentile))),
    high: Math.min(50, Math.ceil(percentileToRawStudyScore(highPercentile))),
    combinedPercentile,
    examPercentile,
    observedExamPercentile: overall.percentile,
    sacPercentile: resolvedSacPercentile,
    examWeightPercent: resolvedExamWeightPercent,
    confidence,
    evidence,
    components,
    approximatedEvidenceCount: evidence.filter((item) => !item.exactReferenceYear).length,
    excludedAttemptCount: subjectAttempts.length - linked.length,
  }
}

export function buildStudyScoreTrend({
  subject,
  attempts,
  references,
  sacPercentile,
  examWeightPercent = defaultExamWeight(subject),
  distributionYear,
}: {
  subject: string
  attempts: ExamAttempt[]
  references: AssessmentReference[]
  sacPercentile?: number | null
  examWeightPercent?: number
  distributionYear?: number | null
}): StudyScoreTrendPoint[] {
  const orderedAttempts = attempts
    .filter((attempt) => sameStudy(attempt.subject, subject))
    .toSorted(compareAttempts)

  return orderedAttempts.flatMap((attempt, index) => {
    const prediction = predictStudyScore({
      subject,
      attempts: orderedAttempts.slice(0, index + 1),
      references,
      sacPercentile,
      examWeightPercent,
      distributionYear,
    })
    const evidence = prediction?.evidence.find((item) => item.attempt.id === attempt.id)
    if (!prediction || !evidence) return []

    const date = new Date(`${attempt.completedAt}T00:00:00`)
    const timestamp = date.getTime()
    return [{
      attempt,
      timestamp,
      dateLabel: Number.isFinite(timestamp)
        ? date.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
        : attempt.completedAt,
      studyScore: prediction.studyScore,
      low: prediction.low,
      high: prediction.high,
      evidenceCount: prediction.evidence.length,
      referenceYear: evidence.referenceYear,
      exactReferenceYear: evidence.exactReferenceYear,
    }]
  })
}
