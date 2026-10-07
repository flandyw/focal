import { getMistakeSchedule, type ExamAttempt, type Mistake } from "./exam-data"

export type BrowserFilter = "all" | "due" | "new" | "learning" | "review" | "mature" | "suspended"
export type LibrarySort = "due" | "newest" | "oldest" | "marks" | "question"
export type LibraryFilters = {
  search: string
  browserFilter: BrowserFilter
  category: string
  topic: string
  sort: LibrarySort
  examId?: string
  provider?: string
  resolution?: "all" | "unresolved" | "resolved"
}

export function filterMistakeLibrary(mistakes: Mistake[], attemptMap: Map<string, ExamAttempt>, dueIds: Set<string>, filters: LibraryFilters) {
  const { browserFilter, category, topic, sort, examId = "all", provider = "all", resolution = "all" } = filters
  const terms = filters.search.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  return mistakes.map((mistake) => ({ mistake, schedule: getMistakeSchedule(mistake) }))
    .filter(({ mistake, schedule }) => {
      const attempt = attemptMap.get(mistake.attemptId)
      if (category !== "all" && mistake.category !== category) return false
      if (topic !== "all" && mistake.areaOfStudy !== topic) return false
      if (examId !== "all" && (examId === "unlinked" ? Boolean(attempt) : mistake.attemptId !== examId)) return false
      if (provider !== "all" && attempt?.provider !== provider) return false
      if (resolution !== "all" && schedule.resolved !== (resolution === "resolved")) return false
      if (browserFilter === "suspended" && !mistake.suspended) return false
      if (browserFilter !== "all" && browserFilter !== "suspended") {
        if (mistake.suspended) return false
        if (browserFilter === "due" && !dueIds.has(mistake.id)) return false
        if (browserFilter === "mature" && !schedule.resolved) return false
        if (browserFilter === "learning" && schedule.state !== "learning" && schedule.state !== "relearning") return false
        if ((browserFilter === "new" || browserFilter === "review") && schedule.state !== browserFilter) return false
      }
      const text = [mistake.question, mistake.questionText, mistake.explanation, mistake.correction, mistake.category, mistake.areaOfStudy, attempt?.title, attempt?.subject, attempt?.provider, attempt?.paper].filter(Boolean).join(" ").toLocaleLowerCase()
      return terms.every((term) => text.includes(term))
    })
    .sort((first, second) => {
      let difference: number
      switch (sort) {
        case "newest": difference = Date.parse(second.mistake.createdAt) - Date.parse(first.mistake.createdAt); break
        case "oldest": difference = Date.parse(first.mistake.createdAt) - Date.parse(second.mistake.createdAt); break
        case "marks": difference = (second.mistake.marksLost ?? 0) - (first.mistake.marksLost ?? 0); break
        case "question": difference = first.mistake.question.localeCompare(second.mistake.question, undefined, { numeric: true }); break
        default: difference = Date.parse(first.schedule.dueAt) - Date.parse(second.schedule.dueAt)
      }
      return difference || first.mistake.id.localeCompare(second.mistake.id)
    })
    .map(({ mistake }) => mistake)
}
