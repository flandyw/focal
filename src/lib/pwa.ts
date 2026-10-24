import { toast } from "sonner"
import { supabase } from "./supabase"

let registration: Promise<ServiceWorkerRegistration | null> | undefined
export const PUSH_OWNER_KEY = "focal:push-owner:v1"
export const PUSH_PREFERENCES_KEY = "focal:push-preferences:v1"
let accountCleanup = Promise.resolve()

export function clearPushForOtherAccount(userId?: string) {
  accountCleanup = accountCleanup.then(async () => {
    if (import.meta.env.VITE_DESKTOP) return
    try {
      const owner = localStorage.getItem(PUSH_OWNER_KEY)
      if (!owner) return
      if (owner === userId) return await resyncPush()
      const worker = await registerPwa()
      const subscription = await worker?.pushManager.getSubscription()
      if (subscription && !await subscription.unsubscribe()) return
      localStorage.removeItem(PUSH_OWNER_KEY)
      localStorage.removeItem(PUSH_PREFERENCES_KEY)
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
  const preferences = JSON.parse(localStorage.getItem(PUSH_PREFERENCES_KEY) ?? '{"planned":true,"friends":true}')
  await fetch("/api/push", { method: "PUT", headers, body: JSON.stringify({ ...subscription.toJSON(), ...preferences }) })
}

export function registerPwa() {
  if (import.meta.env.VITE_DESKTOP || !window.isSecureContext || !("serviceWorker" in navigator)) return Promise.resolve(null)
  registration ??= navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null)
  return registration
}

// An installed PWA resumes instead of relaunching, so it can sit on an old deploy for days; check on resume and every 30 min.
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
  document.addEventListener("visibilitychange", () => void check())
  setInterval(() => void check(), 30 * 60_000)
}

export function timerNotificationHelp() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1
  const installed = window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone
  if (ios && !installed) return "On iPhone or iPad, add Focal to your Home Screen from the Share menu, open it there, then enable notifications. Requires iOS 16.4 or later."
  if (!window.isSecureContext || typeof Notification === "undefined") return "Notifications are unavailable in this browser. Use a supported browser over HTTPS."
  if (Notification.permission === "denied") return "Notifications are blocked. Allow them in your browser or device settings, then return here."
  return "Alerts when a focus block or break ends. Allow notifications when prompted. Keep Focal open; alerts may be delayed while your phone is locked or the app is in the background."
}

export async function notifyTimer(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return
  try {
    const worker = await registerPwa()
    // renotify: a repeated tag otherwise replaces the last alert silently, so later block ends never buzz.
    const options = { body, tag: "focal-study-timer", renotify: true, icon: "/icon-192.png" } as NotificationOptions
    // ponytail: alerts depend on the running page; use server push for reliable closed-app reminders.
    if (worker) await worker.showNotification(title, options)
    else new Notification(title, options)
  } catch {
    // An unavailable notification must never interrupt the timer or saving study time.
  }
}

export async function requestTimerNotifications() {
  if (typeof Notification === "undefined" || !window.isSecureContext) return false
  try {
    // Ask before awaiting anything, preserving the tap required by iOS.
    const permission = Notification.permission === "default" ? await Notification.requestPermission() : Notification.permission
    if (permission !== "granted") return false
    if (!import.meta.env.VITE_DESKTOP && "serviceWorker" in navigator) return !!(await registerPwa())
    return true
  } catch {
    return false
  }
}
