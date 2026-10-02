import { addDays, format, parseISO } from "date-fns"
import { getSubjectById } from "@/lib/utils"
import { VCE_SUBJECTS } from "@/lib/types"
import type { CalendarEvent, Project, StudySession } from "@/lib/types"

export function buildTodayOverview(
  projects: Project[],
  sessions: StudySession[],
  events: CalendarEvent[],
  now = new Date(),
) {
  const activeProjects = projects.filter(
    (project) => !project.isFinished && !project.isArchived,
  )
  const projectsWithDeadlines = activeProjects.filter((project) => project.deadline)
  const isPastDeadline = (project: Project) => (
    project.deadline ? parseISO(project.deadline).getTime() < now.getTime() : false
  )
  const overdueProjects = projectsWithDeadlines.filter(
    isPastDeadline,
  )
  const nextWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const dueThisWeek = projectsWithDeadlines
    .filter(
      (project) => project.deadline && !isPastDeadline(project) && parseISO(project.deadline) <= nextWeek,
    )
    .sort((a, b) => parseISO(a.deadline!).getTime() - parseISO(b.deadline!).getTime())

  const subjectsById = new Map(VCE_SUBJECTS.map((subject) => [subject.id, subject]))
  for (const project of projects) {
    if (!project.subjectId || subjectsById.has(project.subjectId)) continue
    const subject = getSubjectById(project.subjectId)
    if (subject) subjectsById.set(subject.id, subject)
  }

  const deadlinesByDate: Record<string, Project[]> = {}
  for (const project of projectsWithDeadlines) {
    if (!project.deadline) continue
    const dateKey = format(parseISO(project.deadline), "yyyy-MM-dd")
    ;(deadlinesByDate[dateKey] ??= []).push(project)
  }

  const sessionsByDate: Record<string, StudySession[]> = {}
  for (const session of sessions) {
    const dateKey = format(parseISO(session.schedule.blocks[0].start), "yyyy-MM-dd")
    ;(sessionsByDate[dateKey] ??= []).push(session)
  }

  const eventsByDate: Record<string, CalendarEvent[]> = {}
  for (const event of events) {
    const startKey = format(parseISO(event.startTime), "yyyy-MM-dd")
    ;(eventsByDate[startKey] ??= []).push(event)
    if (!event.endTime) continue
    const endKey = format(parseISO(event.endTime), "yyyy-MM-dd")
    let current = parseISO(event.startTime)
    while (format(current, "yyyy-MM-dd") < endKey) {
      current = addDays(current, 1)
      ;(eventsByDate[format(current, "yyyy-MM-dd")] ??= []).push(event)
    }
  }

  return {
    now,
    nextWeek,
    activeProjects,
    projectsWithDeadlines,
    overdueProjects,
    dueThisWeek,
    planningSubjects: Array.from(subjectsById.values()),
    upcomingEvents: events
      .filter((event) => {
        const start = new Date(event.startTime)
        return !event.isFinished && start >= now && start <= nextWeek
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()),
    deadlinesByDate,
    sessionsByDate,
    eventsByDate,
  }
}
