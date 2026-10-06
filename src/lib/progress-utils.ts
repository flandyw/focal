import { VCE_SUBJECTS, type Project, type StudySession } from "./types"
export { cn } from "./utils"

export function getSubjectById(id?: string) {
  if (!id || id === "_unassigned") return undefined
  return VCE_SUBJECTS.find((subject) => subject.id === id || subject.name === id)
    ?? { id, name: id, shortCode: id, color: "var(--chart-2)" }
}

export function getSessionSubjectIds(session: StudySession, project?: Project): string[] {
  if (session.subjectIds.length > 0) return session.subjectIds
  return project?.subjectId ? [project.subjectId] : []
}

export function getSessionEffectiveMinutes(session: StudySession): number {
  const ranges = session.execution.state === "planned"
    ? session.schedule.blocks
    : session.execution.intervals.filter((interval): interval is typeof interval & { end: string } => Boolean(interval.end))
  if (ranges.length > 0) {
    const sorted = ranges
      .map((range) => ({ start: new Date(range.start).getTime(), end: new Date(range.end).getTime() }))
      .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.end > range.start)
      .sort((a, b) => a.start - b.start)
    let total = 0
    let current = sorted[0]
    for (const range of sorted.slice(1)) {
      if (range.start > current.end) {
        total += current.end - current.start
        current = range
      } else {
        current.end = Math.max(current.end, range.end)
      }
    }
    if (current) total += current.end - current.start
    return Math.round(total / 60000)
  }
  return 0
}

