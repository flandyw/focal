import { describe, expect, test } from "bun:test"

import { decideFocusSession, isFocusCounting, type FocusSessionAction } from "../src/lib/focus-session"
import { DEFAULT_SETTINGS, timerReducer, type TimerAction, type TimerState } from "../src/lib/study-timer"
import type { FocusTimerSession } from "../src/lib/ongoing-timers"

const identity = { subject: "Chemistry", title: "25 minute focus block" }

/** The timer as it loads: parked on the focus screen, not counting. */
function parked(): TimerState {
  return {
    running: false, mode: "work", secondsLeft: DEFAULT_SETTINGS.workMinutes * 60,
    totalSeconds: DEFAULT_SETTINGS.workMinutes * 60, cycles: 0,
    studyOvertime: false, overtimeSeconds: 0, freeStudy: false, breakSeconds: 0,
  }
}

function running(): TimerState {
  return timerReducer(parked(), { type: "TOGGLE" })
}

function open(over: Partial<FocusTimerSession> = {}): FocusTimerSession {
  return { id: "session-1", revision: 1, subject: "Chemistry", provider: "Focal", title: "25 minute focus block",
    cycleNumber: 1, workMinutes: 25, startedAt: 1_000, pausedSeconds: 0, ...over }
}

function decide(previous: TimerState, next: TimerState, session: FocusTimerSession | undefined, at = 2_000): FocusSessionAction | null {
  return decideFocusSession(previous, next, session, identity, at)?.action ?? null
}

/** Plays a whole sequence the way the hook does: each start opens the session the
 *  following boundaries act on, and a complete closes it. */
function play(steps: readonly TimerAction[], session: FocusTimerSession | undefined) {
  const emitted: (FocusSessionAction | null)[] = []
  let previous = parked()
  let current = session
  for (const action of steps) {
    const next = timerReducer(previous, action)
    const decision = decide(previous, next, current)
    emitted.push(decision)
    if (decision === "start") current = open()
    if (decision === "complete") current = undefined
    previous = next
  }
  return emitted
}

describe("focus session lifecycle", () => {
  test("a timer parked on the focus screen is not a running session", () => {
    expect(isFocusCounting(parked())).toBe(false)
    // Opening the page changes nothing, so it cannot start anything.
    expect(decide(parked(), parked(), undefined)).toBeNull()
  })

  test("idle work mode -> Start -> Pause -> Resume -> Finish sends one command per boundary", () => {
    const emitted = play([
      { type: "TOGGLE" },                                                          // Start
      { type: "TOGGLE" },                                                          // Pause
      { type: "TOGGLE" },                                                          // Resume
      { type: "TICK", settings: DEFAULT_SETTINGS, seconds: 1_500 },                 // Finish
    ], undefined)
    expect(emitted).toEqual(["start", "pause", "resume", "complete"])
  })

  test("the first focus block reaches the server at all", () => {
    // The regression: mode said "work" before and after Start, so `wasWorking` and
    // `isWorking` were both true and the whole first Pomodoro ran with no session
    // behind it on the server.
    const before = parked()
    const after = timerReducer(before, { type: "TOGGLE" })
    expect(after.mode).toBe("work")
    expect(decide(before, after, undefined)).toBe("start")
  })

  test("a break that does not auto-start the next focus block starts no session", () => {
    // autoStartFocus is off by default, so arriving at the focus timer is not starting it.
    const settings = { ...DEFAULT_SETTINGS, autoStartFocus: false }
    const onBreak = timerReducer(running(), { type: "TICK", settings, seconds: 1_500 })
    expect(onBreak.mode).toBe("break")

    const arrived = timerReducer(onBreak, { type: "SKIP_BREAK", settings })
    expect(arrived.mode).toBe("work")
    expect(arrived.running).toBe(false)
    // Supabase must not start counting while the readout says the timer is paused.
    expect(decide(onBreak, arrived, undefined)).toBeNull()
  })

  test("the block before a break is completed", () => {
    const onBreak = timerReducer(running(), { type: "TICK", settings: DEFAULT_SETTINGS, seconds: 1_500 })
    expect(decide(running(), onBreak, open())).toBe("complete")
  })

  test("pausing mid-block is a pause, not a completion", () => {
    const paused = timerReducer(running(), { type: "TOGGLE" })
    expect(paused.mode).toBe("work")
    expect(paused.running).toBe(false)
    expect(decide(running(), paused, open())).toBe("pause")
  })

  test("resuming a paused block is a resume", () => {
    const paused = timerReducer(running(), { type: "TOGGLE" })
    expect(decide(paused, running(), open({ pausedAt: 1_500 }))).toBe("resume")
  })

  test("starting free study ends the focus block rather than pausing it", () => {
    const freeStudy = timerReducer(running(), { type: "START_FREE_STUDY", settings: DEFAULT_SETTINGS })
    expect(freeStudy.studyOvertime).toBe(true)
    expect(decide(running(), freeStudy, open())).toBe("complete")
  })

  test("a subject or intent corrected mid-block is published", () => {
    const state = running()
    expect(decide(state, state, open({ subject: "Physics" }))).toBe("update")
    expect(decide(state, state, open({ title: "Old title" }))).toBe("update")
  })

  test("a tick inside a running block is not a boundary", () => {
    const state = running()
    const ticked = timerReducer(state, { type: "TICK", settings: DEFAULT_SETTINGS, seconds: 1 })
    expect(decide(state, ticked, open())).toBeNull()
  })

  test("a session closed on another device is not resurrected by the next transition", () => {
    // After a reset the session is gone; the focus timer going back to work must not
    // hand the server a second session for the same block.
    const afterReset = timerReducer(running(), { type: "RESET", settings: DEFAULT_SETTINGS })
    expect(decide(running(), afterReset, undefined)).toBeNull()
  })
})
