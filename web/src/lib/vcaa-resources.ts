import { normaliseComparisonName, type AssessmentReference, type ExamAttempt } from "@/lib/exam-data"

const VCAA_EXAM_RESOURCES = "https://www.vcaa.vic.edu.au/assessment/vce/examination-specifications-past-examinations-and-examination-reports/examination-specifications-past-examinations-and-external-assessment-reports"

export function getVcaaExamResourcesUrl() {
  return VCAA_EXAM_RESOURCES
}

export function formatReferenceFreshness(generatedAt?: string | null) {
  if (!generatedAt) return "Reference update date unavailable"
  return `Official resources updated ${new Date(generatedAt).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}`
}

export type VcaaResourceKind = "specification" | "exam" | "report" | "sample" | "other"

export type VcaaResource = {
  label: string
  url: string
  kind: VcaaResourceKind
  year: number | null
}

export type VcaaStudyResources = {
  studyName: string
  pageUrl: string
  resources: VcaaResource[]
}

export type VcaaExamResource = VcaaResource & Pick<VcaaStudyResources, "studyName" | "pageUrl">

export type VcaaExamCompanions = {
  reports: VcaaResource[]
  specification?: VcaaResource
  sample?: VcaaResource
}

function getResourcePaperNumber(resource: Pick<VcaaResource, "label">): number | null {
  const label = resource.label.toLowerCase()
  const number = label.match(/\b(?:exam(?:ination)?|paper)\s*([1-9])\b/)?.[1] ??
    label.match(/\b([1-9])\s+(?:exam(?:ination)?|paper)\b/)?.[1] ??
    label.match(/\b([1-9])\s+(?:external assessment report|assessment guide)\b/)?.[1]
  return number ? Number(number) : null
}

function isExamDocument(resource: VcaaResource) {
  return resource.kind === "exam" && !/\btranscript\b/i.test(resource.label)
}

function getResourceStudyName(resource: VcaaResource, study: VcaaStudyResources) {
  if (!/\bnht\b/i.test(study.studyName)) return study.studyName
  return resource.label.match(/^\d{4}\s+(?:VCE\s+)?(.+?)\s+(?:written\s+)?exam(?:ination)?(?:\s+[1-9])?$/i)?.[1]?.trim() ?? study.studyName
}

export function getVcaaExams(studies: VcaaStudyResources[]): VcaaExamResource[] {
  const seen = new Set<string>()
  const exams: VcaaExamResource[] = []
  for (const study of studies) {
    for (const resource of study.resources) {
      if (!isExamDocument(resource)) continue
      const exam = { ...resource, studyName: getResourceStudyName(resource, study), pageUrl: study.pageUrl }
      const key = `${exam.url}|${exam.label}`
      if (seen.has(key)) continue
      seen.add(key)
      exams.push(exam)
    }
  }
  return exams
}

const vcaaExamsCache = new WeakMap<VcaaStudyResources[], VcaaExamResource[]>()

export function getCachedVcaaExams(studies: VcaaStudyResources[]): VcaaExamResource[] {
  let cached = vcaaExamsCache.get(studies)
  if (!cached) {
    cached = getVcaaExams(studies)
    vcaaExamsCache.set(studies, cached)
  }
  return cached
}

export function getVcaaExamProvider(exam: Pick<VcaaExamResource, "pageUrl" | "url">) {
  return /(?:^|[-/])nht(?:[-/]|$)/i.test(`${exam.pageUrl} ${exam.url}`) ? "VCAA NHT" : "VCAA"
}

export function getVcaaExamPaper(exam: Pick<VcaaExamResource, "label">) {
  const number = exam.label.match(/\b(?:exam(?:ination)?|paper)\s*([1-9])\b/i)?.[1] ??
    exam.label.match(/\b([1-9])\s+(?:exam(?:ination)?|paper)\b/i)?.[1]
  return number ? `Exam ${number}` : "Exam"
}

export function findVcaaExamReference(exam: VcaaExamResource, references: AssessmentReference[]) {
  if (exam.year === null) return undefined
  const paper = normaliseComparisonName(getVcaaExamPaper(exam))
  return references.find((reference) => reference.year === exam.year &&
    normaliseComparisonName(reference.studyName) === normaliseComparisonName(exam.studyName) &&
    normaliseComparisonName(reference.name) === paper)
}

export function findVcaaExamAttempt(exam: VcaaExamResource, attempts: ExamAttempt[]) {
  if (exam.year === null) return undefined
  const paper = normaliseComparisonName(getVcaaExamPaper(exam))
  const provider = normaliseComparisonName(getVcaaExamProvider(exam))
  return attempts.filter((attempt) => attempt.examYear === exam.year &&
    normaliseComparisonName(attempt.provider) === provider &&
    normaliseComparisonName(attempt.subject) === normaliseComparisonName(exam.studyName) &&
    (paper === "exam" || normaliseComparisonName(attempt.paper) === paper))
    .toSorted((first, second) => second.completedAt.localeCompare(first.completedAt) || second.updatedAt.localeCompare(first.updatedAt))[0]
}

export function isVcaaExamLogged(exam: VcaaExamResource, attempts: ExamAttempt[]) {
  return Boolean(findVcaaExamAttempt(exam, attempts))
}

function companionScore(resource: VcaaResource, exam: VcaaExamResource) {
  if (/\bnht\b/i.test(exam.pageUrl) && !normaliseComparisonName(resource.label).includes(normaliseComparisonName(exam.studyName))) return -1
  if (resource.year !== exam.year && resource.year !== null) return -1
  const examPaper = Number(getVcaaExamPaper(exam).match(/\d+/)?.[0]) || null
  const resourcePaper = getResourcePaperNumber(resource)
  if (examPaper !== null && resourcePaper !== null && examPaper !== resourcePaper) return -1
  let score = resource.year === exam.year ? 20 : resource.year === null ? 8 : 0
  if (examPaper !== null && resourcePaper === examPaper) score += 10
  if (examPaper === null && resourcePaper === null) score += 5
  if (/assessment guide/i.test(resource.label)) score += 2
  return score
}

function pickCompanion(resources: VcaaResource[], exam: VcaaExamResource, kind: VcaaResourceKind) {
  return resources.filter((resource) => resource.kind === kind)
    .map((resource) => ({ resource, score: companionScore(resource, exam) }))
    .filter((candidate) => candidate.score > 0)
    .toSorted((first, second) => second.score - first.score || (second.resource.year ?? 0) - (first.resource.year ?? 0))[0]?.resource
}

/** Match the marking and preparation material that belongs with one official paper. */
export function getVcaaExamCompanions(exam: VcaaExamResource, study?: VcaaStudyResources): VcaaExamCompanions {
  const resources = study?.resources ?? []
  const reportCandidates = resources.filter((resource) => resource.kind === "report")
    .map((resource) => ({ resource, score: companionScore(resource, exam) }))
    .filter((candidate) => candidate.score > 0)
  const hasExactYearReport = reportCandidates.some((candidate) => candidate.resource.year === exam.year)
  const reports = reportCandidates
    .filter((candidate) => !hasExactYearReport || candidate.resource.year === exam.year)
    .toSorted((first, second) => second.score - first.score || first.resource.label.localeCompare(second.resource.label))
    .slice(0, 2)
    .map((candidate) => candidate.resource)
  return {
    reports,
    specification: pickCompanion(resources, exam, "specification"),
    sample: pickCompanion(resources, exam, "sample"),
  }
}

export function findVcaaExamForAttempt(attempt: ExamAttempt, studies: VcaaStudyResources[]) {
  const provider = normaliseComparisonName(attempt.provider)
  if (provider !== "vcaa" && provider !== "vcaa nht") return undefined
  const paper = normaliseComparisonName(attempt.paper)
  const candidates = getVcaaExams(studies).filter((exam) => exam.year === attempt.examYear &&
    normaliseComparisonName(exam.studyName) === normaliseComparisonName(attempt.subject) &&
    normaliseComparisonName(getVcaaExamProvider(exam)) === provider)
  return candidates.find((exam) => normaliseComparisonName(getVcaaExamPaper(exam)) === paper) ??
    (paper === "exam" && candidates.length === 1 ? candidates[0] : undefined)
}

const vcaaForAttemptCache = new WeakMap<VcaaStudyResources[], Map<string, VcaaExamResource | undefined>>()

function attemptVcaaKey(attempt: ExamAttempt) {
  return `${normaliseComparisonName(attempt.provider)}|${attempt.examYear}|${normaliseComparisonName(attempt.subject)}|${normaliseComparisonName(attempt.paper)}`
}

export function findCachedVcaaExamForAttempt(attempt: ExamAttempt, studies: VcaaStudyResources[]) {
  let bucket = vcaaForAttemptCache.get(studies)
  if (!bucket) {
    bucket = new Map()
    vcaaForAttemptCache.set(studies, bucket)
  }
  const key = attemptVcaaKey(attempt)
  if (bucket.has(key)) return bucket.get(key)
  const result = findVcaaExamForAttempt(attempt, studies)
  bucket.set(key, result)
  if (bucket.size > 2000) bucket.clear()
  return result
}
