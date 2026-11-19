import { classPeriodsOn, subjectNameFor } from "./class-timetable.js"
import { buildDayPlan, type DayPlanSource } from "./day-plan.js"
import { localDate, materialiseTask, type LearningWorkspace, type StudyTask } from "./learning-workspace.js"
import { isCompletedSac } from "./sac.js"
import { activeItems, buildItemEvidence, isRecheckDue, itemGroup } from "./stoplight.js"
import { sameStudySubject } from "./studySubjects.js"
import { formatExamLabel, getExamStart, type Timetable } from "./timetable.js"
import type { TimetableConfig } from "./types.js"

const HORIZON_DAYS = 14
const LOOKAHEAD_DAYS = 28
const ITEM_MINUTES = 25
const PREP_MINUTES = 45
const PREP_SESSIONS = 3
const ASSESSED = new Set(["sac", "exam", "assignment", "practice-sac"])
const FREE_PERIOD = /\b(free|spare|study)\b/i

export type AdaptivePlanSource = DayPlanSource & { classTimetable?: TimetableConfig }

type Assessment = { key: string; subject: string; title: string; date: string }
type Need = Pick<StudyTask, "kind" | "title" | "subject" | "detail" | "durationMinutes"> & { sourceId: string; before: string }

const minutesOf = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number)
  return hours * 60 + minutes
}
const addDays = (date: Date, days: number) => localDate(new Date(date.getFullYear(), date.getMonth(), date.getDate() + days))
const dayLabel = (date: string) => new Date(`${date}T12:00:00`).toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })

function upcomingAssessments(source: AdaptivePlanSource, timetable: Timetable | null, today: string, until: string): Assessment[] {
  const tracked = new Set(source.trackedExamIds)
  return [
    ...source.sacRecords.filter((sac) => !isCompletedSac(sac))
      .map((sac) => ({ key: `sac:${sac.id}`, subject: sac.subject, title: sac.title, date: localDate(new Date(sac.scheduledAt)) })),
    ...(source.events ?? []).filter((event) => !event.deleted_at && !event.isFinished && ASSESSED.has(event.eventType) && event.subjectId)
      .map((event) => ({ key: `event:${event.id}`, subject: subjectNameFor(event.subjectId), title: event.title, date: localDate(new Date(event.startTime)) })),
    ...(timetable?.exams ?? []).filter((exam) => tracked.has(exam.id))
      .map((exam) => ({ key: `exam:${exam.id}`, subject: exam.subject, title: formatExamLabel(exam), date: localDate(getExamStart(exam)) })),
  ].filter((item) => item.date >= today && item.date <= until).sort((a, b) => a.date.localeCompare(b.date))
}

/**
 * Schedules the next fortnight: prep sessions before each upcoming SAC/exam, then red, amber and
 * re-check-due stoplight items (due before their subject's next assessment). Each study day's
 * budget is `dailyMinutes` plus free periods in the class timetable, minus work already on it;
 * tasks go to the least-loaded eligible day, spreading subjects apart. Re-running moves the
 * planner's still-planned tasks (including overdue ones) and archives those no longer needed.
 */
export function planAdaptive(source: AdaptivePlanSource, timetable: Timetable | null, { subject, now = new Date() }: { subject?: string; now?: Date } = {}) {
  const { learning } = source
  const today = localDate(now)
  const horizonEnd = addDays(now, HORIZON_DAYS)
  const inScope = (name?: string) => !subject || sameStudySubject(name, subject)
  const assessments = upcomingAssessments(source, timetable, today, addDays(now, LOOKAHEAD_DAYS)).filter((item) => inScope(item.subject))
  const items = activeItems(learning).filter((item) => inScope(item.subject))
  const itemIds = new Set(items.map((item) => item.id))
  const doneToday = new Set(learning.tasks.filter((task) => !task.archivedAt && task.status !== "planned" && task.plannedFor >= today).map((task) => task.sourceId))
  const done = new Set(learning.tasks.filter((task) => !task.archivedAt && task.status !== "planned").map((task) => task.sourceId))

  const needs: Need[] = []
  for (const assessment of assessments) {
    const weakest = items.filter((item) => item.rating === "red" && sameStudySubject(item.subject, assessment.subject)).slice(0, 2).map((item) => item.name)
    for (let index = 1; index <= PREP_SESSIONS; index += 1) {
      const sourceId = `prep:${assessment.key}:${index}`
      if (done.has(sourceId)) continue
      needs.push({
        kind: "sac-prep",
        title: `Prepare: ${assessment.title}`,
        subject: assessment.subject,
        detail: [`${index}/${PREP_SESSIONS} before ${dayLabel(assessment.date)}`, weakest.length ? `Focus: ${weakest.join(", ")}` : ""].filter(Boolean).join(" · "),
        durationMinutes: Math.min(PREP_MINUTES, learning.preferences.dailyMinutes),
        sourceId,
        before: assessment.date,
      })
    }
  }
  const evidence = buildItemEvidence(source, now)
  const score = (id: string, rating?: string) => {
    const entry = evidence.get(id)
    return (rating === "red" ? 30 : rating === "amber" ? 20 : 10) + Math.min(entry?.open ?? 0, 5) * 2 + (entry?.available ? 10 * (1 - entry.awarded / entry.available) : 0)
  }
  needs.push(...items
    .filter((item) => !doneToday.has(item.id) && (item.rating === "red" || item.rating === "amber" || isRecheckDue(item, now)))
    .map((item) => ({ item, score: score(item.id, item.rating) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => ({
      kind: "topic-practice" as const,
      title: `Revise: ${item.name}`,
      subject: item.subject,
      detail: item.check ? `${itemGroup(item)} · Check: ${item.check}` : itemGroup(item),
      durationMinutes: Math.min(ITEM_MINUTES, learning.preferences.dailyMinutes),
      sourceId: item.id,
      before: assessments.find((assessment) => sameStudySubject(item.subject, assessment.subject))?.date ?? horizonEnd,
    })))
  // Stable sort: earliest deadline first, stoplight score order kept within a deadline.
  needs.sort((a, b) => a.before.localeCompare(b.before))

  const owned = (task: StudyTask) => !task.archivedAt && task.status === "planned" && !!task.sourceId && inScope(task.subject)
    && (task.sourceId.startsWith("prep:") || itemIds.has(task.sourceId))
  const movable = new Map<string, StudyTask>()
  for (const task of learning.tasks) if (owned(task) && !movable.has(task.sourceId!)) movable.set(task.sourceId!, task)
  const fixed = { ...learning, tasks: learning.tasks.filter((task) => !owned(task)) }

  const days = Array.from({ length: HORIZON_DAYS }, (_, offset) => {
    const date = addDays(now, offset)
    const weekday = new Date(`${date}T12:00:00`).getDay()
    const free = classPeriodsOn(date, source.classTimetable)
      .filter((period) => FREE_PERIOD.test(period.subject) || FREE_PERIOD.test(period.period))
      .reduce((total, period) => total + Math.max(0, minutesOf(period.endTime) - minutesOf(period.startTime)), 0)
    const capacity = (learning.preferences.studyDays.includes(weekday) ? learning.preferences.dailyMinutes : 0) + free
    const plan = buildDayPlan(date, { ...source, learning: fixed }, timetable, now.getTime())
    return { date, capacity, used: plan.plannedMinutes + plan.completedMinutes, subjects: new Map<string, number>() }
  }).filter((day) => day.capacity > 0)

  const placed = new Map<string, string>()
  let unplaced = 0
  for (const need of needs) {
    // ponytail: greedy earliest-deadline-first, O(needs × days); swap for a solver if plans ever need backtracking.
    let best: (typeof days)[number] | undefined
    let bestCost = Infinity
    days.forEach((day, index) => {
      if (day.date >= need.before || day.capacity - day.used < need.durationMinutes) return
      const cost = day.used / day.capacity + 0.6 * (day.subjects.get(need.subject!) ?? 0) + index * 0.01
      if (cost < bestCost) [best, bestCost] = [day, cost]
    })
    if (!best) { unplaced += 1; continue }
    best.used += need.durationMinutes
    best.subjects.set(need.subject!, (best.subjects.get(need.subject!) ?? 0) + 1)
    placed.set(need.sourceId, best.date)
  }

  const timestamp = now.toISOString()
  let moved = 0
  let dropped = 0
  const tasks = learning.tasks.map((task) => {
    if (movable.get(task.sourceId!) !== task) return task
    const date = placed.get(task.sourceId!)
    if (date) {
      if (date === task.plannedFor) return task
      moved += 1
      return { ...task, plannedFor: date, updatedAt: timestamp }
    }
    if (needs.some((need) => need.sourceId === task.sourceId)) return task
    dropped += 1
    return { ...task, archivedAt: timestamp, updatedAt: timestamp }
  })
  const added = needs.filter((need) => placed.has(need.sourceId) && !movable.has(need.sourceId))
    .map(({ before: _before, ...need }) => materialiseTask({ ...need, plannedFor: placed.get(need.sourceId)! }, now))
  const changed = moved + dropped + added.length > 0
  return {
    learning: changed ? { ...learning, tasks: [...tasks, ...added], updatedAt: timestamp } : learning,
    added: added.length, moved, dropped, unplaced,
  }
}

export function describeAdaptivePlan({ added, moved, dropped, unplaced }: ReturnType<typeof planAdaptive>) {
  const parts = [
    added ? `${added} task${added === 1 ? "" : "s"} added` : "",
    moved ? `${moved} rescheduled` : "",
    dropped ? `${dropped} no longer needed` : "",
    unplaced ? `${unplaced} didn't fit the next ${HORIZON_DAYS} days` : "",
  ].filter(Boolean)
  return parts.length ? parts.join(" · ") : "Your plan is already up to date."
}
