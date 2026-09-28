import { describe, expect, test } from "bun:test"
import type { ExamTimerSession } from "../src/lib/ongoing-timers"
import { buildCommand } from "../src/lib/study-session-sync"

// The command builder only needs a device id and an indexed timing store.
const store = new Map<string, string>()
Reflect.set(globalThis, "localStorage", {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => void store.set(key, value),
  removeItem: (key: string) => void store.delete(key),
})
Reflect.set(globalThis, "indexedDB", undefined)

// The server state machine is the only queue, so the client has exactly one job left:
// keep the same session ID and a truthful expected_revision across the whole lifecycle.
describe("study session commands", () => {
  const exam = (over: Partial<ExamTimerSession> = {}): ExamTimerSession => ({
    id: "session-1",
    subject: "Chemistry",
    provider: "VCAA",
    title: "Exam 1",
    examYear: 2025,
    paper: "1",
    readingMinutes: 15,
    writingMinutes: 45,
    marks: 1,
    startedAt: 1_000,
    pausedSeconds: 0,
    phase: "reading",
    ...over,
  })

  test("carries one session id and the server revision through start, pause, resume and complete", async () => {
    const start = await buildCommand(undefined, exam(), "exam", "start", "session-1")
    expect([start.session_id, start.expected_revision, start.action]).toEqual(["session-1", 0, "start"])

    const paused = await buildCommand(exam(), exam({ revision: 1, pausedAt: 2_000 }), "exam", "pause", "session-1")
    const resumed = await buildCommand(exam({ revision: 2, pausedAt: 2_000 }), exam({ revision: 2 }), "exam", "resume", "session-1")
    const completed = await buildCommand(exam({ revision: 3, pausedAt: 4_000 }), exam({ revision: 3, pausedAt: 4_000, phase: "writing" }), "exam", "complete", "session-1")

    expect([paused.session_id, resumed.session_id, completed.session_id]).toEqual(["session-1", "session-1", "session-1"])
    expect([paused.expected_revision, resumed.expected_revision, completed.expected_revision]).toEqual([1, 2, 3])
    expect([paused.action, resumed.action, completed.action]).toEqual(["pause", "resume", "complete"])
  })

  test("gives every command its own mutation id so a retry is never a silent duplicate", async () => {
    const first = await buildCommand(undefined, exam(), "exam", "start", "session-1")
    const second = await buildCommand(undefined, exam(), "exam", "start", "session-1")
    expect(first.mutation_id).not.toBe(second.mutation_id)
  })

  test("sends the phase and strips the client-only timer fields from the metadata", async () => {
    const command = await buildCommand(undefined, exam({ phase: "writing", revision: 4 }), "exam", "save_progress", "session-1")
    expect(command.phase).toBe("writing")
    for (const key of ["id", "revision", "startedAt", "pausedAt", "pausedSeconds", "phase"]) {
      expect(Object.hasOwn(command.metadata as object, key)).toBe(false)
    }
  })
})
