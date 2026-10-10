import type { AppView } from "./app-view"

type NavigationItem = { id: AppView; label: string; description: string }

const ACTION_NAVIGATION: NavigationItem[] = [
  { id: "calendar" as const, label: "Calendar", description: "Day plan for any date" },
  { id: "exams" as const, label: "Exams", description: "Practice results and analysis" },
  { id: "focus" as const, label: "Study timer", description: "Focus blocks and timed practice papers" },
  { id: "mistakes" as const, label: "Mistakes", description: "Review your revision queue" },
  { id: "timetable" as const, label: "Timetable", description: "Your school class cycle" },
]

const ASSESSMENT_NAVIGATION: NavigationItem[] = [
  { id: "sacs" as const, label: "SACs", description: "Plan, time, and record SACs" },
  { id: "library" as const, label: "VCAA library", description: "Official papers, reports, and progression" },
]

const ANALYSIS_NAVIGATION: NavigationItem[] = [
  { id: "progress", label: "Progress", description: "Study patterns and progress graphs" },
  { id: "stoplight" as const, label: "Stoplight", description: "Rate every skill red, amber or green" },
  { id: "goals" as const, label: "Goals", description: "Work backwards from score targets" },
  { id: "predictor" as const, label: "Study score", description: "Estimate study scores and ATAR" },
  { id: "vcaa" as const, label: "VCAA data", description: "Compare grades and open matching papers" },
]

export const NAVIGATION_GROUPS: Array<{ label: string; items: NavigationItem[] }> = [
  { label: "Study", items: ACTION_NAVIGATION },
  { label: "Assessments", items: ASSESSMENT_NAVIGATION },
  { label: "Analysis", items: ANALYSIS_NAVIGATION },
]

const APP_NAVIGATION: NavigationItem[] = [...ACTION_NAVIGATION, ...ASSESSMENT_NAVIGATION, ...ANALYSIS_NAVIGATION]

export const SETTINGS_ITEM = {
  id: "settings" as const,
  label: "Settings",
  description: "Subjects, difficulty, and sync",
}

export const ALL_NAVIGATION = [...APP_NAVIGATION, SETTINGS_ITEM]
