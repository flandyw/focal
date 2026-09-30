import { getMistakeSchedule, type ExamAttempt, type Mistake } from "@/lib/exam-data"
import { isCompletedSac, type SacRecord } from "@/lib/sac"
import { formatExamLabel, getExamEnd, getExamStart, type Timetable, type TimetableEntry } from "@/lib/timetable"
import { localDate, type LearningWorkspace, type StudyTask, type StudyTaskStatus } from "@/lib/learning-workspace"
import type { CanonicalStudySession } from "../../../src/lib/sync/sessionContract"
import { VCE_SUBJECTS } from "../../../src/lib/types"

/** The day plan reads the records the app already keeps. It never stores a
 *  second copy, so a task edited anywhere is edited on the calendar too. */
export type DayPlanSource = {
  sacRecords: SacRecord[]
  attempts: ExamAttempt[]
  mistakes: Mistake[]
  learning: LearningWorkspace
  trackedExamIds: string[]
  /** Canonical study sessions: the same shared rows the desktop calendar reads. */
  sessions?: CanonicalStudySession[]
}

/** Everything the web app already knows about a single day, in one list. No
 *  second calendar store: the day plan is a view over tasks, SACs, exams and
 *  the revision queue, so nothing can drift between two calendars. */
export type DayItem =
  | { kind: "task"; id: string; title: string; detail: string; subject?: string; minutes: number; status: StudyTaskStatus }
  | { kind: "sac"; id: string; title: string; detail: string; minutes: number; startTime: string; completed: boolean }
  | { kind: "exam"; id: string; title: string; detail: string; minutes: number; startTime: string; multiDay?: boolean }
  | { kind: "session"; id: string; title: string; detail: string; minutes: number; startTime: string; status: "planned" | "in-progress" | "completed" }
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

// Use the same scheduler as the mistakes page and the folio app: a card with no
// explicit due date still lands on its computed day, and mastered or paused cards
// never join the revision queue.
function isDueOn(mistake: Mistake, date: string) {
  if (mistake.suspended) return false
  const schedule = getMistakeSchedule(mistake)
  if (schedule.resolved) return false
  return localDate(new Date(schedule.dueAt)) === date
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Desktop rows file under VCE subject ids; show the same names the desktop does. */
function subjectLabel(id: string | undefined): string {
  if (!id) return ""
  return VCE_SUBJECTS.find((subject) => subject.id === id)?.name ?? id
}

/** Overlapping ranges count once, exactly as the desktop's effective minutes do. */
function mergedMinutes(ranges: readonly { start: string; end: string }[]): number {
  const sorted = ranges
    .map((range) => ({ start: new Date(range.start).getTime(), end: new Date(range.end).getTime() }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start)
  let total = 0
  let current = sorted[0]
  for (const range of sorted.slice(1)) {
    if (range.start > current.end) {
      total += current.end - current.start
      current = range
    } else {
      current.end = Math.max(current.end, range.end)
    }
  }
  if (current) total += current.end - current.start
  return Math.round(total / 60000)
}

/**
 * Projects one canonical study session exactly the way Focal desktop's calendar does:
 * it lands on the local date of its `startTime` (its first schedule block, or its start
 * when there is none), its minutes are its worked intervals, and a cancelled sitting is
 * never shown. Both apps then list the same sessions on the same days with the same
 * durations, from the one shared record.
 */
function sessionItem(session: CanonicalStudySession): { item: DayItem; date: string } | null {
  if (session.state === "cancelled") return null
  const nested = isRecord(session.metadata.legacy_metadata) ? session.metadata.legacy_metadata : session.metadata
  const legacy = isRecord(nested) ? nested : {}
  const subjectIds = Array.isArray(legacy.subjectIds)
    ? legacy.subjectIds.filter((id): id is string => typeof id === "string")
    : []
  const scheduleBlocks = isRecord(legacy.schedule) && Array.isArray(legacy.schedule.blocks)
    ? legacy.schedule.blocks.flatMap((block) => {
      if (!isRecord(block) || typeof block.start !== "string" || typeof block.end !== "string") return []
      return [{ start: block.start, end: block.end }]
    })
    : []
  const start = session.started_at ?? session.created_at
  // Without a schedule the desktop files the sitting under its start plus an hour, so
  // the calendar lands it on the same day here.
  const schedule = scheduleBlocks.length > 0
    ? scheduleBlocks
    : [{ start, end: new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString() }]
  const worked = session.state === "planned"
    ? schedule
    : session.segments.flatMap((segment) => segment.ended_at ? [{ start: segment.started_at, end: segment.ended_at }] : [])
  const span = { start: schedule[0].start, end: schedule[schedule.length - 1].end }
  const minutes = worked.length > 0 ? mergedMinutes(worked) : mergedMinutes([span])
  return {
    date: localDate(new Date(schedule[0].start)),
    item: {
      kind: "session",
      id: session.id,
      title: session.title,
      detail: subjectIds.map(subjectLabel).filter(Boolean).join(" · ") || subjectLabel(session.subject_id ?? undefined),
      minutes,
      startTime: timeOf(schedule[0].start) ?? "",
      status: session.state === "planned" ? "planned" : session.state === "completed" ? "completed" : "in-progress",
    },
  }
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
  for (const session of data.sessions ?? []) {
    const projected = sessionItem(session)
    if (projected && projected.date === date) items.push(projected.item)
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

  // Work first, then anything fixed in time, then what is already on record, then the queue.
  const order: Record<DayItem["kind"], number> = { task: 0, sac: 1, exam: 2, session: 3, "logged-exam": 4, mistakes: 5 }
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
