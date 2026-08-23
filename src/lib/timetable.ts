import type { SchoolHoliday, Subject, TimetableConfig, TimetableDayLabel, TimetableEntry, TimetablePeriod } from "@/lib/types"

// --- Types ---

const TIMETABLE_BREAK_LABELS = new Set([
  "recess",
  "lunch",
  "homeroom",
  "assembly",
  "form",
  "free",
])

// --- Helpers ---

function timeStringToMinutes(t: string): number {
  return timetableTimeToMinutes(t) ?? Number.POSITIVE_INFINITY
}

export const TIMETABLE_SCREENSHOT_PROMPT = `I have attached a screenshot of my school timetable. Convert it into a Focal timetable import file.

Return only valid JSON with no markdown fences, commentary, or citations. Use exactly this shape:
{
  "cycleLength": 10,
  "entries": [
    {
      "dayLabel": 1,
      "periods": [
        {
          "period": "Period 1",
          "subject": "Mathematical Methods",
          "location": "Room 12",
          "startTime": "09:00",
          "endTime": "10:00"
        }
      ]
    }
  ]
}

Requirements:
- Read every visible timetable day and put each day in one entries item.
- dayLabel must be a whole number starting at 1. Preserve numbered cycle days if shown; otherwise number the visible days from left to right.
- cycleLength must equal the timetable cycle length. If the screenshot only shows one five-day school week, use 5. If it shows a two-week Day 1–10 cycle, use 10.
- Use 24-hour HH:mm times with leading zeroes. Copy the displayed times precisely.
- Include classes, study periods, homeroom/form, assembly, recess, lunch, and other visible fixed periods.
- period is the row or period label. subject is the subject exactly as shown. location is the room exactly as shown, or an empty string when none is visible.
- Do not invent unreadable subjects, rooms, days, or times. Use an empty string for an unreadable subject or location. If a start or end time is unreadable, stop and tell me which time needs clarification instead of producing JSON.
- Do not include dates, holidays, colours, teachers, notes, or any keys not shown in the required shape.

Before answering, silently check that every endTime is later than its startTime and that every dayLabel is between 1 and cycleLength. Your final answer must be only the raw JSON so I can save it as focal-timetable.json and import it.`

function timetableImportError(message: string): never {
  throw new Error(`Could not import timetable: ${message}`)
}

function readImportString(record: Record<string, unknown>, key: string, context: string): string {
  const value = record[key]
  if (typeof value !== "string") timetableImportError(`${context} is missing ${key}.`)
  return value.trim()
}

function parseTimetableImportObject(value: unknown, current: TimetableConfig): TimetableConfig {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    timetableImportError("the file must contain one timetable object.")
  }
  const root = value as Record<string, unknown>
  const cycleLength = root.cycleLength
  if (typeof cycleLength !== "number" || !Number.isInteger(cycleLength) || cycleLength < 1 || cycleLength > 60) {
    timetableImportError("cycleLength must be a whole number from 1 to 60.")
  }
  if (!Array.isArray(root.entries) || root.entries.length === 0) {
    timetableImportError("entries must contain at least one day.")
  }

  const entries = root.entries.map((entry, entryIndex): TimetableEntry => {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      timetableImportError(`entry ${entryIndex + 1} must be an object.`)
    }
    const record = entry as Record<string, unknown>
    const dayLabel = record.dayLabel
    if (typeof dayLabel !== "number" || !Number.isInteger(dayLabel) || dayLabel < 1 || dayLabel > cycleLength) {
      timetableImportError(`entry ${entryIndex + 1} has a dayLabel outside 1-${cycleLength}.`)
    }
    if (!Array.isArray(record.periods) || record.periods.length === 0) {
      timetableImportError(`Day ${dayLabel} must contain at least one period.`)
    }
    const periods = record.periods.map((period, periodIndex): TimetablePeriod => {
      const context = `Day ${dayLabel}, period ${periodIndex + 1}`
      if (typeof period !== "object" || period === null || Array.isArray(period)) {
        timetableImportError(`${context} must be an object.`)
      }
      const periodRecord = period as Record<string, unknown>
      const parsed = {
        period: readImportString(periodRecord, "period", context),
        subject: readImportString(periodRecord, "subject", context),
        location: readImportString(periodRecord, "location", context),
        startTime: readImportString(periodRecord, "startTime", context),
        endTime: readImportString(periodRecord, "endTime", context),
      }
      const error = getTimetablePeriodError(parsed)
      if (error) timetableImportError(`${context}: ${error}`)
      return parsed
    })
    return { dayLabel, periods }
  })

  const mergedEntries = Array.from({ length: cycleLength }, (_, index) => ({
    dayLabel: index + 1,
    periods: entries
      .filter((entry) => entry.dayLabel === index + 1)
      .flatMap((entry) => entry.periods)
      .sort(comparePeriodsByStart),
  })).filter((entry) => entry.periods.length > 0)

  return {
    ...current,
    enabled: true,
    cycleLength,
    dayToWeekday: undefined,
    currentDayOverride: null,
    entries: mergedEntries,
  }
}

function directChild(element: Element, name: string): Element | undefined {
  return Array.from(element.children).find((child) => child.tagName.toLowerCase() === name.toLowerCase())
}

function directChildren(element: Element, name: string): Element[] {
  return Array.from(element.children).filter((child) => child.tagName.toLowerCase() === name.toLowerCase())
}

function xmlText(element: Element, name: string): string {
  return directChild(element, name)?.textContent?.trim() ?? ""
}

function parseTimetableXml(content: string): unknown {
  const document = new DOMParser().parseFromString(content, "application/xml")
  if (document.querySelector("parsererror")) timetableImportError("the XML is malformed.")
  const root = document.documentElement
  if (root.tagName.toLowerCase() !== "timetable") timetableImportError("XML must use <timetable> as its root element.")
  const entriesElement = directChild(root, "entries")
  const dayElements = entriesElement ? directChildren(entriesElement, "day") : directChildren(root, "day")
  return {
    cycleLength: Number(root.getAttribute("cycleLength") ?? root.getAttribute("cycle-length")),
    entries: dayElements.map((day) => {
      const periodsElement = directChild(day, "periods")
      const periodElements = periodsElement ? directChildren(periodsElement, "period") : directChildren(day, "period")
      return {
        dayLabel: Number(day.getAttribute("label") ?? day.getAttribute("dayLabel")),
        periods: periodElements.map((period) => ({
          period: xmlText(period, "name") || xmlText(period, "period"),
          subject: xmlText(period, "subject"),
          location: xmlText(period, "location"),
          startTime: xmlText(period, "startTime"),
          endTime: xmlText(period, "endTime"),
        })),
      }
    }),
  }
}

export function parseTimetableImport(
  content: string,
  fileName: string,
  current: TimetableConfig,
): TimetableConfig {
  const trimmed = content.trim()
  if (!trimmed) timetableImportError("the selected file is empty.")
  const isXml = fileName.toLowerCase().endsWith(".xml") || trimmed.startsWith("<")
  let parsed: unknown
  try {
    parsed = isXml ? parseTimetableXml(trimmed) : JSON.parse(trimmed)
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Could not import timetable:")) throw error
    timetableImportError(isXml ? "the XML is malformed." : "the JSON is malformed.")
  }
  return parseTimetableImportObject(parsed, current)
}

function comparePeriodsByStart(a: TimetablePeriod, b: TimetablePeriod): number {
  return timeStringToMinutes(a.startTime) - timeStringToMinutes(b.startTime)
}

function copyPeriodIntoSlot(
  period: TimetablePeriod,
  slot: Pick<TimetablePeriod, "startTime" | "endTime">,
): TimetablePeriod {
  return { ...period, startTime: slot.startTime, endTime: slot.endTime }
}

function toLocalDateStr(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function isTimetableBreakLabel(label: string): boolean {
  return TIMETABLE_BREAK_LABELS.has(label.trim().toLowerCase())
}

/** Parse a persisted HH:mm value without accepting partial or out-of-range times. */
export function timetableTimeToMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return hours * 60 + minutes
}

export type TimetableMeridiem = "AM" | "PM"

export interface TimetableTimeParts {
  hour: number
  minute: number
  meridiem: TimetableMeridiem
}

export function timetableTimeTo12HourParts(value: string): TimetableTimeParts | null {
  const total = timetableTimeToMinutes(value)
  if (total === null) return null
  const hour24 = Math.floor(total / 60)
  return {
    hour: hour24 % 12 || 12,
    minute: total % 60,
    meridiem: hour24 < 12 ? "AM" : "PM",
  }
}

export function timetableTimeFrom12HourParts(
  hour: number,
  minute: number,
  meridiem: TimetableMeridiem,
): string | null {
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return null
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null
  const hour24 = (hour % 12) + (meridiem === "PM" ? 12 : 0)
  return `${String(hour24).padStart(2, "0")}:${String(minute).padStart(2, "0")}`
}

/** Return a user-facing validation error for a timetable period, or null when valid. */
export function getTimetablePeriodError(period: TimetablePeriod): string | null {
  if (!period.period.trim()) return "Add a period name."
  const start = timetableTimeToMinutes(period.startTime)
  const end = timetableTimeToMinutes(period.endTime)
  if (start === null || end === null) return "Use a valid start and end time."
  if (end <= start) return "End time must be after start time."
  return null
}

/** Merge duplicate day entries and return periods in start-time order. */
export function getTimetablePeriodsForDay(
  dayLabel: TimetableDayLabel,
  entries: TimetableEntry[],
): TimetablePeriod[] {
  return entries
    .filter((entry) => entry.dayLabel === dayLabel)
    .flatMap((entry) => entry.periods)
    .sort(comparePeriodsByStart)
}

/** Resolve persisted timetable subjects from either IDs or imported display names. */
export function resolveTimetableSubject(value: string, subjects: Subject[]): Subject | undefined {
  const key = value.trim().toLowerCase()
  if (!key) return undefined
  const exact = subjects.find((subject) => (
    subject.id.toLowerCase() === key
    || subject.name.trim().toLowerCase() === key
    || subject.shortCode.trim().toLowerCase() === key
  ))
  if (exact) return exact

  // Imported school timetables commonly wrap subject names in VCE/unit labels.
  const name = key
    .replace(/^vce\s+/, "")
    .replace(/\s+units?\s+[1-4](?:\s*(?:&|\/|-|–)\s*[1-4])?$/, "")
    .trim()
  return subjects.find((subject) => subject.name.trim().toLowerCase() === name)
}

/**
 * Find every timetable period on a calendar date, respecting the configured cycle.
 * `enabled` only controls the Today dashboard; the saved timetable remains usable elsewhere.
 */
export function getTimetablePeriodsForDate(
  date: Date,
  config: TimetableConfig,
): TimetablePeriod[] {
  const dayLabel = getDayLabelForDate(
    date,
    config.day1Starts,
    config.holidays,
    config.cycleLength,
    config.weekendTimetables,
  )
  if (dayLabel === null) return []
  return getTimetablePeriodsForDay(dayLabel, config.entries)
}

/** Find every period for a subject on a calendar date, respecting the configured cycle. */
export function getTimetablePeriodsForSubjectOnDate(
  date: Date,
  subjectId: string,
  config: TimetableConfig,
): TimetablePeriod[] {
  if (!subjectId) return []
  return getTimetablePeriodsForDate(date, config)
    .filter((period) => period.subject === subjectId)
}

export function reorderPeriodsIntoSlots({
  periods,
  periodToMove,
  insertIndex,
  showBreaks,
}: {
  periods: TimetablePeriod[]
  periodToMove: TimetablePeriod
  insertIndex: number
  showBreaks: boolean
}): TimetablePeriod[] {
  const sortedPeriods = [...periods].sort(comparePeriodsByStart)
  const fixedPeriods = showBreaks
    ? []
    : sortedPeriods.filter((period) => isTimetableBreakLabel(period.period))
  const movablePeriods = showBreaks
    ? sortedPeriods
    : sortedPeriods.filter((period) => !isTimetableBreakLabel(period.period))
  const orderedMovablePeriods = [...movablePeriods]
  orderedMovablePeriods.splice(
    Math.min(Math.max(insertIndex, 0), orderedMovablePeriods.length),
    0,
    { ...periodToMove },
  )
  const movableSlots = [...movablePeriods, periodToMove].sort(
    comparePeriodsByStart,
  )
  const retimedMovablePeriods = orderedMovablePeriods.map((period, i) =>
    copyPeriodIntoSlot(period, movableSlots[i] ?? period),
  )
  return [...fixedPeriods, ...retimedMovablePeriods].sort(comparePeriodsByStart)
}

export function isDateInHoliday(date: Date, holidays: SchoolHoliday[]): boolean {
  const dateStr = toLocalDateStr(date)
  return holidays.some((h) => dateStr >= h.startDate && dateStr <= h.endDate)
}

/**
 * Count weekdays (Mon–Fri) between two local-midnight dates, excluding the start date
 * and including the end date. Counts only school days, skipping weekends.
 */
function countSchoolDaysBetween(
  start: Date,
  end: Date,
  holidays: SchoolHoliday[],
  weekendTimetables: boolean,
): number {
  let count = 0
  const cursor = new Date(start)

  // ponytail: a day-by-day scan keeps overlapping holidays correct. School
  // cycles are short; upgrade to merged date ranges only if multi-decade spans matter.
  while (cursor < end) {
    cursor.setDate(cursor.getDate() + 1)
    const weekend = cursor.getDay() === 0 || cursor.getDay() === 6
    if ((weekendTimetables || !weekend) && !isDateInHoliday(cursor, holidays)) count++
  }

  return count
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2]) - 1
  const day = Number(match[3])
  const date = new Date(year, month, day)
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== day) return null
  return date
}

/**
 * Compute the day label (1..cycleLength) for a given date based on the configured day-1 start date.
 * When `weekendTimetables` is false (default), weekends (Sat/Sun) are skipped and the function
 * returns null. When true, all 7 days count toward the cycle so Saturday/Sunday have their own
 * day-labels according to dayToWeekday.
 * Returns null if the date falls within a holiday period, or before day-1 starts.
 *
 * Uses local-date arithmetic so behaviour is consistent across timezones — VCE schools
 * operate on local calendar days, not UTC days.
 */
export function getDayLabelForDate(
  date: Date,
  day1Starts: string,
  holidays: SchoolHoliday[],
  cycleLength = 10,
  weekendTimetables = false,
): TimetableDayLabel | null {
  if (isDateInHoliday(date, holidays)) return null

  const start = parseLocalDate(day1Starts)
  if (!start) return null

  const msPerDay = 24 * 60 * 60 * 1000
  // Compare in local-midnight space so the diff isn't skewed by time-of-day or timezone.
  const startLocal = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const dateLocal = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const diffDays = Math.round((dateLocal.getTime() - startLocal.getTime()) / msPerDay)
  if (diffDays < 0) return null

  // When weekend timetables are off, Sat(6)/Sun(0) are not school days.
  if (!weekendTimetables && (dateLocal.getDay() === 0 || dateLocal.getDay() === 6)) return null

  // Count school days since day1Starts. When weekend timetables are on, count
  // every day; otherwise only Mon–Fri.
  const schoolDayCount = countSchoolDaysBetween(startLocal, dateLocal, holidays, weekendTimetables)
  const length = Number.isInteger(cycleLength) && cycleLength >= 1 ? cycleLength : 10
  return (schoolDayCount % length) + 1
}

/** Find the next calendar date that has a timetable day. */
export function getNextTimetableDay(
  date: Date,
  day1Starts: string,
  holidays: SchoolHoliday[],
  cycleLength = 10,
  weekendTimetables = false,
): { date: Date; dayLabel: TimetableDayLabel } | null {
  const candidate = new Date(date)

  // ponytail: one year covers normal school breaks; lift the cap if multi-year
  // timetable pauses ever become a supported use case.
  for (let offset = 1; offset <= 366; offset++) {
    candidate.setDate(candidate.getDate() + 1)
    const dayLabel = getDayLabelForDate(
      candidate,
      day1Starts,
      holidays,
      cycleLength,
      weekendTimetables,
    )
    if (dayLabel !== null) return { date: candidate, dayLabel }
  }

  return null
}

/**
 * Find the timetable entries for a given day label.
 */
export function getTimetableEntriesForDay(
  dayLabel: TimetableDayLabel,
  entries: TimetableEntry[],
): TimetableEntry[] {
  return entries.filter((e) => e.dayLabel === dayLabel)
}

export interface CurrentPeriodInfo {
  current: TimetablePeriod | null
  next: TimetablePeriod | null
  remainingMinutes: number
}

/**
 * Find the current (in-progress) and next upcoming period from a list of periods,
 * based on the current wall-clock time.
 *
 * Sorts periods by start time internally so the result is correct regardless of input order.
 * Periods with invalid (NaN) times are skipped. If the current time is before all periods,
 * the first period is reported as `next`. If after all periods, `next` is null.
 */
export function getCurrentPeriodInfo(periods: TimetablePeriod[], now?: Date): CurrentPeriodInfo {
  const date = now ?? new Date()
  const currentMinutes = date.getHours() * 60 + date.getMinutes()

  const parsed = periods
    .map((p) => {
      const start = timetableTimeToMinutes(p.startTime)
      const end = timetableTimeToMinutes(p.endTime)
      if (start === null || end === null) return null
      if (end <= start) return null
      return { period: p, start, end }
    })
    .filter((p): p is { period: TimetablePeriod; start: number; end: number } => p !== null)
    .sort((a, b) => a.start - b.start)

  let current: TimetablePeriod | null = null
  let next: TimetablePeriod | null = null
  let remainingMinutes = 0

  for (const p of parsed) {
    if (currentMinutes >= p.start && currentMinutes < p.end) {
      current = p.period
      remainingMinutes = p.end - currentMinutes
      // A current period is in progress; `next` is the period after it.
      continue
    }
    if (current === null && currentMinutes < p.start && next === null) {
      next = p.period
    } else if (current !== null && next === null && p.start > currentMinutes) {
      next = p.period
    }
  }

  return { current, next, remainingMinutes }
}
