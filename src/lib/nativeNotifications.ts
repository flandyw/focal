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

/** Best-effort native delivery. Returns false in browser builds or after denial. */
export async function sendNativeNotification(options: Options) {
  if (!await getPermission()) return false

  try {
    sendNotification(options)
    return true
  } catch {
    return false
  }
}
