import type {
  CalendarEvent,
  PriorityItem,
  PriorityUrgency,
  Project,
  StudySession,
} from "@/lib/types"
import { getDeadlineTypeInfo, getEventTypeInfo, getSessionSubjectIds } from "@/lib/utils"
import { getProjectTopicMastery } from "@/lib/mastery"

const DAY_MS = 24 * 60 * 60 * 1000
const ASSESSMENT_TYPES = new Set(["sac", "exam", "assignment"])
export const FOCUS_PRIORITIES_KEY = "focal-focus-priorities"

export interface FocusPriorities {
  subjectOrder: string[]
  pinnedEventIds: string[]
}

export function readFocusPriorities(): FocusPriorities {
  try {
    const parsed = JSON.parse(localStorage.getItem(FOCUS_PRIORITIES_KEY) ?? "{}") as {
      subjectOrder?: unknown
      pinnedEventIds?: unknown
    }
    return {
      subjectOrder: Array.isArray(parsed.subjectOrder)
        ? parsed.subjectOrder.filter((value): value is string => typeof value === "string")
        : [],
      pinnedEventIds: Array.isArray(parsed.pinnedEventIds)
        ? parsed.pinnedEventIds.filter((value): value is string => typeof value === "string")
        : [],
    }
  } catch {
    return { subjectOrder: [], pinnedEventIds: [] }
  }
}

interface PriorityInput {
  projects: Project[]
  sessions: StudySession[]
  events: CalendarEvent[]
  now?: number
  subjectOrder?: string[]
  pinnedEventIds?: string[]
}

function getTime(value?: string): number | null {
  if (!value) return null
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? null : time
}

function getDaysUntil(value?: string, now = Date.now()): number | null {
  const time = getTime(value)
  if (time === null) return null
  return Math.ceil((time - now) / DAY_MS)
}

function getProjectSubjectIds(project?: Project): string[] {
  return project?.subjectId ? [project.subjectId] : []
}

function getUrgencyForDays(days: number): PriorityUrgency {
  if (days < 0) return "critical"
  if (days <= 2) return "high"
  if (days <= 7) return "medium"
  return "low"
}

function getPressureRank(urgency: PriorityUrgency): number {
  switch (urgency) {
    case "critical":
      return 4
    case "high":
      return 3
    case "medium":
      return 2
    case "low":
      return 1
  }
}

function formatDaysReason(days: number): string {
  if (days < 0) return `${Math.abs(days)}d overdue`
  if (days === 0) return "due today"
  if (days === 1) return "due tomorrow"
  return `due in ${days}d`
}

function sortPriorityItems(
  items: PriorityItem[],
  subjectOrder: string[],
  pinnedEventIds: string[],
): PriorityItem[] {
  const subjectRanks = new Map(subjectOrder.map((subjectId, index) => [subjectId, index]))
  const pinnedEvents = new Set(pinnedEventIds)
  const score = (item: PriorityItem) => {
    const urgency = getPressureRank(item.urgency) * 100
    const pinned = item.eventId && pinnedEvents.has(item.eventId) ? 80 : 0
    const bestSubjectRank = item.subjectIds.reduce<number | null>((best, subjectId) => {
      const rank = subjectRanks.get(subjectId)
      if (rank === undefined) return best
      return best === null ? rank : Math.min(best, rank)
    }, null)
    const subject = bestSubjectRank === null ? 0 : Math.max(8, 44 - bestSubjectRank * 8)
    return urgency + pinned + subject
  }
  return items.sort((a, b) => {
    const scoreDelta = score(b) - score(a)
    if (scoreDelta !== 0) return scoreDelta
    return a.title.localeCompare(b.title)
  })
}

export function getPriorityItems({
  projects,
  sessions,
  events,
  now = Date.now(),
  subjectOrder = [],
  pinnedEventIds = [],
}: PriorityInput): PriorityItem[] {
  const nextWeek = now + 7 * DAY_MS
  const activeProjects = projects.filter((project) => !project.isFinished && !project.isArchived)
  const activeProjectById = new Map(activeProjects.map((project) => [project.id, project]))
  const plannedProjectIds = new Set(
    sessions
      .filter((session) => {
        const start = getTime(session.startTime)
        return session.projectId && session.status === "planned" && start !== null && start >= now && start <= nextWeek
      })
      .map((session) => session.projectId!)
  )

  const items: PriorityItem[] = []

  activeProjects.forEach((project) => {
    const days = getDaysUntil(project.deadline, now)
    if (days === null) return
    if (days < 0 || days <= 7) {
      items.push({
        id: `project-${project.id}`,
        kind: days < 0 ? "overdue-project" : "upcoming-assessment",
        title: project.name,
        reason: `${project.deadlineType ? getDeadlineTypeInfo(project.deadlineType).label : "Deadline"} ${formatDaysReason(days)}`,
        urgency: getUrgencyForDays(days),
        subjectIds: getProjectSubjectIds(project),
        projectId: project.id,
        action: days < 0 ? "Open and triage" : "Prep next step",
      })
    }
  })

  const pinnedEvents = new Set(pinnedEventIds)
  events.forEach((event) => {
    if (event.isFinished) return
    const days = getDaysUntil(event.startTime, now)
    if (days === null || days < -1) return
    const isPinned = pinnedEvents.has(event.id)
    if (!isPinned && (!ASSESSMENT_TYPES.has(event.eventType) || days > 14)) return
    if (isPinned && days > 30) return
    items.push({
      id: `event-${event.id}`,
      kind: isPinned ? "pinned-event" : "upcoming-assessment",
      title: event.title,
      reason: `${getEventTypeInfo(event.eventType).label} ${formatDaysReason(days)}${isPinned ? " · pinned event" : ""}`,
      urgency: getUrgencyForDays(days),
      subjectIds: event.subjectId ? [event.subjectId] : [],
      eventId: event.id,
      action: "Check details",
    })
  })

  sessions.forEach((session) => {
    if (session.status !== "planned") return
    const start = getTime(session.startTime)
    if (start === null || start < now || start > nextWeek) return
    const project = session.projectId ? activeProjectById.get(session.projectId) : undefined
    const days = Math.ceil((start - now) / DAY_MS)
    items.push({
      id: `session-${session.id}`,
      kind: "planned-session",
      title: session.title,
      reason: days <= 0 ? "planned today" : `planned in ${days}d`,
      urgency: days <= 1 ? "medium" : "low",
      subjectIds: getSessionSubjectIds(session, project),
      projectId: session.projectId,
      sessionId: session.id,
      action: "Open session",
    })
  })

  activeProjects.forEach((project) => {
    if (!project.deadline || plannedProjectIds.has(project.id)) return
    const days = getDaysUntil(project.deadline, now)
    if (days === null || days < 0 || days > 21) return
    items.push({
      id: `plan-${project.id}`,
      kind: "plan-prep",
      title: `Plan prep for ${project.name}`,
      reason: `no session scheduled before ${formatDaysReason(days)}`,
      urgency: days <= 7 ? "medium" : "low",
      subjectIds: getProjectSubjectIds(project),
      projectId: project.id,
      action: "Plan session",
    })
  })

  sessions.forEach((session) => {
    if (session.status !== "completed" || !session.confidence || session.confidence > 2) return
    const project = session.projectId ? activeProjectById.get(session.projectId) : undefined
    const topics = session.topics?.filter((topic) => topic.trim().length > 0) ?? []
    items.push({
      id: `weak-${session.id}`,
      kind: "weak-topic",
      title: topics.length > 0 ? `Revise ${topics[0]}` : `Review ${session.title}`,
      reason: `confidence ${session.confidence}/5 after last review`,
      urgency: "medium",
      subjectIds: getSessionSubjectIds(session, project),
      projectId: session.projectId,
      sessionId: session.id,
      action: "Review notes",
    })
  })

  const projectsWithWeakSession = new Set(
    items.filter((item) => item.kind === "weak-topic").flatMap((item) => item.projectId ? [item.projectId] : []),
  )
  activeProjects.forEach((project) => {
    if (projectsWithWeakSession.has(project.id)) return
    const weakest = getProjectTopicMastery(project)[0]
    if (!weakest || weakest.score >= 70) return
    items.push({
      id: `mastery-${project.id}-${weakest.topic}`,
      kind: "weak-topic",
      title: `Revise ${weakest.topic}`,
      reason: `${weakest.score}% mastery from ${weakest.evidenceCount} result${weakest.evidenceCount === 1 ? "" : "s"}`,
      urgency: weakest.score < 50 ? "high" : "medium",
      subjectIds: getProjectSubjectIds(project),
      projectId: project.id,
      action: "Open assessment",
    })
  })

  const labelledItems = items.map((item) => {
    const rankedSubjects = item.subjectIds
      .map((subjectId) => subjectOrder.indexOf(subjectId))
      .filter((rank) => rank >= 0)
    if (rankedSubjects.length === 0) return item
    const rank = Math.min(...rankedSubjects) + 1
    return { ...item, reason: `${item.reason} · #${rank} subject priority` }
  })

  return sortPriorityItems(labelledItems, subjectOrder, pinnedEventIds).slice(0, 7)
}
