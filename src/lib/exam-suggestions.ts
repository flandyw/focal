import {
  formatReferenceName,
  normaliseComparisonName,
  type AssessmentReference,
  type ExamAttempt,
} from "./exam-data.js"
import { getCachedVcaaExams, getVcaaExamPaper, type VcaaStudyResources } from "./vcaa-resources.js"
import {
  identifyDifficultyProvider,
  resolveDifficultySettings,
  type ExamDifficultySettings,
} from "./exam-difficulty.js"
import { getKnownExamMarks } from "./exam-conditions.js"

export type ExamSuggestion = {
  subject: string
  provider: string
  examYear: number
  paper: string
  marks: number
}

function paperOrder(paper: string) {
  return Number(paper.match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER)
}

function suggestionMarks(subject: string, paper: string, fallback: number) {
  return getKnownExamMarks(subject, paper) ?? fallback
}

function suggestionKey(suggestion: Pick<ExamSuggestion, "subject" | "provider" | "examYear" | "paper">) {
  return `${normaliseComparisonName(suggestion.subject)}\u0000${normaliseComparisonName(suggestion.provider)}\u0000${suggestion.examYear}\u0000${normaliseComparisonName(suggestion.paper)}`
}

export function findLatestAttempt(attempts: ExamAttempt[]) {
  let latest: ExamAttempt | null = null
  for (const attempt of attempts) {
    if (!latest || (attempt.completedAt.localeCompare(latest.completedAt) || attempt.createdAt.localeCompare(latest.createdAt)) > 0) latest = attempt
  }
  return latest
}

export function buildExamSuggestions(
  attempts: ExamAttempt[],
  references: AssessmentReference[],
  preferredSubjects: string[],
  limit = 4,
  studies: VcaaStudyResources[] = [],
): ExamSuggestion[] {
  if (limit <= 0) return []

  const unique = new Map<string, ExamSuggestion>()
  const referenceMarks = new Map<string, number>()
  for (const reference of references) {
    const paper = formatReferenceName(reference.name)
    const referenceKey = `${normaliseComparisonName(reference.studyName)}\u0000${normaliseComparisonName(paper)}`
    if (!referenceMarks.has(referenceKey)) referenceMarks.set(referenceKey, reference.maxScore)
    const suggestion: ExamSuggestion = {
      subject: reference.studyName,
      provider: "VCAA",
      examYear: reference.year,
      paper,
      marks: suggestionMarks(reference.studyName, paper, reference.maxScore),
    }
    const key = suggestionKey(suggestion)
    if (!unique.has(key)) unique.set(key, suggestion)
  }
  for (const exam of getCachedVcaaExams(studies)) {
    if (exam.year === null) continue
    const paper = getVcaaExamPaper(exam)
    const fallbackMarks = referenceMarks.get(`${normaliseComparisonName(exam.studyName)}\u0000${normaliseComparisonName(paper)}`)
    const suggestion: ExamSuggestion = {
      subject: exam.studyName,
      provider: "VCAA",
      examYear: exam.year,
      paper,
      marks: suggestionMarks(exam.studyName, paper, fallbackMarks ?? 100),
    }
    const key = suggestionKey(suggestion)
    if (!unique.has(key)) unique.set(key, suggestion)
  }

  const logged = new Set(attempts.filter((attempt) => normaliseComparisonName(attempt.provider) === "vcaa").map(suggestionKey))
  const available = [...unique.values()].filter((suggestion) => !logged.has(suggestionKey(suggestion)))
  const latest = findLatestAttempt(attempts)
  const chosen: ExamSuggestion[] = []
  const chosenKeys = new Set<string>()
  const add = (items: ExamSuggestion[]) => {
    for (const item of items) {
      if (chosen.length >= limit) return
      const key = suggestionKey(item)
      if (chosenKeys.has(key)) continue
      chosenKeys.add(key)
      chosen.push(item)
    }
  }
  const byYearAscending = (first: ExamSuggestion, second: ExamSuggestion) =>
    first.examYear - second.examYear || paperOrder(first.paper) - paperOrder(second.paper) || first.paper.localeCompare(second.paper)
  const byYearDescending = (first: ExamSuggestion, second: ExamSuggestion) =>
    second.examYear - first.examYear || paperOrder(first.paper) - paperOrder(second.paper) || first.paper.localeCompare(second.paper)

  if (latest) {
    const latestSubject = normaliseComparisonName(latest.subject)
    const sameSubject = available.filter((item) => normaliseComparisonName(item.subject) === latestSubject)
    const latestPaperOrder = paperOrder(latest.paper)
    add(sameSubject.filter((item) =>
      item.examYear === latest.examYear && paperOrder(item.paper) > latestPaperOrder
    ).sort(byYearAscending))
    add(sameSubject.filter((item) => item.examYear > latest.examYear).sort(byYearAscending))
    add(sameSubject.filter((item) =>
      item.examYear === latest.examYear && paperOrder(item.paper) <= latestPaperOrder
    ).sort(byYearAscending))
    add(sameSubject.filter((item) => item.examYear < latest.examYear).sort(byYearDescending))
  }

  if (chosen.length >= limit) return chosen

  const preferences = new Map(preferredSubjects.map((subject, index) => [normaliseComparisonName(subject), index]))
  add(available.sort((first, second) =>
    (preferences.get(normaliseComparisonName(first.subject)) ?? Number.MAX_SAFE_INTEGER) -
      (preferences.get(normaliseComparisonName(second.subject)) ?? Number.MAX_SAFE_INTEGER) ||
    byYearDescending(first, second) ||
    first.subject.localeCompare(second.subject),
  ))

  return chosen
}

function getCompanyPaperTemplates(
  subject: string,
  examYear: number,
  references: AssessmentReference[],
  latest: ExamAttempt | null,
) {
  const subjectKey = normaliseComparisonName(subject)
  const subjectReferences = references.filter((reference) =>
    normaliseComparisonName(reference.studyName) === subjectKey,
  )
  const templateYear = subjectReferences.some((reference) => reference.year === examYear)
    ? examYear
    : Math.max(...subjectReferences.map((reference) => reference.year), 0)
  const templates = new Map<string, { paper: string; marks: number }>()
  for (const reference of subjectReferences) {
    if (reference.year !== templateYear) continue
    const paper = formatReferenceName(reference.name)
    templates.set(normaliseComparisonName(paper), {
      paper,
      marks: suggestionMarks(subject, paper, reference.maxScore),
    })
  }
  if (!templates.size) {
    const latestPaperNumber = latest ? paperOrder(latest.paper) : Number.MAX_SAFE_INTEGER
    if (Number.isFinite(latestPaperNumber) && latestPaperNumber !== Number.MAX_SAFE_INTEGER) {
      templates.set("exam 1", { paper: "Exam 1", marks: suggestionMarks(subject, "Exam 1", latest?.rawMax ?? 100) })
      templates.set("exam 2", { paper: "Exam 2", marks: suggestionMarks(subject, "Exam 2", latest?.rawMax ?? 100) })
    } else {
      templates.set("exam", { paper: "Exam", marks: latest?.rawMax ?? 100 })
    }
  }
  return [...templates.values()].sort((first, second) =>
    paperOrder(first.paper) - paperOrder(second.paper) || first.paper.localeCompare(second.paper),
  )
}

export function buildCompanyExamSuggestions(
  attempts: ExamAttempt[],
  references: AssessmentReference[],
  preferredSubjects: string[],
  settings?: ExamDifficultySettings,
  limit = 4,
): ExamSuggestion[] {
  if (limit <= 0) return []
  const latest = findLatestAttempt(attempts)
  const subject = latest?.subject || preferredSubjects.find((preferred) => references.some((reference) =>
    normaliseComparisonName(reference.studyName) === normaliseComparisonName(preferred),
  )) || references[0]?.studyName
  if (!subject) return []

  const examYear = latest?.examYear ?? new Date().getFullYear()
  // Settings stores difficulty hardest -> easiest; a practice progression should
  // run in the opposite direction so students build towards the hardest papers.
  const resolvedSettings = resolveDifficultySettings(settings)
  const providers = resolvedSettings.providerOrder.filter((provider) =>
    provider !== "VCAA" && provider !== "VCAA NHT",
  ).toReversed()
  if (!providers.length) return []

  const subjectKey = normaliseComparisonName(subject)
  const providerSet = new Set(providers)
  const logged = new Set<string>()
  const relevantCompanyAttempts = attempts.filter((attempt) => {
    if (attempt.examYear !== examYear || normaliseComparisonName(attempt.subject) !== subjectKey) return false
    const provider = identifyDifficultyProvider(attempt, resolvedSettings.providerOrder)
    if (!provider || !providerSet.has(provider)) return false
    logged.add(suggestionKey({ ...attempt, provider }))
    return true
  })
  const latestCompany = findLatestAttempt(relevantCompanyAttempts)
  const latestProvider = latestCompany ? identifyDifficultyProvider(latestCompany, resolvedSettings.providerOrder) : null
  const startIndex = latestProvider ? Math.max(0, providers.indexOf(latestProvider)) : 0
  const providerSequence = [...providers.slice(startIndex), ...providers.slice(0, startIndex)]
  const papers = getCompanyPaperTemplates(subject, examYear, references, latest)
  const suggestions: ExamSuggestion[] = []

  for (const company of providerSequence) {
    const isCurrentCompany = company === latestProvider
    const latestPaperRank = isCurrentCompany && latestCompany ? paperOrder(latestCompany.paper) : -1
    for (const template of papers) {
      if (isCurrentCompany && paperOrder(template.paper) <= latestPaperRank) continue
      const suggestion: ExamSuggestion = { subject, provider: company, examYear, ...template }
      if (logged.has(suggestionKey(suggestion))) continue
      suggestions.push(suggestion)
      if (suggestions.length >= limit) return suggestions
    }
  }

  return suggestions
}
