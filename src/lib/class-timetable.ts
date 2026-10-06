import { VCE_SUBJECTS, type TimetableConfig, type TimetablePeriod } from "./types"
import { getDayLabelForDate, getTimetablePeriodsForDate, resolveTimetableSubject } from "./class-timetable-core"
import { normaliseComparisonName } from "./exam-data"

export { getDayLabelForDate, getTimetablePeriodsForDate }
export {
  TIMETABLE_SCREENSHOT_PROMPT,
  getTimetablePeriodError,
  isTimetableBreakLabel,
  parseTimetableImport,
  timetableTimeToMinutes,
} from "./class-timetable-core"

/** The class timetable shares its shape (and sync row) with the desktop app. */
export function defaultClassTimetable(now = new Date()): TimetableConfig {
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7))
  const day1Starts = `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, "0")}-${String(monday.getDate()).padStart(2, "0")}`
  return { enabled: true, day1Starts, holidays: [], entries: [], cycleLength: 10, weekendTimetables: false }
}

/** Events store the desktop subject id when the name is a known VCE subject, so both apps agree. */
export function subjectIdFor(name: string): string {
  const key = normaliseComparisonName(name)
  return VCE_SUBJECTS.find((subject) => normaliseComparisonName(subject.name) === key)?.id ?? name
}

export function subjectNameFor(id: string | undefined): string {
  if (!id) return ""
  return VCE_SUBJECTS.find((subject) => subject.id === id)?.name ?? id
}

/** A period's subject may be a desktop id, a display name, or a school label like "VCE Biology Units 3&4". */
export function periodSubjectName(period: TimetablePeriod): string {
  return resolveTimetableSubject(period.subject, VCE_SUBJECTS)?.name ?? period.subject
}

export function periodMatchesSubject(period: TimetablePeriod, subjectName: string): boolean {
  return Boolean(subjectName) && normaliseComparisonName(periodSubjectName(period)) === normaliseComparisonName(subjectName)
}

export function classPeriodsOn(date: string, config: TimetableConfig | undefined): TimetablePeriod[] {
  if (!config) return []
  const [year, month, day] = date.split("-").map(Number)
  if (!year || !month || !day) return []
  return getTimetablePeriodsForDate(new Date(year, month - 1, day), config)
}
