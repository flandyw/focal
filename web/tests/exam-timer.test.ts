import { describe, expect, test } from "bun:test"
import { formatTimer, getExamTimerState } from "../src/lib/exam-timer"

describe("exam timer", () => {
  test("moves from reading to writing and calculates expected mark progress", () => {
    const start = 1_000_000
    expect(getExamTimerState(start + 5 * 60_000, start, 15, 60, 40)).toMatchObject({
      phase: "reading",
      remainingSeconds: 600,
      expectedMarks: 0,
    })
    expect(getExamTimerState(start + 45 * 60_000, start, 15, 60, 40)).toMatchObject({
      phase: "writing",
      remainingSeconds: 1800,
      expectedMarks: 20,
    })
    expect(getExamTimerState(start + 80 * 60_000, start, 15, 60, 40)).toMatchObject({
      phase: "overtime",
      remainingSeconds: 0,
      overtimeSeconds: 300,
      expectedMarks: 40,
    })
    expect(formatTimer(3661)).toBe("1:01:01")
  })
})
