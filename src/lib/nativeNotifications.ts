import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
  type Options,
} from "@tauri-apps/plugin-notification"

const PERMISSION_PROMPTED_KEY = "focal-notification-permission-prompted"

let permissionRequest: Promise<boolean> | null = null

async function getPermission() {
  try {
    if (await isPermissionGranted()) return true
    if (localStorage.getItem(PERMISSION_PROMPTED_KEY) === "true") return false

    permissionRequest ??= requestPermission()
      .then((permission) => {
        try {
          localStorage.setItem(PERMISSION_PROMPTED_KEY, "true")
        } catch {
          // Permission still works when browser storage is unavailable.
        }
        return permission === "granted"
      })
      .finally(() => {
        permissionRequest = null
      })

    return await permissionRequest
  } catch {
    return false
  }
}

async function sendBrowserNotification(options: Options) {
  if (typeof window === "undefined" || !("Notification" in window)) return false
  try {
    let permission = Notification.permission
    if (permission === "default" && localStorage.getItem(PERMISSION_PROMPTED_KEY) !== "true") {
      localStorage.setItem(PERMISSION_PROMPTED_KEY, "true")
      permission = await Notification.requestPermission()
    }
    if (permission !== "granted") return false
    new Notification(options.title, { body: options.body })
    return true
  } catch {
    return false
  }
}

/** Best-effort notification delivery through Tauri, with a browser fallback. */
export async function sendNativeNotification(options: Options) {
  if (await getPermission()) {
    try {
      sendNotification(options)
      return true
    } catch {
      // Fall through when the Tauri API is unavailable in the browser build.
    }
  }
  return sendBrowserNotification(options)
}
