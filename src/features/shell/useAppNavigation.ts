import { useCallback, useMemo, useState } from "react"

export type AppDestination =
  | { kind: "home" }
  | { kind: "assessments" }
  | { kind: "project"; projectId: string }
  | { kind: "timetable" }
  | { kind: "planner" }
  | { kind: "inbox" }
  | { kind: "analytics" }
  | { kind: "examtrack" }
  | { kind: "settings" }

const HOME: AppDestination = { kind: "home" }

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
  const [state, setState] = useState<AppNavigationState>({
    destination: HOME,
    previousDestination: HOME,
  })
  const destination = state.destination

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
  const selectExamTrack = useCallback(() => navigate({ kind: "examtrack" }), [navigate])
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
  const examTrackView = destination.kind === "examtrack"
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
    examTrackView,
    settingsView,
    selectProject,
    selectHome,
    selectAssessments,
    selectTimetable,
    selectPlanner,
    selectInbox,
    selectAnalytics,
    selectExamTrack,
    openSettings,
    closeSettings,
  }), [
    analyticsView,
    assessmentsView,
    closeSettings,
    destination,
    homeSelected,
    openSettings,
    examTrackView,
    selectAnalytics,
    selectExamTrack,
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
