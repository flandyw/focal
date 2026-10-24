import { isPaused, isRunning } from "./lib/sync/sessionContract"
import { continuableToday } from "./lib/day-plan"
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, ChevronDown, Search } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog"
import { Button } from "./components/ui/button"
import { CircleAccretionDiskLoader } from "./components/ui/circle-accretion-disk-loader"
import { Label } from "./components/ui/label"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog"
import { PastStudyForm } from "./components/planning/PastStudyForm"
import type { CalendarEvent, TimetableConfig } from "./lib/types"
import { sameStudySubject, studySubjectId, studySubjectOptions, subjectColor } from "./lib/studySubjects"
import { isPreferredSubject } from "./lib/subjects"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./components/ui/dropdown-menu"
import {
  SidebarInset,
  SidebarProvider,
} from "./components/ui/sidebar"
import { Toaster } from "./components/ui/sonner"
import {
  EMPTY_APP_DATA,
  getDueMistakes,
  recordMistakeReview,
  reduceMistakeReviews,
  mistakeReviewDayStart,
  normalizeMistakeReviewPreferences,
  type ReviewRating,
  type PracticeContext,
  removeAttempt,
  type AppData,
  type ExamAttempt,
  type Mistake,
  type SavedAtarEstimate,
} from "./lib/exam-data"
import { downloadAppData, loadAppData, parseAppDataFile, saveAppData } from "./lib/storage"
import { useSupabaseSync } from "./lib/sync"
import { canonicalNow, saveTimerSessionChange, useStudySessionSync } from "./lib/study-session-sync"
import { getExamClock } from "./lib/exam-timer"
import { suggestTimetableForAttempt, formatExamLabel } from "./lib/timetable"
import type { ExamTimerPreset } from "./components/exam-timer-mode"
import type { StudyTimerMode } from "./components/study-timer-page"
import type { ExamDifficultySettings } from "./lib/exam-difficulty"
import type { SacRecord } from "./lib/sac"
import type { FocusTimerSession } from "./lib/ongoing-timers"
import { loadAppView, loadSidebarOpen, saveAppView, type AppView } from "./lib/app-view"
import { subjectWorkspace, updateSubjectLearning } from "./lib/subject-workspace"
import { SubjectCombobox } from "./components/subject-combobox"
import { AppSidebar, MobileTabBar } from "./components/app-navigation"
import { ALL_NAVIGATION } from "./lib/navigation"
import { clearPushForOtherAccount } from "./lib/pwa"
import { useReferenceData } from "./hooks/use-reference-data"

import { localDate, materialiseTask, type CurriculumArea, type LearningWorkspaceUpdate, type StudyGoal } from "./lib/learning-workspace"
import { AI_ENABLED } from "./lib/host"
import { applyItemLinks, collectLinkRecords, demoteGreens, progressStoplight, restoreItems, type ItemLink } from "./lib/stoplight"
import { applyMistakeAutofills, applyMistakeEdits, applyMistakeFieldMergePlan, type MistakeAutofill, type MistakeEdit, type MistakeFieldMergePlan } from "./lib/mistake-autofill"
import type { VcaaExplorerPreset } from "./components/vcaa-explorer"
import type { OnboardingFinish } from "./components/onboarding-dialog"

const ProgressPage = lazy(() => import("./components/progress-page").then((module) => ({ default: module.ProgressPage })))
const ChatPage = lazy(() => import("./components/chat-page").then((module) => ({ default: module.ChatPage })))
const PAGE_LOADING = <div className="grid min-h-[50dvh] place-items-center text-muted-foreground"><CircleAccretionDiskLoader dotSize={6} gap={5} /></div>

const ExamPicker = lazy(() => import("./components/exam-picker").then((module) => ({ default: module.ExamPicker })))

const ExamSheet = lazy(() =>
  import("./components/exam-sheet").then((module) => ({ default: module.ExamSheet })),
)
const MistakeSheet = lazy(() =>
  import("./components/mistake-sheet").then((module) => ({ default: module.MistakeSheet })),
)
const ExamsPage = lazy(() =>
  import("./components/exams-page").then((module) => ({ default: module.ExamsPage })),
)
const VcaaExplorer = lazy(() =>
  import("./components/vcaa-explorer").then((module) => ({ default: module.VcaaExplorer })),
)
const SettingsPage = lazy(() =>
  import("./components/settings-page").then((module) => ({ default: module.SettingsPage })),
)
const StudyScorePredictor = lazy(() =>
  import("./components/study-score-predictor").then((module) => ({ default: module.StudyScorePredictor })),
)
const ExamLibrary = lazy(() =>
  import("./components/exam-library").then((module) => ({ default: module.ExamLibrary })),
)
const MistakesPage = lazy(() =>
  import("./components/mistakes-page").then((module) => ({ default: module.MistakesPage })),
)
const SacPage = lazy(() =>
  import("./components/sac-page").then((module) => ({ default: module.SacPage })),
)
const StudyTimerPage = lazy(() =>
  import("./components/study-timer-page").then((module) => ({ default: module.StudyTimerPage })),
)
const StoplightPage = lazy(() =>
  import("./components/stoplight-page").then((module) => ({ default: module.StoplightPage })),
)
const FriendsPage = lazy(() =>
  import("./components/friends-page").then((module) => ({ default: module.FriendsPage })),
)
const GoalsPage = lazy(() =>
  import("./components/goals-page").then((module) => ({ default: module.GoalsPage })),
)
const ClassTimetablePage = lazy(() =>
  import("./components/class-timetable-page").then((module) => ({ default: module.ClassTimetablePage })),
)
const OnboardingDialog = lazy(() =>
  import("./components/onboarding-dialog").then((module) => ({ default: module.OnboardingDialog })),
)
const AppTour = lazy(() =>
  import("./components/app-tour").then((module) => ({ default: module.AppTour })),
)
const ONBOARDED_KEY = "examtrack:onboarded:v1"
const CalendarPage = lazy(() =>
  import("./components/calendar-page").then((module) => ({ default: module.CalendarPage })),
)

export default function App({ embedded = false }: { embedded?: boolean } = {}) {
  const [view, setView] = useState<AppView>(() => embedded ? "exams" : loadAppView(
    typeof localStorage === "undefined" ? null : localStorage,
    typeof location === "undefined" ? "" : location.search,
  ))
  const [data, setData] = useState<AppData>(() => (typeof localStorage === "undefined" ? EMPTY_APP_DATA : loadAppData()))
  const [chosenSubject, setChosenSubject] = useState<string | null>(() => {
    try { return localStorage.getItem("examtrack:subject:v1") } catch { return null }
  })
  const [timerPreset, setTimerPreset] = useState<ExamTimerPreset | null>(null)
  // A timed paper is a mode of the study timer, so the mode is app state: the
  // library, the VCAA explorer, and ?timer=exam all land in the same place.
  const [timerMode, setTimerMode] = useState<StudyTimerMode>(() =>
    typeof location !== "undefined" && new URLSearchParams(location.search).get("timer") === "exam"
      ? "exam"
      : "focus")
  const [comparisonYear, setComparisonYear] = useState(2025)
  const [settingsSection, setSettingsSection] = useState<"ai" | "account">()
  const [examOpen, setExamOpen] = useState(false)
  const [editingAttempt, setEditingAttempt] = useState<ExamAttempt | null>(null)
  const [mistakeOpen, setMistakeOpen] = useState(false)
  const [mistakeAttemptId, setMistakeAttemptId] = useState<string | null>(null)
  const [editingMistake, setEditingMistake] = useState<Mistake | null>(null)
  const [trackerOpen, setTrackerOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  // A calendar task hands the study timer its subject and intent when focused.
  const [focusPreset, setFocusPreset] = useState<{ subject?: string; intent: string } | undefined>()
  const [vcaaSelection, setVcaaSelection] = useState<(VcaaExplorerPreset & { key: string }) | null>(null)
  const sync = useSupabaseSync(data, setData)
  const studySessionSync = useStudySessionSync(sync.user?.id, data, setData)
  const [pastStudyId, setPastStudyId] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<AppData | null>(null)
  // Timer moves queue durably and reach the server a moment later: "saved" means both outboxes are empty.
  const examSaveStatus = sync.status === "synced" && studySessionSync.queued === 0
    ? "Saved to your account. Open Focal on another device and sign in to the same account to continue."
    : sync.status === "syncing" || sync.status === "synced" ? "Saving to your account. Wait for confirmation before switching devices."
    : sync.status === "error" ? "Saved on this device. Cloud sync failed; reconnect before switching devices."
    : sync.status === "unconfigured" ? "Saved on this device. Cloud sync is not configured."
    : sync.status === "restoring" || sync.status === "reconnecting" ? "Saved on this device. Reconnecting to your account."
    : "Saved on this device. Sign in to save across devices."
  const examSyncAction = sync.status === "error" ? { label: "Retry sync", onClick: sync.retry }
    : sync.status === "signed-out" || sync.status === "sign-in-required" ? { label: "Sign in", onClick: () => setView("settings") } : undefined
  const {
    references,
    referencesGeneratedAt,
    resourcesGeneratedAt,
    resourceStudies,
    scalingReferences,
    timetable,
    referencesStatus,
    studiesStatus,
    scalingStatus,
    reload: reloadReferences,
  } = useReferenceData(view === "predictor")

  // Latch on a genuinely empty account, once sync has settled, so adding subjects mid-flow doesn't close it.
  const [onboarding, setOnboarding] = useState(false)
  const [touring, setTouring] = useState(false)
  const accountEmpty = !data.subjects.length && !data.attempts.length && !data.mistakes.length && !data.sacRecords.length && !studySessionSync.sessions.length
  if (!onboarding && !embedded && accountEmpty && ["unconfigured", "signed-out", "synced"].includes(sync.status) && !(() => { try { return localStorage.getItem(ONBOARDED_KEY) } catch { return "1" } })()) setOnboarding(true)

  function finishOnboarding(next: OnboardingFinish) {
    try { localStorage.setItem(ONBOARDED_KEY, "1") } catch { /* Shows again next visit without storage. */ }
    setOnboarding(false)
    if (next === "sign-in") { setSettingsSection("account"); setView("settings") }
    else if (next === "exam") { setEditingAttempt(null); setExamOpen(true) }
    else if (next === "focus") { setTimerMode("focus"); setView("focus") }
    else if (next === "calendar") setView("calendar")
    else if (next === "tour") setTouring(true)
  }

  const referenceLoadFailed = [referencesStatus, studiesStatus, scalingStatus].includes("error")
  const referencesLoading = referencesStatus === "loading" || studiesStatus === "loading"

  const selectedSubject = chosenSubject ?? data.subjects[0] ?? data.attempts[0]?.subject ?? data.sacRecords[0]?.subject ?? data.mistakes.find((mistake) => mistake.subject)?.subject ?? "all"
  const globalView = ["calendar", "chat", "timetable", "predictor", "settings", "focus", "friends"].includes(view)
  const subjectScoped = !globalView && selectedSubject !== "all"
  const workspace = useMemo(() => selectedSubject === "all" ? data : subjectWorkspace(data, selectedSubject), [data, selectedSubject])
  const pageData = useMemo(() => subjectScoped ? workspace : data.mistakeInsights?.subject ? { ...data, mistakeInsights: undefined } : data, [subjectScoped, workspace, data])
  const pageReferences = useMemo(() => subjectScoped ? references.filter((reference) => sameStudySubject(reference.studyName, selectedSubject)) : references, [subjectScoped, references, selectedSubject])
  const pageStudies = useMemo(() => subjectScoped ? resourceStudies.filter((study) => sameStudySubject(study.studyName, selectedSubject)) : resourceStudies, [subjectScoped, resourceStudies, selectedSubject])
  const pageSubjects = useMemo(() => subjectScoped ? [selectedSubject] : [...new Set(references.map((reference) => reference.studyName))], [subjectScoped, selectedSubject, references])
  const pageTimetable = useMemo(() => subjectScoped && timetable ? { ...timetable, exams: timetable.exams.filter((exam) => sameStudySubject(exam.subject, selectedSubject)) } : timetable, [subjectScoped, timetable, selectedSubject])
  const subjectOptions = useMemo(() => studySubjectOptions([
    ...data.subjects, ...data.attempts.map((attempt) => attempt.subject),
    ...data.sacRecords.map((record) => record.subject), ...data.mistakes.flatMap((mistake) => mistake.subject ? [mistake.subject] : []), ...data.learning.curriculumAreas.map((item) => item.subject),
    ...data.learning.goals.flatMap((goal) => goal.subject ? [goal.subject] : []),
    ...studySessionSync.sessions.flatMap((session) => session.subject_id ? [session.subject_id] : []),
    ...references.map((reference) => reference.studyName), ...(selectedSubject === "all" ? [] : [selectedSubject]),
  ]).map((subject) => subject.name), [data.subjects, data.attempts, data.sacRecords, data.mistakes, data.learning.curriculumAreas, data.learning.goals, studySessionSync.sessions, references, selectedSubject])
  const subjectValue = subjectOptions.find((subject) => sameStudySubject(subject, selectedSubject)) ?? selectedSubject
  const mySubjects = subjectOptions.filter((subject) => isPreferredSubject(subject, data.subjects) || (subjectScoped && subject === subjectValue))
  const otherSubjects = subjectOptions.filter((subject) => !mySubjects.includes(subject)).toSorted((first, second) => first.localeCompare(second))
  const dueMistakeCount = useMemo(() => getDueMistakes(workspace.mistakes).length, [workspace.mistakes])
  const dueStudyTaskCount = useMemo(() => data.learning.tasks.filter((task) => !task.archivedAt && task.status === "planned" && task.plannedFor <= localDate(new Date())).length, [data.learning.tasks])

  function chooseSubject(subject: string) {
    if (!subject) return
    setChosenSubject(subject)
    try { localStorage.setItem("examtrack:subject:v1", subject) } catch { /* Selection still works without storage. */ }
  }

  function saveSubjectLearning(update: LearningWorkspaceUpdate) {
    if (!subjectScoped) return saveLearning(update)
    setData((current) => ({ ...current, learning: updateSubjectLearning(current.learning, selectedSubject, update) }))
  }

  const subjectExamIds = useMemo(() => {
    if (!timetable) return []
    const ids = new Set<string>()
    for (const attempt of workspace.attempts) {
      for (const entry of suggestTimetableForAttempt(attempt, timetable, data.trackedExamIds)) {
        ids.add(entry.id)
      }
    }
    return [...ids]
  }, [workspace.attempts, data.trackedExamIds, timetable])

  // Reconcile saved, imported and synced reviews too; timestamps keep manual ratings authoritative until new practice.
  useEffect(() => {
    setData((current) => {
      const learning = progressStoplight(current.learning, current.mistakes)
      return learning === current.learning ? current : { ...current, learning }
    })
  }, [data.mistakes, data.learning])

  useEffect(() => {
    // Serialize the full store off the critical path: a keystroke currently
    // triggers a multi-hundred-KB JSON.stringify on every render commit.
    const id = window.setTimeout(() => saveAppData(data), 400)
    return () => window.clearTimeout(id)
  }, [data])
  const latestData = useRef(data)
  useEffect(() => { latestData.current = data }, [data])
  useEffect(() => () => saveAppData(latestData.current), [])
  useEffect(() => {
    const save = () => saveAppData(latestData.current)
    const recover = (event: Event) => {
      if (!import.meta.env.PROD || import.meta.env.VITE_DESKTOP || !navigator.onLine) return
      try {
        // ponytail: one automatic reload per built entry, per tab. Further failures
        // use the error boundary; this avoids loops without a version polling service.
        const key = "examtrack:deployment-reload:v1"
        if (sessionStorage.getItem(key) === import.meta.url) return
        save()
        sessionStorage.setItem(key, import.meta.url)
      } catch {
        // Keep the backup/reload screen if saving or the reload guard is unavailable.
        return
      }
      event.preventDefault()
      window.location.reload()
    }
    window.addEventListener("pagehide", save)
    window.addEventListener("vite:preloadError", recover)
    return () => {
      window.removeEventListener("pagehide", save)
      window.removeEventListener("vite:preloadError", recover)
    }
  }, [])
  // Reading hands over to writing on its own, whichever page is open. One phase_change
  // per revision: the session prop stays stale while the save is in flight.
  const publishedPhase = useRef<string | null>(null)
  useEffect(() => {
    const exam = data.activeExamTimer
    if (!exam || exam.pausedAt !== undefined || exam.phase === "writing") return
    const publish = () => {
      const key = `${exam.id}:${exam.revision ?? 0}`
      if (publishedPhase.current === key) return
      publishedPhase.current = key
      void saveActiveExamTimer({ ...exam, phase: "writing" })
    }
    const now = canonicalNow().getTime()
    const clock = getExamClock(exam, now)
    if (clock.phase !== "reading") return publish()
    const id = window.setTimeout(publish, clock.endsAt.reading - now)
    return () => window.clearTimeout(id)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- re-arms whenever the session changes, which refreshes the closure
  }, [data.activeExamTimer])
  useEffect(() => saveAppView(typeof localStorage === "undefined" ? null : localStorage, view), [view])
  useEffect(() => { document.title = `${ALL_NAVIGATION.find((item) => item.id === view)?.label ?? "Study"} · Focal` }, [view])
  useEffect(() => {
    if (sync.status === "restoring" || sync.status === "reconnecting") return
    void clearPushForOtherAccount(sync.status === "sign-in-required" ? undefined : sync.user?.id)
  }, [sync.status, sync.user?.id])
  useEffect(() => {
    if (import.meta.env.VITE_DESKTOP || !("serviceWorker" in navigator)) return
    const openNotification = (event: MessageEvent) => {
      if (event.data?.type !== "focal:notification-click") return
      if (event.data.path === "/?view=friends") setView("friends")
      else if (event.data.path === "/?timer=calendar") setView("calendar")
      else { setTimerMode("focus"); setView("focus") }
    }
    navigator.serviceWorker.addEventListener("message", openNotification)
    return () => navigator.serviceWorker.removeEventListener("message", openNotification)
  }, [])
  useEffect(() => {
    if (embedded) return
    const openCommandMenu = (event: KeyboardEvent) => {
      if (!event.repeat && !event.isComposing && event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setCommandOpen((current) => !current)
      }
    }
    document.addEventListener("keydown", openCommandMenu)
    return () => document.removeEventListener("keydown", openCommandMenu)
  }, [embedded])
  function saveAttempt(attempt: ExamAttempt, logMistake = false) {
    const isNew = !editingAttempt
    linkInBackground({ ...data, attempts: [...data.attempts.filter((item) => item.id !== attempt.id), attempt] }, (attempt.questionResults ?? []).map((result) => result.id))
    setData((current) => ({
      ...current,
      attempts: isNew
        ? [...current.attempts, attempt]
        : current.attempts.map((item) => item.id === attempt.id ? attempt : item),
    }))
    if (logMistake) {
      setEditingMistake(null)
      setMistakeAttemptId(attempt.id)
      setMistakeOpen(true)
    }

    if (!isNew) {
      toast.success("Exam updated")
      return
    }

    // After saving a practice attempt, surface official exams for that subject.
    const suggested = timetable
      ? suggestTimetableForAttempt(attempt, timetable, data.trackedExamIds)
      : []
    if (suggested.length === 0) {
      toast.success("Exam saved")
      return
    }

    const description =
      suggested.length === 1
        ? `Also track the official ${formatExamLabel(suggested[0])}?`
        : `Also track ${suggested.length} ${attempt.subject} official exams?`
    toast.success("Exam saved", {
      description,
      action: {
        label: suggested.length === 1 ? "Track" : `Track ${suggested.length}`,
        onClick: () => {
          for (const entry of suggested) toggleTrackedExam(entry.id)
        },
      },
    })
  }

  function saveSubjects(subjects: string[]) {
    setData((current) => ({ ...current, subjects, subjectsUpdatedAt: new Date().toISOString() }))
  }

  function saveAtarEstimate(estimate: SavedAtarEstimate) {
    const updatedAt = new Date().toISOString()
    setData((current) => ({
      ...current,
      atarEstimates: [estimate, ...current.atarEstimates],
      atarEstimatesUpdatedAt: updatedAt,
    }))
    toast.success("ATAR estimate saved")
  }

  function deleteAtarEstimate(id: string) {
    setData((current) => ({
      ...current,
      atarEstimates: current.atarEstimates.filter((estimate) => estimate.id !== id),
      atarEstimatesUpdatedAt: new Date().toISOString(),
    }))
    toast("Saved ATAR estimate deleted")
  }

  function saveExamDifficulty(examDifficulty: ExamDifficultySettings) {
    setData((current) => ({ ...current, examDifficulty }))
  }

  function saveEvents(update: (events: CalendarEvent[]) => CalendarEvent[]) {
    setData((current) => ({ ...current, events: update(current.events) }))
  }

  function saveClassTimetable(classTimetable: TimetableConfig) {
    setData((current) => ({ ...current, classTimetable }))
  }

  function notifyDemoted(previous: CurriculumArea[]) {
    if (!previous.length) return
    toast(`${previous.length} green item${previous.length === 1 ? "" : "s"} moved to amber after a new mistake`, { action: { label: "Undo", onClick: () => saveLearning((current) => restoreItems(current, previous)) } })
  }

  function applyLinks(links: ItemLink[]) {
    const result = applyItemLinks(data, links)
    setData((current) => applyItemLinks(current, links).data)
    toast.success(`Linked ${result.linked} record${result.linked === 1 ? "" : "s"} to stoplight items`)
    notifyDemoted(result.demoted)
  }

  // ponytail: fire-and-forget; failures (not connected, offline) stay silent because "Link mistakes" on the Stoplight page retries.
  function linkInBackground(next: Pick<AppData, "attempts" | "mistakes" | "learning">, ids: string[]) {
    if (!AI_ENABLED) return
    const records = collectLinkRecords(next, new Set(ids))
    if (!records.length) return
    void import("./lib/mistake-ai")
      .then(({ classifyToStoplight }) => classifyToStoplight(records, next.learning.curriculumAreas.filter((item) => !item.archivedAt)))
      .then((links) => { if (links.length) applyLinks(links) })
      .catch(() => {})
  }

  function saveLearning(update: LearningWorkspaceUpdate) {
    setData((current) => ({ ...current, learning: typeof update === "function" ? update(current.learning) : update }))
  }

  function planGoal(goal: StudyGoal) {
    const sourceId = `goal:${goal.id}`
    if (data.learning.tasks.some((task) => !task.archivedAt && task.status === "planned" && task.sourceId === sourceId)) {
      setView("calendar")
      toast.info("This goal is already planned")
      return
    }
    setData((current) => {
      if (current.learning.tasks.some((task) => !task.archivedAt && task.status === "planned" && task.sourceId === sourceId)) return current
      const label = goal.kind === "study-score" ? `raw ${goal.target}` : goal.kind === "atar" ? `ATAR ${goal.target}` : `${goal.target}% exam average`
      const task = materialiseTask({
        kind: goal.kind === "exam-percentage" ? "practice-exam" : "topic-practice",
        title: `Work toward ${goal.subject ? `${goal.subject} ` : ""}${label}`,
        subject: goal.subject,
        detail: `Complete a focused evidence-building session before the ${goal.deadline} target date.`,
        durationMinutes: Math.min(60, current.learning.preferences.dailyMinutes),
        plannedFor: localDate(new Date()),
        sourceId,
      })
      return { ...current, learning: { ...current.learning, tasks: [...current.learning.tasks, task], updatedAt: task.updatedAt } }
    })
    setView("calendar")
    toast.success("Goal added to your plan")
  }

  function saveExamProgression(examProgression: NonNullable<AppData["examProgression"]>) {
    setData((current) => ({ ...current, examProgression }))
  }

  // A timer action is one call to the server state machine. A failed one is said plainly:
  // the focus timer keeps its boundary queued and retries it, so the message must not
  // repeat with every retry through an outage.
  const lastSessionFailure = useRef<{ key: string; at: number } | null>(null)
  function reportSessionFailure(action: string, error: unknown) {
    const message = error instanceof Error && error.message ? error.message : "Check your connection and try again."
    console.error(`Could not ${action} the study session:`, error)
    const key = `${action}:${message}`
    const now = Date.now()
    const repeat = lastSessionFailure.current?.key === key && now - lastSessionFailure.current.at < 60_000
    lastSessionFailure.current = { key, at: now }
    if (repeat) return
    toast.error(`Couldn't ${action}`, { description: message })
  }

  async function saveActiveExamTimer(activeExamTimer: AppData["activeExamTimer"], action?: "cancel" | "complete") {
    try {
      const saved = await saveTimerSessionChange(data.activeExamTimer, activeExamTimer, "exam", action)
      saveAppData({ ...data, activeExamTimer: saved })
      setData((current) => ({ ...current, activeExamTimer: saved }))
    } catch (error) {
      reportSessionFailure(action ?? "save", error)
    }
  }

  async function saveActiveSacTimer(activeSacTimer: AppData["activeSacTimer"], action?: "cancel" | "complete") {
    try {
      const saved = await saveTimerSessionChange(data.activeSacTimer, activeSacTimer, "sac", action)
      saveAppData({ ...data, activeSacTimer: saved })
      setData((current) => ({ ...current, activeSacTimer: saved }))
    } catch (error) {
      reportSessionFailure(action ?? "save", error)
    }
  }

  // A focus block is the timer's own record, so the canonical session is the
  // only place it is written: it reaches Focal analytics through the server. The
  // failure is re-thrown so the timer knows the boundary did not land: swallowing
  // it would read as "the session is closed", which strands a running timer on
  // the server with nothing left to close it.
  async function queueFocusSession(
    previous: FocusTimerSession | undefined,
    next: FocusTimerSession | undefined,
    action?: "cancel" | "complete",
  ): Promise<FocusTimerSession | undefined> {
    try {
      return await saveTimerSessionChange(previous, next, "focus", action)
    } catch (error) {
      reportSessionFailure(action ?? "save", error)
      throw error
    }
  }

  function toggleCompletedExam(id: string) {
    setData((current) => ({
      ...current,
      completedExamIds: current.completedExamIds.includes(id)
        ? current.completedExamIds.filter((examId) => examId !== id)
        : [...current.completedExamIds, id],
      completedExamIdsUpdatedAt: new Date().toISOString(),
    }))
  }
  function saveMistake(mistakeOrMistakes: Mistake | Mistake[]) {
    const mistakes = Array.isArray(mistakeOrMistakes) ? mistakeOrMistakes : [mistakeOrMistakes]
    setData((current) => ({
      ...current,
      mistakes: editingMistake
        ? current.mistakes.map((item) => item.id === mistakes[0].id ? mistakes[0] : item)
        : [...current.mistakes, ...mistakes],
    }))
    toast.success(editingMistake ? "Mistake updated" : `${mistakes.length} mistake${mistakes.length === 1 ? "" : "s"} saved`)
    const relinked = mistakes.filter((mistake) => !editingMistake || mistake.itemIds?.join() !== editingMistake.itemIds?.join())
    const { previous } = demoteGreens(data.learning, relinked)
    if (previous.length) {
      saveLearning((current) => demoteGreens(current, relinked).learning)
      notifyDemoted(previous)
    }
    linkInBackground({ ...data, mistakes: [...data.mistakes, ...mistakes] }, mistakes.filter((mistake) => !mistake.itemIds?.length).map((mistake) => mistake.id))
  }

  function saveTimedAttempt(attempt: ExamAttempt) {
    setData((current) => ({ ...current, attempts: [...current.attempts, attempt] }))
    setView("exams")
    if (attempt.provider.trim().toLowerCase() === "vcaa") {
      toast.success("Timed VCAA exam logged", {
        description: "Your mark is ready to compare with official grade distributions.",
        action: { label: "Compare", onClick: () => openVcaaComparison(attempt) },
      })
    } else {
      toast.success("Timed exam logged")
    }
  }

  function openVcaaComparison(attempt: ExamAttempt) {
    setVcaaSelection({
      key: attempt.id,
      subject: attempt.subject,
      paper: attempt.paper,
      score: attempt.rawMax > 0 ? attempt.rawScore / attempt.rawMax * 100 : 0,
    })
    setView("vcaa")
  }

  function saveSac(record: SacRecord) {
    const exists = data.sacRecords.some((item) => item.id === record.id)
    const updatedAt = new Date().toISOString()
    setData((current) => ({
      ...current,
      sacRecords: current.sacRecords.some((item) => item.id === record.id)
        ? current.sacRecords.map((item) => item.id === record.id ? record : item)
        : [...current.sacRecords, record],
      sacRecordsUpdatedAt: updatedAt,
    }))
    toast.success(exists ? "SAC updated" : "SAC saved")
  }

  function deleteSac(record: SacRecord) {
    setData((current) => ({ ...current, sacRecords: current.sacRecords.filter((item) => item.id !== record.id), sacRecordsUpdatedAt: new Date().toISOString() }))
    toast("SAC deleted", {
      action: {
        label: "Undo",
        onClick: () => setData((current) => ({ ...current, sacRecords: [...current.sacRecords, { ...record, updatedAt: new Date().toISOString() }], sacRecordsUpdatedAt: new Date().toISOString() })),
      },
    })
  }

  function logMistakeForLatest() {
    const latest = [...workspace.attempts].toSorted((first, second) =>
      second.completedAt.localeCompare(first.completedAt),
    )[0]
    if (!latest) return
    setEditingMistake(null)
    setMistakeAttemptId(latest.id)
    setMistakeOpen(true)
  }

  function openNewExam() {
    setEditingAttempt(null)
    setExamOpen(true)
  }

  function openNewMistake(attemptId: string | null = null) {
    setEditingMistake(null)
    setMistakeAttemptId(attemptId)
    setMistakeOpen(true)
  }

  function deleteAttempt(attempt: ExamAttempt) {
    const related = data.mistakes.filter((mistake) => mistake.attemptId === attempt.id)
    // Local first, so it is gone on the next paint. The sync effect then pushes the delete
    // to the server from the outbox (see pushAppChanges) — nothing waits on the retry loop.
    setData((current) => removeAttempt(current, attempt.id))
    toast("Exam deleted", {
      action: {
        label: "Undo",
        onClick: () => {
          const updatedAt = new Date().toISOString()
          setData((current) => ({
            ...current,
            attempts: [...current.attempts, { ...attempt, updatedAt }],
            mistakes: [...current.mistakes, ...related.map((mistake) => ({ ...mistake, updatedAt }))],
          }))
        },
      },
    })
  }

  function reviewMistake(mistake: Mistake, rating: ReviewRating, context: PracticeContext = {}) {
    const completedAt = new Date().toISOString()
    setData((current) => ({
      ...current,
      mistakes: current.mistakes.map((item) => item.id === mistake.id ? recordMistakeReview(item, rating, completedAt, current.mistakeReviewPreferences, current.mistakes, context) : item),
    }))
  }

  function toggleMistakeSuspension(mistake: Mistake) {
    const timestamp = new Date().toISOString()
    setData((current) => ({
      ...current,
      mistakes: current.mistakes.map((item) => item.id === mistake.id ? { ...item, suspended: !item.suspended, updatedAt: timestamp } : item),
    }))
    toast.success(mistake.suspended ? "Card returned to the review queue" : "Card suspended")
  }

  function setMistakesSuspended(ids: string[], suspended: boolean) {
    const selectedIds = new Set(ids)
    const updatedAt = new Date().toISOString()
    setData((current) => ({ ...current, mistakes: current.mistakes.map((mistake) => selectedIds.has(mistake.id) ? { ...mistake, suspended, updatedAt } : mistake) }))
    toast.success(suspended ? "Selected cards paused" : "Selected cards returned to the review queue")
  }

  function importMistakes(incoming: Mistake[]) {
    const imported = incoming.map((mistake) => !mistake.attemptId && !mistake.subject && selectedSubject !== "all" ? { ...mistake, subject: selectedSubject } : mistake)
    setData((current) => ({ ...current, mistakes: [...current.mistakes, ...imported] }))
    toast.success(`${imported.length} mistake${imported.length === 1 ? "" : "s"} imported`)
    linkInBackground({ ...data, mistakes: [...data.mistakes, ...imported] }, imported.map((mistake) => mistake.id))
  }

  function applyAutofills(autofills: MistakeAutofill[]) {
    const updatedAt = new Date().toISOString()
    setData((current) => ({
      ...current,
      mistakes: applyMistakeAutofills(current.mistakes, autofills, updatedAt),
    }))
  }

  function applyBulkEdits(edits: MistakeEdit[]) {
    const updatedAt = new Date().toISOString()
    setData((current) => ({ ...current, mistakes: applyMistakeEdits(current.mistakes, edits, updatedAt) }))
  }

  function applyMistakeMergePlan(plan: MistakeFieldMergePlan) {
    const updatedAt = new Date().toISOString()
    setData((current) => ({
      ...current,
      mistakes: applyMistakeFieldMergePlan(current.mistakes, plan, updatedAt),
    }))
  }

  function deleteMistake(mistake: Mistake) {
    setData((current) => ({ ...current, mistakes: current.mistakes.filter((item) => item.id !== mistake.id) }))
    toast("Mistake deleted", { action: { label: "Undo", onClick: () => setData((current) => ({ ...current, mistakes: [...current.mistakes, { ...mistake, updatedAt: new Date().toISOString() }] })) } })
  }

  function toggleTrackedExam(id: string) {
    setData((current) => {
      const has = current.trackedExamIds.includes(id)
      return {
        ...current,
        trackedExamIds: has
          ? current.trackedExamIds.filter((value) => value !== id)
          : [...current.trackedExamIds, id],
        trackedExamIdsUpdatedAt: new Date().toISOString(),
      }
    })
  }

  function clearTrackedExams() {
    setData((current) => ({ ...current, trackedExamIds: subjectScoped ? current.trackedExamIds.filter((id) => !pageTimetable?.exams.some((exam) => exam.id === id)) : [], trackedExamIdsUpdatedAt: new Date().toISOString() }))
  }

  function trackExamSubjects() {
    setData((current) => ({
      ...current,
      trackedExamIds: [...new Set([...current.trackedExamIds, ...subjectExamIds])],
      trackedExamIdsUpdatedAt: new Date().toISOString(),
    }))
    toast.success(`${subjectExamIds.length} exam${subjectExamIds.length === 1 ? "" : "s"} added`)
  }

  async function importData(file: File) {
    try {
      setPendingImport(parseAppDataFile(await file.text()))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import this file.")
    }
  }

  return (
    <SidebarProvider keyboardShortcut={!embedded} className={embedded ? "min-h-0" : undefined} defaultOpen={loadSidebarOpen(typeof document === "undefined" ? null : document.cookie)}>
      <a href="#main-content" className="fixed left-2 top-2 z-50 -translate-y-20 rounded-md bg-background px-3 py-2 text-sm shadow focus:translate-y-0">Skip to content</a>
      {!embedded && <AppSidebar
        view={view}
        dueMistakes={dueMistakeCount}
        plannedTasks={dueStudyTaskCount}
        user={sync.user}
        syncStatus={sync.status}
        sessions={view === "focus" && timerMode === "focus" ? studySessionSync.sessions.filter((session) => session.kind !== "focus") : studySessionSync.sessions}
        onViewChange={setView}
        onSignOut={() => { void sync.signOut().catch((error: unknown) => { toast.error(error instanceof Error ? error.message : "Could not sign out.") }) }}
        onControlSession={studySessionSync.control}
        onLogExam={openNewExam}
        onLogPastStudy={() => setPastStudyId(crypto.randomUUID())}
        onStartExam={() => { setTimerMode("exam"); setView("focus") }}
        onLogMistake={() => openNewMistake()}
        onSearch={() => setCommandOpen(true)}
        commandOpen={commandOpen}
        onCommandOpenChange={setCommandOpen}
      />}
      <SidebarInset className="min-w-0">
        {/* Mobile: one compact row; it stays sticky so iOS Safari tints the status bar from it instead of blurring it. */}
        {!embedded && <header className="mobile-app-header sticky top-0 z-20 flex h-11 shrink-0 items-center gap-1 bg-background pr-2 pl-4 lg:hidden">
          <span className="min-w-0 shrink truncate font-heading text-lg font-medium">{ALL_NAVIGATION.find((item) => item.id === view)?.label}</span>
          {!globalView && <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={`Subject: ${subjectScoped ? subjectValue : "All subjects"}`} className="min-w-0 shrink text-muted-foreground" />}>
              {subjectScoped && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: subjectColor(studySubjectId(subjectValue)) }} />}
              <span className="truncate">{subjectScoped ? subjectValue : "All subjects"}</span>
              <ChevronDown aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[60dvh] w-60">
              <DropdownMenuGroup>
                <DropdownMenuLabel>Subject</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={subjectScoped ? subjectValue : "all"} onValueChange={(value) => chooseSubject(value as string)}>
                  {/* Your subjects (and the current one) first; every other VCE subject follows under its own label. */}
                  {["all", ...mySubjects].map((subject) => <DropdownMenuRadioItem key={subject} value={subject} className="min-h-10">{subject === "all" ? "All subjects" : subject}</DropdownMenuRadioItem>)}
                  {otherSubjects.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Other subjects</DropdownMenuLabel></>}
                  {otherSubjects.map((subject) => <DropdownMenuRadioItem key={subject} value={subject} className="min-h-10">{subject}</DropdownMenuRadioItem>)}
                </DropdownMenuRadioGroup>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>}
          <Button variant="ghost" size="icon" aria-label="Search" className="ml-auto text-muted-foreground" onClick={() => setCommandOpen(true)}><Search aria-hidden /></Button>
        </header>}
        {embedded && <nav aria-label="Exam tools" className="flex flex-wrap gap-1 border-b px-4 py-2">
          {[ALL_NAVIGATION[1], ALL_NAVIGATION[0], ...ALL_NAVIGATION.slice(2)].map((item) => <Button key={item.id} size="sm" variant={view === item.id ? "secondary" : "ghost"} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>{item.id === "exams" ? "Overview" : item.id === "settings" ? "Exam settings" : item.id === "focus" ? "Timed paper" : item.label}</Button>)}
          <span role="status" className="ml-auto self-center text-xs text-muted-foreground">{sync.status === "synced" ? "Synced" : sync.status === "syncing" ? "Syncing…" : sync.status === "error" ? "Sync failed" : "Saved locally"}</span>
        </nav>}
        <main id="main-content" data-view={view} tabIndex={-1} className={`w-full min-w-0 outline-none ${view === "chat" ? "flex h-[calc(100dvh-2.75rem-env(safe-area-inset-top)-var(--mobile-tabbar))] flex-col lg:h-dvh" : "px-4 pt-1 pb-[max(calc(1.5rem+var(--mobile-tabbar)),env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-10 lg:py-9 2xl:px-12"}`}>
          {!globalView && <div className="mb-6 flex flex-wrap items-end gap-3 border-b pb-4 max-lg:hidden">
            <div className="w-full sm:w-72">
              <Label htmlFor="workspace-subject" className="mb-1.5 text-xs text-muted-foreground">Subject</Label>
              <SubjectCombobox id="workspace-subject" subjects={subjectOptions} preferredSubjects={data.subjects} includeAll value={subjectValue} onValueChange={chooseSubject} />
            </div>
            <p className="pb-2 text-xs text-muted-foreground" role="status">{selectedSubject === "all" ? "Showing all subjects. Choose one to focus your workspace." : `Showing ${subjectValue} only.${view === "sacs" && data.activeSacTimer && !sameStudySubject(data.activeSacTimer.subject, selectedSubject) ? ` Active timer: ${data.activeSacTimer.subject}.` : ""}`}</p>
          </div>}
          {sync.status === "sign-in-required" && view !== "settings" ? <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="min-w-0 flex-1">Your Focal session ended. Saved work stays on this device until you sign in again.</p>
            <Button size="sm" onClick={() => setView("settings")}>Sign in again</Button>
          </div> : null}
          <AlertDialog open={pendingImport !== null} onOpenChange={(open) => { if (!open) setPendingImport(null) }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace current data?</AlertDialogTitle>
                <AlertDialogDescription>{pendingImport && `This replaces everything with ${pendingImport.attempts.length} exams, ${pendingImport.sacRecords.length} SACs, and ${pendingImport.mistakes.length} mistakes.`}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => { if (pendingImport) { setData(pendingImport); toast.success("Focal data imported") } setPendingImport(null) }}>Replace</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog open={pastStudyId !== null} onOpenChange={(open) => { if (!open) setPastStudyId(null) }}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>Log past study</DialogTitle><DialogDescription>{sync.user ? "Record study you’ve already done. It counts toward your shared study history." : "Saved in this browser only. Sign in before logging to share study with desktop."}</DialogDescription></DialogHeader>
              {pastStudyId && <PastStudyForm key={pastStudyId} subjects={studySubjectOptions(selectedSubject === "all" ? [...data.subjects, ...references.map((reference) => reference.studyName)] : [selectedSubject])} onCancel={() => setPastStudyId(null)} onSave={async (entry) => {
                await studySessionSync.log(entry, pastStudyId)
                setPastStudyId(null)
                toast.success("Study logged")
              }} />}
            </DialogContent>
          </Dialog>
          
          {data.activeExamTimer && view !== "focus" ? (
            <Alert className="mb-6">
              <AlertTitle>{data.activeExamTimer.pausedAt !== undefined ? "Saved exam" : "Exam in progress"} · {data.activeExamTimer.title}</AlertTitle>
              <AlertDescription><span>{data.activeExamTimer.paper || data.activeExamTimer.subject} · {data.activeExamTimer.workspaceItems?.filter((item) => item.status === "done").length ?? 0} questions done · {data.activeExamTimer.marks} marks</span><span role="status">{examSaveStatus}</span></AlertDescription>
              <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => { setTimerMode("exam"); setView("focus") }}>{data.activeExamTimer.pausedAt !== undefined ? "Open saved exam" : "Return to exam"}</Button>{examSyncAction ? <Button size="sm" variant="outline" onClick={examSyncAction.onClick}>{examSyncAction.label}</Button> : null}</div>
            </Alert>
          ) : null}
          {referenceLoadFailed ? (
            <Alert className="mb-6" variant="destructive">
              <AlertCircle />
              <AlertTitle>Some reference data failed to load</AlertTitle>
              <AlertDescription>
                Official VCAA comparisons, exam resources, or scaling data may be unavailable. Your own records are unaffected.
              </AlertDescription>
              <Button size="sm" variant="outline" onClick={reloadReferences}>Retry</Button>
            </Alert>
          ) : null}
          <div key={`${view}:${subjectScoped ? selectedSubject : "all"}`} className={`page-enter ${view === "chat" ? "flex min-h-0 flex-1 flex-col" : ""}`}>
          {view === "exams" ? (
            <Suspense fallback={PAGE_LOADING}>
              <ExamsPage
                data={pageData}
                references={pageReferences}
                comparisonYear={comparisonYear}
                onComparisonYearChange={setComparisonYear}
                timetable={pageTimetable}
                onLogExam={openNewExam}
                onLogMistakeForLatest={logMistakeForLatest}
                onOpenMistakes={() => setView("mistakes")}
                onOpenLibrary={() => setView("library")}
                onOpenCalendar={() => setView("calendar")}
                onOpenTracker={() => setTrackerOpen(true)}
                onEditExam={(attempt) => { setEditingAttempt(attempt); setExamOpen(true) }}
                onAddMistake={openNewMistake}
                onDeleteExam={deleteAttempt}
              />
            </Suspense>
          ) : null}
          {view === "timetable" ? <Suspense fallback={PAGE_LOADING}><ClassTimetablePage config={data.classTimetable} subjects={data.subjects} onChange={saveClassTimetable} /></Suspense> : null}
          {view === "calendar" ? <Suspense fallback={PAGE_LOADING}><CalendarPage data={pageData} subjects={data.subjects} onPlanSessions={studySessionSync.plan} onLogStudy={(entry) => studySessionSync.log(entry, crypto.randomUUID())} onEditSession={studySessionSync.edit} onMergeSessions={studySessionSync.merge} onRemoveSession={studySessionSync.remove} onConvertSession={async (session, events) => {
            // Persist the replacement before queuing deletion, so a failed conversion retains the study.
            const current = latestData.current
            const next = { ...current, events: [...current.events.filter((item) => !events.some((event) => event.id === item.id)), ...events] }
            saveAppData(next)
            latestData.current = next
            setData(next)
            try { await studySessionSync.remove(session) }
            catch (error) { throw new Error(`Events saved, but the study session could not be removed. Retry conversion to finish. ${error instanceof Error ? error.message : ""}`) }
          }} classTimetable={data.classTimetable} onClassTimetableChange={saveClassTimetable} onEventsChange={saveEvents} onOpenTimetable={() => setView("timetable")} sessions={studySessionSync.sessions} timetable={pageTimetable} onChange={saveLearning} onNavigate={setView} onStartFocus={(subject, intent, sessionId) => {
            if (!sessionId) { setFocusPreset({ subject, intent }); setTimerMode("focus"); setView("focus"); return }
            const session = studySessionSync.sessions.find((row) => row.id === sessionId)
            if (!session || session.kind !== "focus") { toast.error("This study session is unavailable."); return }
            const open = () => { setFocusPreset(undefined); setTimerMode("focus"); setView("focus") }
            if (isRunning(session)) open()
            else void studySessionSync.control(session, isPaused(session) || continuableToday(session) ? "resume" : "start").then(open)
              .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not start this session."))
          }} /></Suspense> : null}
          {view === "progress" ? <Suspense fallback={PAGE_LOADING}><ProgressPage subject={subjectScoped ? selectedSubject : undefined} sessions={studySessionSync.sessions} attempts={pageData.attempts} onLogExam={openNewExam} onNewSession={() => setView("focus")} /></Suspense> : null}
          {view === "focus" ? <Suspense fallback={PAGE_LOADING}><StudyTimerPage embedded={embedded} subjects={pageSubjects} preferredSubjects={pageData.subjects} mode={timerMode} onModeChange={setTimerMode} focusPreset={focusPreset} sessions={studySessionSync.sessions} onFocusSessionChange={queueFocusSession} onControlSession={studySessionSync.control} plannedActions={studySessionSync} exam={{ progression: data.examProgression, onProgressionChange: saveExamProgression, attempts: data.attempts, references, studies: resourceStudies, preferredSubjects: data.subjects, initialExam: timerPreset, activeSession: data.activeExamTimer, saveStatus: examSaveStatus, syncAction: examSyncAction, onLeave: () => setTimerMode("focus"), onSessionChange: saveActiveExamTimer, onSave: (attempt) => { setTimerPreset(null); saveTimedAttempt(attempt) } }} /></Suspense> : null}
          {view === "stoplight" ? <Suspense fallback={PAGE_LOADING}><StoplightPage data={pageData} subjects={pageSubjects} onChange={saveSubjectLearning} onApplyLinks={applyLinks} /></Suspense> : null}
          {view === "goals" ? <Suspense fallback={PAGE_LOADING}><GoalsPage data={pageData} references={pageReferences} subjects={pageSubjects} onChange={saveSubjectLearning} subjectScoped={subjectScoped} onPlanGoal={planGoal} /></Suspense> : null}
          {view === "mistakes" ? <Suspense fallback={PAGE_LOADING}><MistakesPage workspaceSubject={subjectScoped ? selectedSubject : undefined} onSaveReviewPreferences={(mistakeReviewPreferences) => setData((current) => ({ ...current, mistakeReviewPreferences: { ...mistakeReviewPreferences, updatedAt: new Date().toISOString() } }))} onReduceReviews={(days, target) => {
            setData((current) => {
              const now = Date.now()
              const changes = reduceMistakeReviews(subjectScoped ? subjectWorkspace(current, selectedSubject).mistakes : current.mistakes, days, target, now)
              return { ...current, mistakeReviewPreferences: { ...normalizeMistakeReviewPreferences(current.mistakeReviewPreferences), lighterUntil: new Date(mistakeReviewDayStart(now, days)).toISOString(), lighterDailyTarget: target, updatedAt: new Date(now).toISOString() }, mistakes: current.mistakes.map((m) => changes.has(m.id) ? { ...m, dueAt: changes.get(m.id)!, updatedAt: new Date(now).toISOString() } : m) }
            })
            toast.success("Lighter review period started")
          }} data={pageData} studies={pageStudies} onLog={() => openNewMistake()} onEdit={(mistake) => { setEditingMistake(mistake); setMistakeOpen(true) }} onReview={reviewMistake} onToggleSuspend={toggleMistakeSuspension} onSetSuspended={setMistakesSuspended} onDelete={deleteMistake} onImportMistakes={importMistakes} onApplyAutofills={applyAutofills} onApplyMergePlan={applyMistakeMergePlan} onApplyEdits={applyBulkEdits} onSaveInsights={(mistakeInsights) => setData((current) => ({ ...current, mistakeInsights: { ...mistakeInsights, subject: subjectScoped ? selectedSubject : undefined } }))} onSaveAlternativeDeck={(deck) => setData((current) => {
            const scopedIds = new Set(pageData.mistakes.map((mistake) => mistake.id))
            return { ...current, alternativeMistakeDeck: { ...deck, cards: [...(subjectScoped ? current.alternativeMistakeDeck?.cards ?? [] : []).filter((card) => !scopedIds.has(card.sourceMistakeId)), ...deck.cards] } }
          })} /></Suspense> : null}
          {view === "sacs" ? <Suspense fallback={PAGE_LOADING}><SacPage records={pageData.sacRecords} subjects={pageSubjects} preferredSubjects={pageData.subjects} activeTimer={data.activeSacTimer} onTimerChange={saveActiveSacTimer} onSave={saveSac} onDelete={deleteSac} /></Suspense> : null}
          {view === "library" ? <>{referencesLoading ? PAGE_LOADING : <Suspense fallback={PAGE_LOADING}><ExamLibrary references={pageReferences} studies={pageStudies} attempts={pageData.attempts} completedExamIds={data.completedExamIds} generatedAt={resourcesGeneratedAt ?? referencesGeneratedAt} preferredSubjects={pageData.subjects} onToggleCompleted={toggleCompletedExam} onStart={(preset) => { setTimerPreset(preset); setTimerMode("exam"); setView("focus") }} onCompare={openVcaaComparison} /></Suspense>}</> : null}
          {view === "predictor" ? <>{referencesStatus === "loading" || scalingStatus === "loading" ? PAGE_LOADING : <Suspense fallback={PAGE_LOADING}><StudyScorePredictor data={pageData} references={pageReferences} scalingReferences={scalingReferences} onSaveAtarEstimate={saveAtarEstimate} onDeleteAtarEstimate={deleteAtarEstimate} /></Suspense>}</> : null}
          {view === "vcaa" ? <>{referencesLoading ? PAGE_LOADING : <Suspense fallback={PAGE_LOADING}><VcaaExplorer key={vcaaSelection?.key ?? "vcaa-default"} references={pageReferences} attempts={pageData.attempts} preferredSubjects={pageData.subjects} studies={pageStudies} initialSelection={vcaaSelection} onOpenLibrary={() => setView("library")} onStart={(preset) => { setTimerPreset(preset); setTimerMode("exam"); setView("focus") }} /></Suspense>}</> : null}
          {view === "friends" ? <Suspense fallback={PAGE_LOADING}><FriendsPage key={`${sync.user?.id}:${sync.status === "sign-in-required"}`} signedIn={Boolean(sync.user) && sync.status !== "sign-in-required"} onSignIn={() => setView("settings")} /></Suspense> : null}
          {view === "chat" ? <Suspense fallback={PAGE_LOADING}><ChatPage key={`${sync.user?.id}:${sync.status === "sign-in-required"}`} userId={sync.status === "sign-in-required" ? undefined : sync.user?.id} subject={selectedSubject} onSignIn={() => { setSettingsSection("account"); setView("settings") }} onSettings={() => { setSettingsSection("ai"); setView("settings") }} /></Suspense> : null}
          {view === "settings" ? <Suspense fallback={PAGE_LOADING}><SettingsPage initialSection={settingsSection} sync={sync} subjects={pageSubjects} selectedSubjects={data.subjects} providers={[...new Set(data.attempts.map((attempt) => attempt.provider))]} examDifficulty={data.examDifficulty} onSubjectsChange={saveSubjects} onExamDifficultyChange={saveExamDifficulty} onExport={() => downloadAppData(data)} onImport={importData} onReplayOnboarding={() => setOnboarding(true)} onStartTour={() => setTouring(true)} /></Suspense> : null}
          </div>
        </main>
        {!embedded && <MobileTabBar view={view} dueMistakes={dueMistakeCount} plannedTasks={dueStudyTaskCount} onViewChange={setView} />}
      </SidebarInset>
      {examOpen ? (
        <Suspense fallback={null}>
          <ExamSheet references={pageReferences} preferredSubjects={selectedSubject === "all" ? data.subjects : [selectedSubject]} comparisonYear={comparisonYear} initialAttempt={editingAttempt} onOpenChange={setExamOpen} onSave={saveAttempt} />
        </Suspense>
      ) : null}
      {mistakeOpen ? (
        <Suspense fallback={null}>
          <MistakeSheet open initialSubject={selectedSubject === "all" ? undefined : selectedSubject} attempts={editingMistake ? data.attempts : workspace.attempts} studies={pageStudies} initialAttemptId={mistakeAttemptId} initialMistake={editingMistake} storageUserId={sync.user?.id} items={pageData.learning.curriculumAreas.filter((item) => item.group && !item.archivedAt)} onOpenChange={setMistakeOpen} onSave={saveMistake} />
        </Suspense>
      ) : null}
      {trackerOpen && timetable ? (
        <Suspense fallback={null}>
        <ExamPicker
          open={trackerOpen}
          onOpenChange={setTrackerOpen}
          entries={pageTimetable?.exams ?? []}
          trackedIds={data.trackedExamIds}
          onToggle={toggleTrackedExam}
          onClearAll={clearTrackedExams}
          onTrackSubjects={trackExamSubjects}
          subjectMatchCount={subjectExamIds.length}
          trackedCount={data.trackedExamIds.filter((id) => pageTimetable?.exams.some((exam) => exam.id === id)).length}
        />
        </Suspense>
      ) : null}
      {touring ? <Suspense fallback={null}><AppTour onNavigate={setView} onClose={() => setTouring(false)} /></Suspense> : null}
      {onboarding ? <Suspense fallback={null}><OnboardingDialog subjects={[...new Set(references.map((reference) => reference.studyName))]} selectedSubjects={data.subjects} signedIn={Boolean(sync.user)} onSubjectsChange={saveSubjects} onFinish={finishOnboarding} /></Suspense> : null}
      {!embedded && <Toaster position="bottom-right" mobileOffset={{ bottom: "calc(var(--mobile-tabbar) + 0.75rem)" }} />}
    </SidebarProvider>
  )
}
