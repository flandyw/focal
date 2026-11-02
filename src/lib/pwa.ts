import { toast } from "sonner"
import { supabase } from "./supabase"
import { DESKTOP_NOTIFICATIONS_SINCE_KEY, NOTIFICATION_PREFERENCES_CHANGED, PUSH_OWNER_KEY, PUSH_PREFERENCES_KEY, inQuietHours, loadNotificationPreferences, saveNotificationPreferences } from "./notification-preferences"

export { PUSH_OWNER_KEY, PUSH_PREFERENCES_KEY } from "./notification-preferences"

const PUSH_CHECKED_KEY = "focal:push-checked:v1"
const PUSH_CHECK_MS = 6 * 3600_000

let registration: Promise<ServiceWorkerRegistration | null> | undefined
let accountCleanup = Promise.resolve()

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }
let installPrompt: InstallPrompt | null = null
const installListeners = new Set<() => void>()
const announceInstall = () => installListeners.forEach((listener) => listener())
// Chrome fires this once, early, and only keeps it if the page holds on to it.
if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => { event.preventDefault(); installPrompt = event as InstallPrompt; announceInstall() })
  window.addEventListener("appinstalled", () => { installPrompt = null; announceInstall() })
}
export const canPromptInstall = () => installPrompt !== null
export function onInstallChange(listener: () => void) {
  installListeners.add(listener)
  return () => { installListeners.delete(listener) }
}
export async function promptInstall() {
  const prompt = installPrompt
  if (!prompt) return
  await prompt.prompt()
  await prompt.userChoice
  installPrompt = null
  announceInstall()
}

export function clearPushForOtherAccount(userId?: string) {
  accountCleanup = accountCleanup.then(async () => {
    try {
      const owner = localStorage.getItem(PUSH_OWNER_KEY)
      if (!owner) return
      if (owner === userId) return import.meta.env.VITE_DESKTOP ? undefined : await resyncPush()
      const worker = import.meta.env.VITE_DESKTOP ? null : await registerPwa()
      const subscription = await worker?.pushManager.getSubscription()
      if (subscription && !await subscription.unsubscribe()) return
      localStorage.removeItem(PUSH_OWNER_KEY)
      localStorage.removeItem(PUSH_PREFERENCES_KEY)
      localStorage.removeItem(DESKTOP_NOTIFICATIONS_SINCE_KEY)
    } catch {
      // Offline revocation is retried on the next account refresh.
    }
  })
  return accountCleanup
}

// Browsers rotate or expire push subscriptions silently; re-register so reminders don't quietly stop.
// Runs on every focus, so the network check is rationed unless the worker reports a rotation.
export async function resyncPush(force = false) {
  if (!force && Date.now() - Number(localStorage.getItem(PUSH_CHECKED_KEY)) < PUSH_CHECK_MS) return
  const worker = await registerPwa()
  const { data } = await supabase?.auth.getSession() ?? { data: null }
  if (!worker || !data?.session || Notification.permission !== "granted") return
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }
  let subscription = await worker.pushManager.getSubscription()
  if (subscription) {
    const known = await fetch("/api/push", { method: "POST", headers, body: JSON.stringify({ endpoint: subscription.endpoint }) })
    if (!known.ok) return
    const remote = await known.json()
    if (remote) {
      localStorage.setItem(PUSH_CHECKED_KEY, String(Date.now()))
      // Quiet hours and daily reminders follow the phone when it changes time zone.
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
      if (remote.timezone !== timezone) {
        const preferences = { ...loadNotificationPreferences(), timezone }
        await fetch("/api/push", { method: "PUT", headers, body: JSON.stringify({ ...subscription.toJSON(), ...preferences }) })
        saveNotificationPreferences(preferences)
      }
      return
    }
    await subscription.unsubscribe()
  }
  const { publicKey } = await (await fetch("/api/push")).json()
  if (!publicKey) return
  subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
  const preferences = loadNotificationPreferences()
  const response = await fetch("/api/push", { method: "PUT", headers, body: JSON.stringify({ ...subscription.toJSON(), ...preferences }) })
  if (!response.ok) throw new Error("Could not restore push reminders.")
  localStorage.setItem(PUSH_CHECKED_KEY, String(Date.now()))
}

export function registerPwa() {
  if (import.meta.env.VITE_DESKTOP || !window.isSecureContext || !("serviceWorker" in navigator)) return Promise.resolve(null)
  registration ??= navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => { registration = undefined; return null })
  return registration
}

// The shell opens from cache, so check after launch, on resume, and every 30 min, at most every 5 min so app-switching
// doesn't refetch the shell; the service worker caches a new version before this reports it.
export function watchForUpdates() {
  if (!import.meta.env.PROD || import.meta.env.VITE_DESKTOP) return
  const current = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute("src")
  let notified = false
  let checkedAt = 0
  const check = async () => {
    if (notified || document.visibilityState !== "visible" || !navigator.onLine || Date.now() - checkedAt < 5 * 60_000) return
    checkedAt = Date.now()
    void registerPwa().then((worker) => worker?.update()).catch(() => undefined)
    try {
      const html = await (await fetch("/", { cache: "no-store" })).text()
      const latest = html.match(/<script[^>]*type="module"[^>]*src="([^"]+)"/)?.[1]
      if (!current || !latest || latest === current) return
      notified = true
      toast("A new version of Focal is available", { duration: Infinity, action: { label: "Reload", onClick: () => location.reload() } })
    } catch {
      // Offline or a flaky network; the next resume tries again.
    }
  }
  // The worker already refreshes the shell at launch; don't compete with first paint for the same file.
  setTimeout(() => void check(), 10_000)
  document.addEventListener("visibilitychange", () => void check())
  setInterval(() => void check(), 30 * 60_000)
}

export function timerNotificationHelp() {
  if (import.meta.env.VITE_DESKTOP) return "Allow Focal in your system notification settings. Keep the desktop app running or minimized for alerts."
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone
  if (ios && !installed) return "On iPhone or iPad, add Focal to your Home Screen from the Share menu, open it there, then enable notifications. Requires iOS 16.4 or later."
  if (!window.isSecureContext || typeof Notification === "undefined") return "Notifications are unavailable in this browser. Use a supported browser over HTTPS."
  if (Notification.permission === "denied") return "Notifications are blocked. Allow them in your browser or device settings, then return here."
  return "Alerts when a focus block or break ends. Allow notifications when prompted, then enable reminders so timers can reach you while your phone is locked."
}

export async function notificationPermission(): Promise<NotificationPermission | "unsupported"> {
  try {
    if (import.meta.env.VITE_DESKTOP) {
      const { isPermissionGranted } = await import("@tauri-apps/plugin-notification")
      return await isPermissionGranted() ? "granted" : Notification.permission === "denied" ? "denied" : "default"
    }
    return window.isSecureContext && typeof Notification !== "undefined" ? Notification.permission : "unsupported"
  } catch { return "unsupported" }
}

export async function showNotification(title: string, body: string, tag: string, path = "/?timer=focus") {
  if (await notificationPermission() !== "granted") throw new Error(timerNotificationHelp())
  if (import.meta.env.VITE_DESKTOP) {
    const { sendNotification } = await import("@tauri-apps/plugin-notification")
    sendNotification({ title, body })
    return
  }
  const worker = await registerPwa()
  const options = { body, tag, renotify: true, icon: "/icon-192.png", badge: "/badge-96.png", vibrate: [200, 100, 200], data: { path } } as NotificationOptions
  if (worker) await worker.showNotification(title, options)
  else new Notification(title, options)
}

type TimerAlertType = "focus" | "breaks" | "reading" | "writing" | "sac"
export type TimerAlert = { at: number; title: string; body: string; type: TimerAlertType; path: string }
const alertKey = (scope: string, alert: Pick<TimerAlert, "at" | "title">) => `${scope}:${alert.title}:${alert.at}`

export async function notifyTimer(scope: string, alert: TimerAlert) {
  const key = alertKey(scope, alert)
  try {
    // A frozen page wakes long after the moment passed: an alert now would only repeat what the user can already see.
    if (Date.now() - alert.at > 2 * 60_000) return
    // The page beat the server to it, so the queued push would only repeat this.
    if (!import.meta.env.VITE_DESKTOP && localStorage.getItem(PUSH_OWNER_KEY)) void supabase?.from("push_timer_alerts").delete().eq("key", key).then(() => undefined, () => undefined)
    const preferences = loadNotificationPreferences()
    if (!preferences[alert.type] || inQuietHours(preferences)) return
    const worker = import.meta.env.VITE_DESKTOP ? null : await registerPwa()
    // A suspended phone wakes to late timers; the push has usually landed by then under this same tag.
    if ((await worker?.getNotifications({ tag: `timer:${key}` }))?.length) return
    await showNotification(alert.title, alert.body, `timer:${key}`, alert.path)
  } catch {
    // An unavailable notification must never interrupt the timer or saving study time.
  }
}

/**
 * Hands the next timer boundaries to the server so they arrive while the phone is locked and this page is frozen.
 * shortcut: only runs on devices that enabled push, and a failure (offline) falls back to the page's own alert.
 */
export async function scheduleTimerAlerts(scope: "focus" | "exam" | "sac", alerts: TimerAlert[]) {
  if (import.meta.env.VITE_DESKTOP || !supabase || !localStorage.getItem(PUSH_OWNER_KEY)) return
  try {
    const { data } = await supabase.auth.getSession()
    const userId = data.session?.user.id
    if (!userId) return
    await supabase.from("push_timer_alerts").delete().eq("user_id", userId).like("key", `${scope}:%`)
    if (!alerts.length) return
    await supabase.from("push_timer_alerts").insert(alerts.map((alert) => ({
      user_id: userId, key: alertKey(scope, alert), fire_at: new Date(alert.at).toISOString(), kind: alert.type, body: alert.body, path: alert.path,
    })))
  } catch {
    // Offline or migration not applied yet: the open page still alerts.
  }
}

/** Opening the app answers its notifications; leaving them makes the shade feel stale. */
export async function clearDeliveredNotifications() {
  try {
    const worker = await registerPwa()
    for (const notification of await worker?.getNotifications() ?? []) notification.close()
  } catch { /* Nothing to clear. */ }
}

export async function requestTimerNotifications() {
  try {
    if (import.meta.env.VITE_DESKTOP) {
      const { isPermissionGranted, requestPermission } = await import("@tauri-apps/plugin-notification")
      return await isPermissionGranted() || await requestPermission() === "granted"
    }
    if (typeof Notification === "undefined" || !window.isSecureContext) return false
    // Ask before awaiting anything, preserving the tap required by iOS.
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
    if (permission !== "granted") return false
    if (!import.meta.env.VITE_DESKTOP && "serviceWorker" in navigator) return !!(await registerPwa())
    return true
  } catch {
    return false
  }
}

export function watchDesktopNotifications(userId: string) {
  let stopped = false
  let busy = false
  const deliveryKey = `focal:notification-deliveries:${userId}:v1`
  const startedAt = new Date().toISOString()
  const check = async () => {
    if (stopped || busy || !navigator.onLine) return
    busy = true
    try {
      if (!supabase || localStorage.getItem(PUSH_OWNER_KEY) !== userId || await notificationPermission() !== "granted") return
      const preferences = loadNotificationPreferences()
      if (inQuietHours(preferences)) return
      // ponytail: desktop reminders need the running app and synced data; add a native background service for closed-app delivery.
      const { data, error } = await supabase.rpc("desktop_notification_events", { p_preferences: preferences, p_since: localStorage.getItem(DESKTOP_NOTIFICATIONS_SINCE_KEY) ?? startedAt })
      if (error) throw error
      const delivered: Record<string, number> = JSON.parse(localStorage.getItem(deliveryKey) ?? "{}")
      for (const key of Object.keys(delivered)) if (delivered[key]! < Date.now() - 7 * 86400_000) delete delivered[key]
      for (const event of data ?? []) {
        if (stopped || localStorage.getItem(PUSH_OWNER_KEY) !== userId) return
        if (delivered[event.event_key]) continue
        await showNotification("Focal", event.body, event.event_key, event.path)
        delivered[event.event_key] = Date.now()
        localStorage.setItem(deliveryKey, JSON.stringify(delivered))
      }
    } catch {
      // Offline/auth/server failures retry on the next tick; they never interrupt study or sync.
    } finally { busy = false }
  }
  void check()
  const interval = window.setInterval(() => void check(), 30_000)
  window.addEventListener("focus", check)
  window.addEventListener(NOTIFICATION_PREFERENCES_CHANGED, check)
  return () => {
    stopped = true
    window.clearInterval(interval)
    window.removeEventListener("focus", check)
    window.removeEventListener(NOTIFICATION_PREFERENCES_CHANGED, check)
  }
}
