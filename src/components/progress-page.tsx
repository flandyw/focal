import { useEffect, useMemo, useState } from "react"
import type { StudySession } from "../lib/types"
import { isDeleted, type CanonicalStudySession } from "../lib/sync/sessionContract"
import { toast } from "sonner"
import { examHost } from "../lib/host"
import { AnalyticsView } from "./analytics/AnalyticsView"

const NO_PROJECTS: import("../lib/types").Project[] = []

export function ProgressPage({ sessions, onNewSession }: { sessions: CanonicalStudySession[]; onNewSession: () => void }) {
  const [localSessions, setLocalSessions] = useState<StudySession[]>([])
  useEffect(() => {
    let active = true
    void examHost.studySessions?.().then((history) => { if (active) setLocalSessions(history) }).catch((error: unknown) => {
      if (active) toast.error(error instanceof Error ? error.message : "Could not load desktop study history.")
    })
    return () => { active = false }
  }, [])
  const studySessions = useMemo(() => sessions.filter((session) => !isDeleted(session)).map((session): StudySession => {
    const blocks = session.segments.filter((segment) => segment.ended_at).map((segment) => ({ start: segment.started_at, end: segment.ended_at! }))
    const start = session.started_at ?? session.created_at
    const metadata = session.metadata.legacy_metadata && typeof session.metadata.legacy_metadata === "object" ? session.metadata.legacy_metadata as Record<string, unknown> : session.metadata
    const reflection = metadata.reflection as StudySession["reflection"]
    return {
      schemaVersion: 2,
      createdVia: "examtrack",
      created_at: session.created_at,
      id: session.id,
      title: session.title,
      reflection: reflection && typeof reflection.confidence === "number" && Number.isInteger(reflection.confidence) && reflection.confidence >= 1 && reflection.confidence <= 5 ? { confidence: reflection.confidence } : undefined,
      subjectIds: session.subject_id ? [session.subject_id] : [],
      schedule: { blocks: blocks.length ? blocks : [{ start, end: session.completed_at ?? start }] },
      execution: session.completed
        ? { state: "completed", completedAt: session.completed_at!, intervals: blocks.map((block) => ({ ...block, source: "manual" })) }
        : { state: "planned", intervals: [] },
    }
  }), [sessions])

  const history = new Map(localSessions.map((session) => [session.id, session]))
  for (const session of studySessions) history.set(session.id, session)
  // A cancelled canonical session also supersedes its old local snapshot.
  for (const session of sessions) if (isDeleted(session)) history.delete(session.id)
  return <AnalyticsView sessions={[...history.values()]} projects={NO_PROJECTS} onNewSession={onNewSession} />
}
