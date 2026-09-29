import { expect, test } from "bun:test"

import {
  addTask,
  archiveTask,
  buildCalendarMonth,
  buildDayPlan,
  moveTask,
  overdueTasks,
  setTaskStatus,
  shiftMonth,
  type DayPlanSource,
} from "../src/lib/day-plan"
import { EMPTY_LEARNING_WORKSPACE, localDate, type LearningWorkspace, type StudyTask } from "../src/lib/learning-workspace"
import type { Timetable } from "../src/lib/timetable"
import type { CanonicalStudySession } from "../../../src/lib/sync/sessionContract"

const stamp = "2026-03-01T00:00:00.000Z"

function task(overrides: Partial<StudyTask> & { id: string }): StudyTask {
  return {
    kind: "custom",
    title: "Study",
    detail: "Personal study task",
    durationMinutes: 30,
    plannedFor: "2026-03-04",
    status: "planned",
    createdAt: stamp,
    updatedAt: stamp,
    ...overrides,
  }
}

function source(overrides: Partial<DayPlanSource> = {}): DayPlanSource {
  return {
    sacRecords: [],
    attempts: [],
    mistakes: [],
    trackedExamIds: [],
    learning: { ...EMPTY_LEARNING_WORKSPACE, tasks: [] },
    ...overrides,
  }
}

const timetable: Timetable = {
  year: 2026,
  sourceUrl: "https://example.com",
  compiledFromOfficialPublication: "test",
  exams: [
    { id: "e1", date: "2026-03-04", dateEnd: null, startTime: "09:00", endTime: "12:00", readingMinutes: 30, subject: "Mathematics", paper: "Exam 1", component: "written" },
    { id: "e2", date: "2026-03-09", dateEnd: "2026-03-10", startTime: null, endTime: null, readingMinutes: null, subject: "Chemistry", paper: null, component: "written" },
  ],
}

test("a day plan reads the records the app already keeps, in one ordered list", () => {
  const data = source({
    learning: {
      ...EMPTY_LEARNING_WORKSPACE,
      tasks: [
        task({ id: "t1", title: "Redo organic paper", subject: "Chemistry", durationMinutes: 50 }),
        task({ id: "t2", title: "Finished flashcards", status: "completed", durationMinutes: 20 }),
        task({ id: "t3", title: "Archived", archivedAt: stamp }),
        task({ id: "t4", title: "Another day", plannedFor: "2026-03-05" }),
      ],
    },
    sacRecords: [{ id: "s1", subject: "Physics", provider: "school", title: "Practical report", unit: 2, scheduledAt: "2026-03-04T14:00:00.000Z", durationMinutes: 90, createdAt: stamp, updatedAt: stamp }],
    mistakes: [
      { id: "m1", attemptId: "a1", question: "Q1", category: "knowledge", explanation: "", correction: "", dueAt: "2026-03-04T08:00:00.000Z" },
      { id: "m2", attemptId: "a1", question: "Q2", category: "knowledge", explanation: "", correction: "", dueAt: "2026-03-04T08:00:00.000Z" },
      { id: "m3", attemptId: "a1", question: "Q3", category: "knowledge", explanation: "", correction: "", dueAt: "2026-03-04T08:00:00.000Z", resolved: true },
    ],
    trackedExamIds: ["e1", "e2"],
  })

  const plan = buildDayPlan("2026-03-04", data, timetable)

  expect(plan.items.map((item) => item.kind)).toEqual(["task", "task", "sac", "exam", "mistakes"])
  // Only open work counts as planned; a completed task no longer does.
  expect(plan.plannedMinutes).toBe(50)
  expect(plan.completedMinutes).toBe(20)
  expect(plan.dueMistakes).toBe(2)
  expect(plan.items.at(-1)).toMatchObject({ kind: "mistakes", count: 2 })
})

test("a multi-day exam appears on every day it runs, and untracked exams never appear", () => {
  expect(buildDayPlan("2026-03-09", source({ trackedExamIds: ["e2"] }), timetable).items).toHaveLength(1)
  expect(buildDayPlan("2026-03-10", source({ trackedExamIds: ["e2"] }), timetable).items).toHaveLength(1)
  expect(buildDayPlan("2026-03-11", source({ trackedExamIds: ["e2"] }), timetable).items).toHaveLength(0)
  expect(buildDayPlan("2026-03-04", source(), timetable).items).toHaveLength(0)
})

const segment = (startedAt: string, endedAt: string | null, id = "g1") =>
  ({ id, session_id: "cs1", started_at: startedAt, ended_at: endedAt, phase: null, source_device_id: null })

function canonicalSession(overrides: Partial<CanonicalStudySession> = {}): CanonicalStudySession {
  return {
    id: "cs1",
    kind: "focus",
    state: "completed",
    phase: "focus",
    revision: 4,
    title: "Methods revision",
    subject_id: "mm",
    originating_app: "focal",
    created_at: "2026-03-04T08:00:00.000Z",
    updated_at: "2026-03-04T10:00:00.000Z",
    started_at: "2026-03-04T08:00:00.000Z",
    paused_at: null,
    completed_at: "2026-03-04T10:00:00.000Z",
    cancelled_at: null,
    accumulated_active_ms: 3_900_000,
    segment_started_at: null,
    metadata: {
      subjectIds: ["mm"],
      schedule: { blocks: [{ start: "2026-03-04T08:00:00.000Z", end: "2026-03-04T10:00:00.000Z" }] },
    },
    segments: [
      segment("2026-03-04T08:00:00.000Z", "2026-03-04T08:20:00.000Z"),
      segment("2026-03-04T08:30:00.000Z", "2026-03-04T09:15:00.000Z", "g2"),
    ],
    ...overrides,
  }
}

// Both apps read the one canonical study log, so the calendar must place every sitting
// exactly where Focal desktop's calendar places it: the day of its `startTime`, counted
// in worked intervals rather than the window they span.
test("a study session appears on the desktop's day, with the desktop's minutes", () => {
  const data = source({ sessions: [canonicalSession()] })
  const item = buildDayPlan("2026-03-04", data, timetable).items.find((entry) => entry.kind === "session")
  // 20 + 45 worked minutes, not the two-hour window they span; "mm" shows its name.
  expect(item).toMatchObject({
    kind: "session",
    title: "Methods revision",
    detail: "Mathematical Methods",
    minutes: 65,
    status: "completed",
  })
  expect(buildDayPlan("2026-03-05", data, timetable).items.filter((entry) => entry.kind === "session")).toHaveLength(0)
})

test("a sitting is filed under its schedule day even when the server start differs", () => {
  const data = source({ sessions: [canonicalSession({ started_at: "2026-03-05T08:00:00.000Z" })] })
  expect(buildDayPlan("2026-03-04", data, timetable).items.some((entry) => entry.kind === "session")).toBe(true)
  expect(buildDayPlan("2026-03-05", data, timetable).items.some((entry) => entry.kind === "session")).toBe(false)
})

test("a timer session without a planned window lands on its start day", () => {
  // The web's own focus blocks carry no schedule; the desktop files them at their start
  // plus an hour and counts their closed segments. Same projection here.
  const data = source({ sessions: [canonicalSession({
    subject_id: "Chemistry",
    metadata: { examtrack: { subject: "Chemistry" } },
    segments: [segment("2026-03-04T08:00:00.000Z", "2026-03-04T08:45:00.000Z")],
  })] })
  const item = buildDayPlan("2026-03-04", data, timetable).items.find((entry) => entry.kind === "session")
  expect(item).toMatchObject({ detail: "Chemistry", minutes: 45, status: "completed" })
})

test("a still-running session counts only the boundaries that have closed", () => {
  const running = canonicalSession({
    state: "running",
    completed_at: null,
    segment_started_at: "2026-03-04T08:00:00.000Z",
    segments: [segment("2026-03-04T08:00:00.000Z", null)],
  })
  const item = buildDayPlan("2026-03-04", source({ sessions: [running] }), timetable)
    .items.find((entry) => entry.kind === "session")
  // With no closed segment yet the desktop falls back to the planned span; so does this.
  expect(item).toMatchObject({ minutes: 120, status: "in-progress" })
})

test("a discarded sitting never appears on the calendar", () => {
  const cancelled = canonicalSession({ state: "cancelled", completed_at: null, cancelled_at: "2026-03-04T09:00:00.000Z" })
  const items = buildDayPlan("2026-03-04", source({ sessions: [cancelled] }), timetable).items
  expect(items.filter((entry) => entry.kind === "session")).toHaveLength(0)
})

test("the month grid is six Monday-first weeks that always contain the month", () => {
  const march = buildCalendarMonth(new Date(2026, 2, 1), source(), null, new Date(2026, 2, 4))
  expect(march).toHaveLength(42)
  // 1 March 2026 is a Sunday, so the grid opens on Monday 23 February.
  expect(march[0].date).toBe("2026-02-23")
  expect(march[0].inMonth).toBe(false)
  expect(march.filter((day) => day.inMonth)).toHaveLength(31)
  expect(march.find((day) => day.isToday)?.date).toBe("2026-03-04")

  const february = buildCalendarMonth(new Date(2024, 1, 1), source(), null, new Date(2024, 1, 10))
  // 1 February 2024 is a Thursday and the month has 29 days.
  expect(february.filter((day) => day.inMonth)).toHaveLength(29)
  expect(february[0].date).toBe("2024-01-29")
})

test("shifting months keeps the first of the month", () => {
  expect(localDate(shiftMonth(new Date(2026, 11, 15), 1))).toBe("2027-01-01")
  expect(localDate(shiftMonth(new Date(2026, 0, 31), -1))).toBe("2025-12-01")
})

test("only open work from an earlier day is carried over", () => {
  const tasks = [
    task({ id: "t1", plannedFor: "2026-03-01" }),
    task({ id: "t2", plannedFor: "2026-03-01", status: "completed" }),
    task({ id: "t3", plannedFor: "2026-03-03", status: "skipped" }),
    task({ id: "t4", plannedFor: "2026-03-04" }),
  ]
  expect(overdueTasks(tasks, "2026-03-04").map((item) => item.id)).toEqual(["t1"])
})

test("task edits keep the workspace valid and reject impossible tasks", () => {
  const workspace: LearningWorkspace = {
    ...EMPTY_LEARNING_WORKSPACE,
    tasks: [task({ id: "t1" }), task({ id: "t2", plannedFor: "2026-03-05" })],
  }

  const completed = setTaskStatus(workspace, "t1", "completed", new Date("2026-03-04T00:00:00Z"))
  expect(completed.tasks[0].status).toBe("completed")
  expect(completed.updatedAt).toBe("2026-03-04T00:00:00.000Z")

  // Moving reopens finished work, and a blank date is ignored.
  const moved = moveTask(completed, "t1", "2026-03-05")
  expect(moved.tasks[0]).toMatchObject({ plannedFor: "2026-03-05", status: "planned" })
  expect(moveTask(moved, "t1", "")).toBe(moved)

  const archived = archiveTask(moved, "t2")
  expect(archived.tasks[1].archivedAt).toBeTruthy()

  const added = addTask(workspace, { title: "  Read notes  ", date: "2026-03-04", minutes: 25, subject: "Biology" })
  expect(added.tasks.at(-1)).toMatchObject({ title: "Read notes", plannedFor: "2026-03-04", durationMinutes: 25, subject: "Biology", status: "planned" })
  // Nothing broken is ever stored.
  expect(addTask(workspace, { title: "   ", date: "2026-03-04", minutes: 25 })).toBe(workspace)
  expect(addTask(workspace, { title: "Too long", date: "2026-03-04", minutes: 900 })).toBe(workspace)
})
