import type { AppData } from "./exam-data.js"
import { sameStudySubject } from "./studySubjects.js"

export const validCompletionYear = (year: unknown): year is number => typeof year === "number" && Number.isInteger(year) && year >= 1900 && year <= 9999

/** Accept PR #8 arrays as well as the dated metadata. */
export function readSubjectCompletions(value: unknown, updatedAt: string) {
  const payload = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined
  const subjects = (Array.isArray(value) ? value : Array.isArray(payload?.subjects) ? payload.subjects : []).filter((item): item is string => typeof item === "string")
  const years = payload?.years && typeof payload.years === "object" ? payload.years as Record<string, unknown> : {}
  // ponytail: the old shared timestamp cannot reveal individual completion dates; users can correct the inferred year.
  const fallback = Number(updatedAt.slice(0, 4))
  return { completedSubjects: subjects, subjectCompletionYears: Object.fromEntries(subjects.map((subject) => [subject, validCompletionYear(years[subject]) ? years[subject] : fallback > 1970 && validCompletionYear(fallback) ? fallback : 2026])) as Record<string, number> }
}

export function subjectCompletionYear(data: Pick<AppData, "completedSubjects" | "subjectCompletionYears">, subject: string): number | undefined {
  const name = data.completedSubjects.find((item) => sameStudySubject(item, subject))
  return name === undefined ? undefined : data.subjectCompletionYears[name]
}

/** null resumes a subject. This never removes records, estimates, or sessions. */
export function setSubjectCompletion(data: AppData, subject: string, year: number | null, at = new Date().toISOString()): AppData {
  if (!subject.trim() || year !== null && !validCompletionYear(year)) throw new Error("Choose a subject and a valid completion year")
  const completedSubjects = data.completedSubjects.filter((item) => !sameStudySubject(item, subject))
  const subjectCompletionYears = Object.fromEntries(Object.entries(data.subjectCompletionYears).filter(([item]) => !sameStudySubject(item, subject)))
  if (year !== null) { completedSubjects.push(subject); subjectCompletionYears[subject] = year }
  return { ...data, completedSubjects, subjectCompletionYears, completedSubjectsUpdatedAt: at }
}

/** Call with the year's finishing subjects; omit subjects continuing next year. */
export function completeSubjectYear(data: AppData, year: number, subjects: string[], at = new Date().toISOString()): AppData {
  if (!validCompletionYear(year)) throw new Error("Choose a valid completion year")
  return subjects.reduce((next, subject) => setSubjectCompletion(next, subject, year, at), data)
}

export function currentSubjectWork(data: AppData): AppData {
  const active = (subject?: string | null) => !subject || !data.completedSubjects.some((completed) => sameStudySubject(completed, subject))
  const attemptSubjects = new Map(data.attempts.map((attempt) => [attempt.id, attempt.subject]))
  return {
    ...data,
    subjects: data.subjects.filter(active),
    mistakes: data.mistakes.filter((mistake) => active(attemptSubjects.get(mistake.attemptId) ?? mistake.subject)),
    sacRecords: data.sacRecords.filter((record) => active(record.subject)),
    events: data.events.filter((event) => active(event.subjectId)),
    learning: { ...data.learning, tasks: data.learning.tasks.filter((task) => active(task.subject)), goals: data.learning.goals.filter((goal) => active(goal.subject)) },
    classTimetable: data.classTimetable && { ...data.classTimetable, entries: data.classTimetable.entries.map((entry) => ({ ...entry, periods: entry.periods.filter((period) => active(period.subject)) })) },
  }
}
