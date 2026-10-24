import { toast } from "sonner"
import { supabase } from "./supabase"
import { DESKTOP_NOTIFICATIONS_SINCE_KEY, NOTIFICATION_PREFERENCES_CHANGED, PUSH_OWNER_KEY, PUSH_PREFERENCES_KEY, inQuietHours, loadNotificationPreferences } from "./notification-preferences"

export { PUSH_OWNER_KEY, PUSH_PREFERENCES_KEY } from "./notification-preferences"

let registration: Promise<ServiceWorkerRegistration | null> | undefined
let accountCleanup = Promise.resolve()

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
async function resyncPush() {
  const worker = await registerPwa()
  const { data } = await supabase?.auth.getSession() ?? { data: null }
  if (!worker || !data?.session || Notification.permission !== "granted") return
  const headers = { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` }
  let subscription = await worker.pushManager.getSubscription()
  if (subscription) {
    const known = await fetch("/api/push", { method: "POST", headers, body: JSON.stringify({ endpoint: subscription.endpoint }) })
    if (!known.ok || await known.json()) return
    await subscription.unsubscribe()
  }
  const { publicKey } = await (await fetch("/api/push")).json()
  if (!publicKey) return
  subscription = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey })
  const preferences = loadNotificationPreferences()
  const response = await fetch("/api/push", { method: "PUT", headers, body: JSON.stringify({ ...subscription.toJSON(), ...preferences }) })
  if (!response.ok) throw new Error("Could not restore push reminders.")
}

export function registerPwa() {
  if (import.meta.env.VITE_DESKTOP || !window.isSecureContext || !("serviceWorker" in navigator)) return Promise.resolve(null)
  registration ??= navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => { registration = undefined; return null })
  return registration
}

// The shell opens from cache, so check on launch, on resume, and every 30 min; the service worker caches a new version before this reports it.
export function watchForUpdates() {
  if (!import.meta.env.PROD || import.meta.env.VITE_DESKTOP) return
  const current = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.getAttribute("src")
  let notified = false
  const check = async () => {
    if (notified || document.visibilityState !== "visible" || !navigator.onLine) return
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
  void check()
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
  return "Alerts when a focus block or break ends. Allow notifications when prompted. Keep Focal open; alerts may be delayed while your phone is locked or the app is in the background."
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
  const options = { body, tag, renotify: true, icon: "/icon-192.png", badge: "/icon-192.png", data: { path } } as NotificationOptions
  if (worker) await worker.showNotification(title, options)
  else new Notification(title, options)
}

export async function notifyTimer(title: string, body: string, type: "focus" | "breaks" | "reading" | "writing" | "sac", path = "/?timer=focus") {
  try {
    const preferences = loadNotificationPreferences()
    if (!preferences[type] || inQuietHours(preferences)) return
    // ponytail: alerts depend on the running page; use server push for reliable closed-app reminders.
    await showNotification(title, body, `focal-timer-${type}`, path)
  } catch {
    // An unavailable notification must never interrupt the timer or saving study time.
  }
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
