import { useEffect, useMemo, useState } from "react"
import type { StudySession } from "../lib/types"
import { isDeleted, type CanonicalStudySession } from "../lib/sync/sessionContract"
import { analyticsSessions } from "../lib/progress-utils"
import { toast } from "sonner"
import { examHost } from "../lib/host"
import { AnalyticsView } from "./analytics/AnalyticsView"
import type { ExamAttempt } from "../lib/exam-data"

const NO_PROJECTS: import("../lib/types").Project[] = []

export function ProgressPage({ sessions, attempts, subject, onNewSession, onLogExam }: { sessions: CanonicalStudySession[]; attempts: ExamAttempt[]; subject?: string; onNewSession: () => void; onLogExam: () => void }) {
  const [localSessions, setLocalSessions] = useState<StudySession[]>([])
  useEffect(() => {
    let active = true
    void examHost.studySessions?.().then((history) => { if (active) setLocalSessions(history) }).catch((error: unknown) => {
      if (active) toast.error(error instanceof Error ? error.message : "Could not load desktop study history.")
    })
    return () => { active = false }
  }, [])
  const studySessions = useMemo(() => analyticsSessions(sessions), [sessions])

  const history = new Map(localSessions.map((session) => [session.id, session]))
  for (const session of studySessions) history.set(session.id, session)
  // A cancelled canonical session also supersedes its old local snapshot.
  for (const session of sessions) if (isDeleted(session)) history.delete(session.id)
  return <AnalyticsView sessions={[...history.values()]} attempts={attempts} subject={subject} projects={NO_PROJECTS} onNewSession={onNewSession} onLogExam={onLogExam} />
}
