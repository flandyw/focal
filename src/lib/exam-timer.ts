export type ExamTimerPhase = "reading" | "writing" | "overtime"

export function getExamTimerState(
  now: number,
  startedAt: number,
  readingMinutes: number,
  writingMinutes: number,
  marks: number,
) {
  const elapsedSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const readingSeconds = readingMinutes * 60
  const writingSeconds = writingMinutes * 60
  const phase: ExamTimerPhase = elapsedSeconds < readingSeconds
    ? "reading"
    : elapsedSeconds < readingSeconds + writingSeconds
      ? "writing"
      : "overtime"
  const phaseElapsedSeconds = phase === "reading"
    ? elapsedSeconds
    : Math.min(writingSeconds, Math.max(0, elapsedSeconds - readingSeconds))
  const phaseDurationSeconds = phase === "reading" ? readingSeconds : writingSeconds
  const writingElapsedSeconds = phase === "reading" ? 0 : phaseElapsedSeconds

  return {
    phase,
    remainingSeconds: Math.max(0, phaseDurationSeconds - phaseElapsedSeconds),
    overtimeSeconds: phase === "overtime" ? elapsedSeconds - readingSeconds - writingSeconds : 0,
    progress: phase === "reading"
      ? readingSeconds ? (phaseElapsedSeconds / readingSeconds) * 100 : 100
      : writingSeconds ? (phaseElapsedSeconds / writingSeconds) * 100 : 100,
    expectedMarks: writingSeconds ? Math.min(marks, (writingElapsedSeconds / writingSeconds) * marks) : marks,
    writingElapsedSeconds,
  }
}

export function formatTimer(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`
}
