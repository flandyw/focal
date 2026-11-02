export const PUSH_OWNER_KEY = "focal:push-owner:v1"
export const PUSH_PREFERENCES_KEY = "focal:push-preferences:v1"
export const DESKTOP_NOTIFICATIONS_SINCE_KEY = "focal:desktop-notifications-since:v1"
export const NOTIFICATION_PREFERENCES_CHANGED = "focal:notification-preferences-changed"

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const SWITCHES = ["planned", "friends", "cheers", "deadlines", "daily", "focus", "breaks", "reading", "writing", "sac", "badge", "quiet"] as const
const DEFAULTS = {
  planned: true, friends: true, cheers: true, deadlines: false, daily: false,
  focus: true, breaks: true, reading: true, writing: true, sac: true, badge: true, quiet: false,
  lead_minutes: 0 as 0 | 5 | 10 | 15 | 30 | 60,
  deadline_days: 1 as 0 | 1 | 3 | 7,
  daily_time: "18:00", quiet_start: "22:00", quiet_end: "08:00", timezone: "UTC",
}
export type NotificationPreferences = typeof DEFAULTS

function validTimezone(value: string) {
  if (value.length > 100) return false
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true } catch { return false }
}

// Hand-written so the entry chunk doesn't carry zod; this also guards the push API, so unknown keys are dropped.
export function parseNotificationPreferences(input: unknown): NotificationPreferences | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null
  const value = input as Record<string, unknown>
  const next = { ...DEFAULTS }
  for (const key of SWITCHES) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== "boolean") return null
    next[key] = value[key]
  }
  for (const key of ["daily_time", "quiet_start", "quiet_end"] as const) {
    if (value[key] === undefined) continue
    if (typeof value[key] !== "string" || !TIME.test(value[key])) return null
    next[key] = value[key]
  }
  if (value.lead_minutes !== undefined) {
    if (![0, 5, 10, 15, 30, 60].includes(value.lead_minutes as number)) return null
    next.lead_minutes = value.lead_minutes as typeof next.lead_minutes
  }
  if (value.deadline_days !== undefined) {
    if (![0, 1, 3, 7].includes(value.deadline_days as number)) return null
    next.deadline_days = value.deadline_days as typeof next.deadline_days
  }
  if (value.timezone !== undefined) {
    if (typeof value.timezone !== "string" || !validTimezone(value.timezone)) return null
    next.timezone = value.timezone
  }
  return next
}

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PUSH_PREFERENCES_KEY) ?? "{}")
    return parseNotificationPreferences({ cheers: saved.friends, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...saved }) ?? { ...DEFAULTS }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveNotificationPreferences(preferences: NotificationPreferences) {
  localStorage.setItem(PUSH_PREFERENCES_KEY, JSON.stringify(preferences))
  window.dispatchEvent(new Event(NOTIFICATION_PREFERENCES_CHANGED))
}

export function inQuietHours(preferences: NotificationPreferences, now = new Date()) {
  if (!preferences.quiet) return false
  const current = new Intl.DateTimeFormat("en-GB", { timeZone: preferences.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now)
  return preferences.quiet_start < preferences.quiet_end
    ? current >= preferences.quiet_start && current < preferences.quiet_end
    : current >= preferences.quiet_start || current < preferences.quiet_end
}
