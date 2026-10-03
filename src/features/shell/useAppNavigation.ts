import { useCallback, useEffect, useMemo, useState } from "react"
import { setCachedPreference } from "@/lib/storage/preferences"

export type AppDestination =
  | { kind: "home" }
  | { kind: "assessments" }
  | { kind: "project"; projectId: string }
  | { kind: "timetable" }
  | { kind: "planner" }
  | { kind: "inbox" }
  | { kind: "analytics" }
  | { kind: "focal-web" }
  | { kind: "settings" }

const HOME: AppDestination = { kind: "home" }
const LAST_DESTINATION_KEY = "focal-last-destination"
const RESTORABLE_DESTINATIONS = new Set<AppDestination["kind"]>([
  "home",
  "assessments",
  "timetable",
  "planner",
  "inbox",
  "analytics",
  "focal-web",
])

export function normaliseStoredDestination(value: string | null): AppDestination {
  if (!value || !RESTORABLE_DESTINATIONS.has(value as AppDestination["kind"])) return HOME
  return { kind: value as Exclude<AppDestination["kind"], "project" | "settings"> }
}

export interface AppNavigationState {
  destination: AppDestination
  previousDestination: AppDestination
}

export function navigateTo(
  state: AppNavigationState,
  destination: AppDestination,
): AppNavigationState {
  return {
    destination,
    previousDestination: destination.kind === "settings" && state.destination.kind !== "settings"
      ? state.destination
      : state.previousDestination,
  }
}

export function closeSettingsDestination(state: AppNavigationState): AppNavigationState {
  return state.destination.kind === "settings"
    ? { destination: state.previousDestination, previousDestination: HOME }
    : state
}

export function useAppNavigation() {
  const [state, setState] = useState<AppNavigationState>(() => {
    let destination = HOME
    try {
      destination = normaliseStoredDestination(localStorage.getItem(LAST_DESTINATION_KEY))
    } catch {
      // ponytail: private browsing may block storage; home remains the safe default.
    }
    return { destination, previousDestination: HOME }
  })
  const destination = state.destination

  useEffect(() => {
    if (destination.kind === "project" || destination.kind === "settings") return
    setCachedPreference(LAST_DESTINATION_KEY, destination.kind, false)
  }, [destination])

  const navigate = useCallback((next: AppDestination) => {
    setState((current) => navigateTo(current, next))
  }, [])

  const selectProject = useCallback((projectId: string) => {
    navigate({ kind: "project", projectId })
  }, [navigate])
  const selectHome = useCallback(() => navigate(HOME), [navigate])
  const selectAssessments = useCallback(() => navigate({ kind: "assessments" }), [navigate])
  const selectTimetable = useCallback(() => navigate({ kind: "timetable" }), [navigate])
  const selectPlanner = useCallback(() => navigate({ kind: "planner" }), [navigate])
  const selectInbox = useCallback(() => navigate({ kind: "inbox" }), [navigate])
  const selectAnalytics = useCallback(() => navigate({ kind: "analytics" }), [navigate])
  const selectFocalWeb = useCallback(() => navigate({ kind: "focal-web" }), [navigate])
  const openSettings = useCallback(() => navigate({ kind: "settings" }), [navigate])
  const closeSettings = useCallback(() => {
    setState(closeSettingsDestination)
  }, [])

  const selectedId = destination.kind === "project" ? destination.projectId : null
  const homeSelected = destination.kind === "home"
  const assessmentsView = destination.kind === "assessments"
  const timetableView = destination.kind === "timetable"
  const plannerView = destination.kind === "planner"
  const inboxView = destination.kind === "inbox"
  const analyticsView = destination.kind === "analytics"
  const focalWebView = destination.kind === "focal-web"
  const settingsView = destination.kind === "settings"

  return useMemo(() => ({
    destination,
    selectedId,
    homeSelected,
    assessmentsView,
    timetableView,
    plannerView,
    inboxView,
    analyticsView,
    focalWebView,
    settingsView,
    selectProject,
    selectHome,
    selectAssessments,
    selectTimetable,
    selectPlanner,
    selectInbox,
    selectAnalytics,
    selectFocalWeb,
    openSettings,
    closeSettings,
  }), [
    analyticsView,
    assessmentsView,
    closeSettings,
    destination,
    homeSelected,
    openSettings,
    focalWebView,
    selectAnalytics,
    selectFocalWeb,
    selectHome,
    selectAssessments,
    selectProject,
    selectedId,
    selectTimetable,
    selectPlanner,
    selectInbox,
    settingsView,
    timetableView,
    plannerView,
    inboxView,
  ])
}
