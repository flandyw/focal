import { describe, expect, test } from "bun:test"

import { readCursorFor, reconcileSessionResult } from "../src/lib/study-session-sync"
import type { FocusTimerSession } from "../src/lib/ongoing-timers"
import type { CanonicalStudySession, StudySessionCommand, StudySessionMutationResult } from "../../../src/lib/sync/sessionContract"

const at = (seconds: number) => new Date(Date.parse("2026-09-11T10:00:00") + seconds * 1000).toISOString()

function canonical(over: Partial<CanonicalStudySession> = {}): CanonicalStudySession {
  return {
    id: "session-1", kind: "focus", state: "running", phase: "focus", revision: 1,
    title: "25 minute focus block", subject_id: "Chemistry", originating_app: "examtrack",
    created_at: at(0), updated_at: at(0), started_at: at(0), paused_at: null,
    completed_at: null, cancelled_at: null, accumulated_active_ms: 0,
    segment_started_at: at(0), metadata: { examtrack: { subject: "Chemistry", provider: "Focal",
      title: "25 minute focus block", cycleNumber: 1, workMinutes: 25, pausedSeconds: 0 } },
    segments: [], ...over,
  }
}

function result(over: Partial<StudySessionMutationResult> = {}): StudySessionMutationResult {
  return { ok: true, applied: true, reason: null, server_now: at(10), session: canonical(), ...over }
}

function command(over: Partial<StudySessionCommand> = {}): StudySessionCommand {
  return { mutation_id: crypto.randomUUID(), session_id: "session-1", expected_revision: 0, action: "start",
    device_id: crypto.randomUUID(), app: "examtrack", kind: "focus", phase: "focus", ...over }
}

function local(over: Partial<FocusTimerSession> = {}): FocusTimerSession {
  return { id: "session-1", subject: "Chemistry", provider: "Focal", title: "25 minute focus block",
    cycleNumber: 1, workMinutes: 25, startedAt: 1_000, pausedSeconds: 0, ...over }
}

const reconcile = (r: StudySessionMutationResult, c: StudySessionCommand, t: FocusTimerSession) =>
  reconcileSessionResult(r, c, t, true, "focus")

describe("reconciling a server answer", () => {
  test("an applied command hands back the server's row, not the one that was asked for", () => {
    const projected = reconcile(result({ applied: true, session: canonical({ state: "running", revision: 3 }) }),
      command(), local())!
    expect(projected.revision).toBe(3)
    expect(projected.pausedAt).toBeUndefined()
  })

  test("the first start keeps the revision the server handed back", () => {
    // The bug: `if (saved && previous)` dropped it, so the next command was built on
    // expected_revision 0 against a row already at 1, and every later command was stale.
    const projected = reconcile(result({ session: canonical({ revision: 1 }) }), command(), local({ revision: undefined }))!
    expect(projected.revision).toBe(1)
  })

  test("a rejected pause cannot come back as a paused local timer", () => {
    // The exact failure in the field: the UI wanted paused, the server refused as
    // stale and said running. Taking the server's word leaves the readout and the
    // billed time in agreement.
    const refusal = result({ applied: false, ok: true, reason: "stale_revision",
      session: canonical({ state: "running", revision: 7, accumulated_active_ms: 300_000 }) })
    let projected: FocusTimerSession | undefined
    try {
      projected = reconcile(refusal, command({ action: "pause", expected_revision: 3 }), local({ revision: 3, pausedAt: 9_000 }))
    } catch (error) {
      expect(String(error)).toContain("another device")
    }
    // Either way it is never a paused timer wearing the server's revision.
    expect(projected?.pausedAt).toBeUndefined()
  })

  test("a stale rejection that already agrees with what was asked for is accepted", () => {
    // Pausing a session the other device already paused is not a failure; the row
    // the server returns is simply the truth.
    const alreadyPaused = canonical({ state: "paused", revision: 8, segment_started_at: null,
      paused_at: at(300), accumulated_active_ms: 300_000 })
    const projected = reconcile(result({ applied: false, reason: "already_paused", session: alreadyPaused }),
      command({ action: "pause", expected_revision: 3 }), local({ revision: 3 }))!
    expect(projected.pausedAt).toBeTypeOf("number")
    expect(projected.revision).toBe(8)
  })

  test("starting a session that is already running is accepted, not reported as a clash", () => {
    const projected = reconcile(result({ applied: false, ok: false, reason: "already_running",
      session: canonical({ state: "running", revision: 2 }) }),
      command({ action: "start" }), local())!
    expect(projected.revision).toBe(2)
  })

  test("a session another device finished stops being a local timer", () => {
    const finished = canonical({ state: "completed", revision: 9, segment_started_at: null, completed_at: at(600) })
    expect(reconcile(result({ session: finished }), command({ action: "save_progress" }), local())).toBeUndefined()
  })

  test("closing a session hands back nothing, whether it applied or not", () => {
    const completed = canonical({ state: "completed", revision: 4, completed_at: at(600) })
    expect(reconcileSessionResult(result({ session: completed }), command({ action: "complete" }), local(), false, "focus"))
      .toBeUndefined()
  })

  test("a response with no session is an error, never a silent success", () => {
    expect(() => reconcile(result({ session: null }), command(), local())).toThrow()
  })

  test("elapsed time is read from the server's accumulated segments, not the local clock", () => {
    // The local timer claims it started at epoch 0 and has 999 paused seconds. Neither
    // is believed: the start is reconstructed from what the server says was worked.
    const before = Date.now()
    const projected = reconcile(result({ session: canonical({ state: "paused", revision: 4,
      segment_started_at: null, paused_at: at(1_260), accumulated_active_ms: 1_200_000 }) }),
      command({ action: "pause" }), local({ startedAt: 0, pausedSeconds: 999 }))!
    // Twenty minutes of worked time back from the answer. The anchor is the server clock
    // in a real call; here, with no anchor, it is the local one.
    expect(projected.startedAt).toBeGreaterThanOrEqual(before - 1_200_000 - 1_000)
    expect(projected.startedAt).toBeLessThanOrEqual(Date.now() - 1_200_000)
    expect(projected.startedAt).not.toBe(0)
  })
})

describe("reading the shared session feed", () => {
  test("an empty history is re-read once from the whole state, never paged from a stale cursor", () => {
    // A cursor past the sittings the account already has returns an empty tail forever.
    expect(readCursorFor(4_096, 0, false)).toBe(-1)
    // Once the whole state has been read, an empty history is a real one.
    expect(readCursorFor(4_096, 0, true)).toBe(4_096)
    // Sittings in hand means the cursor is good enough; polling stays cheap.
    expect(readCursorFor(7, 2, false)).toBe(7)
  })
})
