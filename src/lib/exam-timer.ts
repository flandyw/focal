import type { ExamTimerSession } from "./ongoing-timers"

export type ExamPhase = "reading" | "writing" | "overtime"

type ClockSession = Pick<ExamTimerSession, "startedAt" | "pausedAt" | "readingMinutes" | "writingMinutes" | "marks" | "writingFromMs">

/**
 * Everything the paper's clock shows, derived from one number: active elapsed time
 * (`(pausedAt ?? now) - startedAt`, which the server already keeps free of pauses).
 * The reading/writing boundary is a point on that axis, not a shift of `startedAt`,
 * because `startedAt` is rebuilt from the server on every sync and a shift would be lost.
 */
export function getExamClock(session: ClockSession, now: number) {
  const elapsedMs = Math.max(0, (session.pausedAt ?? now) - session.startedAt)
  const writingStartMs = session.writingFromMs ?? session.readingMinutes * 60_000
  const writingMs = session.writingMinutes * 60_000
  const writingEndMs = writingStartMs + writingMs
  const phase: ExamPhase = elapsedMs < writingStartMs ? "reading" : elapsedMs < writingEndMs ? "writing" : "overtime"
  const writingElapsedMs = Math.min(writingMs, Math.max(0, elapsedMs - writingStartMs))
  const remainingMs = phase === "reading" ? writingStartMs - elapsedMs : phase === "writing" ? writingEndMs - elapsedMs : 0
  return {
    phase,
    elapsedMs,
    writingStartMs,
    writingEndMs,
    remainingSeconds: Math.ceil(remainingMs / 1000),
    overtimeSeconds: Math.floor(Math.max(0, elapsedMs - writingEndMs) / 1000),
    writingElapsedSeconds: Math.floor(writingElapsedMs / 1000),
    expectedMarks: writingMs ? (writingElapsedMs / writingMs) * session.marks : session.marks,
    /** Wall-clock times the phases end, assuming no further pauses. */
    endsAt: { reading: now + writingStartMs - elapsedMs, writing: now + writingEndMs - elapsedMs },
  }
}

export type ExamClock = ReturnType<typeof getExamClock>

export function formatTimer(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`
}
