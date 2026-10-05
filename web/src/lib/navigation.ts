import {
  BookOpenText,
  Calculator,
  CalendarClock,
  CalendarDays,
  ClipboardCheck,
  ClipboardList,
  LibraryBig,
  Map,
  NotebookPen,
  Target,
  Settings2,
  Timer,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type { AppView } from "./app-view"

type NavigationItem = { id: AppView; label: string; description: string; icon: LucideIcon }

const ACTION_NAVIGATION: NavigationItem[] = [
  { id: "calendar" as const, label: "Calendar", description: "Day plan for any date", icon: CalendarDays },
  { id: "exams" as const, label: "Exams", description: "Practice results and analysis", icon: ClipboardList },
  { id: "focus" as const, label: "Study timer", description: "Focus blocks and timed practice papers", icon: Timer },
  { id: "mistakes" as const, label: "Mistakes", description: "Review your revision queue", icon: NotebookPen },
  { id: "timetable" as const, label: "Timetable", description: "Your school class cycle", icon: CalendarClock },
]

const ASSESSMENT_NAVIGATION: NavigationItem[] = [
  { id: "sacs" as const, label: "SACs", description: "Plan, time, and record SACs", icon: ClipboardCheck },
  { id: "library" as const, label: "VCAA library", description: "Official papers, reports, and progression", icon: BookOpenText },
]

const ANALYSIS_NAVIGATION: NavigationItem[] = [
  { id: "mastery" as const, label: "Mastery", description: "Map curriculum strengths and gaps", icon: Map },
  { id: "goals" as const, label: "Goals", description: "Work backwards from score targets", icon: Target },
  { id: "predictor" as const, label: "Study score", description: "Estimate study scores and ATAR", icon: Calculator },
  { id: "vcaa" as const, label: "VCAA data", description: "Compare grades and open matching papers", icon: LibraryBig },
]

export const NAVIGATION_GROUPS: Array<{ label: string; items: NavigationItem[] }> = [
  { label: "Study", items: ACTION_NAVIGATION },
  { label: "Assessments", items: ASSESSMENT_NAVIGATION },
  { label: "Analysis", items: ANALYSIS_NAVIGATION },
]

export const APP_NAVIGATION: NavigationItem[] = [...ACTION_NAVIGATION, ...ASSESSMENT_NAVIGATION, ...ANALYSIS_NAVIGATION]

export const SETTINGS_ITEM = {
  id: "settings" as const,
  label: "Settings",
  description: "Subjects, difficulty, and sync",
  icon: Settings2,
}

export const ALL_NAVIGATION = [...APP_NAVIGATION, SETTINGS_ITEM]

export function getViewLabel(view: AppView) {
  return ALL_NAVIGATION.find((item) => item.id === view)?.label ?? "Focal"
}
