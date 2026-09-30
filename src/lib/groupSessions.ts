import { getSubjectById, getSessionSubjectIds, getSessionEffectiveMinutes } from "@/lib/utils"
import type { Project, StudySession } from "@/lib/types"

const SUBJECT_COLOR_FALLBACK = "var(--primary)"

export interface CalendarSessionIndicator {
  subjectId: string
  shortCode: string
  color: string
  count: number
  totalMinutes: number
  sessionIds: string[]
  status: StudySession["execution"]["state"]
}

export interface SessionProjectGroup {
  projectId?: string
  projectName: string
  sessions: StudySession[]
  totalMinutes: number
  count: number
}

export interface SessionSubjectGroup {
  subjectId: string
  shortCode: string
  color: string
  totalMinutes: number
  count: number
  projectGroups: SessionProjectGroup[]
}

function getSubjectInfo(subjectId: string): { shortCode: string; color: string } {
  const subject = getSubjectById(subjectId)
  return {
    shortCode: subject?.shortCode ?? subjectId,
    color: subject?.color ?? SUBJECT_COLOR_FALLBACK,
  }
}
/**
 * For a list of sessions on a single day, produce one indicator per unique subject.
 * Used by CalendarGrid to render compact subject bars instead of per-session bars.
 */
export function getCalendarSessionIndicators(
  sessions: StudySession[],
  projects: Project[],
): CalendarSessionIndicator[] {
  const bySubject = new Map<string, {
    count: number
    totalMinutes: number
    sessionIds: string[]
    statuses: StudySession["execution"]["state"][]
  }>()

  for (const session of sessions) {
    const project = session.projectId ? projects.find((p) => p.id === session.projectId) : undefined
    const subjectIds = getSessionSubjectIds(session, project)
    if (subjectIds.length === 0) continue

    const minutesPerSubject = getSessionEffectiveMinutes(session) / subjectIds.length

    for (const subjectId of subjectIds) {
      const entry = bySubject.get(subjectId)
      if (entry) {
        entry.count += 1
        entry.totalMinutes += minutesPerSubject
        entry.sessionIds.push(session.id)
        entry.statuses.push(session.execution.state)
      } else {
        bySubject.set(subjectId, {
          count: 1,
          totalMinutes: minutesPerSubject,
          sessionIds: [session.id],
          statuses: [session.execution.state],
        })
      }
    }
  }

  return Array.from(bySubject.entries())
    .map(([subjectId, data]) => {
      const info = getSubjectInfo(subjectId)
      const status: StudySession["execution"]["state"] = data.statuses.includes("in-progress")
        ? "in-progress"
        : data.statuses.every((item) => item === "completed")
          ? "completed"
          : "planned"
      return {
        subjectId,
        shortCode: info.shortCode,
        color: info.color,
        count: data.count,
        totalMinutes: Math.round(data.totalMinutes),
        sessionIds: data.sessionIds,
        status,
      }
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
}

/**
 * For a list of sessions on a single day, group by subject then by project.
 * Used by DayDetail to build collapsible sections.
 */
export function groupSessionsBySubject(
  sessions: StudySession[],
  projects: Project[],
): SessionSubjectGroup[] {
  const bySubject = new Map<string, { sessions: StudySession[]; totalMinutes: number }>()

  for (const session of sessions) {
    const project = session.projectId ? projects.find((p) => p.id === session.projectId) : undefined
    const subjectIds = getSessionSubjectIds(session, project)
    if (subjectIds.length === 0) continue

    const minutesPerSubject = getSessionEffectiveMinutes(session) / subjectIds.length

    for (const subjectId of subjectIds) {
      const entry = bySubject.get(subjectId)
      if (entry) {
        entry.sessions.push(session)
        entry.totalMinutes += minutesPerSubject
      } else {
        bySubject.set(subjectId, { sessions: [session], totalMinutes: minutesPerSubject })
      }
    }
  }

  return Array.from(bySubject.entries())
    .map(([subjectId, data]) => {
      const info = getSubjectInfo(subjectId)
      const projectGroups = buildProjectGroups(data.sessions, projects)
      return {
        subjectId,
        shortCode: info.shortCode,
        color: info.color,
        totalMinutes: Math.round(data.totalMinutes),
        count: data.sessions.length,
        projectGroups,
      }
    })
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
}

function buildProjectGroups(sessions: StudySession[], projects: Project[]): SessionProjectGroup[] {
  const byProject = new Map<string, { projectId?: string; projectName: string; sessions: StudySession[]; totalMinutes: number }>()

  for (const session of sessions) {
    const project = session.projectId ? projects.find((p) => p.id === session.projectId) : undefined
    const key = project?.id ?? "__no_project__"
    const existing = byProject.get(key)
    if (existing) {
      existing.sessions.push(session)
      existing.totalMinutes += getSessionEffectiveMinutes(session)
    } else {
      byProject.set(key, {
        projectId: project?.id,
        projectName: project?.name ?? "Study session",
        sessions: [session],
        totalMinutes: getSessionEffectiveMinutes(session),
      })
    }
  }

  return Array.from(byProject.values())
    .map((g) => ({
      projectId: g.projectId,
      projectName: g.projectName,
      sessions: g.sessions.sort(
        (a, b) => new Date(a.schedule.blocks[0].start).getTime() - new Date(b.schedule.blocks[0].start).getTime(),
      ),
      totalMinutes: Math.round(g.totalMinutes),
      count: g.sessions.length,
    }))
    .sort((a, b) => b.totalMinutes - a.totalMinutes)
}
