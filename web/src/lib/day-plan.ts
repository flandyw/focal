import type { ExamAttempt, Mistake } from "@/lib/exam-data"
import { isCompletedSac, type SacRecord } from "@/lib/sac"
import { formatExamLabel, getExamEnd, getExamStart, type Timetable, type TimetableEntry } from "@/lib/timetable"
import { localDate, type LearningWorkspace, type StudyTask, type StudyTaskStatus } from "@/lib/learning-workspace"

/** The day plan reads the records the app already keeps. It never stores a
 *  second copy, so a task edited anywhere is edited on the calendar too. */
export type DayPlanSource = {
  sacRecords: SacRecord[]
  attempts: ExamAttempt[]
  mistakes: Mistake[]
  learning: LearningWorkspace
  trackedExamIds: string[]
}

/** Everything the web app already knows about a single day, in one list. No
 *  second calendar store: the day plan is a view over tasks, SACs, exams and
 *  the revision queue, so nothing can drift between two calendars. */
export type DayItem =
  | { kind: "task"; id: string; title: string; detail: string; subject?: string; minutes: number; status: StudyTaskStatus }
  | { kind: "sac"; id: string; title: string; detail: string; minutes: number; startTime: string; completed: boolean }
  | { kind: "exam"; id: string; title: string; detail: string; minutes: number; startTime: string; multiDay?: boolean }
  | { kind: "logged-exam"; id: string; title: string; detail: string; minutes: number; completed: true }
  | { kind: "mistakes"; id: string; title: string; detail: string; minutes: number; count: number }

export type DayPlan = {
  date: string
  items: DayItem[]
  plannedMinutes: number
  completedMinutes: number
  dueMistakes: number
}

export type CalendarDay = {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
  items: DayItem[]
  load: number
  minutes: number
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const

export function weekdayLabels() {
  return WEEKDAYS
}

function shiftDays(date: Date, amount: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + amount)
  return next
}

/** Monday-first, which is what a VCE week looks like. */
function startOfWeek(date: Date) {
  return shiftDays(date, -((date.getDay() + 6) % 7))
}

function timeOf(iso: string) {
  const parsed = new Date(iso)
  if (!Number.isFinite(parsed.getTime())) return undefined
  return parsed.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
}

function taskItem(task: StudyTask): DayItem {
  return {
    kind: "task",
    id: task.id,
    title: task.title,
    detail: task.detail,
    subject: task.subject,
    minutes: task.durationMinutes,
    status: task.status,
  }
}

function sacItem(record: SacRecord): DayItem {
  return {
    kind: "sac",
    id: record.id,
    title: record.title,
    detail: [record.subject, record.unit, record.sacNumber].filter(Boolean).join(" · "),
    minutes: record.durationMinutes,
    startTime: timeOf(record.scheduledAt) ?? "",
    completed: isCompletedSac(record),
  }
}

function examItem(entry: TimetableEntry): DayItem {
  const start = getExamStart(entry)
  const multiDay = Math.round((getExamEnd(entry).getTime() - start.getTime()) / 86_400_000) > 0
  return {
    kind: "exam",
    id: entry.id,
    title: formatExamLabel(entry),
    detail: multiDay ? "Examination period" : entry.paper ? "Examination" : "Examination period",
    minutes: Math.max(0, Math.round((getExamEnd(entry).getTime() - start.getTime()) / 60_000)),
    startTime: entry.startTime ?? "",
    multiDay,
  }
}

function isDueOn(mistake: Mistake, date: string) {
  if (!mistake.dueAt || mistake.resolved) return false
  return localDate(new Date(mistake.dueAt)) === date
}

export function buildDayPlan(date: string, data: DayPlanSource, timetable: Timetable | null): DayPlan {
  const items: DayItem[] = []

  for (const task of data.learning.tasks) {
    if (task.archivedAt || task.plannedFor !== date) continue
    items.push(taskItem(task))
  }
  for (const record of data.sacRecords) {
    if (localDate(new Date(record.scheduledAt)) !== date) continue
    items.push(sacItem(record))
  }
  for (const attempt of data.attempts) {
    if (localDate(new Date(attempt.completedAt)) !== date) continue
    items.push({
      kind: "logged-exam",
      id: attempt.id,
      title: attempt.title,
      detail: [attempt.subject, attempt.paper, `${attempt.rawScore}/${attempt.rawMax}`].filter(Boolean).join(" · "),
      minutes: attempt.timing ? attempt.timing.plannedReadingMinutes + attempt.timing.plannedWritingMinutes : 0,
      completed: true,
    })
  }
  const tracked = new Set(data.trackedExamIds)
  for (const entry of timetable?.exams ?? []) {
    if (!tracked.has(entry.id)) continue
    const start = localDate(getExamStart(entry))
    const end = localDate(getExamEnd(entry))
    if (date < start || date > end) continue
    items.push(examItem(entry))
  }

  const dueMistakes = data.mistakes.filter((mistake) => isDueOn(mistake, date))
  if (dueMistakes.length) {
    items.push({
      kind: "mistakes",
      id: `mistakes:${date}`,
      title: dueMistakes.length === 1 ? "1 mistake due for review" : `${dueMistakes.length} mistakes due for review`,
      detail: "From your spaced revision queue",
      minutes: 0,
      count: dueMistakes.length,
    })
  }

  const plannedMinutes = items
    .filter((item) => item.kind === "task" && item.status === "planned")
    .reduce((total, item) => total + item.minutes, 0)
  const completedMinutes = items
    .filter((item) => item.kind === "task" && item.status === "completed")
    .reduce((total, item) => total + item.minutes, 0)

  // Work first, then anything fixed in time, then the revision queue.
  const order: Record<DayItem["kind"], number> = { task: 0, sac: 1, exam: 2, "logged-exam": 3, mistakes: 4 }
  items.sort((a, b) => order[a.kind] - order[b.kind] || b.minutes - a.minutes)
  return { date, items, plannedMinutes, completedMinutes, dueMistakes: dueMistakes.length }
}

/** Six Monday-first weeks covering the month, so the grid never changes height. */
export function buildCalendarMonth(month: Date, data: DayPlanSource, timetable: Timetable | null, now = new Date()): CalendarDay[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const cursor = startOfWeek(first)
  const today = localDate(now)
  return Array.from({ length: 42 }, (_, index) => {
    const date = shiftDays(cursor, index)
    const key = localDate(date)
    const plan = buildDayPlan(key, data, timetable)
    return {
      date: key,
      day: date.getDate(),
      inMonth: date.getMonth() === month.getMonth(),
      items: plan.items,
      load: plan.items.length,
      minutes: plan.plannedMinutes,
      isToday: key === today,
    }
  })
}

export function shiftMonth(month: Date, amount: number) {
  return new Date(month.getFullYear(), month.getMonth() + amount, 1)
}

/** Incomplete work left behind, offered to the day you are looking at. */
export function overdueTasks(tasks: StudyTask[], before: string): StudyTask[] {
  return tasks
    .filter((task) => !task.archivedAt && task.status === "planned" && task.plannedFor < before)
    .toSorted((a, b) => a.plannedFor.localeCompare(b.plannedFor) || a.createdAt.localeCompare(b.createdAt))
}

/* ------------------------------------------------------------------ */
/* task edits                                                          */
/* ------------------------------------------------------------------ */

function withTasks(workspace: LearningWorkspace, tasks: StudyTask[], now: Date): LearningWorkspace {
  return { ...workspace, tasks, updatedAt: now.toISOString() }
}

export function setTaskStatus(workspace: LearningWorkspace, id: string, status: StudyTaskStatus, now = new Date()): LearningWorkspace {
  const timestamp = now.toISOString()
  return withTasks(workspace, workspace.tasks.map((task) => task.id === id ? { ...task, status, updatedAt: timestamp } : task), now)
}

export function moveTask(workspace: LearningWorkspace, id: string, plannedFor: string, now = new Date()): LearningWorkspace {
  // A cleared date input must never blank a task's day.
  if (!plannedFor) return workspace
  const timestamp = now.toISOString()
  return withTasks(workspace, workspace.tasks.map((task) => task.id === id
    ? { ...task, plannedFor, status: task.status === "completed" ? "planned" : task.status, updatedAt: timestamp }
    : task), now)
}

export function archiveTask(workspace: LearningWorkspace, id: string, now = new Date()): LearningWorkspace {
  const timestamp = now.toISOString()
  return withTasks(workspace, workspace.tasks.map((task) => task.id === id ? { ...task, archivedAt: timestamp, updatedAt: timestamp } : task), now)
}

export function addTask(workspace: LearningWorkspace, task: { title: string; date: string; minutes: number; subject?: string }, now = new Date()): LearningWorkspace {
  const title = task.title.trim().slice(0, 200)
  const minutes = Math.round(task.minutes)
  // A bad title or duration is ignored rather than stored as a broken task.
  if (!title || !task.date || !Number.isFinite(minutes) || minutes < 5 || minutes > 360) return workspace
  const timestamp = now.toISOString()
  return withTasks(workspace, [...workspace.tasks, {
    id: crypto.randomUUID(),
    kind: "custom",
    title,
    detail: "Personal study task",
    subject: task.subject?.trim() || undefined,
    durationMinutes: minutes,
    plannedFor: task.date,
    status: "planned",
    createdAt: timestamp,
    updatedAt: timestamp,
  }], now)
}
