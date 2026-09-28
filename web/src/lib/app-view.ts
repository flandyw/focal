export const APP_VIEW_STORAGE_KEY = "examtrack:view:v1"

export const APP_VIEWS = [
  "dashboard",
  "planner",
  "practice",
  "mistakes",
  "sacs",
  "library",
  "timer",
  "mastery",
  "goals",
  "predictor",
  "vcaa",
  "settings",
] as const

export type AppView = (typeof APP_VIEWS)[number]

export function isAppView(value: unknown): value is AppView {
  return typeof value === "string" && APP_VIEWS.includes(value as AppView)
}

export function loadAppView(
  storage: Pick<Storage, "getItem"> | null | undefined,
  search = "",
): AppView {
  const timer = new URLSearchParams(search).get("timer")
  if (timer === "exam") return "timer"
  if (timer === "sac") return "sacs"
  if (!storage) return "dashboard"
  try {
    const stored = storage.getItem(APP_VIEW_STORAGE_KEY)
    return isAppView(stored) ? stored : "dashboard"
  } catch {
    return "dashboard"
  }
}

export function saveAppView(storage: Pick<Storage, "setItem"> | null | undefined, view: AppView) {
  if (!storage) return
  try {
    storage.setItem(APP_VIEW_STORAGE_KEY, view)
  } catch {
    // Navigation still works when storage is disabled or full.
  }
}
