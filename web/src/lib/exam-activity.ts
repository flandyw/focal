import type { ExamAttempt } from "@/lib/exam-data"

const DAY_MS = 24 * 60 * 60 * 1000
const DAYS_IN_RANGE = 365
const DAYS_IN_WEEK = 7

export type ExamActivityLevel = 0 | 1 | 2 | 3 | 4

export type ExamActivityDay = {
  date: string
  count: number
  level: ExamActivityLevel
  inRange: boolean
}

export type ExamActivityMonth = {
  label: string
  weekIndex: number
}

export type ExamActivity = {
  weeks: ExamActivityDay[][]
  months: ExamActivityMonth[]
  total: number
  activeDays: number
  longestStreak: number
  rangeStart: string
  rangeEnd: string
}

function normaliseDate(date: Date) {
  return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
}

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function formatDate(date: Date) {
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, "0")
  const day = String(date.getUTCDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function addDays(date: Date, days: number) {
  return new Date(date.getTime() + days * DAY_MS)
}

function activityLevel(count: number): ExamActivityLevel {
  if (count <= 0) return 0
  if (count === 1) return 1
  if (count === 2) return 2
  if (count === 3) return 3
  return 4
}

export function buildExamActivity(
  attempts: Pick<ExamAttempt, "completedAt">[],
  endDate = new Date(),
): ExamActivity {
  const rangeEndDate = normaliseDate(endDate)
  const rangeStartDate = addDays(rangeEndDate, -(DAYS_IN_RANGE - 1))
  const gridStartDate = addDays(rangeStartDate, -rangeStartDate.getUTCDay())
  const dayCount = Math.ceil((rangeEndDate.getTime() - gridStartDate.getTime() + DAY_MS) / DAY_MS)
  const weekCount = Math.ceil(dayCount / DAYS_IN_WEEK)
  const rangeStart = formatDate(rangeStartDate)
  const rangeEnd = formatDate(rangeEndDate)
  const counts = new Map<string, number>()

  for (const attempt of attempts) {
    if (attempt.completedAt < rangeStart || attempt.completedAt > rangeEnd) continue
    counts.set(attempt.completedAt, (counts.get(attempt.completedAt) ?? 0) + 1)
  }

  const weeks = Array.from({ length: weekCount }, (_, weekIndex) =>
    Array.from({ length: DAYS_IN_WEEK }, (_, dayIndex) => {
      const date = formatDate(addDays(gridStartDate, weekIndex * DAYS_IN_WEEK + dayIndex))
      const inRange = date >= rangeStart && date <= rangeEnd
      const count = inRange ? (counts.get(date) ?? 0) : 0
      return { date, count, level: activityLevel(count), inRange }
    }),
  )

  const months: ExamActivityMonth[] = []
  let previousMonth = ""
  let previousLabelWeek = -4
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const firstVisibleDay = weeks[weekIndex].find((day) => day.inRange)
    if (!firstVisibleDay) continue
    const date = parseDate(firstVisibleDay.date)
    const monthKey = `${date.getUTCFullYear()}-${date.getUTCMonth()}`
    if (monthKey === previousMonth) continue
    previousMonth = monthKey
    if (weekIndex - previousLabelWeek < 4) continue
    months.push({
      label: date.toLocaleDateString("en-AU", { month: "short", timeZone: "UTC" }),
      weekIndex,
    })
    previousLabelWeek = weekIndex
  }

  let longestStreak = 0
  let currentStreak = 0
  for (let offset = 0; offset < DAYS_IN_RANGE; offset += 1) {
    const count = counts.get(formatDate(addDays(rangeStartDate, offset))) ?? 0
    if (count > 0) {
      currentStreak += 1
      longestStreak = Math.max(longestStreak, currentStreak)
    } else {
      currentStreak = 0
    }
  }

  return {
    weeks,
    months,
    total: [...counts.values()].reduce((total, count) => total + count, 0),
    activeDays: counts.size,
    longestStreak,
    rangeStart,
    rangeEnd,
  }
}
