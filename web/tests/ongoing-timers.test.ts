import { describe, expect, test } from "bun:test"
import { EMPTY_APP_DATA, migrateAppData } from "../src/lib/exam-data"
import { getExamTimerState } from "../src/lib/exam-timer"
import { pauseExamSession, resumeExamSession, updateExamSessionConditions, type ExamTimerSession } from "../src/lib/ongoing-timers"

const start = Date.parse("2026-09-11T00:00:00Z")
const session: ExamTimerSession = {
  subject: "Chemistry", provider: "VCAA", title: "Chemistry practice", examYear: 2025, paper: "Exam",
  readingMinutes: 15, writingMinutes: 120, marks: 100, startedAt: start, pausedSeconds: 0,
  id: "session-1", revision: 1,
  workspaceItems: [{ id: "q1", label: "Question 1", marks: 5, status: "flagged", confidence: "low", note: "Revisit calculation" }],
}

describe("saved exam sessions", () => {
  test("restores a paused workspace on another device and excludes an overnight break", () => {
    const paused = pauseExamSession(session, start + 20 * 60_000)
    const restored = migrateAppData(JSON.parse(JSON.stringify({ ...EMPTY_APP_DATA, activeExamTimer: paused })))!
    const remote = restored.activeExamTimer!
    expect(remote.workspaceItems).toEqual(session.workspaceItems)
    const now = start + 24 * 60 * 60_000
    const resumed = resumeExamSession(remote, now)
    expect(getExamTimerState(now, resumed.startedAt, 15, 120, 100).writingElapsedSeconds).toBe(300)
    expect(resumed.pausedSeconds).toBe((now - paused.pausedAt!) / 1000)
  })

  test("repeated pause/resume is idempotent and preserves fractional pause time", () => {
    const paused = pauseExamSession(session, start + 1000)
    expect(pauseExamSession(paused, start + 2000)).toBe(paused)
    const resumed = resumeExamSession(paused, start + 2500)
    expect(resumed.pausedSeconds).toBe(1.5)
    expect(resumeExamSession(resumed, start + 3000)).toBe(resumed)
  })

  test("legacy Focal mirror fields are discarded while the ExamTrack timer details survive", () => {
    const restored = migrateAppData(JSON.parse(JSON.stringify({ ...EMPTY_APP_DATA, activeExamTimer: {
      ...session, focal: { sessionId: "legacy-id", kind: "exam", intervals: [] },
    } })))!
    expect(restored.activeExamTimer?.id).toBe(session.id)
    expect("focal" in (restored.activeExamTimer ?? {})).toBe(false)
    expect(restored.activeExamTimer?.workspaceItems).toEqual(session.workspaceItems)
  })
})

describe("editing exam conditions", () => {
  const timerFor = (value: ExamTimerSession, now: number) => getExamTimerState(value.pausedAt ?? now, value.startedAt, value.readingMinutes, value.writingMinutes, value.marks)

  test("changes reading allocation during writing without losing writing time", () => {
    const now = start + 35 * 60_000
    const next = updateExamSessionConditions(session, { readingMinutes: 30, writingMinutes: 150, marks: 80 }, now)
    expect(timerFor(next, now).phase).toBe("writing")
    expect(timerFor(next, now).writingElapsedSeconds).toBe(20 * 60)
    expect(timerFor(next, now).remainingSeconds).toBe(130 * 60)
    expect(next.pausedAt).toBeUndefined()
    expect(next.workspaceItems).toEqual(session.workspaceItems)
  })

  test("keeps a saved exam frozen through edits, serialization, and overnight resume", () => {
    const paused = pauseExamSession(session, start + 35 * 60_000)
    const tomorrow = start + 24 * 60 * 60_000
    const next = updateExamSessionConditions(paused, { readingMinutes: 0, writingMinutes: 60, marks: 50 }, tomorrow)
    const restored = migrateAppData(JSON.parse(JSON.stringify({ ...EMPTY_APP_DATA, activeExamTimer: next })))!.activeExamTimer!
    expect(restored.pausedAt).toBe(paused.pausedAt)
    expect(timerFor(restored, tomorrow).remainingSeconds).toBe(40 * 60)
    expect(timerFor(resumeExamSession(restored, tomorrow), tomorrow).remainingSeconds).toBe(40 * 60)
    expect(restored.id).toBe(session.id)
  })

  test("can extend and shorten reading before writing starts", () => {
    const now = start + 5 * 60_000
    const extended = updateExamSessionConditions(session, { readingMinutes: 20, writingMinutes: 120, marks: 100 }, now)
    expect(timerFor(extended, now).remainingSeconds).toBe(15 * 60)
    const shortened = updateExamSessionConditions(session, { readingMinutes: 5, writingMinutes: 120, marks: 100 }, now)
    expect(timerFor(shortened, now).phase).toBe("writing")
    expect(timerFor(shortened, now).writingElapsedSeconds).toBe(0)
  })

  test("shorter writing time records overtime and an extension brings it back into time", () => {
    const now = start + 45 * 60_000
    const shortened = updateExamSessionConditions(session, { readingMinutes: 15, writingMinutes: 20, marks: 100 }, now)
    expect(timerFor(shortened, now).overtimeSeconds).toBe(10 * 60)
    const extended = updateExamSessionConditions(shortened, { readingMinutes: 0, writingMinutes: 60, marks: 100 }, now)
    expect(timerFor(extended, now).remainingSeconds).toBe(30 * 60)
    expect(timerFor(extended, now).overtimeSeconds).toBe(0)
  })

  test("rejects invalid numbers and totals below mapped marks without modifying the session", () => {
    const original = JSON.stringify(session)
    for (const conditions of [
      { readingMinutes: NaN, writingMinutes: 120, marks: 100 },
      { readingMinutes: -1, writingMinutes: 120, marks: 100 },
      { readingMinutes: 15, writingMinutes: 0, marks: 100 },
      { readingMinutes: 15, writingMinutes: Infinity, marks: 100 },
      { readingMinutes: 15, writingMinutes: 361, marks: 100 },
      { readingMinutes: 15, writingMinutes: 120, marks: 4.5 },
      { readingMinutes: 15, writingMinutes: 120, marks: 501 },
      { readingMinutes: 15, writingMinutes: 120, marks: 5.1 },
    ]) expect(() => updateExamSessionConditions(session, conditions)).toThrow()
    expect(JSON.stringify(session)).toBe(original)
  })
})
