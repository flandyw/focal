import { VCE_SUBJECTS, type Project, type StudySession } from "./types.js"
export { cn } from "./utils.js"
import { studySubjectId } from "./studySubjects.js"
import { isDeleted, studySessionSubjectSpans, type CanonicalStudySession } from "./sync/sessionContract.js"

/** Canonical sessions as analytics sessions. A session that switched subject becomes one per subject holding that
 *  subject's time; the first keeps the session's id, so a desktop snapshot with that id is still replaced. */
export function analyticsSessions(sessions: readonly CanonicalStudySession[]): StudySession[] {
  return sessions.filter((session) => !isDeleted(session)).flatMap((session) => {
    const blocks = session.segments.filter((segment) => segment.ended_at).map((segment) => ({ start: segment.started_at, end: segment.ended_at! }))
    const start = session.started_at ?? session.created_at
    const metadata = (session.metadata.legacy_metadata && typeof session.metadata.legacy_metadata === "object" ? session.metadata.legacy_metadata : session.metadata) as Record<string, unknown>
    const reflection = metadata.reflection as StudySession["reflection"]
    const pieces = studySessionSubjectSpans(session, blocks.length ? blocks : [{ start, end: session.completed_at ?? start }])
    return [...new Set(pieces.map((piece) => piece.subjectId))].map((subjectId, index): StudySession => {
      const own = pieces.filter((piece) => piece.subjectId === subjectId).map((piece) => ({ start: piece.start, end: piece.end }))
      return {
        schemaVersion: 2, createdVia: "examtrack", created_at: session.created_at, id: index ? `${session.id}:${subjectId}` : session.id, title: session.title,
        reflection: reflection && typeof reflection.confidence === "number" && Number.isInteger(reflection.confidence) && reflection.confidence >= 1 && reflection.confidence <= 5 ? { confidence: reflection.confidence } : undefined,
        subjectIds: subjectId ? [subjectId] : [],
        schedule: { blocks: own },
        execution: session.completed
          ? { state: "completed", completedAt: session.completed_at!, intervals: blocks.length ? own.map((block) => ({ ...block, source: "manual" as const })) : [] }
          : { state: "planned", intervals: [] },
      }
    })
  })
}

export function getSubjectById(id?: string) {
  if (!id || id === "_unassigned") return undefined
  return VCE_SUBJECTS.find((subject) => subject.id === id || subject.name === id)
    ?? { id, name: id, shortCode: id, color: "var(--chart-2)" }
}

export function getSessionSubjectIds(session: StudySession, project?: Project): string[] {
  const ids = session.subjectIds.length > 0 ? session.subjectIds : project?.subjectId ? [project.subjectId] : []
  // Names, ids and short codes for one subject must group together.
  return [...new Set(ids.map((id) => studySubjectId(id)))]
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

