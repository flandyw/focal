import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { CalendarPage } from "../src/components/calendar-page"
import { EMPTY_APP_DATA, type AppData } from "../src/lib/exam-data"
import { EMPTY_LEARNING_WORKSPACE, type StudyTask } from "../src/lib/learning-workspace"

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

function render(tasks: StudyTask[]) {
  const data: AppData = { ...EMPTY_APP_DATA, learning: { ...EMPTY_LEARNING_WORKSPACE, tasks } }
  return renderToStaticMarkup(
    <CalendarPage data={data} onChange={noop} onNavigate={noop} onStartFocus={noop} timetable={null} />,
  )
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
