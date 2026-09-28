import { getMistakeSchedule, type ExamAttempt, type Mistake } from "@/lib/exam-data"

export type BrowserFilter = "all" | "due" | "new" | "learning" | "review" | "mature" | "suspended"
export type LibraryFilters = { search: string; browserFilter: BrowserFilter; category: string; topic: string; sort: string }

export function filterMistakeLibrary(mistakes: Mistake[], attemptMap: Map<string, ExamAttempt>, dueIds: Set<string>, { search, browserFilter, category, topic, sort }: LibraryFilters) {
  const normalizedSearch = search.trim().toLocaleLowerCase()
  const schedules = new Map(mistakes.map((mistake) => [mistake.id, getMistakeSchedule(mistake)]))
  return mistakes.filter((mistake) => {
      const schedule = schedules.get(mistake.id)
      const attempt = attemptMap.get(mistake.attemptId)
      const matchesSearch = !normalizedSearch || [mistake.question, mistake.questionText, mistake.explanation, mistake.correction, mistake.areaOfStudy, mistake.criterion, attempt?.title, attempt?.subject]
        .some((value) => value?.toLocaleLowerCase().includes(normalizedSearch))
      if (!matchesSearch || !schedule || (category !== "all" && mistake.category !== category) || (topic !== "all" && mistake.areaOfStudy !== topic)) return false
      if (browserFilter === "all") return true
      if (browserFilter === "due") return dueIds.has(mistake.id)
      if (browserFilter === "suspended") return Boolean(mistake.suspended)
      if (browserFilter === "mature") return schedule.resolved && !mistake.suspended
      if (browserFilter === "learning") return !mistake.suspended && (schedule.state === "learning" || schedule.state === "relearning")
      return !mistake.suspended && schedule.state === browserFilter
    }).toSorted((first, second) => {
      if (sort === "newest") return second.createdAt.localeCompare(first.createdAt)
      if (sort === "oldest") return first.createdAt.localeCompare(second.createdAt)
      if (sort === "marks") return (second.marksLost ?? 0) - (first.marksLost ?? 0)
      if (sort === "question") return first.question.localeCompare(second.question, undefined, { numeric: true })
      return (schedules.get(first.id)?.dueAt ?? "").localeCompare(schedules.get(second.id)?.dueAt ?? "")
    })
}
