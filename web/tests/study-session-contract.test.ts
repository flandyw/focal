import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import {
  estimateServerNow,
  isStudySessionCommand,
  observeServerClock,
  parseCanonicalStudySession,
  parseStudySessionMutationResult,
  studySessionActiveMilliseconds,
} from "../../src/lib/sync/sessionContract"

const commandVectors = JSON.parse(readFileSync(new URL("../../src/lib/sync/vectors/session-command-sequence.json", import.meta.url), "utf8")) as {
  protocol: string
  session_id: string
  device_id: string
  app: "folio"
  kind: "focus"
  phase: "focus"
  title: string
  subject_id: string
  steps: { mutation_id: string; action: "start" | "pause" | "resume"; expected_revision: number }[]
  terminal_replay: { state: string; stale_action: string; result: string; state_after: string }
}

const session = (state: "running" | "paused" | "completed" | "cancelled" = "running") => ({
  id: "session-1",
  kind: "exam",
  state,
  phase: "writing",
  revision: 7,
  title: "Chemistry exam",
  subject_id: "Chemistry",
  originating_app: "examtrack",
  created_at: "2026-09-28T00:00:00.000Z",
  updated_at: "2026-09-28T00:05:00.000Z",
  started_at: "2026-09-28T00:00:00.000Z",
  paused_at: state === "paused" ? "2026-09-28T00:05:00.000Z" : null,
  completed_at: state === "completed" ? "2026-09-28T00:05:00.000Z" : null,
  cancelled_at: state === "cancelled" ? "2026-09-28T00:05:00.000Z" : null,
  accumulated_active_ms: 300_000,
  segment_started_at: state === "running" ? "2026-09-28T00:00:04.000Z" : null,
  metadata: { examtrack: { examYear: 2026, paper: "1" } },
  segments: [],
})

describe("canonical study-session contract", () => {
  test("validates the shared DTO and rejects malformed intervals", () => {
    expect(parseCanonicalStudySession(session())).not.toBeNull()
    expect(parseCanonicalStudySession({ ...session(), revision: -1 })).toBeNull()
    expect(parseCanonicalStudySession({ ...session(), state: "running", segment_started_at: null })).toBeNull()
  })

  test("uses a server timestamp plus monotonic elapsed time despite a skewed wall clock", () => {
    const anchor = observeServerClock("2026-09-28T00:00:00.000Z", 1_000)!
    const deviceWallClock = Date.parse("2026-09-28T00:10:00.000Z")
    const estimatedServerNow = estimateServerNow(anchor, 11_000)
    expect(deviceWallClock - estimatedServerNow).toBe(590_000)
    expect(estimatedServerNow).toBe(Date.parse("2026-09-28T00:00:10.000Z"))
    expect(studySessionActiveMilliseconds(parseCanonicalStudySession(session())!, estimatedServerNow))
      .toBe(306_000)
  })

  test("paused and terminal sessions do not accrue time after the last server boundary", () => {
    const now = Date.parse("2026-09-28T00:10:00.000Z")
    for (const state of ["paused", "completed", "cancelled"] as const) {
      expect(studySessionActiveMilliseconds(parseCanonicalStudySession(session(state))!, now)).toBe(300_000)
    }
  })

  test("runs the shared Folio command and terminal-state conformance vectors", () => {
    expect(commandVectors.protocol).toBe("study-session/1")
    for (const step of commandVectors.steps) {
      expect(isStudySessionCommand({
        ...step, session_id: commandVectors.session_id, device_id: commandVectors.device_id,
        app: commandVectors.app, kind: commandVectors.kind, phase: commandVectors.phase,
        title: commandVectors.title, subject_id: commandVectors.subject_id,
      })).toBe(true)
    }
    expect(commandVectors.terminal_replay).toEqual({
      state: "completed", stale_action: "resume", result: "session_terminal", state_after: "completed",
    })
    const command = { ...commandVectors.steps[1], session_id: commandVectors.session_id, device_id: commandVectors.device_id,
      app: commandVectors.app, kind: commandVectors.kind }
    expect(isStudySessionCommand({ ...command, device_id: "folio-android" })).toBe(false)
    expect(parseStudySessionMutationResult({
      ok: true, applied: false, reason: "stale_revision", server_now: "2026-09-28T00:05:00.000Z",
      session: session("paused"),
    })?.reason).toBe("stale_revision")
  })
})
