import { getSessionEffectiveMinutes, getSessionSubjectIds } from "@/lib/utils"
import type { PriorityUrgency, Project, StudySession } from "@/lib/types"

export function getCompletedStudyMinutesBySubject(
  sessions: StudySession[],
  projects: Project[],
): Record<string, number> {
  const projectsById = new Map(projects.map((project) => [project.id, project]))
  const minutesBySubject: Record<string, number> = {}

  for (const session of sessions) {
    if (session.execution.state !== "completed") continue
    const subjectIds = getSessionSubjectIds(
      session,
      session.projectId ? projectsById.get(session.projectId) : undefined,
    )
    const minutes = getSessionEffectiveMinutes(session)
    if (subjectIds.length === 0 || minutes <= 0) continue
    const minutesPerSubject = minutes / subjectIds.length
    for (const subjectId of subjectIds) {
      minutesBySubject[subjectId] = (minutesBySubject[subjectId] ?? 0) + minutesPerSubject
    }
  }

  return minutesBySubject
}

export function getUrgencyLabel(urgency: PriorityUrgency) {
  switch (urgency) {
    case "critical": return "Critical"
    case "high": return "High"
    case "medium": return "Medium"
    case "low": return "Low"
  }
}

export function getUrgencyClassName(urgency: PriorityUrgency) {
  switch (urgency) {
    case "critical": return "bg-destructive/12 text-destructive"
    case "high": return "bg-warning/14 text-warning dark:text-warning"
    case "medium": return "bg-primary/12 text-primary"
    case "low": return "bg-muted text-muted-foreground"
  }
}
