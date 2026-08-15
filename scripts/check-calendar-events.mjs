import { strict as assert } from "node:assert"
import { dedupeCalendarEvents } from "../src/lib/calendarEvents.ts"
import { moveCalendarEventToDate, shiftCalendarPeriod } from "../src/lib/calendarNavigation.ts"

const base = {
  id: "old",
  title: "PE SAC 3",
  startTime: "2026-07-31T01:37:00Z",
  endTime: "2026-07-31T02:52:00Z",
  eventType: "practice-sac",
  subjectId: "pe",
  isFinished: false,
  created_at: "2026-07-16T00:00:00Z",
  updated_at: "2026-07-16T00:00:00Z",
}

const result = dedupeCalendarEvents([
  base,
  {
    ...base,
    id: "new",
    startTime: "2026-07-31T11:37:00+10:00",
    endTime: "2026-07-31T12:52:00+10:00",
    updated_at: "2026-07-20T00:00:00Z",
  },
])

assert.deepEqual(result.events.map((event) => event.id), ["new"])
assert.deepEqual(result.duplicateIds, ["old"])

const previousWeek = shiftCalendarPeriod(new Date(2026, 7, 15), "week", -1)
assert.equal(previousWeek.getFullYear(), 2026)
assert.equal(previousWeek.getMonth(), 7)
assert.equal(previousWeek.getDate(), 8)

const nextMonth = shiftCalendarPeriod(new Date(2026, 11, 15), "month", 1)
assert.equal(nextMonth.getFullYear(), 2027)
assert.equal(nextMonth.getMonth(), 0)
assert.equal(nextMonth.getDate(), 1)

const moved = moveCalendarEventToDate(
  new Date(2026, 7, 10, 9, 30).toISOString(),
  new Date(2026, 7, 12, 11).toISOString(),
  new Date(2026, 7, 20),
)
assert.equal(new Date(moved.startTime).getDate(), 20)
assert.equal(new Date(moved.startTime).getHours(), 9)
assert.equal(new Date(moved.endTime).getDate(), 22)
assert.equal(new Date(moved.endTime).getHours(), 11)
console.log("calendar event checks passed")
