import { describe, expect, test } from "bun:test"
import { EMPTY_APP_DATA, migrateAppData } from "../src/lib/exam-data"
import { createFocalTimerLink } from "../src/lib/focal-timer"
import { getExamTimerState } from "../src/lib/exam-timer"
import { pauseExamSession, resumeExamSession, mergeTimerSession, updateExamSessionConditions, type ExamTimerSession } from "../src/lib/ongoing-timers"

const start = Date.parse("2026-09-11T00:00:00Z")
const session: ExamTimerSession = {
  subject: "Chemistry", provider: "VCAA", title: "Chemistry practice", examYear: 2025, paper: "Exam",
  readingMinutes: 15, writingMinutes: 120, marks: 100, startedAt: start, pausedSeconds: 0,
  focal: createFocalTimerLink("exam", "Chemistry", "Chemistry practice", 8100, new Date(start)),
  workspaceItems: [{ id: "q1", label: "Question 1", marks: 5, status: "flagged", confidence: "low", note: "Revisit calculation" }],
}

describe("saved exam sessions", () => {
  test("restores a paused workspace on another device and excludes an overnight break", () => {
    const paused = pauseExamSession(session, start + 20 * 60_000)
    const updatedAt = new Date(paused.pausedAt!).toISOString()
    const restored = migrateAppData(JSON.parse(JSON.stringify({ ...EMPTY_APP_DATA, activeExamTimer: paused, activeExamTimerUpdatedAt: updatedAt })))!
    const remote = mergeTimerSession(undefined, "", restored.activeExamTimer, updatedAt).session!
    expect(remote.workspaceItems).toEqual(session.workspaceItems)
    const now = start + 24 * 60 * 60_000
    const resumed = resumeExamSession(remote, now)
    expect(getExamTimerState(now, resumed.startedAt, 15, 120, 100).writingElapsedSeconds).toBe(300)
    expect(resumed.focal?.sessionId).toBe(session.focal?.sessionId)
    expect(resumed.focal?.intervals).toEqual([
      { start: new Date(start).toISOString(), end: updatedAt },
      { start: new Date(now).toISOString() },
    ])
    expect(resumed.pausedSeconds).toBe((now - paused.pausedAt!) / 1000)
  })

  test("repeated pause/resume is idempotent and preserves fractional pause time", () => {
    const paused = pauseExamSession(session, start + 1000)
    expect(pauseExamSession(paused, start + 2000)).toBe(paused)
    const resumed = resumeExamSession(paused, start + 2500)
    expect(resumed.pausedSeconds).toBe(1.5)
    expect(resumeExamSession(resumed, start + 3000)).toBe(resumed)
  })

  test("completion on another device removes a stale saved session", () => {
    expect(mergeTimerSession(session, "2026-09-11T00:00:00Z", undefined, "2026-09-12T00:00:00Z").session).toBeUndefined()
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
    expect(next.focal?.plannedSeconds).toBe(180 * 60)
    expect(next.focal?.sessionId).toBe(session.focal?.sessionId)
    expect(next.focal?.intervals).toEqual(session.focal?.intervals)
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
    expect(restored.focal?.intervals).toEqual(paused.focal?.intervals)
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
