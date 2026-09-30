import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { eventToStudySessionDraft } from "../src/lib/calendarEvents"
import { createStudySession } from "../src/lib/studySessions"
import type { CalendarEvent } from "../src/lib/types"

const event: CalendarEvent = {
  id: "event", title: "Revision", description: "Chapter 3", location: "Library",
  startTime: "2026-06-05T23:00:00Z", endTime: "2026-06-06T01:00:00Z",
  eventType: "event", subjectId: "mm", isFinished: true, created_at: "2026-06-01T00:00:00Z",
}
const draft = eventToStudySessionDraft(event)
assert.deepEqual(draft.subjectIds, ["mm"])
assert.equal(draft.description, "Chapter 3\n\nLocation: Library")
assert.equal(draft.status, "planned")
assert.equal(draft.startTime, event.startTime)
assert.equal(draft.endTime, event.endTime!.replace("Z", ".000Z"))
const session = createStudySession("session", { ...draft, schedule: { blocks: [{ start: draft.startTime, end: draft.endTime }] } })
assert.equal(session.execution.state, "planned")
assert.equal(session.execution.intervals.length, 0)
assert.equal(Date.parse(session.endTime) - Date.parse(session.startTime), 2 * 60 * 60_000)
const noSubject = eventToStudySessionDraft({ ...event, subjectId: undefined, endTime: undefined })
assert.deepEqual(noSubject.subjectIds, [])
assert.equal(Date.parse(noSubject.endTime) - Date.parse(noSubject.startTime), 60 * 60_000)
assert.throws(() => eventToStudySessionDraft({ ...event, startTime: "invalid" }))
assert.throws(() => eventToStudySessionDraft({ ...event, endTime: event.startTime }))
assert.equal(event.id, "event")
// ponytail: source checks cover wiring without a browser harness; focus/keyboard behavior still needs a UI smoke check.
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8")
const grid = source("src/components/home/CalendarGrid.tsx")
assert.equal([...grid.matchAll(/\{renderEventMenu\((event|ev)\)\}/g)].length, 4)
assert(grid.includes("onConvert={onConvertToSession"))
const day = source("src/components/home/DayDetail.tsx")
assert(day.includes('onConvert={dayItem.kind === "event" && onConvertToSession'))
assert.equal(source("src/components/home/HomeView.tsx").split("onConvertToSession={onConvertToSession}").length - 1, 2)
assert.equal(source("src/App.tsx").split("onConvertToSession={handleConvertEventToSession}").length - 1, 2)
assert(source("src/components/home/CalendarItemMenu.tsx").includes("Convert to study session"))
process.stdout.write("Event conversion checks passed\n")
