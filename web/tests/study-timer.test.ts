import { describe, expect, test } from "bun:test"

import {
  DEFAULT_SETTINGS,
  MAX_DURATION_MINUTES,
  advanceTimer,
  closeOpenBlock,
  countBlocksToday,
  getFocusSecondsToday,
  parseSettings,
  timerReducer,
  type FocusBlock,
  type TimerSettings,
  type TimerState,
} from "../src/lib/study-timer"

const settings: TimerSettings = { ...DEFAULT_SETTINGS, workMinutes: 25, breakMinutes: 5, longBreakEvery: 4 }

function freshState(overrides: Partial<TimerState> = {}): TimerState {
  return {
    running: false, mode: "work", secondsLeft: 1500, totalSeconds: 1500, cycles: 0,
    studyOvertime: false, overtimeSeconds: 0, freeStudy: false, breakSeconds: 0,
    ...overrides,
  }
}

describe("study timer state machine", () => {
  test("a focus block rolls into a break, and every fourth into a long break", () => {
    const afterBlock = advanceTimer(freshState({ running: true, secondsLeft: 1 }), settings, 1)
    expect(afterBlock.mode).toBe("break")
    expect(afterBlock.cycles).toBe(1)
    expect(afterBlock.running).toBe(settings.autoStartBreak)

    const third = advanceTimer(freshState({ running: true, secondsLeft: 1, cycles: 2 }), settings, 1)
    expect(third.mode).toBe("break")

    const fourth = advanceTimer(freshState({ running: true, secondsLeft: 1, cycles: 3 }), settings, 1)
    expect(fourth.mode).toBe("long-break")
    expect(fourth.secondsLeft).toBe(settings.longBreakMinutes * 60)
  })

  test("one oversized tick lands on the state the clock would have reached", () => {
    // 25 focus + 5 break, then 10s into the next focus block.
    const autoFocus = { ...settings, autoStartFocus: true }
    const ticked = advanceTimer(freshState({ running: true }), autoFocus, 30 * 60 + 10)
    expect(ticked.mode).toBe("work")
    expect(ticked.cycles).toBe(1)
    expect(ticked.secondsLeft).toBe(1500 - 10)

    // The same gap with auto-start off parks the block paused, fully unspent.
    const parked = advanceTimer(freshState({ running: true }), settings, 30 * 60 + 10)
    expect(parked.mode).toBe("work")
    expect(parked.running).toBe(false)
    expect(parked.secondsLeft).toBe(1500)
  })

  test("a stopped timer never moves, however long the gap", () => {
    expect(advanceTimer(freshState(), settings, 60 * 60 * 24)).toEqual(freshState())
  })

  test("overtime holds the break's elapsed time instead of counting down", () => {
    const onBreak = timerReducer(freshState({ mode: "break", secondsLeft: 280, totalSeconds: 300 }), {
      type: "START_STUDY_OVERTIME", settings,
    })
    expect(onBreak.studyOvertime).toBe(true)
    expect(onBreak.overtimeSeconds).toBe(20)

    const later = advanceTimer(onBreak, settings, 100)
    expect(later.overtimeSeconds).toBe(120)
    expect(advanceTimer({ ...later, running: false }, settings, 100)).toEqual({ ...later, running: false })
  })

  test("free study cannot start during a break, and returning to break clears the overrun", () => {
    expect(timerReducer(freshState({ mode: "break" }), { type: "START_FREE_STUDY", settings })).toEqual(freshState({ mode: "break" }))

    const free = timerReducer(freshState(), { type: "START_FREE_STUDY", settings })
    expect(free.freeStudy).toBe(true)
    expect(free.mode).toBe("break")
    expect(timerReducer(free, { type: "RETURN_TO_BREAK" }).studyOvertime).toBe(false)
  })

  test("free study can be finished: a stopped focus block, one full block's time", () => {
    const free = timerReducer(freshState(), { type: "START_FREE_STUDY", settings })
    const finished = timerReducer({ ...free, overtimeSeconds: 900 }, { type: "END_FREE_STUDY", settings })

    // Back on the focus screen and stopped, with nothing left over from free study.
    expect(finished.mode).toBe("work")
    expect(finished.running).toBe(false)
    expect(finished.freeStudy).toBe(false)
    expect(finished.studyOvertime).toBe(false)
    expect(finished.overtimeSeconds).toBe(0)
    expect(finished.secondsLeft).toBe(settings.workMinutes * 60)
    // Leaving focus is not ending free study: nothing changes outside it.
    expect(timerReducer(freshState(), { type: "END_FREE_STUDY", settings })).toEqual(freshState())
  })

  test("free study counts up in overtimeSeconds, because secondsLeft stays frozen", () => {
    // The regression: free study repurposes the break window instead of
    // counting it down, so elapsed time lands in overtimeSeconds while
    // secondsLeft stays at total. Reading the elapsed time as
    // total - secondsLeft is therefore permanently zero.
    const free = timerReducer(freshState(), { type: "START_FREE_STUDY", settings })
    expect(free.secondsLeft).toBe(free.totalSeconds)

    const later = advanceTimer(free, settings, 125)
    expect(later.overtimeSeconds).toBe(125)
    expect(later.totalSeconds - later.secondsLeft).toBe(0)

    // Paused, the held time moves to breakSeconds instead of accruing.
    const held = advanceTimer({ ...later, running: false }, settings, 30)
    expect(held.breakSeconds).toBe(30)
    expect(held.overtimeSeconds).toBe(125)
  })

  test("added time extends the block but never past the maximum", () => {
    const added = timerReducer(freshState(), { type: "ADD_TIME", minutes: 5 })
    expect(added.secondsLeft).toBe(1500 + 300)
    expect(added.totalSeconds).toBe(1500 + 300)

    const capped = timerReducer(freshState({ secondsLeft: 60, totalSeconds: 60 }), { type: "ADD_TIME", minutes: 500 })
    expect(capped.totalSeconds).toBe(MAX_DURATION_MINUTES * 60)
  })

  test("changing a duration keeps a part-elapsed block's progress", () => {
    const midBlock = freshState({ running: true, secondsLeft: 600, totalSeconds: 1500 })
    const shorter = timerReducer(midBlock, {
      type: "SYNC_SETTINGS", settings: { ...settings, workMinutes: 20 }, previousSettings: settings,
    })
    expect(shorter.secondsLeft).toBe(600)
    expect(shorter.totalSeconds).toBe(1200)

    // An untouched block follows the new length instead of keeping a stale total.
    const untouched = timerReducer(freshState(), {
      type: "SYNC_SETTINGS", settings: { ...settings, workMinutes: 20 }, previousSettings: settings,
    })
    expect(untouched.secondsLeft).toBe(1200)
    expect(untouched.totalSeconds).toBe(1200)
  })

  test("skipping a break respects auto-start, and cannot skip a focus block", () => {
    expect(timerReducer(freshState({ mode: "break" }), { type: "SKIP_BREAK", settings }).mode).toBe("work")
    expect(
      timerReducer(freshState({ mode: "break" }), {
        type: "SKIP_BREAK", settings: { ...settings, autoStartFocus: true },
      }).running,
    ).toBe(true)
    expect(timerReducer(freshState(), { type: "SKIP_BREAK", settings })).toEqual(freshState())
  })
})

describe("study timer settings", () => {
  test("a corrupt or hostile payload falls back to defaults", () => {
    expect(parseSettings("{not json")).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings(JSON.stringify({ workMinutes: "x", longBreakEvery: 999, dailyGoal: -4 }))).toEqual({
      ...DEFAULT_SETTINGS,
      longBreakEvery: 12,
      dailyGoal: 0,
    })
  })

  test("stored durations are clamped to the allowed range", () => {
    expect(parseSettings(JSON.stringify({ workMinutes: 0, breakMinutes: 10_000 }))).toMatchObject({
      workMinutes: 1,
      breakMinutes: 180,
    })
  })
})

describe("focus block log", () => {
  const now = new Date("2026-09-11T14:00:00")

  function block(id: string, startedAt: number, endedAt: number, activeSeconds?: number): FocusBlock {
    return { id, cycleNumber: 1, source: "pomodoro", subject: "Chemistry", intent: "", startedAt, endedAt,
      activeSeconds: activeSeconds ?? (endedAt - startedAt) / 1000 }
  }

  test("today's totals count the blocks that ended today, by the time actually worked", () => {
    const dayStart = new Date(now)
    dayStart.setHours(0, 0, 0, 0)
    const start = dayStart.getTime()
    const blocks = [
      block("yesterday", start - 7_200_000, start - 3_600_000, 600),
      block("morning", start, start + 1_500_000, 1_500),
      // Ended today, so it is today's block: it is counted whole rather than clipped,
      // because a block has no one boundary to clip to.
      block("midnight", start - 3_600_000, start + 1_000, 600),
    ]
    expect(countBlocksToday(blocks, now)).toBe(2)
    expect(getFocusSecondsToday(blocks, now)).toBe(1_500 + 600)
  })

  test("closing a block keeps real time and rejects a backwards clock", () => {
    const open = { cycleNumber: 2, source: "pomodoro" as const, subject: "Physics", intent: "Moles", startedAt: 1_000, pausedSeconds: 0 }
    const [closed] = closeOpenBlock(open, 61_000, [])
    expect(closed.endedAt - closed.startedAt).toBe(60_000)
    expect(closed.activeSeconds).toBe(60)
    const backwards = closeOpenBlock(open, 500, [])[0]
    expect(backwards.endedAt).toBe(500)
    expect(backwards.startedAt).toBe(500)
    expect(backwards.activeSeconds).toBe(0)
  })

  test("a paused block keeps the wall clock it really spanned and bills only the running seconds", () => {
    const open = { cycleNumber: 1, source: "pomodoro" as const, subject: "Physics", intent: "", startedAt: 0, pausedSeconds: 0 }
    // 50s of wall time, 30s of it already banked as paused: 20s of study.
    const banked = closeOpenBlock({ ...open, pausedSeconds: 30 }, 50_000, [])[0]
    expect(banked.activeSeconds).toBe(20)
    // The endpoints are the real ones. Pulling the pause out of them would report a
    // block that finished at 20s, which is a minute that never happened.
    expect([banked.startedAt, banked.endedAt]).toEqual([0, 50_000])
    // A pause still in progress at close time is billed too.
    expect(closeOpenBlock({ ...open, pausedAt: 40_000 }, 50_000, [])[0].activeSeconds).toBe(40)
    // Pauses longer than the block itself cannot produce a negative duration.
    expect(closeOpenBlock({ ...open, pausedSeconds: 9_000 }, 50_000, [])[0].activeSeconds).toBe(0)
  })

  test("a block interrupted by a pause still shows the real 10:00 to 10:30, not 10:00 to 10:20", () => {
    // 10:00 start, 10:10 pause, 10:20 resume, 10:30 finish: twenty minutes of work
    // inside a thirty minute span.
    const open = { cycleNumber: 1, source: "pomodoro" as const, subject: "Physics", intent: "",
      startedAt: Date.parse("2026-09-11T10:00:00"), pausedSeconds: 600, pausedAt: undefined }
    const [closed] = closeOpenBlock(open, Date.parse("2026-09-11T10:30:00"), [])
    expect(closed.activeSeconds).toBe(1_200)
    expect(new Date(closed.startedAt).getHours()).toBe(10)
    expect(new Date(closed.startedAt).getMinutes()).toBe(0)
    expect(new Date(closed.endedAt).getHours()).toBe(10)
    expect(new Date(closed.endedAt).getMinutes()).toBe(30)
  })
})
