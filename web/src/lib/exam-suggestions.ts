import {
  formatReferenceName,
  normaliseComparisonName,
  type AssessmentReference,
  type ExamAttempt,
} from "@/lib/exam-data"
import { getCachedVcaaExams, getVcaaExamPaper, type VcaaStudyResources } from "@/lib/vcaa-resources"
import {
  identifyDifficultyProvider,
  resolveDifficultySettings,
  type ExamDifficultySettings,
} from "@/lib/exam-difficulty"
import { getKnownExamMarks } from "@/lib/exam-conditions"

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

function isCompanySuggestionLogged(suggestion: ExamSuggestion, attempts: ExamAttempt[], providerOrder?: readonly string[]) {
  return attempts.some((attempt) =>
    attempt.examYear === suggestion.examYear &&
    identifyDifficultyProvider(attempt, providerOrder) === suggestion.provider &&
    normaliseComparisonName(attempt.subject) === normaliseComparisonName(suggestion.subject) &&
    normaliseComparisonName(attempt.paper) === normaliseComparisonName(suggestion.paper),
  )
}

function isLogged(suggestion: ExamSuggestion, attempts: ExamAttempt[]) {
  const subject = normaliseComparisonName(suggestion.subject)
  const paper = normaliseComparisonName(suggestion.paper)
  return attempts.some((attempt) =>
    attempt.examYear === suggestion.examYear &&
    normaliseComparisonName(attempt.provider) === "vcaa" &&
    normaliseComparisonName(attempt.subject) === subject &&
    normaliseComparisonName(attempt.paper) === paper,
  )
}

export function findLatestAttempt(attempts: ExamAttempt[]) {
  return [...attempts].toSorted((first, second) =>
    second.completedAt.localeCompare(first.completedAt) ||
    second.createdAt.localeCompare(first.createdAt),
  )[0] ?? null
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
  for (const reference of references) {
    const suggestion: ExamSuggestion = {
      subject: reference.studyName,
      provider: "VCAA",
      examYear: reference.year,
      paper: formatReferenceName(reference.name),
      marks: suggestionMarks(reference.studyName, formatReferenceName(reference.name), reference.maxScore),
    }
    const key = suggestionKey(suggestion)
    if (!unique.has(key)) unique.set(key, suggestion)
  }
  for (const exam of getCachedVcaaExams(studies)) {
    if (exam.year === null) continue
    const paper = getVcaaExamPaper(exam)
    const fallbackReference = references.find((reference) =>
      normaliseComparisonName(reference.studyName) === normaliseComparisonName(exam.studyName) &&
      normaliseComparisonName(formatReferenceName(reference.name)) === normaliseComparisonName(paper)
    )
    const suggestion: ExamSuggestion = {
      subject: exam.studyName,
      provider: "VCAA",
      examYear: exam.year,
      paper,
      marks: suggestionMarks(exam.studyName, paper, fallbackReference?.maxScore ?? 100),
    }
    const key = suggestionKey(suggestion)
    if (!unique.has(key)) unique.set(key, suggestion)
  }

  const available = [...unique.values()].filter((suggestion) => !isLogged(suggestion, attempts))
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
    ).toSorted(byYearAscending))
    add(sameSubject.filter((item) => item.examYear > latest.examYear).toSorted(byYearAscending))
    add(sameSubject.filter((item) =>
      item.examYear === latest.examYear && paperOrder(item.paper) <= latestPaperOrder
    ).toSorted(byYearAscending))
    add(sameSubject.filter((item) => item.examYear < latest.examYear).toSorted(byYearDescending))
  }

  const preferences = new Map(preferredSubjects.map((subject, index) => [normaliseComparisonName(subject), index]))
  add(available.toSorted((first, second) =>
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
  const subjectReferences = references.filter((reference) =>
    normaliseComparisonName(reference.studyName) === normaliseComparisonName(subject),
  )
  const templateYear = subjectReferences.some((reference) => reference.year === examYear)
    ? examYear
    : Math.max(...subjectReferences.map((reference) => reference.year), 0)
  const templates = new Map<string, { paper: string; marks: number }>()
  for (const reference of subjectReferences.filter((reference) => reference.year === templateYear)) {
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
  return [...templates.values()].toSorted((first, second) =>
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

  const relevantCompanyAttempts = attempts.filter((attempt) =>
    attempt.examYear === examYear &&
    normaliseComparisonName(attempt.subject) === normaliseComparisonName(subject) &&
    providers.includes(identifyDifficultyProvider(attempt, resolvedSettings.providerOrder) ?? ""),
  )
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
      if (isCompanySuggestionLogged(suggestion, attempts, resolvedSettings.providerOrder)) continue
      suggestions.push(suggestion)
      if (suggestions.length >= limit) return suggestions
    }
  }

  return suggestions
}
