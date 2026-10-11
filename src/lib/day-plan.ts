import { getMistakeSchedule, type ExamAttempt, type Mistake } from "./exam-data"
import { isCompletedSac, type SacRecord } from "./sac"
import { formatExamLabel, getExamEnd, getExamStart, type Timetable, type TimetableEntry } from "./timetable"
import { localDate, type LearningWorkspace, type StudyTask, type StudyTaskStatus } from "./learning-workspace"
import { isDeleted, isPaused, isRunning, type CanonicalStudySession } from "./sync/sessionContract"
import { subjectNameFor } from "./class-timetable"
import { VCE_SUBJECTS, type CalendarEvent } from "./types"

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
  /** Calendar events shared with the desktop app. */
  events?: CalendarEvent[]
}

/** Everything the web app already knows about a single day, in one list. No
 *  second calendar store: the day plan is a view over tasks, SACs, exams and
 *  the revision queue, so nothing can drift between two calendars. */
export type DayItem =
  | { kind: "task"; id: string; title: string; detail: string; subject?: string; minutes: number; status: StudyTaskStatus; covered?: boolean }
  | { kind: "sac"; id: string; title: string; detail: string; minutes: number; startTime: string; completed: boolean }
  | { kind: "exam"; id: string; title: string; detail: string; minutes: number; startTime: string; multiDay?: boolean }
  | { kind: "event"; id: string; title: string; detail: string; minutes: number; startTime: string; completed: boolean; multiDay: boolean }
  | { kind: "session"; id: string; title: string; detail: string; minutes: number; startTime: string; done: boolean; live: boolean }
  | { kind: "logged-exam"; id: string; title: string; detail: string; minutes: number; completed: true }
  | { kind: "mistakes"; id: string; title: string; detail: string; minutes: number; count: number }

export type DayPlan = {
  date: string
  items: DayItem[]
  /** Study time still to do and study time banked, counted from every kind of work
   *  on the day -- tasks, shared study sittings, SACs and logged papers. */
  plannedMinutes: number
  completedMinutes: number
  plannedCount: number
  completedCount: number
  totalCount: number
  dueMistakes: number
}

export type CalendarDay = {
  date: string
  day: number
  inMonth: boolean
  isToday: boolean
  items: DayItem[]
  load: number
  /** Total study load on the day: what is still to do plus what was banked. */
  minutes: number
  /** That load as a percentage of the heaviest day in the grid, so a quiet cell still
   *  says how quiet it is instead of reading as an absence. */
  loadBar: number
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

const EVENT_TYPE_LABEL: Record<string, string> = {
  sac: "SAC", "practice-sac": "Practice SAC", exam: "Exam", assignment: "Assignment", homework: "Homework", event: "Event", other: "Other",
}

function eventTypeLabel(type: string) {
  return EVENT_TYPE_LABEL[type] ?? "Event"
}

/** Local first and last day an event touches; an end at exactly midnight belongs to the day before. */
function eventDays(event: CalendarEvent): { first: string; last: string } {
  const start = new Date(event.startTime)
  const end = event.endTime ? new Date(event.endTime) : start
  const last = end.getTime() > start.getTime() ? new Date(end.getTime() - 60_000) : start
  return { first: localDate(start), last: localDate(last) }
}

function eventItem(event: CalendarEvent, date: string, days: { first: string; last: string }): DayItem {
  const start = new Date(event.startTime)
  const end = event.endTime ? new Date(event.endTime) : null
  const minutes = end ? Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000)) : 0
  const multiDay = days.first !== days.last
  return {
    kind: "event",
    id: event.id,
    title: event.title,
    detail: [eventTypeLabel(event.eventType), subjectNameFor(event.subjectId), event.location].filter(Boolean).join(" · "),
    minutes: multiDay ? 0 : minutes,
    startTime: multiDay && date !== days.first ? "" : timeOf(event.startTime) ?? "",
    completed: Boolean(event.isFinished),
    multiDay,
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
  return total / 60000
}

function sessionSchedule(session: CanonicalStudySession) {
  const nested = isRecord(session.metadata.legacy_metadata) ? session.metadata.legacy_metadata : session.metadata
  const legacy = isRecord(nested) ? nested : {}
  const subjectIds = Array.isArray(legacy.subjectIds)
    ? legacy.subjectIds.filter((id): id is string => typeof id === "string")
    : []
  // A session's blocks are its segments, done or not. Only a row with none (a timer still on its
  // first interval, or an old row) falls back to a stored schedule, then to start plus an hour,
  // which is where the desktop files such a sitting.
  const closed = session.segments.flatMap((segment) => segment.ended_at ? [{ start: segment.started_at, end: segment.ended_at }] : [])
  const stored = isRecord(legacy.schedule) && Array.isArray(legacy.schedule.blocks)
    ? legacy.schedule.blocks.flatMap((block) => {
      if (!isRecord(block) || typeof block.start !== "string" || typeof block.end !== "string") return []
      return [{ start: block.start, end: block.end }]
    })
    : []
  const start = session.started_at ?? session.created_at
  const schedule = closed.length > 0 ? closed : stored.length > 0 ? stored
    : [{ start, end: new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString() }]
  return { subjectIds, schedule, closed }
}

/** Where a session sits on a day's timeline. An open interval runs to `now`. `done` is the
 *  session's completed flag; a block that has not been started or finished is just not done. */
export function sessionBlocks(session: CanonicalStudySession, now = Date.now()): { start: string; end: string; done: boolean; live: boolean }[] {
  if (isDeleted(session)) return []
  const blocks = session.segments.map((segment) => ({
    start: segment.started_at,
    end: segment.ended_at ?? new Date(Math.max(now, Date.parse(segment.started_at))).toISOString(),
    done: session.completed,
    live: segment.ended_at === null,
  }))
  return blocks.length > 0 ? blocks : sessionSchedule(session).schedule.map((block) => ({ ...block, done: session.completed, live: false }))
}

/** Count only the blocks touching this local day, including work in an unfinished timer.
 *  Keep fractional minutes until the day's total is rounded, so short blocks add up. */
export function sessionItem(session: CanonicalStudySession, date: string, now = Date.now()): { item: DayItem; date: string } | null {
  if (isDeleted(session)) return null
  const { subjectIds } = sessionSchedule(session)
  const dayStart = new Date(`${date}T00:00:00`)
  const dayEnd = new Date(dayStart)
  dayEnd.setDate(dayEnd.getDate() + 1)
  const blocks = sessionBlocks(session, now).flatMap((block) => {
    const start = Math.max(dayStart.getTime(), Date.parse(block.start))
    const end = Math.min(dayEnd.getTime(), Date.parse(block.end))
    return end > start ? [{ start: new Date(start).toISOString(), end: new Date(end).toISOString() }] : []
  })
  if (!blocks.length) return null
  return {
    date,
    item: {
      kind: "session",
      id: session.id,
      title: session.title,
      detail: subjectIds.map(subjectLabel).filter(Boolean).join(" · ") || subjectLabel(session.subject_id ?? undefined),
      minutes: mergedMinutes(blocks),
      startTime: timeOf(blocks[0].start) ?? "",
      done: session.completed || session.started_at !== null,
      live: !session.completed && (isRunning(session) || isPaused(session)),
    },
  }
}

/** What a day owes and what it banked, in study minutes. Exam entries and the review
 *  aggregate are markers rather than study, so they never move the totals, and neither
 *  does a skipped task or one already counted through the sitting that covered it. */
function workOf(item: DayItem): { minutes: number; done: boolean } | null {
  if (item.kind === "task") {
    if (item.status === "skipped" || item.covered === true) return null
    return { minutes: item.minutes, done: item.status === "completed" }
  }
  if (item.kind === "sac") return { minutes: item.minutes, done: item.completed }
  if (item.kind === "session") return { minutes: item.minutes, done: item.done }
  if (item.kind === "logged-exam") return { minutes: item.minutes, done: true }
  return null
}

/** What the day has banked. A task covered by a sitting reads as done even though the
 *  minutes are carried by that sitting. */
export function isDayItemDone(item: DayItem) {
  if (item.kind === "task") return item.status === "completed" || item.covered === true
  return workOf(item)?.done ?? false
}

export function buildDayPlan(date: string, data: DayPlanSource, timetable: Timetable | null, now = Date.now()): DayPlan {
  const items: DayItem[] = []

  for (const task of data.learning.tasks) {
    if (task.archivedAt || task.plannedFor !== date) continue
    items.push(taskItem(task))
  }
  for (const record of data.sacRecords) {
    if (localDate(new Date(record.scheduledAt)) !== date) continue
    items.push(sacItem(record))
  }
  for (const event of data.events ?? []) {
    const days = eventDays(event)
    if (date < days.first || date > days.last) continue
    items.push(eventItem(event, date, days))
  }
  for (const session of data.sessions ?? []) {
    const projected = sessionItem(session, date, now)
    if (projected) items.push(projected.item)
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

  // A sitting the timer ran from a day-plan task carries that task's title, so it is the
  // same work twice. The sitting wins: the task reads as covered and the minutes are
  // counted once, as the ones actually logged rather than the ones intended.
  const sittings = new Set(items.filter((item) => item.kind === "session").map((item) => item.title))
  for (const item of items) {
    if (item.kind === "task" && sittings.has(item.title)) item.covered = true
  }
  const totals = items.reduce(
    (total, item) => {
      const work = workOf(item)
      if (!work) return total
      return work.done
        ? { ...total, completedMinutes: total.completedMinutes + work.minutes, completedCount: total.completedCount + 1 }
        : { ...total, plannedMinutes: total.plannedMinutes + work.minutes, plannedCount: total.plannedCount + 1 }
    },
    { plannedMinutes: 0, completedMinutes: 0, plannedCount: 0, completedCount: 0 },
  )

  // Work first, then anything fixed in time, then what is already on record, then the queue.
  const order: Record<DayItem["kind"], number> = { task: 0, sac: 1, event: 2, exam: 2, session: 3, "logged-exam": 4, mistakes: 5 }
  items.sort((a, b) => order[a.kind] - order[b.kind] || b.minutes - a.minutes)
  return {
    date,
    items,
    ...totals,
    plannedMinutes: Math.round(totals.plannedMinutes),
    completedMinutes: Math.round(totals.completedMinutes),
    totalCount: totals.plannedCount + totals.completedCount,
    dueMistakes: dueMistakes.length,
  }
}

/** Six Monday-first weeks covering the month, so the grid never changes height. */
export function buildCalendarMonth(month: Date, data: DayPlanSource, timetable: Timetable | null, now = new Date()): CalendarDay[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1)
  const cursor = startOfWeek(first)
  const today = localDate(now)
  const grid = Array.from({ length: 42 }, (_, index) => {
    const date = shiftDays(cursor, index)
    const key = localDate(date)
    const plan = buildDayPlan(key, data, timetable, now.getTime())
    return {
      date: key,
      day: date.getDate(),
      inMonth: date.getMonth() === month.getMonth(),
      items: plan.items,
      load: plan.items.length,
      minutes: plan.plannedMinutes + plan.completedMinutes,
      isToday: key === today,
    }
  })
  const peak = Math.max(0, ...grid.map((day) => day.minutes))
  return grid.map((day) => ({ ...day, loadBar: peak > 0 ? day.minutes / peak * 100 : 0 }))
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

export function addTask(workspace: LearningWorkspace, task: { title: string; date: string; minutes: number; subject?: string; detail?: string }, now = new Date()): LearningWorkspace {
  const title = task.title.trim().slice(0, 200)
  const minutes = Math.round(task.minutes)
  // A bad title or duration is ignored rather than stored as a broken task.
  if (!title || !task.date || !Number.isFinite(minutes) || minutes < 5 || minutes > 360) return workspace
  const timestamp = now.toISOString()
  return withTasks(workspace, [...workspace.tasks, {
    id: crypto.randomUUID(),
    kind: "custom",
    title,
    detail: task.detail?.trim().slice(0, 200) || "Personal study task",
    subject: task.subject?.trim() || undefined,
    durationMinutes: minutes,
    plannedFor: task.date,
    status: "planned",
    createdAt: timestamp,
    updatedAt: timestamp,
  }], now)
}
