import type { AppView } from "./app-view"

type NavigationItem = { id: AppView; label: string; description: string }

const item = (id: AppView, label: string, description: string): NavigationItem => ({ id, label, description })

// Five destinations; tools such as ATAR, VCAA data and goals sit inside the one they serve.
export const NAVIGATION_GROUPS: Array<{ label: string; items: NavigationItem[] }> = [
  { label: "Today", items: [item("today", "Today", "Today’s plan, due reviews and what’s next")] },
  { label: "Plan", items: [
    item("calendar", "Calendar", "Day plan for any date"),
    item("timetable", "Timetable", "Your school class cycle"),
  ] },
  { label: "Practice", items: [
    item("exams", "Practice", "Practice results and analysis"),
    item("library", "Papers", "Official papers, reports, and progression"),
    item("mistakes", "Mistakes", "Review your revision queue"),
    item("focus", "Study timer", "Focus blocks and timed practice papers"),
  ] },
  { label: "Subjects", items: [
    item("stoplight", "Skills", "Rate every skill red, amber or green"),
    item("sacs", "Assessments", "Plan, time, and record SACs"),
    item("goals", "Goals", "Work backwards from score targets"),
  ] },
  { label: "Progress", items: [
    item("progress", "Progress", "Study patterns and progress graphs"),
    item("predictor", "Study score", "Predict raw and scaled study scores"),
    item("atar", "ATAR", "Estimate an ATAR from study scores"),
    item("vcaa", "Benchmarks", "Compare grades and open matching papers"),
  ] },
  { label: "Together", items: [
    item("friends", "Friends", "Live study and a study-time leaderboard"),
    item("chat", "Chat", "Ask about your study and make changes"),
  ] },
]

const APP_NAVIGATION = NAVIGATION_GROUPS.flatMap((group) => group.items)

export const SETTINGS_ITEM = {
  id: "settings" as const,
  label: "Settings",
  description: "Subjects, difficulty, and sync",
}

export const ALL_NAVIGATION = [...APP_NAVIGATION, SETTINGS_ITEM]
