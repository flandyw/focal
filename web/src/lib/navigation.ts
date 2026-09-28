import {
  BookOpenText,
  Calculator,
  CalendarRange,
  ChartNoAxesCombined,
  ClipboardCheck,
  Clock3,
  LibraryBig,
  Map,
  NotebookPen,
  Target,
  WandSparkles,
  Settings2,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"

import type { AppView } from "@/lib/app-view"

type NavigationItem = { id: AppView; label: string; description: string; icon: LucideIcon }

const ACTION_NAVIGATION: NavigationItem[] = [
  { id: "dashboard" as const, label: "Dashboard", description: "Overview and exam results", icon: ChartNoAxesCombined },
  { id: "planner" as const, label: "Revision planner", description: "Plan the next study actions", icon: CalendarRange },
  { id: "practice" as const, label: "Practice studio", description: "Build targeted practice sessions", icon: WandSparkles },
  { id: "mistakes" as const, label: "Mistakes", description: "Review your revision queue", icon: NotebookPen },
]

const ASSESSMENT_NAVIGATION: NavigationItem[] = [
  { id: "sacs" as const, label: "SACs", description: "Plan, time, and record SACs", icon: ClipboardCheck },
  { id: "library" as const, label: "VCAA library", description: "Official papers, reports, and progression", icon: BookOpenText },
  { id: "timer" as const, label: "Exam timer", description: "Run a timed practice paper", icon: Clock3 },
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
  return ALL_NAVIGATION.find((item) => item.id === view)?.label ?? "ExamTrack"
}
