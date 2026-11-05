import type { AppData } from "./exam-data"
import { buildDayPlan } from "./day-plan"
import { localDate, type TaskDraft } from "./learning-workspace"
import { subjectWorkspace } from "./subject-workspace"
import { sameStudySubject } from "./studySubjects"
import { isDeleted, studySessionSubjects, type CanonicalStudySession } from "./sync/sessionContract"

export function weekStart(now: Date, offset = 0): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - (now.getDay() + 6) % 7 + offset * 7)
}

export function buildWeeklyReview(data: AppData, sessions: CanonicalStudySession[], start: Date) {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
  const first = localDate(start), last = localDate(end)
  const inWeek = (date: string) => date >= first && date < last
  const days = Array.from({ length: 7 }, (_, i) => localDate(new Date(start.getFullYear(), start.getMonth(), start.getDate() + i)))
  const plans = days.map((day) => buildDayPlan(day, { ...data, sessions }, null))
  const planned = plans.reduce((sum, plan) => sum + plan.plannedMinutes + plan.completedMinutes, 0)
  const completed = plans.reduce((sum, plan) => sum + plan.completedMinutes, 0)
  const tasks = data.learning.tasks.filter((task) => !task.archivedAt && inWeek(task.plannedFor))
  const done = plans.flatMap((plan) => plan.items).filter((item) => item.kind === "task" && (item.status === "completed" || item.covered)).length
  const attempts = data.attempts.filter((attempt) => inWeek(attempt.completedAt))
  const subjects = data.subjects.length ? data.subjects : [...new Set(data.attempts.map((attempt) => attempt.subject))]
  const neglected = subjects.filter((subject) => {
    const scoped = subjectWorkspace(data, subject)
    const ownSessions = sessions.filter((session) => !isDeleted(session) && studySessionSubjects(session).some((id) => sameStudySubject(id, subject)))
    return days.every((day) => buildDayPlan(day, { ...scoped, sessions: ownSessions }, null).completedCount === 0)
  })
  const attemptMap = new Map(data.attempts.map((attempt) => [attempt.id, attempt]))
  const categories = new Map<string, { subject: string; category: string; cards: number }>()
  let reviews = 0, recalled = 0
  for (const mistake of data.mistakes) {
    if (mistake.suspended) continue
    const history = (mistake.reviewHistory ?? []).filter((review) => {
      const at = Date.parse(review.completedAt)
      return at >= start.getTime() && at < end.getTime()
    })
    reviews += history.length
    recalled += history.filter((review) => ["good", "easy", "correct"].includes(review.result)).length
    const created = Date.parse(mistake.createdAt)
    if (!(created >= start.getTime() && created < end.getTime()) && !history.some((review) => ["again", "hard", "incorrect", "assisted"].includes(review.result))) continue
    const subject = attemptMap.get(mistake.attemptId)?.subject ?? mistake.subject ?? "Unassigned"
    const key = `${subject}\0${mistake.category}`
    const row = categories.get(key) ?? { subject, category: mistake.category, cards: 0 }
    row.cards++
    categories.set(key, row)
  }
  const repeated = [...categories.values()].filter((row) => row.cards >= 2).sort((a, b) => b.cards - a.cards)
  const previous = localDate(weekStart(start, -1))
  const topics = new Map<string, { subject: string; topic: string; earned: number; max: number; beforeEarned: number; beforeMax: number; count: number; beforeCount: number }>()
  for (const attempt of data.attempts) {
    if (attempt.completedAt < previous || attempt.completedAt >= last) continue
    for (const result of attempt.questionResults ?? []) {
      const topic = result.topic ?? result.areaOfStudy?.trim()
      if (!topic) continue
      const key = `${attempt.subject}\0${topic}`
      const row = topics.get(key) ?? { subject: attempt.subject, topic, earned: 0, max: 0, beforeEarned: 0, beforeMax: 0, count: 0, beforeCount: 0 }
      if (inWeek(attempt.completedAt)) { row.earned += result.marksAwarded; row.max += result.maxMarks; row.count++ }
      else { row.beforeEarned += result.marksAwarded; row.beforeMax += result.maxMarks; row.beforeCount++ }
      topics.set(key, row)
    }
  }
  const improved = [...topics.values()].filter((row) => row.count >= 2 && row.beforeCount >= 2 && row.max && row.beforeMax)
    .map((row) => ({ ...row, delta: 100 * (row.earned / row.max - row.beforeEarned / row.beforeMax) })).filter((row) => row.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const date = localDate(end < today ? today : end)
  const suggestions: TaskDraft[] = [
    ...repeated.slice(0, 2).map((row): TaskDraft => ({ kind: "mistake-review", title: `Review ${row.category.toLowerCase()} mistakes`, subject: row.subject === "Unassigned" ? undefined : row.subject, detail: `${row.cards} different mistakes appeared in the week of ${first}. Work through the correction, then retry without notes.`, durationMinutes: 20, plannedFor: date, sourceId: `weekly:${first}:${row.subject}:${row.category}` })),
    ...neglected.slice(0, 1).map((subject): TaskDraft => ({ kind: "topic-practice", title: `Check in on ${subject}`, subject, detail: `No completed study or assessment was recorded for this subject in the week of ${first}. Choose a topic and check what you remember.`, durationMinutes: 25, plannedFor: date, sourceId: `weekly:${first}:${subject}:check-in` })),
  ].filter((draft) => !data.learning.tasks.some((task) => !task.archivedAt && task.sourceId === draft.sourceId))
  return { first, last: days[6], planned, completed, taskCount: tasks.length, done, papers: attempts.length, reviews, recalled, repeated, improved, neglected, suggestions }
}
