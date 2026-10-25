import {
  analyseAttempt,
  findAttemptReferenceById,
  normaliseComparisonName,
  validateAttempt,
  type AssessmentReference,
  type ExamAttempt,
} from "./exam-data.js"
import { normaliseScalingStudyName } from "./scaling.js"
import { paperTypeOf, parsePaperType } from "./paper-types.js"

type StudyScoreEvidence = {
  attempt: ExamAttempt
  percentile: number
  weight: number
  referenceYear: number
  exactReferenceYear: boolean
  paper: 1 | 2 | null
}

type StudyScoreComponent = {
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
function inverseNormalCdf(probability: number): number {
  // Published grade bands cannot resolve the extreme tails beyond 0.1% precision.
  const p = clamp(probability, 0.001, 0.999)
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

function normalPercentile(z: number): number {
  const x = Math.abs(z)
  const t = 1 / (1 + 0.2316419 * x)
  const tail = Math.exp(-x * x / 2) / Math.sqrt(2 * Math.PI) * t *
    (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))))
  return clamp((z >= 0 ? 1 - tail : tail) * 100, 0, 100)
}

// Moderation maps a school SAC rank onto that school's exam results, so the
// school's median study score shifts the student's within-school position.
// shortcut: assumes the school's spread matches the state's; use school score spread if it becomes available.
export function sacPercentileFromRank(rank: number, cohortSize: number, schoolMedianStudyScore = 30): number | null {
  if (!Number.isInteger(rank) || !Number.isInteger(cohortSize) || rank < 1 || rank > cohortSize) return null
  const withinSchool = (cohortSize - rank + 0.5) / cohortSize
  return clamp(normalPercentile((schoolMedianStudyScore - 30) / 7 + inverseNormalCdf(withinSchool)), 0.1, 99.9)
}

export function defaultExamWeight(subject: string): number {
  const name = normaliseScalingStudyName(subject)
  if (isTwoPaperMathematics(subject) || name === "algorithmics hess") return 60
  if (["agricultural and horticultural studies", "food studies", "foundation mathematics", "media"].includes(name)) return 40
  if (["art creative practice", "art making and exhibiting", "product design and technologies", "systems engineering"].includes(name)) return 30
  return 50
}

export function isTwoPaperMathematics(subject: string) {
  return /^(general mathematics|mathematical methods|specialist mathematics)$/.test(normaliseScalingStudyName(subject))
}

function paperNumber(paper: string): 1 | 2 | null {
  const type = parsePaperType(paper)
  return type === "exam1" ? 1 : type === "exam2" ? 2 : null
}

function sameStudy(first: string, second: string) {
  return normaliseScalingStudyName(first) === normaliseScalingStudyName(second)
}

function compatibleReferences(attempt: ExamAttempt, references: AssessmentReference[], distributionYear?: number | null) {
  const subjectReferences = references.filter((reference) => sameStudy(reference.studyName, attempt.subject))
  const availableReferences = distributionYear == null
    ? subjectReferences
    : subjectReferences.filter((reference) => reference.year === distributionYear)

  const explicitlyLinked = findAttemptReferenceById(availableReferences, attempt.referenceId)
  const type = paperTypeOf(attempt)
  const twoPapers = isTwoPaperMathematics(attempt.subject)
  if (type === "combined" && twoPapers) return []
  const number = type === "exam1" ? 1 : type === "exam2" ? 2 : null
  if (explicitlyLinked && (!twoPapers || number === null || paperNumber(explicitlyLinked.name) === number)) return [explicitlyLinked]

  const paper = normaliseComparisonName(attempt.paper)
  const paperMatches = availableReferences.filter(
    (reference) => normaliseComparisonName(reference.name) === paper &&
      (!twoPapers || number === null || paperNumber(reference.name) === number),
  )
  if (paperMatches.length) return paperMatches

  // Keep matching by paper number when a user-entered label contains extra
  // words (for example, "Exam 1 - calculator allowed").
  if (number !== null) {
    const numberedMatches = availableReferences.filter((reference) => paperNumber(reference.name) === number)
    if (numberedMatches.length || twoPapers) return numberedMatches
  }

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
  const z = evidence.reduce(
    (total, item) => total + inverseNormalCdf(item.percentile / 100) * item.weight,
    0,
  ) / weightTotal
  const variance = evidence.reduce(
    (total, item) => total + item.weight * (inverseNormalCdf(item.percentile / 100) - z) ** 2,
    0,
  ) / weightTotal
  const distinctPapers = new Set(evidence.map(({ attempt, paper }) =>
    JSON.stringify([normaliseComparisonName(attempt.provider), normaliseComparisonName(attempt.title), attempt.examYear, paper]),
  )).size
  const effectiveSampleSize = Math.min(distinctPapers, weightTotal ** 2 /
    evidence.reduce((total, item) => total + item.weight ** 2, 0))
  const approximationShare = evidence.reduce((total, item) => total + (item.exactReferenceYear ? 0 : item.weight), 0) / weightTotal
  // shortcut: heuristic prediction range; calibrate with paired practice/final outcomes when available.
  const uncertainty = clamp(
    Math.sqrt((0.5 ** 2 + variance) * (1 + 1 / effectiveSampleSize)) + approximationShare * 0.25,
    0.5,
    1.5,
  )
  return { z, percentile: normalPercentile(z), variance, uncertainty, effectiveSampleSize }
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
    if (validateAttempt(attempt) !== null) return []
    const reference = findStudyScoreReference(attempt, references, distributionYear)
    if (!reference) return []
    const percentile = analyseAttempt(attempt, reference).percentile
    return percentile === null || !Number.isFinite(percentile) ? [] : [{
      attempt,
      percentile,
      referenceYear: reference.year,
      exactReferenceYear: reference.year === attempt.examYear,
      paper: paperNumber(reference.name),
    }]
  })

  if (linked.length === 0) return null

  const allEvidence = weightEvidence(linked)
  const overall = summariseEvidence(allEvidence)
  let evidence = allEvidence
  let examZ = overall.z
  let combinedExamContribution = 0
  let examUncertainty = 0
  let resolvedExamWeightPercent = Number.isFinite(examWeightPercent) ? clamp(examWeightPercent, 0, 100) : defaultExamWeight(subject)
  let components: StudyScoreComponent[] = []
  let componentSummaries = [overall]

  if (isTwoPaperMathematics(subject)) {
    const general = normaliseScalingStudyName(subject) === "general mathematics"
    const definitions = [
      { number: 1 as const, label: "Exam 1", weightPercent: general ? 30 : 20 },
      { number: 2 as const, label: "Exam 2", weightPercent: general ? 30 : 40 },
    ]
    const componentEvidence = definitions.map((definition) => {
      const matched = weightEvidence(linked.filter((item) => item.paper === definition.number))
      const summary = matched.length ? summariseEvidence(matched) : overall
      return { ...definition, matched, summary }
    })
    componentSummaries = componentEvidence.map((component) => component.summary)
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
      (total, component) => total + component.summary.z * component.weightPercent / 100,
      0,
    )
    examZ = combinedExamContribution / 0.6
    examUncertainty = componentEvidence.reduce(
      (total, component) => total + (component.summary.uncertainty + (component.matched.length ? 0 : 0.35)) * component.weightPercent / 100,
      0,
    )
  } else {
    components = [{
      label: "Final examination",
      percentile: overall.percentile,
      weightPercent: resolvedExamWeightPercent,
      evidenceCount: linked.length,
      projected: false,
    }]
    combinedExamContribution = overall.z * resolvedExamWeightPercent / 100
    examUncertainty = overall.uncertainty * resolvedExamWeightPercent / 100
  }

  // Keep the point estimate centred on the student's actual weighted results.
  // Limited evidence belongs in the uncertainty range, not as a systematic
  // bias that drags strong or weak students towards the statewide median.
  const examPercentile = normalPercentile(examZ)
  const hasSac = sacPercentile != null && Number.isFinite(sacPercentile)
  const resolvedSacPercentile = !hasSac
    ? examPercentile
    : clamp(sacPercentile, 0.1, 99.9)
  const sacWeightPercent = 100 - resolvedExamWeightPercent
  // shortcut: normal scores approximate GA standardisation; replace with cohort moments and covariance when available.
  const combinedZ = combinedExamContribution + (hasSac ? inverseNormalCdf(resolvedSacPercentile / 100) : examZ) * sacWeightPercent / 100
  const combinedPercentile = normalPercentile(combinedZ)
  // Projected SACs share the exam's uncertainty; assuming independence would narrow the range artificially.
  const uncertainty = hasSac
    ? examUncertainty + 0.5 * sacWeightPercent / 100
    : (resolvedExamWeightPercent > 0 ? examUncertainty / (resolvedExamWeightPercent / 100) : overall.uncertainty) + 0.35 * sacWeightPercent / 100
  const confidence = components.some((item) => item.projected) || overall.effectiveSampleSize < 1.5
    ? "Low"
    : overall.effectiveSampleSize >= 5 && componentSummaries.every((item) => item.effectiveSampleSize >= 2 && Math.sqrt(item.variance) <= 0.6) &&
      evidence.every((item) => item.exactReferenceYear) && (hasSac || sacWeightPercent === 0)
      ? "High"
      : "Medium"

  return {
    studyScore: Math.round(clamp(30 + 7 * combinedZ, 0, 50)),
    low: Math.floor(clamp(30 + 7 * (combinedZ - uncertainty), 0, 50)),
    high: Math.ceil(clamp(30 + 7 * (combinedZ + uncertainty), 0, 50)),
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
