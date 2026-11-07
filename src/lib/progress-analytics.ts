import type { Project, StudySession } from "./types"
import { getSessionSubjectIds, getSessionEffectiveMinutes } from "./progress-utils.js"

export type AnalyticsRange = 7 | 30 | 90 | 365 | 0

export interface StudyTimePoint {
  date: string
  minutes: number
  subjectId?: string
}

export interface SubjectMinutes {
  subjectId: string
  minutes: number
  percentage: number
}

export interface ConsistencyDay {
  date: string
  minutes: number
  level: 0 | 1 | 2 | 3 | 4
}

export interface ConsistencyStats {
  currentStreak: number
  longestStreak: number
  totalStudyDays: number
  totalMinutes: number
  averageMinutesPerDay: number
}

export interface TimeOfDayBucket {
  hour: number
  minutes: number
}

interface SubjectTimeOfDayBucket extends TimeOfDayBucket {
  subjectId: string
}

export interface SubjectCompletion {
  subjectId: string
  completed: number
  total: number
  rate: number
}

export interface EfficiencyPoint {
  subjectId: string
  minutes: number
  averageConfidence: number
  sessionCount: number
}

export interface AnalyticsData {
  timeTrends: StudyTimePoint[]
  subjectBreakdown: SubjectMinutes[]
  consistency: { days: ConsistencyDay[]; stats: ConsistencyStats }
  timeOfDay: TimeOfDayBucket[]
  timeOfDayBySubject: SubjectTimeOfDayBucket[]
  subjectCompletion: SubjectCompletion[]
  efficiency: EfficiencyPoint[]
  hasData: boolean
}

export interface StudyPeriodComparison {
  currentMinutes: number
  previousMinutes: number
  changePercent: number | null
}

interface SessionAnalytics {
  session: StudySession
  start: number
  minutes: number
  subjectIds: string[]
  shares: number[]
}

function getSessionAnalyticsStart(session: StudySession): number {
  if (session.execution.state !== "planned") {
    let earliest = Infinity
    for (const interval of session.execution.intervals) {
      const start = Date.parse(interval.start)
      if (Number.isFinite(start)) earliest = Math.min(earliest, start)
    }
    if (earliest !== Infinity) return earliest
  }
  return Date.parse(session.schedule.blocks[0]?.start ?? "")
}

function toDateString(timestamp: number): string {
  const d = new Date(timestamp)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getRangeCutoff(range: AnalyticsRange, periodEnd = Date.now()): number {
  if (range === 0) return 0
  const start = new Date(periodEnd)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (range - 1))
  return start.getTime()
}

function splitMinutesAcrossSubjects(minutes: number, subjectIds: string[]): number[] {
  if (subjectIds.length <= 1) return [minutes]
  const base = Math.floor(minutes / subjectIds.length)
  const remainder = minutes % subjectIds.length
  return subjectIds.map((_, index) => base + (index < remainder ? 1 : 0))
}

export function getStudyPeriodComparison(
  sessions: StudySession[],
  projects: Project[],
  range: AnalyticsRange,
  subjectIds?: ReadonlySet<string>,
  now = Date.now(),
): StudyPeriodComparison | null {
  if (range === 0) return null

  const currentStart = new Date(now)
  currentStart.setHours(0, 0, 0, 0)
  currentStart.setDate(currentStart.getDate() - (range - 1))
  const previousStart = new Date(currentStart)
  previousStart.setDate(previousStart.getDate() - range)
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const currentCutoff = currentStart.getTime()
  const previousCutoff = previousStart.getTime()

  let currentMinutes = 0
  let previousMinutes = 0
  for (const session of sessions) {
    if (session.execution.state !== "completed") continue
    const start = getSessionAnalyticsStart(session)
    if (!Number.isFinite(start) || start < previousCutoff || start > now) continue
    const minutes = getSessionEffectiveMinutes(session)
    if (minutes <= 0) continue

    const resolvedSubjectIds = getSessionSubjectIds(
      session,
      session.projectId ? projectsById.get(session.projectId) : undefined,
    )
    const subjects = resolvedSubjectIds.length > 0 ? resolvedSubjectIds : ["_unassigned"]
    const includedMinutes = splitMinutesAcrossSubjects(minutes, subjects).reduce(
      (total, share, index) => total + (subjectIds == null || subjectIds.has(subjects[index]) ? share : 0),
      0,
    )

    if (start >= currentCutoff) currentMinutes += includedMinutes
    else previousMinutes += includedMinutes
  }

  return {
    currentMinutes,
    previousMinutes,
    changePercent: previousMinutes > 0
      ? Math.round(((currentMinutes - previousMinutes) / previousMinutes) * 100)
      : null,
  }
}

function getTimeTrends(completed: SessionAnalytics[]): StudyTimePoint[] {
  const dayMap = new Map<string, Map<string, number>>()

  completed.forEach(({ start, minutes, subjectIds, shares }) => {
    const dateStr = toDateString(start)
    if (minutes <= 0) return

    const subjectMap = dayMap.get(dateStr) ?? new Map<string, number>()

    if (subjectIds.length > 0) {
      subjectIds.forEach((subjectId, index) => {
        subjectMap.set(subjectId, (subjectMap.get(subjectId) ?? 0) + shares[index])
      })
    } else {
      subjectMap.set("_unassigned", (subjectMap.get("_unassigned") ?? 0) + minutes)
    }
    dayMap.set(dateStr, subjectMap)
  })

  const points: StudyTimePoint[] = []
  dayMap.forEach((subjectMap, dateStr) => {
    subjectMap.forEach((minutes, subjectId) => {
      points.push({
        date: dateStr,
        minutes,
        subjectId: subjectId === "_unassigned" ? undefined : subjectId,
      })
    })
  })

  points.sort((a, b) => a.date.localeCompare(b.date))
  return points
}

function getSubjectBreakdown(completed: SessionAnalytics[]): SubjectMinutes[] {
  const subjectMinutes = new Map<string, number>()
  let total = 0

  completed.forEach(({ minutes, subjectIds, shares }) => {
    if (minutes <= 0) return
    if (subjectIds.length === 0) {
      subjectMinutes.set("_unassigned", (subjectMinutes.get("_unassigned") ?? 0) + minutes)
    } else {
      subjectIds.forEach((id, index) => {
        subjectMinutes.set(id, (subjectMinutes.get(id) ?? 0) + shares[index])
      })
    }
    total += minutes
  })

  return Array.from(subjectMinutes.entries())
    .map(([subjectId, minutes]) => ({
      subjectId,
      minutes,
      percentage: total > 0 ? Math.round((minutes / total) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes)
}

function getConsistencyData(
  completed: SessionAnalytics[],
  range: AnalyticsRange,
  periodEnd = Date.now(),
): { days: ConsistencyDay[]; stats: ConsistencyStats } {
  const minutesByDay = new Map<string, number>()

  completed.forEach(({ start, minutes }) => {
    const dateStr = toDateString(start)
    if (minutes > 0) {
      minutesByDay.set(dateStr, (minutesByDay.get(dateStr) ?? 0) + minutes)
    }
  })

  const endDate = new Date(periodEnd)
  const earliestCompletedStart = completed.reduce<number | null>(
    (earliest, { start }) => earliest == null ? start : Math.min(earliest, start), null,
  )
  const startDate = range === 0 && earliestCompletedStart != null
    ? new Date(earliestCompletedStart)
    : new Date(range === 0 ? periodEnd : getRangeCutoff(range, periodEnd))
  startDate.setHours(0, 0, 0, 0)

  const days: ConsistencyDay[] = []
  const current = new Date(startDate)
  while (current <= endDate) {
    const dateStr = toDateString(current.getTime())
    const minutes = minutesByDay.get(dateStr) ?? 0
    days.push({ date: dateStr, minutes, level: getHeatLevel(minutes) })
    current.setDate(current.getDate() + 1)
  }

  const stats = computeStreaks(days)
  return { days, stats }
}

export function getConsistencyForTimeTrends(
  days: ConsistencyDay[],
  points: StudyTimePoint[],
): { days: ConsistencyDay[]; stats: ConsistencyStats } {
  const minutesByDay = new Map<string, number>()
  for (const point of points) {
    minutesByDay.set(point.date, (minutesByDay.get(point.date) ?? 0) + point.minutes)
  }
  const filteredDays = days.map((day) => {
    const minutes = minutesByDay.get(day.date) ?? 0
    return { ...day, minutes, level: getHeatLevel(minutes) }
  })
  return { days: filteredDays, stats: computeStreaks(filteredDays) }
}

function getHeatLevel(minutes: number): 0 | 1 | 2 | 3 | 4 {
  if (minutes === 0) return 0
  if (minutes <= 30) return 1
  if (minutes <= 60) return 2
  if (minutes <= 120) return 3
  return 4
}

function computeStreaks(days: ConsistencyDay[]): ConsistencyStats {
  let longestStreak = 0
  let streak = 0
  let totalStudyDays = 0
  let totalMinutes = 0

  for (const day of days) {
    totalMinutes += day.minutes
    if (day.minutes > 0) {
      totalStudyDays++
      streak++
      longestStreak = Math.max(longestStreak, streak)
    } else {
      streak = 0
    }
  }

  const todayStr = toDateString(Date.now())
  let currentIndex = days.length - 1
  if (days[currentIndex]?.date === todayStr && days[currentIndex].minutes === 0) {
    currentIndex--
  }
  let currentStreak = 0
  while (currentIndex >= 0 && days[currentIndex].minutes > 0) {
    currentStreak++
    currentIndex--
  }

  const averageMinutesPerDay = days.length > 0 ? Math.round(totalMinutes / days.length) : 0

  return { currentStreak, longestStreak, totalStudyDays, totalMinutes, averageMinutesPerDay }
}

function aggregateTimeOfDay(subjectBuckets: SubjectTimeOfDayBucket[]): TimeOfDayBucket[] {
  const buckets: TimeOfDayBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, minutes: 0 }))
  for (const bucket of subjectBuckets) buckets[bucket.hour].minutes += bucket.minutes
  return buckets
}

function getTimeOfDayBySubject(completed: SessionAnalytics[]): SubjectTimeOfDayBucket[] {
  const buckets = new Map<number, Map<string, number>>()

  for (const { start, minutes, subjectIds, shares } of completed) {
    if (minutes <= 0) continue
    const hour = new Date(start).getHours()
    const subjects = subjectIds.length > 0 ? subjectIds : ["_unassigned"]
    const hourBuckets = buckets.get(hour) ?? new Map<string, number>()
    subjects.forEach((subjectId, index) => {
      hourBuckets.set(subjectId, (hourBuckets.get(subjectId) ?? 0) + shares[index])
    })
    buckets.set(hour, hourBuckets)
  }

  return Array.from(buckets.entries()).flatMap(([hour, subjectBuckets]) =>
    Array.from(subjectBuckets.entries()).map(([subjectId, minutes]) => ({
      hour,
      subjectId,
      minutes,
    })),
  )
}

function getSubjectCompletion(sessions: SessionAnalytics[]): SubjectCompletion[] {
  const subjectStats = new Map<string, { completed: number; total: number }>()

  sessions.forEach(({ session, subjectIds }) => {
    if (subjectIds.length === 0) return

    subjectIds.forEach((subjectId) => {
      const stats = subjectStats.get(subjectId) ?? { completed: 0, total: 0 }
      stats.total++
      if (session.execution.state === "completed") stats.completed++
      subjectStats.set(subjectId, stats)
    })
  })

  return Array.from(subjectStats.entries())
    .map(([subjectId, stats]) => ({
      subjectId,
      completed: stats.completed,
      total: stats.total,
      rate: stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0,
    }))
    .sort((a, b) => b.rate - a.rate)
}

function getStudyEfficiency(completed: SessionAnalytics[]): EfficiencyPoint[] {
  const subjectData = new Map<string, { totalMinutes: number; totalConfidence: number; count: number }>()

  completed.forEach(({ session, minutes, subjectIds, shares }) => {
    if (minutes <= 0) return
    const confidence = session.reflection?.confidence
    if (confidence === undefined) return

    const subjects = subjectIds.length > 0 ? subjectIds : ["_unassigned"]

    subjects.forEach((subjectId, index) => {
      const data = subjectData.get(subjectId) ?? { totalMinutes: 0, totalConfidence: 0, count: 0 }
      data.totalMinutes += shares[index]
      data.totalConfidence += confidence
      data.count++
      subjectData.set(subjectId, data)
    })
  })

  return Array.from(subjectData.entries())
    .map(([subjectId, data]) => ({
      subjectId,
      minutes: data.totalMinutes,
      averageConfidence: Math.round((data.totalConfidence / data.count) * 10) / 10,
      sessionCount: data.count,
    }))
    .filter((s) => s.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
}

export function getAnalyticsData(
  sessions: StudySession[],
  projects: Project[],
  range: AnalyticsRange,
  periodEnd = Date.now(),
): AnalyticsData {
  const cutoff = getRangeCutoff(range, periodEnd)
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const inRange: SessionAnalytics[] = []
  for (const session of sessions) {
    const start = getSessionAnalyticsStart(session)
    if (!Number.isFinite(start) || (cutoff > 0 && start < cutoff) || start > periodEnd) continue
    const subjectIds = getSessionSubjectIds(session, session.projectId ? projectsById.get(session.projectId) : undefined)
    const minutes = session.execution.state === "completed" ? getSessionEffectiveMinutes(session) : 0
    inRange.push({ session, start, minutes, subjectIds, shares: splitMinutesAcrossSubjects(minutes, subjectIds) })
  }
  const completed = inRange.filter(({ session }) => session.execution.state === "completed")
  const timeTrends = getTimeTrends(completed)
  const subjectBreakdown = getSubjectBreakdown(completed)
  const consistency = getConsistencyData(completed, range, periodEnd)
  const timeOfDayBySubject = getTimeOfDayBySubject(completed)
  const timeOfDay = aggregateTimeOfDay(timeOfDayBySubject)
  const subjectCompletion = getSubjectCompletion(inRange)
  const efficiency = getStudyEfficiency(completed)
  const hasData = sessions.some((s) => s.execution.state === "completed")

  return { timeTrends, subjectBreakdown, consistency, timeOfDay, timeOfDayBySubject, subjectCompletion, efficiency, hasData }
}
