import { describe, expect, test } from "bun:test"
import {
  createFocalTimerLink,
  isFocalTimerLink,
  pauseFocalTimer,
  resumeFocalTimer,
} from "../src/lib/focal-timer"

describe("Focal timer bridge", () => {
  test("preserves active intervals across pause and resume", () => {
    const started = createFocalTimerLink("exam", "Chemistry", "VCAA Chemistry", 4500, new Date("2026-08-05T10:00:00Z"))
    const paused = pauseFocalTimer(started, new Date("2026-08-05T10:20:00Z"))
    const resumed = resumeFocalTimer(paused, new Date("2026-08-05T10:25:00Z"))

    expect(started.intervals).toEqual([{ start: "2026-08-05T10:00:00.000Z" }])
    expect(paused.intervals).toEqual([{ start: "2026-08-05T10:00:00.000Z", end: "2026-08-05T10:20:00.000Z" }])
    expect(resumed.intervals).toEqual([
      { start: "2026-08-05T10:00:00.000Z", end: "2026-08-05T10:20:00.000Z" },
      { start: "2026-08-05T10:25:00.000Z" },
    ])
  })

  test("does not create duplicate open intervals", () => {
    const started = createFocalTimerLink("sac", "Physics", "Motion SAC", 3000, new Date("2026-08-05T10:00:00Z"))
    expect(resumeFocalTimer(started, new Date("2026-08-05T10:01:00Z"))).toEqual(started)
  })

  test("rejects malformed persisted timer links", () => {
    expect(isFocalTimerLink({ sessionId: "bad", kind: "exam", intervals: "nope" })).toBeFalse()
  })
})
