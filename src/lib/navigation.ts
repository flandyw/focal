import type { AppView } from "./app-view"

type NavigationItem = { id: AppView; label: string; description: string }

const item = (id: AppView, label: string, description: string): NavigationItem => ({ id, label, description })

// Five destinations; tools such as ATAR, VCAA data and goals sit inside the one they serve.
export const NAVIGATION_GROUPS: Array<{ label: string; items: NavigationItem[] }> = [
  { label: "Today", items: [item("today", "Today", "Your day's plan, due cards, and what's coming up")] },
  { label: "Plan", items: [
    item("calendar", "Calendar", "See and plan any day"),
    item("timetable", "Timetable", "Your school class cycle"),
  ] },
  { label: "Practice", items: [
    item("exams", "Practice", "Your logged papers and score trends"),
    item("library", "Papers", "Official VCAA papers, reports, and your progress"),
    item("mistakes", "Mistakes", "Revision cards due for review"),
    item("focus", "Study timer", "Focus sessions and timed practice papers"),
  ] },
  { label: "Subjects", items: [
    item("subjects", "Overview", "Everything for one subject in one place"),
    item("stoplight", "Skills", "Rate each skill red, amber, or green"),
    item("sacs", "Assessments", "Plan, time, and log your SACs"),
    item("goals", "Goals", "Set score targets and see how close you are"),
  ] },
  { label: "Progress", items: [
    item("progress", "Progress", "Study habits, streaks, and exam trends"),
    item("predictor", "Study score", "See where your raw and scaled scores are heading"),
    item("atar", "ATAR", "Combine your study scores into an ATAR estimate"),
    item("vcaa", "Benchmarks", "Check official grade distributions and jump into papers"),
  ] },
  { label: "Together", items: [
    item("friends", "Friends", "Study alongside friends and compare weekly time"),
    item("chat", "Chat", "Ask about your study or update your plan"),
  ] },
]

const APP_NAVIGATION = NAVIGATION_GROUPS.flatMap((group) => group.items)

export const SETTINGS_ITEM = {
  id: "settings" as const,
  label: "Settings",
  description: "Subjects, look and feel, reminders, and sync",
}

export const ALL_NAVIGATION = [...APP_NAVIGATION, SETTINGS_ITEM]
