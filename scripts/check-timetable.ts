import {
  getDayLabelForDate,
  getNextTimetableDay,
  getTimetablePeriodError,
  getTimetablePeriodsForDay,
  getTimetablePeriodsForDate,
  getTimetablePeriodsForSubjectOnDate,
  isTimetableBreakLabel,
  parseTimetableImport,
  resolveTimetableSubject,
  TIMETABLE_SCREENSHOT_PROMPT,
  timetableTimeFrom12HourParts,
  timetableTimeTo12HourParts,
  timetableTimeToMinutes,
} from "../src/lib/timetable.ts"
import { VCE_SUBJECTS } from "../src/lib/types.ts"

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message)
}

check(timetableTimeToMinutes("09:35") === 575, "valid time should parse")
check(timetableTimeToMinutes("9:35") === null, "partial time should be rejected")
check(timetableTimeToMinutes("24:00") === null, "out-of-range time should be rejected")
check(isTimetableBreakLabel(" Lunch "), "break labels should ignore case and whitespace")
check(timetableTimeFrom12HourParts(12, 15, "AM") === "00:15", "12 AM should convert to midnight")
check(timetableTimeFrom12HourParts(12, 15, "PM") === "12:15", "12 PM should stay noon")
check(timetableTimeFrom12HourParts(1, 45, "PM") === "13:45", "PM time should convert to 24-hour storage")
check(timetableTimeTo12HourParts("00:15")?.hour === 12, "midnight should display as 12 AM")
check(timetableTimeTo12HourParts("13:45")?.meridiem === "PM", "afternoon time should display as PM")

check(
  getTimetablePeriodError({ period: "Period 1", subject: "eng", startTime: "10:00", endTime: "09:00" }) === "End time must be after start time.",
  "invalid period range should be rejected",
)

const periods = getTimetablePeriodsForDay(2, [
  { dayLabel: 2, periods: [{ period: "Period 2", subject: "chem", startTime: "10:00", endTime: "11:00" }] },
  { dayLabel: 1, periods: [{ period: "Other day", subject: "eng", startTime: "08:00", endTime: "09:00" }] },
  { dayLabel: 2, periods: [{ period: "Period 1", subject: "eng", startTime: "09:00", endTime: "10:00" }] },
])
check(periods.map((period) => period.period).join(",") === "Period 1,Period 2", "duplicate day entries should merge and sort")

const subjectPeriods = getTimetablePeriodsForSubjectOnDate(new Date(2026, 0, 27), "chem", {
  enabled: true,
  day1Starts: "2026-01-26",
  holidays: [],
  cycleLength: 10,
  entries: [
    { dayLabel: 2, periods: [
      { period: "Period 1", subject: "eng", startTime: "09:00", endTime: "10:00" },
      { period: "Period 2", subject: "chem", startTime: "10:00", endTime: "11:00" },
    ] },
  ],
})
check(subjectPeriods.map((period) => period.period).join(",") === "Period 2", "subject periods should use the date's cycle day")
check(
  getTimetablePeriodsForDate(new Date(2026, 0, 27), {
    enabled: false,
    day1Starts: "2026-01-26",
    holidays: [],
    cycleLength: 10,
    entries: [{ dayLabel: 2, periods: [
      { period: "Period 1", subject: "eng", startTime: "09:00", endTime: "10:00" },
      { period: "Period 2", subject: "chem", startTime: "10:00", endTime: "11:00" },
    ] }],
  }).length === 2,
  "date periods should remain available when the timetable is hidden from Today",
)

const imported = parseTimetableImport(JSON.stringify({
  cycleLength: 5,
  entries: [
    { dayLabel: 2, periods: [{ period: "Period 2", subject: "Chemistry", location: "Lab 1", startTime: "10:00", endTime: "11:00" }] },
    { dayLabel: 2, periods: [{ period: "Period 1", subject: "English", location: "", startTime: "09:00", endTime: "10:00" }] },
  ],
}), "timetable.json", {
  enabled: false,
  day1Starts: "2026-01-26",
  holidays: [],
  entries: [],
  cycleLength: 10,
})
check(imported.enabled, "an imported timetable should be enabled")
check(imported.cycleLength === 5, "the imported cycle length should be used")
check(imported.day1Starts === "2026-01-26", "calendar settings should be preserved")
check(imported.entries[0]?.periods.map((period) => period.period).join(",") === "Period 1,Period 2", "duplicate imported days should merge and sort")
check(
  resolveTimetableSubject(imported.entries[0]?.periods[1]?.subject ?? "", VCE_SUBJECTS)?.id === "chem",
  "imported subject names should resolve to event subject IDs",
)
check(
  resolveTimetableSubject("VCE Business Management Units 3 & 4", VCE_SUBJECTS)?.id === "bm",
  "school timetable labels should resolve after removing VCE unit wrappers",
)
check(TIMETABLE_SCREENSHOT_PROMPT.includes("Return only valid JSON"), "the copyable prompt should require raw JSON")

let rejectedInvalidRange = false
try {
  parseTimetableImport('{"cycleLength":1,"entries":[{"dayLabel":1,"periods":[{"period":"P1","subject":"English","location":"","startTime":"10:00","endTime":"09:00"}]}]}', "bad.json", imported)
} catch {
  rejectedInvalidRange = true
}
check(rejectedInvalidRange, "imports should reject periods that end before they start")

check(getDayLabelForDate(new Date(2026, 0, 30), "2026-01-26", [], 10) === 5, "weekdays should advance the cycle")
check(getDayLabelForDate(new Date(2026, 0, 31), "2026-01-26", [], 10) === null, "weekends should be skipped")
const nextSchoolDay = getNextTimetableDay(new Date(2026, 0, 31), "2026-01-26", [], 10)
check(nextSchoolDay?.date.getDay() === 1, "the next timetable date after a weekend should be Monday")
check(nextSchoolDay?.dayLabel === 6, "the next timetable date should expose Monday's cycle day")
const nextDayAfterBreak = getNextTimetableDay(
  new Date(2026, 0, 31),
  "2026-01-26",
  [{ name: "Break", startDate: "2026-02-02", endDate: "2026-02-06" }],
  10,
)
check(nextDayAfterBreak?.date.getDate() === 9, "the next timetable date should skip school holidays")
check(nextDayAfterBreak?.dayLabel === 6, "school holidays should not advance the cycle")
check(
  getDayLabelForDate(
    new Date(2026, 1, 2),
    "2026-01-26",
    [{ name: "Break", startDate: "2026-02-02", endDate: "2026-02-06" }],
    10,
  ) === null,
  "holidays should pause the timetable",
)
check(
  getDayLabelForDate(
    new Date(2026, 1, 9),
    "2026-01-26",
    [{ name: "Break", startDate: "2026-02-02", endDate: "2026-02-06" }],
    10,
  ) === 6,
  "the cycle should resume where it stopped after a holiday",
)

console.warn("Timetable checks passed")
