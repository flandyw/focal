import { describe, expect, test } from "bun:test"

import {
  createFocusSessionMirror,
  decideFocusSession,
  isFocusCounting,
  owedFocusBoundary,
  SessionRefusedError,
  type FocusSessionAction,
} from "../src/lib/focus-session"
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 5))

function session(at: number, over: Partial<FocusTimerSession> = {}): FocusTimerSession {
  return { id: "session-1", subject: "Chemistry", provider: "Focal", title: "25 minute focus block",
    cycleNumber: 1, workMinutes: 25, startedAt: at, pausedSeconds: 0, ...over }
}

describe("the acknowledged session mirror", () => {
  test("a pause pressed before the start RPC returns is built on the acknowledged revision", async () => {
    const calls: { previous: FocusTimerSession | undefined; next: FocusTimerSession | undefined }[] = []
    const releases: ((acknowledged: FocusTimerSession | undefined) => void)[] = []
    const mirror = createFocusSessionMirror({
      sink: (previous, next) => {
        calls.push({ previous, next })
        return new Promise((resolve) => releases.push(resolve))
      },
    })
    mirror.push({ action: "start", at: 1_000, session: session(1_000) })
    mirror.push({ action: "pause", at: 2_000 })
    // The pause waits its turn; no boundary overtakes an unanswered one.
    expect(calls).toHaveLength(1)
    expect(calls[0].previous).toBeUndefined()
    releases[0](session(1_000, { revision: 1 }))
    await settle()
    // The bug: `previous` was captured before the first RPC finished, so this pause
    // left with expected_revision 0 against a row already at 1 -- stale_revision.
    expect(calls).toHaveLength(2)
    expect(calls[1].previous?.revision).toBe(1)
    expect(calls[1].next?.pausedAt).toBe(2_000)
    releases[1](session(1_000, { revision: 2, pausedAt: 2_000 }))
    await settle()
    expect(mirror.acknowledged()?.revision).toBe(2)
  })

  test("a failed complete keeps the session acknowledged and is retried until the server takes it", async () => {
    const attempts: ((acknowledged: FocusTimerSession | undefined) => void)[] = []
    const failures: ((error: unknown) => void)[] = []
    const mirror = createFocusSessionMirror({
      initial: session(1_000, { revision: 3 }),
      retryDelayMs: 0,
      sink: () => new Promise((resolve, reject) => { attempts.push(resolve); failures.push(reject) }),
    })
    mirror.push({ action: "complete", at: 5_000 })
    expect(attempts).toHaveLength(1)
    failures[0](new Error("network down"))
    await settle()
    // The bug: a failed terminal dropped the local session while the server kept
    // running -- a zombie accumulating study time with nothing left to close it.
    expect(mirror.acknowledged()?.revision).toBe(3)
    expect(attempts).toHaveLength(2)
    attempts[1](undefined)
    await settle()
    expect(mirror.acknowledged()).toBeUndefined()
  })

  test("a refused command adopts the row the server holds and rebuilds on its revision", () => {
    const calls: (FocusTimerSession | undefined)[] = []
    let refuse = true
    const mirror = createFocusSessionMirror({
      initial: session(1_000, { revision: 3 }),
      retryDelayMs: 0,
      sink: (previous) => {
        calls.push(previous)
        if (refuse) {
          refuse = false
          throw new SessionRefusedError("This timer changed on another device (stale_revision).",
            session(1_000, { revision: 9, pausedAt: 1_500 }))
        }
        return undefined
      },
    })
    mirror.push({ action: "pause", at: 2_000 })
    // The refusal's row is the last acknowledged state, so the retry is built on its
    // revision instead of re-sending the stale one forever.
    expect(mirror.acknowledged()?.revision).toBe(9)
    expect(calls[0]?.revision).toBe(3)
  })

  test("a boundary for a session the server has closed is dropped, never sent", async () => {
    const calls: number[] = []
    const mirror = createFocusSessionMirror({ sink: () => { calls.push(1); return undefined } })
    mirror.push({ action: "pause", at: 2_000 })
    mirror.push({ action: "complete", at: 3_000 })
    await settle()
    expect(calls).toHaveLength(0)
    expect(mirror.projected()).toBeUndefined()
  })

  test("a burst of presses projects one coherent history for whatever lands next", () => {
    const mirror = createFocusSessionMirror({ sink: () => new Promise(() => {}) })
    mirror.push({ action: "start", at: 1_000, session: session(1_000) })
    mirror.push({ action: "pause", at: 2_000 })
    mirror.push({ action: "resume", at: 3_000 })
    const projected = mirror.projected()!
    expect(projected.id).toBe("session-1")
    expect(projected.pausedAt).toBeUndefined()
    // The paused stretch is folded out, so the next boundary continues the same story.
    expect(projected.startedAt).toBe(2_000)
  })

  test("the lifecycle buttons are disabled only while a command is on the wire", async () => {
    let release: ((acknowledged: FocusTimerSession | undefined) => void) | undefined
    const mirror = createFocusSessionMirror({ sink: () => new Promise((resolve) => { release = resolve }) })
    mirror.push({ action: "start", at: 1_000, session: session(1_000) })
    expect(mirror.busy()).toBe(true)
    release!(session(1_000, { revision: 1 }))
    await settle()
    expect(mirror.busy()).toBe(false)
  })
})

describe("the standing disagreement between the session and the countdown", () => {
  // Decisions are transitions. A reload mid-block, or a row adopted after a refusal,
  // leaves no transition to notice the disagreement -- this is what closes it.
  const at = 2_000

  test("a reload at a break with a session still open owes a completion", () => {
    const onBreak = timerReducer(running(), { type: "TICK", settings: DEFAULT_SETTINGS, seconds: 1_500 })
    expect(owedFocusBoundary(onBreak, open(), at)).toEqual({ action: "complete", at })
  })

  test("a reload into a counting block with a paused session owes a resume", () => {
    expect(owedFocusBoundary(running(), open({ pausedAt: 1_500 }), at)).toEqual({ action: "resume", at })
  })

  test("a reload into a parked block with a running session owes a pause", () => {
    expect(owedFocusBoundary(parked(), open(), at)).toEqual({ action: "pause", at })
  })

  test("a session and a countdown that agree owe nothing", () => {
    expect(owedFocusBoundary(running(), open(), at)).toBeNull()
    expect(owedFocusBoundary(parked(), open({ pausedAt: 1_500 }), at)).toBeNull()
    expect(owedFocusBoundary(parked(), undefined, at)).toBeNull()
    expect(owedFocusBoundary(running(), undefined, at)).toBeNull()
  })
})
