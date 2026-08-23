import { useEffect } from "react"
import { parseISO } from "date-fns"
import { toast } from "sonner"
import { sendNativeNotification } from "@/lib/nativeNotifications"
import { getDeadlineTypeInfo } from "@/lib/utils"
import type { CalendarEvent, Project, StudySession } from "@/lib/types"

type NotificationUrgency = "critical" | "warning" | "info"
type LeadWindow = "due-now" | "today" | "tomorrow" | "soon"

interface StudyNotification {
  id: string
  scheduledFor: string
  title: string
  body: string
  toastMessage: string
  urgency: NotificationUrgency
  leadWindow: LeadWindow
  hoursUntil: number
}

const MAX_ALERTS_PER_DAY = 5
const MAX_NATIVE_NOTIFICATIONS_PER_DAY = 3
const NOTIFICATION_CHECK_INTERVAL_MS = 60_000
const MISSED_ALERT_GRACE_HOURS = 1
const NOTIFICATION_HISTORY_RETENTION_MS = 30 * 24 * 60 * 60 * 1_000
const NOTIFICATION_STATE_KEY = "focal-study-notification-state"
const LEGACY_PROJECT_NOTIFIED_KEY = "focal-notified-deadlines"
const LEGACY_EVENT_NOTIFIED_KEY = "focal-notified-events"

interface NotificationState {
  sent: Record<string, string[]>
  dailyCounts: Record<string, number>
  dailyNativeCounts: Record<string, number>
}

export function getLeadWindow(hoursUntil: number): LeadWindow | null {
  if (hoursUntil < -MISSED_ALERT_GRACE_HOURS) return null
  if (hoursUntil <= 3) return "due-now"
  if (hoursUntil <= 24) return "today"
  if (hoursUntil <= 48) return "tomorrow"
  if (hoursUntil <= 72) return "soon"
  return null
}

function readNotificationState(): NotificationState {
  try {
    const state = JSON.parse(localStorage.getItem(NOTIFICATION_STATE_KEY) ?? "{}") as Partial<NotificationState>
    return {
      sent: state.sent ?? {},
      dailyCounts: state.dailyCounts ?? {},
      dailyNativeCounts: state.dailyNativeCounts ?? {},
    }
  } catch {
    return { sent: {}, dailyCounts: {}, dailyNativeCounts: {} }
  }
}

function writeNotificationState(state: NotificationState) {
  try {
    localStorage.setItem(NOTIFICATION_STATE_KEY, JSON.stringify(state))
  } catch {
    // A blocked/full local store should not break the app over best-effort alerts.
  }
}

function getLocalDayKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

function getPlural(value: number, unit: string) {
  return `${value} ${unit}${value === 1 ? "" : "s"}`
}

function getRelativeLead(hoursUntil: number, leadWindow: LeadWindow) {
  if (hoursUntil <= 0) return "now"
  if (leadWindow === "soon") return "in 3 days"
  if (leadWindow === "tomorrow") return `in ${getPlural(Math.ceil(hoursUntil / 24), "day")}`
  return `in ${getPlural(Math.max(1, Math.ceil(hoursUntil)), "hour")}`
}

function showToast(notification: StudyNotification) {
  const options = { duration: notification.urgency === "critical" ? 6000 : notification.urgency === "warning" ? 5000 : 4000 }

  if (notification.urgency === "critical") {
    toast.error(notification.toastMessage, options)
  } else if (notification.urgency === "warning") {
    toast.warning(notification.toastMessage, options)
  } else {
    toast.info(notification.toastMessage, options)
  }
}

export function createProjectNotification(project: Project, now: Date): StudyNotification | null {
  if (!project.deadline || project.isFinished || project.isArchived || project.deleted_at) return null

  const deadlineDate = parseISO(project.deadline)
  if (Number.isNaN(deadlineDate.getTime())) return null

  const hoursUntil = (deadlineDate.getTime() - now.getTime()) / 3_600_000
  const leadWindow = getLeadWindow(hoursUntil)
  if (!leadWindow) return null

  const relativeLead = getRelativeLead(hoursUntil, leadWindow)
  const label = project.deadlineType ? getDeadlineTypeInfo(project.deadlineType).label : "Assessment"
  const isOverdue = hoursUntil < 0

  return {
    id: `project:${project.id}`,
    scheduledFor: deadlineDate.toISOString(),
    title: isOverdue ? `${project.name} is overdue` : leadWindow === "due-now" ? `${project.name} is close` : `${label} due ${relativeLead}`,
    body: isOverdue
      ? `${project.name} was due recently. Update it or make a plan to finish it.`
      : `${project.name} is due ${relativeLead}. Plan a focused study block before it slips.`,
    toastMessage: isOverdue ? `${project.name} is overdue` : `${project.name} is due ${relativeLead}`,
    urgency: leadWindow === "due-now" || leadWindow === "today" ? "critical" : leadWindow === "tomorrow" ? "warning" : "info",
    leadWindow,
    hoursUntil,
  }
}

export function createEventNotification(event: CalendarEvent, now: Date): StudyNotification | null {
  if (event.isFinished || event.deleted_at) return null

  const eventDate = parseISO(event.startTime)
  if (Number.isNaN(eventDate.getTime())) return null

  const hoursUntil = (eventDate.getTime() - now.getTime()) / 3_600_000
  const leadWindow = getLeadWindow(hoursUntil)
  if (!leadWindow) return null

  const relativeLead = getRelativeLead(hoursUntil, leadWindow)
  const hasStarted = hoursUntil < 0

  return {
    id: `event:${event.id}`,
    scheduledFor: eventDate.toISOString(),
    title: hasStarted ? `${event.title} has started` : `${event.title} starts ${relativeLead}`,
    body: hasStarted ? "It started recently. Open Focal to check the details." : "Check what you need and leave enough time to prepare.",
    toastMessage: hasStarted ? `${event.title} has started` : `${event.title} starts ${relativeLead}`,
    urgency: leadWindow === "due-now" || leadWindow === "today" ? "critical" : leadWindow === "tomorrow" ? "warning" : "info",
    leadWindow,
    hoursUntil,
  }
}

export function createSessionNotification(session: StudySession, now: Date): StudyNotification | null {
  if (session.status !== "planned" || session.deleted_at) return null

  const sessionDate = parseISO(session.startTime)
  if (Number.isNaN(sessionDate.getTime())) return null

  const hoursUntil = (sessionDate.getTime() - now.getTime()) / 3_600_000
  const leadWindow = getLeadWindow(hoursUntil)
  if (!leadWindow || leadWindow === "soon") return null

  const relativeLead = getRelativeLead(hoursUntil, leadWindow)
  const hasStarted = hoursUntil < 0

  return {
    id: `session:${session.id}`,
    scheduledFor: sessionDate.toISOString(),
    title: hasStarted ? "Study session has started" : `Study session ${relativeLead}`,
    body: hasStarted
      ? `${session.title} started recently. Open Focal when you're ready.`
      : `${session.title} starts ${relativeLead}. Keep it focused and achievable.`,
    toastMessage: hasStarted ? `${session.title} has started` : `${session.title} starts ${relativeLead}`,
    urgency: leadWindow === "due-now" ? "critical" : "warning",
    leadWindow,
    hoursUntil,
  }
}

export function getNotificationOccurrenceKey(notification: Pick<StudyNotification, "id" | "scheduledFor">) {
  return `${notification.id}@${notification.scheduledFor}`
}

async function dispatchNotifications(notifications: StudyNotification[], now: Date) {
  if (notifications.length === 0) return

  const state = readNotificationState()
  const dayKey = getLocalDayKey(now)
  let dailyAlertCount = state.dailyCounts[dayKey] ?? 0
  let dailyNativeCount = state.dailyNativeCounts[dayKey] ?? 0
  state.dailyCounts = { [dayKey]: dailyAlertCount }
  state.dailyNativeCounts = { [dayKey]: dailyNativeCount }

  // ponytail: occurrences cannot alert after the one-hour grace window, so a
  // 30-day history is ample. Add durable audit storage only if alert logs ship.
  const historyCutoff = now.getTime() - NOTIFICATION_HISTORY_RETENTION_MS
  for (const key of Object.keys(state.sent)) {
    const separator = key.lastIndexOf("@")
    if (separator < 0) continue
    const scheduledAt = Date.parse(key.slice(separator + 1))
    if (Number.isFinite(scheduledAt) && scheduledAt < historyCutoff) delete state.sent[key]
  }

  // Existing installs tracked only the item ID. Move that history onto the
  // current occurrence so changing its date starts a fresh reminder sequence.
  for (const notification of notifications) {
    const occurrenceKey = getNotificationOccurrenceKey(notification)
    const legacyWindows = state.sent[notification.id]
    if (legacyWindows && !state.sent[occurrenceKey]) state.sent[occurrenceKey] = legacyWindows
    delete state.sent[notification.id]
  }

  const dueNotifications = notifications
    .filter((notification) => !(state.sent[getNotificationOccurrenceKey(notification)] ?? []).includes(notification.leadWindow))
    .sort((a, b) => a.hoursUntil - b.hoursUntil)
  if (dueNotifications.length === 0 || dailyAlertCount >= MAX_ALERTS_PER_DAY) {
    writeNotificationState(state)
    return
  }

  for (const notification of dueNotifications) {
    if (dailyAlertCount >= MAX_ALERTS_PER_DAY) break

    showToast(notification)
    dailyAlertCount += 1

    const occurrenceKey = getNotificationOccurrenceKey(notification)
    state.sent[occurrenceKey] = [...(state.sent[occurrenceKey] ?? []), notification.leadWindow]
    state.dailyCounts[dayKey] = dailyAlertCount
    writeNotificationState(state)

    if (dailyNativeCount < MAX_NATIVE_NOTIFICATIONS_PER_DAY) {
      const delivered = await sendNativeNotification({
        title: notification.title,
        body: notification.body,
      })
      if (delivered) {
        dailyNativeCount += 1
        state.dailyNativeCounts[dayKey] = dailyNativeCount
        writeNotificationState(state)
      }
    }
  }
}

function migrateLegacyNotificationState() {
  const state = readNotificationState()

  try {
    const notifiedProjects = JSON.parse(localStorage.getItem(LEGACY_PROJECT_NOTIFIED_KEY) ?? "[]") as string[]
    notifiedProjects.forEach((id) => {
      state.sent[`project:${id}`] = state.sent[`project:${id}`] ?? ["soon"]
    })
    localStorage.removeItem(LEGACY_PROJECT_NOTIFIED_KEY)
  } catch {
    // Ignore malformed legacy notification state.
  }

  try {
    const notifiedEvents = JSON.parse(localStorage.getItem(LEGACY_EVENT_NOTIFIED_KEY) ?? "[]") as string[]
    notifiedEvents.forEach((id) => {
      state.sent[`event:${id}`] = state.sent[`event:${id}`] ?? ["soon"]
    })
    localStorage.removeItem(LEGACY_EVENT_NOTIFIED_KEY)
  } catch {
    // Ignore malformed legacy notification state.
  }

  writeNotificationState(state)
}

let dispatchQueue = Promise.resolve()

function queueNotifications(notifications: StudyNotification[], now: Date, isCurrent: () => boolean) {
  dispatchQueue = dispatchQueue
    .catch(() => undefined)
    .then(() => isCurrent() ? dispatchNotifications(notifications, now) : undefined)
  void dispatchQueue.catch(() => undefined)
}

export function useDeadlineNotifications(projects: Project[], events: CalendarEvent[] = [], sessions: StudySession[] = []) {
  useEffect(() => {
    let active = true
    migrateLegacyNotificationState()

    const checkNotifications = () => {
      const now = new Date()
      const notifications = [
        ...projects.map((project) => createProjectNotification(project, now)),
        ...events.map((event) => createEventNotification(event, now)),
        ...sessions.map((session) => createSessionNotification(session, now)),
      ].filter((notification): notification is StudyNotification => notification !== null)

      queueNotifications(notifications, now, () => active)
    }

    const checkWhenVisible = () => {
      if (document.visibilityState === "visible") checkNotifications()
    }

    checkNotifications()
    const interval = window.setInterval(checkNotifications, NOTIFICATION_CHECK_INTERVAL_MS)
    document.addEventListener("visibilitychange", checkWhenVisible)
    window.addEventListener("focus", checkNotifications)

    return () => {
      active = false
      window.clearInterval(interval)
      document.removeEventListener("visibilitychange", checkWhenVisible)
      window.removeEventListener("focus", checkNotifications)
    }
  }, [projects, events, sessions])
}
