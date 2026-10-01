import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { CalendarPage } from "../src/components/calendar-page"
import { EMPTY_APP_DATA, type AppData } from "../src/lib/exam-data"
import { EMPTY_LEARNING_WORKSPACE, type StudyTask } from "../src/lib/learning-workspace"
import type { CanonicalStudySession } from "../../../src/lib/sync/sessionContract"

const noop = () => {}

function task(overrides: Partial<StudyTask> & { id: string }): StudyTask {
  return {
    kind: "custom",
    title: "Redo organic paper",
    detail: "Personal study task",
    subject: "Chemistry",
    durationMinutes: 50,
    plannedFor: new Date().toLocaleDateString("en-CA"),
    status: "planned",
    createdAt: "2026-03-01T00:00:00.000Z",
    updatedAt: "2026-03-01T00:00:00.000Z",
    ...overrides,
  }
}

function render(tasks: StudyTask[], sessions: CanonicalStudySession[] = []) {
  const data: AppData = { ...EMPTY_APP_DATA, learning: { ...EMPTY_LEARNING_WORKSPACE, tasks } }
  return renderToStaticMarkup(
    <CalendarPage data={data} sessions={sessions} onChange={noop} onNavigate={noop} onStartFocus={noop} timetable={null} />,
  )
}

function sitting(): CanonicalStudySession {
  const started = new Date()
  started.setHours(started.getHours() - 1, 0, 0, 0)
  const ended = new Date(started.getTime() + 45 * 60_000)
  return {
    id: "cs1",
    kind: "focus",
    state: "completed",
    phase: "focus",
    revision: 3,
    title: "Methods revision",
    subject_id: "mm",
    originating_app: "examtrack",
    created_at: started.toISOString(),
    updated_at: ended.toISOString(),
    started_at: started.toISOString(),
    paused_at: null,
    completed_at: ended.toISOString(),
    cancelled_at: null,
    accumulated_active_ms: 45 * 60_000,
    segment_started_at: null,
    metadata: { subjectIds: ["mm"] },
    segments: [{ id: "g1", session_id: "cs1", started_at: started.toISOString(), ended_at: ended.toISOString(), phase: null, source_device_id: null }],
  }
}

test("the calendar shows the month, the day plan, and today's work", () => {
  const markup = render([task({ id: "t1" })])

  expect(markup).toContain("Calendar and day plan")
  expect(markup).toContain("Today ·")
  expect(markup).toContain("Redo organic paper")
  expect(markup).toContain("50m")
  // The grid is a real calendar: seven labelled columns and one button per day.
  for (const label of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) {
    expect(markup).toContain(label)
  }
  expect(markup.match(/aria-pressed="(true|false)"/g)?.length).toBe(42)
  // An empty day still says so rather than showing a bare list.
  expect(markup).toContain("Add a task")
})

test("an empty account renders an honest calendar, not an error", () => {
  const markup = render([])
  expect(markup).toContain("Calendar and day plan")
  expect(markup).toContain("Due for review")
})

test("a finished sitting shows up as completed study, not as nothing planned", () => {
  const markup = render([task({ id: "t1" })], [sitting()])

  expect(markup).toContain("Methods revision")
  expect(markup).toContain("Studied")
  // 45 minutes studied and banked, the 50-minute task still open beside it.
  expect(markup).toContain("1 of 2 done")
  expect(markup).toContain("Completed")
  expect(markup).toContain("Planned")
})
