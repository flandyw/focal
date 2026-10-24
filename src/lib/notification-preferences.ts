import { z } from "zod"

export const PUSH_OWNER_KEY = "focal:push-owner:v1"
export const PUSH_PREFERENCES_KEY = "focal:push-preferences:v1"
export const DESKTOP_NOTIFICATIONS_SINCE_KEY = "focal:desktop-notifications-since:v1"
export const NOTIFICATION_PREFERENCES_CHANGED = "focal:notification-preferences-changed"

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/)
export const notificationPreferencesSchema = z.object({
  planned: z.boolean().default(true),
  friends: z.boolean().default(true),
  cheers: z.boolean().default(true),
  deadlines: z.boolean().default(false),
  daily: z.boolean().default(false),
  focus: z.boolean().default(true),
  breaks: z.boolean().default(true),
  reading: z.boolean().default(true),
  writing: z.boolean().default(true),
  sac: z.boolean().default(true),
  lead_minutes: z.union([z.literal(0), z.literal(5), z.literal(10), z.literal(15), z.literal(30), z.literal(60)]).default(0),
  deadline_days: z.union([z.literal(0), z.literal(1), z.literal(3), z.literal(7)]).default(1),
  daily_time: time.default("18:00"),
  quiet: z.boolean().default(false),
  quiet_start: time.default("22:00"),
  quiet_end: time.default("08:00"),
  timezone: z.string().max(100).refine((value) => {
    try { new Intl.DateTimeFormat("en", { timeZone: value }); return true } catch { return false }
  }).default("UTC"),
})
export type NotificationPreferences = z.infer<typeof notificationPreferencesSchema>

export function loadNotificationPreferences(): NotificationPreferences {
  try {
    const saved = JSON.parse(localStorage.getItem(PUSH_PREFERENCES_KEY) ?? "{}")
    return notificationPreferencesSchema.parse({ cheers: saved.friends, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...saved })
  } catch {
    return notificationPreferencesSchema.parse({})
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
