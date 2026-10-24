let registration: Promise<ServiceWorkerRegistration | null> | undefined
export const PUSH_OWNER_KEY = "focal:push-owner:v1"
let accountCleanup = Promise.resolve()

export function clearPushForOtherAccount(userId?: string) {
  accountCleanup = accountCleanup.then(async () => {
    if (import.meta.env.VITE_DESKTOP) return
    try {
      const owner = localStorage.getItem(PUSH_OWNER_KEY)
      if (owner === userId || !owner) return
      const worker = await registerPwa()
      const subscription = await worker?.pushManager.getSubscription()
      if (subscription && !await subscription.unsubscribe()) return
      localStorage.removeItem(PUSH_OWNER_KEY)
    } catch {
      // Offline revocation is retried on the next account refresh.
    }
  })
  return accountCleanup
}

export function registerPwa() {
  if (import.meta.env.VITE_DESKTOP || !window.isSecureContext || !("serviceWorker" in navigator)) return Promise.resolve(null)
  registration ??= navigator.serviceWorker.register("/sw.js", { updateViaCache: "none" })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null)
  return registration
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
    const options = { body, tag: "focal-study-timer", icon: "/icon-192.png" }
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
