export const APP_VIEW_STORAGE_KEY = "examtrack:view:v1"

export const APP_VIEWS = [
  "calendar",
  "exams",
  "focus",
  "mistakes",
  "timetable",
  "sacs",
  "library",
  "progress",
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
  // The timed paper is a mode of the study timer now, not a view of its own.
  if (timer === "exam") return "focus"
  if (timer === "calendar" || timer === "day") return "calendar"
  if (timer === "sac") return "sacs"
  if (timer === "focus" || timer === "study") return "focus"
  if (!storage) return "calendar"
  try {
    const stored = storage.getItem(APP_VIEW_STORAGE_KEY)
    // The old dashboard view is the exams page now; land people where they were.
    if (stored === "dashboard") return "exams"
    return isAppView(stored) ? stored : "calendar"
  } catch {
    return "calendar"
  }
}

// SidebarProvider writes this cookie on every toggle; without reading it back
// the sidebar would reopen full-width on each reload.
export function loadSidebarOpen(cookie: string | null | undefined): boolean {
  const stored = cookie
    ?.split("; ")
    .find((part) => part.startsWith("sidebar_state="))
    ?.slice("sidebar_state=".length)
  return stored !== "false"
}

export function saveAppView(storage: Pick<Storage, "setItem"> | null | undefined, view: AppView) {
  if (!storage) return
  try {
    storage.setItem(APP_VIEW_STORAGE_KEY, view)
  } catch {
    // Navigation still works when storage is disabled or full.
  }
}
