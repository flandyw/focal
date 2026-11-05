import type { AppView } from "./app-view"

// Paths identify places and records; query params describe the view. Subject pages carry the subject in the path.
const VIEW_PATHS: Record<AppView, string> = {
  today: "/today",
  calendar: "/plan",
  timetable: "/plan/timetable",
  exams: "/practice",
  library: "/practice/papers",
  mistakes: "/practice/mistakes",
  focus: "/sessions",
  sacs: "/subjects/:subject/assessments",
  stoplight: "/subjects/:subject/skills",
  goals: "/subjects/:subject/goals",
  progress: "/progress",
  predictor: "/progress/predictions",
  atar: "/progress/predictions/atar",
  vcaa: "/progress/benchmarks",
  friends: "/friends",
  chat: "/chat",
  settings: "/settings",
}

export type AppRoute = { view: AppView; subject?: string; id?: string }

export function routePath({ view, subject, id }: AppRoute) {
  const path = VIEW_PATHS[view].replace(":subject", encodeURIComponent(subject ?? "all"))
  return id ? `${path}/${encodeURIComponent(id)}` : path
}

/** Longest matching pattern wins; one trailing segment after it is a record id (paper, attempt, mistake, session, conversation). */
export function parseRoute(pathname: string): AppRoute | null {
  const parts = pathname.split("/").filter(Boolean).map(decodeURIComponent)
  let best: AppRoute | null = null
  let bestLength = -1
  for (const [view, pattern] of Object.entries(VIEW_PATHS) as Array<[AppView, string]>) {
    const segments = pattern.split("/").filter(Boolean)
    if (parts.length < segments.length || parts.length > segments.length + 1) continue
    let subject: string | undefined
    if (!segments.every((segment, index) => segment === ":subject" ? (subject = parts[index], true) : segment === parts[index])) continue
    if (segments.length > bestLength) {
      best = { view, subject, id: parts[segments.length] }
      bestLength = segments.length
    }
  }
  return best
}
