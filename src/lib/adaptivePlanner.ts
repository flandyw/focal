import { getProjectMasteryScore, getProjectTopicMastery } from "@/lib/mastery"
import { getTimetablePeriodsForDate } from "@/lib/timetable"
import type { CalendarEvent, Project, StudySession, TimetableConfig } from "@/lib/types"
import { getSessionEffectiveMinutes } from "@/lib/utils"

const MINUTE_MS = 60_000
const DAY_MS = 86_400_000

export interface AdaptivePlannerConfig {
  horizonDays: number
  weekdayStart: string
  weekdayEnd: string
  weekendStart: string
  weekendEnd: string
  maxDailyMinutes: number
  breakMinutes: number
}

export const DEFAULT_ADAPTIVE_PLANNER_CONFIG: AdaptivePlannerConfig = {
  horizonDays: 7,
  weekdayStart: "16:00",
  weekdayEnd: "21:00",
  weekendStart: "09:00",
  weekendEnd: "17:00",
  maxDailyMinutes: 180,
  breakMinutes: 10,
}

export interface AdaptivePlanItem {
  projectId: string
  subjectIds: string[]
  title: string
  startTime: string
  endTime: string
  topics?: string[]
  description: string
}

export interface AdaptivePlanGap {
  projectId: string
  projectName: string
  minutes: number
  reason: string
}

export interface AdaptivePlan {
  items: AdaptivePlanItem[]
  gaps: AdaptivePlanGap[]
}

interface Range { start: number; end: number }
interface Workload { project: Project; remaining: number; block: number; urgency: number }

function localTime(date: Date, time: string): number {
  const [hour, minute] = time.split(":").map(Number)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), hour || 0, minute || 0).getTime()
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function mergeRanges(ranges: Range[]): Range[] {
  const sorted = ranges.filter((range) => range.end > range.start).sort((a, b) => a.start - b.start)
  const merged: Range[] = []
  for (const range of sorted) {
    const previous = merged[merged.length - 1]
    if (!previous || range.start > previous.end) merged.push({ ...range })
    else previous.end = Math.max(previous.end, range.end)
  }
  return merged
}

function freeRanges(window: Range, busy: Range[]): Range[] {
  const result: Range[] = []
  let cursor = window.start
  for (const range of mergeRanges(busy)) {
    if (range.end <= window.start || range.start >= window.end) continue
    if (range.start > cursor) result.push({ start: cursor, end: Math.min(range.start, window.end) })
    cursor = Math.max(cursor, range.end)
    if (cursor >= window.end) break
  }
  if (cursor < window.end) result.push({ start: cursor, end: window.end })
  return result.filter((range) => range.end - range.start >= 15 * MINUTE_MS)
}

function deadlineMs(project: Project): number {
  if (!project.deadline) return Number.POSITIVE_INFINITY
  const value = new Date(project.deadline).getTime()
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY
}

function projectUrgency(project: Project, now: number): number {
  const days = Math.max(0, (deadlineMs(project) - now) / DAY_MS)
  const deadlinePressure = Number.isFinite(days) ? Math.max(0, 120 - days * 5) : 0
  const mastery = getProjectMasteryScore(project)
  const weakness = mastery === null ? 20 : 100 - mastery
  return deadlinePressure + weakness + (project.isFavorite ? 15 : 0)
}

function buildWorkloads(projects: Project[], sessions: StudySession[], now: number): Workload[] {
  return projects.flatMap((project): Workload[] => {
    if (project.isArchived || project.isFinished || !project.planning) return []
    const completed = sessions
      .filter((session) => session.projectId === project.id && session.status === "completed")
      .reduce((sum, session) => sum + getSessionEffectiveMinutes(session), 0)
    const alreadyPlanned = sessions
      .filter((session) => session.projectId === project.id && session.status === "planned" && new Date(session.startTime).getTime() >= now)
      .reduce((sum, session) => sum + getSessionEffectiveMinutes(session), 0)
    const remaining = Math.max(0, project.planning.estimatedMinutes - completed - alreadyPlanned)
    if (remaining === 0) return []
    return [{
      project,
      remaining,
      block: Math.max(15, Math.min(180, project.planning.sessionMinutes || 45)),
      urgency: projectUrgency(project, now),
    }]
  }).sort((a, b) => b.urgency - a.urgency || deadlineMs(a.project) - deadlineMs(b.project))
}

function eventRange(event: CalendarEvent): Range | null {
  const start = new Date(event.startTime).getTime()
  const end = new Date(event.endTime ?? new Date(start + 30 * MINUTE_MS).toISOString()).getTime()
  return Number.isFinite(start) && Number.isFinite(end) ? { start, end } : null
}

export function buildAdaptivePlan({
  projects,
  sessions,
  events,
  timetable,
  config = DEFAULT_ADAPTIVE_PLANNER_CONFIG,
  now = new Date(),
}: {
  projects: Project[]
  sessions: StudySession[]
  events: CalendarEvent[]
  timetable?: TimetableConfig | null
  config?: AdaptivePlannerConfig
  now?: Date
}): AdaptivePlan {
  const nowMs = now.getTime()
  const workloads = buildWorkloads(projects, sessions, nowMs)
  const slots: (Range & { dayKey: string })[] = []
  const dailyUsed = new Map<string, number>()

  const firstDay = startOfDay(now)
  for (let offset = 0; offset < Math.max(1, config.horizonDays); offset++) {
    const day = new Date(firstDay)
    day.setDate(firstDay.getDate() + offset)
    const weekend = day.getDay() === 0 || day.getDay() === 6
    const window = {
      start: Math.max(localTime(day, weekend ? config.weekendStart : config.weekdayStart), nowMs),
      end: localTime(day, weekend ? config.weekendEnd : config.weekdayEnd),
    }
    if (window.end <= window.start) continue
    const dayEnd = startOfDay(new Date(day.getTime() + DAY_MS)).getTime()
    const busy: Range[] = []
    for (const event of events) {
      const range = eventRange(event)
      if (range && range.start < dayEnd && range.end > day.getTime()) busy.push(range)
    }
    for (const session of sessions) {
      if (session.status === "completed") continue
      for (const block of session.schedule.blocks) {
        const start = new Date(block.start).getTime()
        const end = new Date(block.end).getTime()
        if (start < dayEnd && end > day.getTime()) busy.push({ start, end })
      }
    }
    if (timetable?.enabled) {
      for (const period of getTimetablePeriodsForDate(day, timetable)) {
        busy.push({ start: localTime(day, period.startTime), end: localTime(day, period.endTime) })
      }
    }
    const dayKey = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`
    slots.push(...freeRanges(window, busy).map((slot) => ({ ...slot, dayKey })))
  }

  const items: AdaptivePlanItem[] = []
  const projectDays = new Map<string, Set<string>>()
  let progress = true
  while (progress && workloads.some((workload) => workload.remaining > 0)) {
    progress = false
    for (const workload of workloads) {
      if (workload.remaining <= 0) continue
      const deadline = deadlineMs(workload.project)
      const canUseSlot = (slot: Range & { dayKey: string }) => {
        const available = (slot.end - slot.start) / MINUTE_MS
        const used = dailyUsed.get(slot.dayKey) ?? 0
        return slot.start <= deadline && available >= 15 && used < config.maxDailyMinutes
      }
      const usedDays = projectDays.get(workload.project.id) ?? new Set<string>()
      let slotIndex = slots.findIndex((slot) => canUseSlot(slot) && !usedDays.has(slot.dayKey))
      if (slotIndex < 0) slotIndex = slots.findIndex(canUseSlot)
      if (slotIndex < 0) continue
      const slot = slots[slotIndex]
      const dailyAvailable = config.maxDailyMinutes - (dailyUsed.get(slot.dayKey) ?? 0)
      const slotMinutes = Math.floor((slot.end - slot.start) / MINUTE_MS)
      const minutes = Math.min(workload.block, Math.max(15, workload.remaining), dailyAvailable, slotMinutes)
      if (minutes < 15) continue
      const weakTopic = getProjectTopicMastery(workload.project)[0]?.topic
      const nextTask = workload.project.checklist?.find((item) => !item.completed)?.text
      const title = nextTask ?? (weakTopic ? `Review ${weakTopic}` : `Prepare ${workload.project.name}`)
      const start = slot.start
      const end = start + minutes * MINUTE_MS
      items.push({
        projectId: workload.project.id,
        subjectIds: workload.project.subjectId ? [workload.project.subjectId] : [],
        title,
        startTime: new Date(start).toISOString(),
        endTime: new Date(end).toISOString(),
        topics: weakTopic ? [weakTopic] : undefined,
        description: `Adaptive plan for ${workload.project.name}`,
      })
      workload.remaining = Math.max(0, workload.remaining - minutes)
      dailyUsed.set(slot.dayKey, (dailyUsed.get(slot.dayKey) ?? 0) + minutes)
      usedDays.add(slot.dayKey)
      projectDays.set(workload.project.id, usedDays)
      slot.start = end + config.breakMinutes * MINUTE_MS
      if (slot.end - slot.start < 15 * MINUTE_MS) slots.splice(slotIndex, 1)
      progress = true
    }
  }

  return {
    items: items.sort((a, b) => a.startTime.localeCompare(b.startTime)),
    gaps: workloads.filter((workload) => workload.remaining > 0).map((workload) => ({
      projectId: workload.project.id,
      projectName: workload.project.name,
      minutes: workload.remaining,
      reason: deadlineMs(workload.project) < nowMs + config.horizonDays * DAY_MS
        ? "Not enough free time before the deadline"
        : "Not enough free time in this planning window",
    })),
  }
}
