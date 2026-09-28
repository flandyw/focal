import { normaliseComparisonName } from "@/lib/exam-data"

export type TimetableComponent =
  | "written"
  | "oral"
  | "performance"
  | "gat"
  | "critical-thinking"

export type TimetableEntry = {
  id: string
  date: string
  dateEnd: string | null
  startTime: string | null
  endTime: string | null
  readingMinutes: number | null
  subject: string
  paper: string | null
  component: TimetableComponent
  scheduledNote?: string | null
}

export type Timetable = {
  year: number
  sourceUrl: string
  compiledFromOfficialPublication: string
  exams: TimetableEntry[]
}

export function isTimetableEntry(value: unknown): value is TimetableEntry {
  if (!value || typeof value !== "object") return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.id === "string" &&
    typeof entry.date === "string" &&
    (entry.dateEnd === null || typeof entry.dateEnd === "string") &&
    (entry.startTime === null || typeof entry.startTime === "string") &&
    (entry.endTime === null || typeof entry.endTime === "string") &&
    (entry.readingMinutes === null || typeof entry.readingMinutes === "number") &&
    typeof entry.subject === "string" &&
    (entry.paper === null || typeof entry.paper === "string") &&
    typeof entry.component === "string" &&
    [
      "written",
      "oral",
      "performance",
      "gat",
      "critical-thinking",
    ].includes(entry.component as string) &&
    (entry.scheduledNote === undefined ||
      entry.scheduledNote === null ||
      typeof entry.scheduledNote === "string")
  )
}

export function isTimetable(value: unknown): value is Timetable {
  if (!value || typeof value !== "object") return false
  const timetable = value as Record<string, unknown>
  return (
    typeof timetable.year === "number" &&
    typeof timetable.sourceUrl === "string" &&
    Array.isArray(timetable.exams) &&
    timetable.exams.every(isTimetableEntry)
  )
}

export function getExamStart(entry: TimetableEntry): Date {
  const time = entry.startTime ?? "00:00"
  return new Date(`${entry.date}T${time}:00`)
}

export function getExamEnd(entry: TimetableEntry): Date {
  if (entry.dateEnd) {
    return new Date(`${entry.dateEnd}T23:59:00`)
  }
  const endTime = entry.endTime ?? entry.startTime ?? "23:59"
  return new Date(`${entry.date}T${endTime}:00`)
}

export function isUpcoming(entry: TimetableEntry, now: Date = new Date()): boolean {
  return getExamStart(entry).getTime() > now.getTime()
}

export function isInProgress(entry: TimetableEntry, now: Date = new Date()): boolean {
  const start = getExamStart(entry).getTime()
  const end = getExamEnd(entry).getTime()
  return start <= now.getTime() && now.getTime() <= end
}

export function isPast(entry: TimetableEntry, now: Date = new Date()): boolean {
  return getExamEnd(entry).getTime() < now.getTime()
}

export function daysUntil(entry: TimetableEntry, now: Date = new Date()): number {
  const start = getExamStart(entry)
  const diffMs = start.getTime() - now.getTime()
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24))
}

export function loadTimetable(): Promise<Timetable | null> {
  if (typeof fetch === "undefined") return Promise.resolve(null)
  return fetch("/vce-2026-timetable.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((value: unknown) => (isTimetable(value) ? value : null))
    .catch(() => null)
}

export function formatExamLabel(entry: TimetableEntry): string {
  return entry.paper ? `${entry.subject} · ${entry.paper}` : entry.subject
}

export function formatExamTime(entry: TimetableEntry): string | null {
  if (!entry.startTime) return null
  if (entry.endTime) return `${entry.startTime} – ${entry.endTime}`
  return entry.startTime
}

export function formatExamDate(entry: TimetableEntry): string {
  const start = new Date(`${entry.date}T00:00:00`)
  const startLabel = start.toLocaleDateString("en-AU", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  })
  if (entry.dateEnd && entry.dateEnd !== entry.date) {
    const end = new Date(`${entry.dateEnd}T00:00:00`)
    return `${startLabel} – ${end.toLocaleDateString("en-AU", {
      day: "numeric",
      month: "short",
    })}`
  }
  return startLabel
}

function escapeCalendarText(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll(";", "\\;").replaceAll(",", "\\,").replaceAll("\n", "\\n")
}

function calendarDate(value: string): string {
  return value.replaceAll("-", "")
}

function nextCalendarDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + 1)
  return date.toISOString().slice(0, 10).replaceAll("-", "")
}

export function buildTimetableCalendar(
  entries: TimetableEntry[],
  sourceUrl: string,
  createdAt: Date = new Date(),
): string {
  const stamp = createdAt.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")
  const events = entries.toSorted((a, b) => a.date.localeCompare(b.date)).flatMap((entry) => {
    const dates = entry.startTime
      ? [
          `DTSTART;TZID=Australia/Melbourne:${calendarDate(entry.date)}T${entry.startTime.replace(":", "")}00`,
          ...(entry.endTime ? [`DTEND;TZID=Australia/Melbourne:${calendarDate(entry.date)}T${entry.endTime.replace(":", "")}00`] : []),
        ]
      : [
          `DTSTART;VALUE=DATE:${calendarDate(entry.date)}`,
          `DTEND;VALUE=DATE:${nextCalendarDate(entry.dateEnd ?? entry.date)}`,
        ]
    const description = [
      entry.readingMinutes === null ? null : `${entry.readingMinutes} minutes reading time`,
      entry.scheduledNote ?? null,
    ].filter(Boolean).join(". ")
    return [
      "BEGIN:VEVENT",
      `UID:${escapeCalendarText(entry.id)}@examtrack.local`,
      `DTSTAMP:${stamp}`,
      ...dates,
      `SUMMARY:${escapeCalendarText(`VCE ${formatExamLabel(entry)}`)}`,
      ...(description ? [`DESCRIPTION:${escapeCalendarText(description)}`] : []),
      `URL:${escapeCalendarText(sourceUrl)}`,
      "END:VEVENT",
    ]
  })
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ExamTrack//VCE Exam Timetable//EN",
    "CALSCALE:GREGORIAN",
    "X-WR-TIMEZONE:Australia/Melbourne",
    ...events,
    "END:VCALENDAR",
    "",
  ].join("\r\n")
}

/** Suggest untracked official VCE exams for a practiced subject. */
export function suggestTimetableForAttempt(
  attempt: { subject: string },
  timetable: Timetable,
  trackedIds: ReadonlyArray<string>,
): TimetableEntry[] {
  const subject = normaliseComparisonName(attempt.subject)
  if (!subject) return []
  const tracked = new Set(trackedIds)
  return timetable.exams
    .filter((entry) => normaliseComparisonName(entry.subject) === subject && !tracked.has(entry.id))
    .toSorted((first, second) => {
      const dateCompare = first.date.localeCompare(second.date)
      if (dateCompare !== 0) return dateCompare
      return (first.startTime ?? "").localeCompare(second.startTime ?? "")
    })
}
