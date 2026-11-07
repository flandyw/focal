import { isPaused, isRunning, studySessionSubjects } from "./lib/sync/sessionContract"
import { continuableToday } from "./lib/day-plan"
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import { AlertCircle, ChevronDown, Search, UsersRound } from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "./components/ui/alert"
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "./components/ui/alert-dialog"
import { Button } from "./components/ui/button"
import { CircleAccretionDiskLoader } from "./components/ui/circle-accretion-disk-loader"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./components/ui/dialog"
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
  countDueMistakes,
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
import { loadFocusSession } from "./lib/study-timer"
import { getExamClock } from "./lib/exam-timer"
import { suggestTimetableForAttempt, formatExamLabel } from "./lib/timetable"
import type { ExamTimerPreset } from "./components/exam-timer-mode"
import type { StudyTimerMode } from "./components/study-timer-page"
import type { ExamDifficultySettings } from "./lib/exam-difficulty"
import type { SacRecord } from "./lib/sac"
import type { FocusTimerSession } from "./lib/ongoing-timers"
import * as ops from "./lib/app-operations"
import { routePath } from "./lib/routes"
import { useAppRoute, useRouteUrl } from "./app/use-app-route"
import { InstallNudge, OfflineChip } from "./components/shell-notices"
import { AIOverviewContext, type OverviewAction } from "./lib/ai-overview-state"
import { loadSidebarOpen, type AppView } from "./lib/app-view"
import { subjectWorkspace, updateSubjectLearning } from "./lib/subject-workspace"
import { AppSidebar, MobileTabBar } from "./components/app-navigation"
import { ALL_NAVIGATION } from "./lib/navigation"
import { clearDeliveredNotifications, clearPushForOtherAccount, notifyTimer, resyncPush, scheduleTimerAlerts, watchDesktopNotifications, type TimerAlert } from "./lib/pwa"
import { setAppBadge, useWakeLock } from "./lib/mobile"
import { loadNotificationPreferences } from "./lib/notification-preferences"
import { useReferenceData } from "./hooks/use-reference-data"
import { useTickingNow } from "./hooks/use-ticking-now"
import { count } from "./lib/utils"
import { localDate, materialiseTask, type CurriculumArea, type LearningWorkspaceUpdate, type StudyGoal } from "./lib/learning-workspace"
import { AI_ENABLED } from "./lib/host"
import { useDesktopWidgets } from "./lib/widgets"
import { applyItemLinks, collectLinkRecords, demoteGreens, progressStoplight, restoreItems, type ItemLink } from "./lib/stoplight"
import { applyMistakeAutofills, applyMistakeEdits, applyMistakeFieldMergePlan, type MistakeAutofill, type MistakeEdit, type MistakeFieldMergePlan } from "./lib/mistake-autofill"
import type { VcaaExplorerPreset } from "./components/vcaa-explorer"
import type { OnboardingFinish } from "./components/onboarding-dialog"
import { useRecovery } from "./hooks/use-recovery"
import { deletedSince, recoverySessionCandidates, replacementData, restoreMissing, saveRecovery, validateRecovery, type RecoveryEntry } from "./lib/recovery"
import { questionKey, unloggedMistakes } from "./lib/marking"
import type { TaskDraft } from "./lib/learning-workspace"

const RecoveryPanel = lazy(() => import("./components/recovery-panel").then((module) => ({ default: module.RecoveryPanel })))
const MarkingMistakesDialog = lazy(() => import("./components/marking-mistakes-dialog").then((module) => ({ default: module.MarkingMistakesDialog })))

const PastStudyForm = lazy(() => import("./components/planning/PastStudyForm").then((module) => ({ default: module.PastStudyForm })))
const ProgressPage = lazy(() => import("./components/progress-page").then((module) => ({ default: module.ProgressPage })))
const ChatPage = lazy(() => import("./components/chat-page").then((module) => ({ default: module.ChatPage })))
const PAGE_LOADING = <div role="status" aria-label="Loading" className="page-loading grid min-h-[50dvh] place-items-center text-muted-foreground"><CircleAccretionDiskLoader dotSize={6} gap={5} /></div>

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
const AtarEstimator = lazy(() =>
  import("./components/atar-estimator").then((module) => ({ default: module.AtarEstimator })),
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
const FriendStudySessions = lazy(() =>
  import("./components/friend-study-sessions").then((module) => ({ default: module.FriendStudySessions })),
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
const SubjectOverview = lazy(() => import("./components/subject-overview").then((module) => ({ default: module.SubjectOverview })))
const TodayPage = lazy(() => import("./components/today-page").then((module) => ({ default: module.TodayPage })))
const CalendarPage = lazy(() =>
  import("./components/calendar-page").then((module) => ({ default: module.CalendarPage })),
)

export default function App({ embedded = false }: { embedded?: boolean } = {}) {
  const { view, navView, recordId, routeSearch, setRouteSearch, setView, closeRecord, consumeBack, initialRoute } = useAppRoute(embedded, (route, search) => {
    const params = new URLSearchParams(search)
    if (route?.subject) setChosenSubject(route.subject)
    setTimerMode(params.get("timer") === "exam" ? "exam" : "focus")
    setMistakesSubject(params.get("subject") ?? "all")
    setExamOpen(false)
    setMistakeOpen(false)
    setEditingAttempt(null)
    setEditingMistake(null)
    setMarkingAttempt(null)
  })
  const [data, setData] = useState<AppData>(() => (typeof localStorage === "undefined" ? EMPTY_APP_DATA : loadAppData()))
  const [chosenSubject, setChosenSubject] = useState<string | null>(() => {
    if (initialRoute?.subject) return initialRoute.subject
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
  // A SAC alert opens the running timer, whether it launches Focal or lands in an open app.
  const [sacTimerRequest, setSacTimerRequest] = useState(() => typeof location !== "undefined" && new URLSearchParams(location.search).get("timer") === "sac" ? 1 : 0)
  const [examOpen, setExamOpen] = useState(false)
  const [draftAttempt, setEditingAttempt] = useState<ExamAttempt | null>(null)
  const [pendingMarkingAttempt, setMarkingAttempt] = useState<ExamAttempt | null>(null)
  const [mistakeOpen, setMistakeOpen] = useState(false)
  const [mistakeAttemptId, setMistakeAttemptId] = useState<string | null>(null)
  const [draftMistake, setEditingMistake] = useState<Mistake | null>(null)
  const editingAttempt = view === "exams" && recordId ? data.attempts.find((attempt) => attempt.id === recordId) ?? null : draftAttempt
  const editingMistake = view === "mistakes" && recordId ? data.mistakes.find((mistake) => mistake.id === recordId) ?? null : draftMistake
  const markingAttempt = view === "exams" && recordId && new URLSearchParams(routeSearch).has("marking") ? editingAttempt : pendingMarkingAttempt
  function openRecord(next: AppView, id: string, search = "") {
    setEditingAttempt(null)
    setEditingMistake(null)
    setExamOpen(false)
    setMistakeOpen(false)
    setView(next, id, search)
  }
  function openMistakeQueue(subject = "all", skill?: string) {
    setView("mistakes", undefined, `?${new URLSearchParams({ subject, ...(skill ? { skill } : { status: "due" }) })}`)
    setMistakesSubject(subject)
  }
  const [trackerOpen, setTrackerOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  // A calendar task hands the study timer its subject and intent when focused.
  const [focusPreset, setFocusPreset] = useState<{ subject?: string; intent: string } | undefined>()
  const [vcaaSelection, setVcaaSelection] = useState<(VcaaExplorerPreset & { key: string }) | null>(null)
  const sync = useSupabaseSync(data, setData)
  useEffect(() => {
    if (!sync.passwordRecovery) return
    // Recovery links must reach Account regardless of the last saved view.
    // oxlint-disable-next-line react/set-state-in-effect
    setSettingsSection("account")
    setView("settings")
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- setView only touches stable state setters
  }, [sync.passwordRecovery])
  const notificationUserId = ["sign-in-required", "restoring"].includes(sync.status) ? undefined : sync.user?.id
  const studySessionSync = useStudySessionSync(sync.user?.id, data, setData)
  const recoveryOwner = (() => {
    if (sync.status === "restoring" || sync.status === "reconnecting") return null
    if (sync.user) return sync.user.id
    try { return localStorage.getItem("examtrack:sync:owner:v1") ? null : "local" }
    catch { return null }
  })()
  const recovery = useRecovery(data, studySessionSync.sessions, recoveryOwner)
  const recoveryOwnerRef = useRef(recoveryOwner)
  useEffect(() => { recoveryOwnerRef.current = recoveryOwner }, [recoveryOwner])
  const [importing, setImporting] = useState(false)
  const [pastStudyId, setPastStudyId] = useState<string | null>(null)
  const [pendingImport, setPendingImport] = useState<AppData | null>(null)
  const pendingImportOwner = useRef<string | null>(null)
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
    timetableStatus,
    referencesStatus,
    studiesStatus,
    scalingStatus,
    reload: reloadReferences,
  } = useReferenceData(
    view === "predictor" || view === "atar",
    !["today", "calendar", "focus", "mistakes", "friends", "settings", "timetable"].includes(view),
    view === "library" || view === "vcaa" || view === "focus" && timerMode === "exam" || mistakeOpen || Boolean(view === "mistakes" && recordId),
  )
  useDesktopWidgets(data, studySessionSync.sessions, timetable, sync.user?.id, sync.status, setView)

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

  const referenceLoadFailed = [referencesStatus, studiesStatus, scalingStatus, timetableStatus].includes("error")
  const referencesLoading = referencesStatus === "loading" || studiesStatus === "loading"

  // Mistakes picks its own subject on the page, so it runs through the same scoping without touching the global choice.
  const [mistakesSubject, setMistakesSubject] = useState(() => new URLSearchParams(location.search).get("subject") ?? "all")
  const selectedSubject = view === "mistakes" ? mistakesSubject : chosenSubject ?? data.subjects[0] ?? data.attempts[0]?.subject ?? data.sacRecords[0]?.subject ?? data.mistakes.find((mistake) => mistake.subject)?.subject ?? "all"
  const globalView = ["today", "calendar", "chat", "timetable", "predictor", "atar", "settings", "focus", "friends"].includes(view)
  const subjectScoped = !globalView && selectedSubject !== "all"
  const showSubjectMenu = !globalView && view !== "mistakes"
  const mistakeSubjects = useMemo(() => {
    const attemptSubjects = new Map(data.attempts.map((attempt) => [attempt.id, attempt.subject]))
    return studySubjectOptions(data.mistakes.flatMap((mistake) => attemptSubjects.get(mistake.attemptId) ?? mistake.subject ?? [])).map((subject) => subject.name).toSorted()
  }, [data.attempts, data.mistakes])
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
    ...studySessionSync.sessions.flatMap(studySessionSubjects),
    ...references.map((reference) => reference.studyName), ...(selectedSubject === "all" ? [] : [selectedSubject]),
  ]).map((subject) => subject.name), [data.subjects, data.attempts, data.sacRecords, data.mistakes, data.learning.curriculumAreas, data.learning.goals, studySessionSync.sessions, references, selectedSubject])
  const subjectValue = subjectOptions.find((subject) => sameStudySubject(subject, selectedSubject)) ?? selectedSubject
  const mySubjects = useMemo(() => subjectOptions.filter((subject) => isPreferredSubject(subject, data.subjects) || (subjectScoped && subject === subjectValue)), [subjectOptions, data.subjects, subjectScoped, subjectValue])
  const otherSubjects = useMemo(() => subjectOptions.filter((subject) => !mySubjects.includes(subject)).toSorted((first, second) => first.localeCompare(second)), [subjectOptions, mySubjects])
  // Cards fall due and days roll over while the app sits open, so the badges follow the clock as well as the data.
  const now = useTickingNow()
  const allDueMistakeCount = useMemo(() => countDueMistakes(data.mistakes, now), [data.mistakes, now])
  const dueMistakeCount = useMemo(() => workspace.mistakes === data.mistakes ? allDueMistakeCount : countDueMistakes(workspace.mistakes, now), [workspace.mistakes, data.mistakes, allDueMistakeCount, now])
  const today = localDate(now)
  const dueStudyTaskCount = useMemo(() => data.learning.tasks.filter((task) => !task.archivedAt && task.status === "planned" && task.plannedFor <= today).length, [data.learning.tasks, today])

  function chooseSubject(subject: string) {
    if (!subject) return
    setChosenSubject(subject)
    try { localStorage.setItem("examtrack:subject:v1", subject) } catch { /* Selection still works without storage. */ }
  }

  function saveSubjectLearning(update: LearningWorkspaceUpdate) {
    if (!subjectScoped) return saveLearning(update)
    void commitRecoverable((current) => ({ ...current, learning: updateSubjectLearning(current.learning, selectedSubject, update) }))
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
    // iOS can kill a backgrounded app without pagehide; going hidden is the last dependable moment to save.
    const saveWhenHidden = () => { if (document.visibilityState === "hidden") save() }
    window.addEventListener("pagehide", save)
    document.addEventListener("visibilitychange", saveWhenHidden)
    window.addEventListener("vite:preloadError", recover)
    return () => {
      window.removeEventListener("pagehide", save)
      document.removeEventListener("visibilitychange", saveWhenHidden)
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
  const timerRunning = Boolean(data.activeExamTimer && data.activeExamTimer.pausedAt === undefined || data.activeSacTimer && data.activeSacTimer.pausedAt === undefined)
  useWakeLock(timerRunning)
  useEffect(() => {
    const now = canonicalNow().getTime()
    const exam = data.activeExamTimer
    const sac = data.activeSacTimer
    const alerts: (TimerAlert & { scope: "exam" | "sac" })[] = []
    if (exam && exam.pausedAt === undefined) {
      const clock = getExamClock(exam, now)
      if (clock.phase === "reading") alerts.push({ scope: "exam", at: clock.endsAt.reading, title: "Reading time over", body: "You can start writing now.", type: "reading", path: "/?timer=exam" })
      if (clock.phase !== "overtime") alerts.push({ scope: "exam", at: clock.endsAt.writing, title: "Writing time over", body: "Your timed paper has reached the end of writing time.", type: "writing", path: "/?timer=exam" })
    }
    if (sac && sac.pausedAt === undefined) alerts.push({ scope: "sac", at: sac.startedAt + sac.durationMinutes * 60_000, title: "SAC time over", body: "Your SAC has reached the end of its allotted time.", type: "sac", path: "/?timer=sac" })
    const upcoming = alerts.filter((alert) => alert.at > now)
    const timers = upcoming.map((alert) => window.setTimeout(() => void notifyTimer(alert.scope, alert), alert.at - now))
    for (const scope of ["exam", "sac"] as const) void scheduleTimerAlerts(scope, upcoming.filter((alert) => alert.scope === scope))
    return () => timers.forEach(window.clearTimeout)
  }, [data.activeExamTimer, data.activeSacTimer])
  useEffect(() => { document.title = `${ALL_NAVIGATION.find((item) => item.id === view)?.label ?? "Study"} · Focal` }, [view])
  useRouteUrl(embedded, view, pendingMarkingAttempt
    ? routePath({ view: "exams", id: pendingMarkingAttempt.id }) + "?marking=1"
    : routePath({ view, subject: chosenSubject ?? selectedSubject, id: recordId }) + routeSearch + (typeof location === "undefined" ? "" : location.hash), consumeBack)
  // Consume one-shot launch links, so a reload lands on the saved page rather than replaying the link.
  const launchAction = useRef(typeof location === "undefined" ? null : new URLSearchParams(location.search).get("action"))
  useEffect(() => {
    const url = new URL(location.href)
    for (const name of ["view", "action"]) url.searchParams.delete(name)
    if (url.href !== location.href) history.replaceState(history.state, "", url)
  }, [])
  // The tab badges follow the chosen subject; the Home Screen icon counts everything waiting.
  const appBadge = allDueMistakeCount + dueStudyTaskCount
  useEffect(() => {
    if (import.meta.env.VITE_DESKTOP) return
    const update = () => setAppBadge(loadNotificationPreferences().badge ? appBadge : 0)
    update()
    window.addEventListener("focal:notification-preferences-changed", update)
    return () => window.removeEventListener("focal:notification-preferences-changed", update)
  }, [appBadge])
  useEffect(() => {
    if (import.meta.env.VITE_DESKTOP) return
    const clear = () => { if (document.visibilityState === "visible") void clearDeliveredNotifications() }
    clear()
    document.addEventListener("visibilitychange", clear)
    return () => document.removeEventListener("visibilitychange", clear)
  }, [])
  useEffect(() => {
    if (sync.status === "restoring" || sync.status === "reconnecting") return
    const refresh = () => void clearPushForOtherAccount(sync.status === "sign-in-required" ? undefined : sync.user?.id)
    refresh()
    window.addEventListener("focus", refresh)
    window.addEventListener("online", refresh)
    return () => { window.removeEventListener("focus", refresh); window.removeEventListener("online", refresh) }
  }, [sync.status, sync.user?.id])
  useEffect(() => {
    if (!import.meta.env.VITE_DESKTOP || !notificationUserId) return
    return watchDesktopNotifications(notificationUserId)
  }, [notificationUserId])
  useEffect(() => {
    if (import.meta.env.VITE_DESKTOP || !("serviceWorker" in navigator)) return
    const openNotification = (event: MessageEvent) => {
      if (event.data?.type === "focal:push-changed") void resyncPush(true).catch(() => undefined)
      if (event.data?.type !== "focal:notification-click" || event.data.path === "/") return
      if (event.data.path === "/?view=friends") setView("friends")
      else if (event.data.path === "/?timer=calendar") setView("calendar")
      else if (event.data.path === "/?timer=sac") { setSacTimerRequest((request) => request + 1); setView("sacs") }
      else if (event.data.path === "/?timer=exam") { setTimerMode("exam"); setView("focus") }
      else { setTimerMode("focus"); setView("focus") }
    }
    navigator.serviceWorker.addEventListener("message", openNotification)
    return () => navigator.serviceWorker.removeEventListener("message", openNotification)
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- setView only touches stable state setters
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
    setView(logMistake ? "mistakes" : "exams")
    linkInBackground({ ...data, attempts: [...data.attempts.filter((item) => item.id !== attempt.id), attempt] }, (attempt.questionResults ?? []).map((result) => result.id))
    setData((current) => ops.recordAttemptResult(current, attempt))
    if (logMistake) {
      setEditingMistake(null)
      setMistakeAttemptId(attempt.id)
      setMistakeOpen(true)
    } else if (unloggedMistakes(attempt, data.mistakes).length) {
      setMarkingAttempt(attempt)
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
    void commitRecoverable((current) => ({
      ...current,
      atarEstimates: current.atarEstimates.filter((estimate) => estimate.id !== id),
      atarEstimatesUpdatedAt: new Date().toISOString(),
    }))
  }

  function saveExamDifficulty(examDifficulty: ExamDifficultySettings) {
    setData((current) => ({ ...current, examDifficulty }))
  }

  function saveEvents(update: (events: CalendarEvent[]) => CalendarEvent[]) {
    void commitRecoverable((current) => ({ ...current, events: update(current.events) }))
  }

  function startFocus(subject: string | undefined, intent: string, sessionId?: string) {
    if (!sessionId) { setFocusPreset({ subject, intent }); setTimerMode("focus"); setView("focus"); return }
    const session = studySessionSync.sessions.find((row) => row.id === sessionId)
    if (!session || session.kind !== "focus") { toast.error("This study session is unavailable."); return }
    const open = () => { setFocusPreset(undefined); setTimerMode("focus"); setView("focus") }
    if (isRunning(session)) open()
    else void studySessionSync.control(session, isPaused(session) || continuableToday(session) ? "resume" : "start").then(open)
      .catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not start this session."))
  }

  function openFriendsTimer(subject?: string, intent = "", sessionId?: string) {
    if (loadFocusSession() || studySessionSync.sessions.some((session) => isRunning(session) || isPaused(session))) {
      setFocusPreset(undefined)
      setTimerMode("focus")
      setView("focus")
      toast("Your current timer is unchanged.")
      return
    }
    startFocus(subject, intent, sessionId)
  }

  function saveClassTimetable(classTimetable: TimetableConfig) {
    setData((current) => ({ ...current, classTimetable }))
  }

  function notifyDemoted(previous: CurriculumArea[]) {
    if (!previous.length) return
    toast(`${previous.length} green item${previous.length === 1 ? "" : "s"} moved to amber after a new mistake`, { duration: 8000, action: { label: "Undo", onClick: () => saveLearning((current) => restoreItems(current, previous)) } })
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
    void commitRecoverable((current) => ({ ...current, learning: typeof update === "function" ? update(current.learning) : update }))
  }

  async function commitRecoverable(update: (current: AppData) => AppData) {
    const before = latestData.current
    const next = update(before)
    const deleted = deletedSince(before, next, [], [])
    if (!deleted) { setData(update); return true }
    try {
      await recovery.preserve(deleted.data, deleted.sessions, deleted.count)
      if (latestData.current !== before) throw new Error("Your data changed while the recovery copy was being saved. Try deleting again.")
      setData(next)
      return true
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save a recovery copy. Nothing was deleted."); return false }
  }

  async function removeStudySession(session: Parameters<typeof studySessionSync.remove>[0]) {
    const deleted = deletedSince(data, data, [session], [])
    if (!deleted) throw new Error("This session is already deleted.")
    await recovery.preserve(deleted.data, deleted.sessions, deleted.count)
    await studySessionSync.remove(session)
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
      saveAppData({ ...latestData.current, activeExamTimer: saved })
      setData((current) => ({ ...current, activeExamTimer: saved }))
    } catch (error) {
      reportSessionFailure(action ?? "save", error)
    }
  }

  async function saveActiveSacTimer(activeSacTimer: AppData["activeSacTimer"], action?: "cancel" | "complete") {
    try {
      const saved = await saveTimerSessionChange(data.activeSacTimer, activeSacTimer, "sac", action)
      saveAppData({ ...latestData.current, activeSacTimer: saved })
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
    setData((current) => ops.setExamFlag(current, "completed", id, !current.completedExamIds.includes(id), new Date().toISOString()))
  }
  function saveMistake(mistakeOrMistakes: Mistake | Mistake[]) {
    const mistakes = Array.isArray(mistakeOrMistakes) ? mistakeOrMistakes : [mistakeOrMistakes]
    setData((current) => ops.saveMistakes(current, editingMistake ? mistakes.slice(0, 1) : mistakes))
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
    setData((current) => ops.recordAttemptResult(current, attempt))
    openRecord("exams", attempt.id, unloggedMistakes(attempt, data.mistakes).length ? "?marking=1" : "")
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
    setData((current) => ops.saveSacRecord(current, record, new Date().toISOString()))
    toast.success(exists ? "SAC updated" : "SAC saved")
  }

  async function deleteSac(record: SacRecord) {
    if (!await commitRecoverable((current) => ops.deleteSacRecord(current, record.id, new Date().toISOString()))) return
    toast("SAC deleted", {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => setData((current) => restoreMissing(current, { ...EMPTY_APP_DATA, sacRecords: [record] })),
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

  useEffect(() => {
    if (launchAction.current !== "log-mistake") return
    launchAction.current = null
    // oxlint-disable-next-line react/set-state-in-effect -- a Home Screen shortcut asked for this sheet
    setMistakeOpen(true)
  }, [])

  async function deleteAttempt(attempt: ExamAttempt) {
    const related = data.mistakes.filter((mistake) => mistake.attemptId === attempt.id)
    // Save the recovery copy before letting the normal outbox deliver the deletion.
    if (!await commitRecoverable((current) => removeAttempt(current, attempt.id))) return
    toast("Exam deleted", {
      duration: 8000,
      action: {
        label: "Undo",
        onClick: () => {
          setData((current) => restoreMissing(current, { ...EMPTY_APP_DATA, attempts: [attempt], mistakes: related }))
        },
      },
    })
  }

  function reviewMistake(mistake: Mistake, rating: ReviewRating, context: PracticeContext = {}) {
    const completedAt = new Date().toISOString()
    setData((current) => ops.reviewMistake(current, mistake.id, rating, completedAt, context))
  }

  function toggleMistakeSuspension(mistake: Mistake) {
    setData((current) => ops.setMistakesSuspended(current, [mistake.id], !mistake.suspended, new Date().toISOString()))
    toast.success(mistake.suspended ? "Card returned to the review queue" : "Reviews paused for this card", { duration: 8000, action: { label: "Undo", onClick: () => toggleMistakeSuspension({ ...mistake, suspended: !mistake.suspended }) } })
  }

  function setMistakesSuspended(ids: string[], suspended: boolean) {
    setData((current) => ops.setMistakesSuspended(current, ids, suspended, new Date().toISOString()))
    toast.success(suspended ? `Reviews paused for ${ids.length} ${ids.length === 1 ? "card" : "cards"}` : `${ids.length} ${ids.length === 1 ? "card" : "cards"} back in the review queue`)
  }

  function importMistakes(incoming: Mistake[], attempt?: ExamAttempt) {
    const imported = incoming.map((mistake) => !mistake.attemptId && !mistake.subject && selectedSubject !== "all" ? { ...mistake, subject: selectedSubject } : mistake)
    const attempts = attempt ? [attempt] : []
    setData((current) => ({ ...current, attempts: [...current.attempts, ...attempts], mistakes: [...current.mistakes, ...imported] }))
    toast.success(`${attempt ? `${attempt.title} and ` : ""}${imported.length} mistake${imported.length === 1 ? "" : "s"} imported`)
    linkInBackground({ ...data, attempts: [...data.attempts, ...attempts], mistakes: [...data.mistakes, ...imported] }, imported.map((mistake) => mistake.id))
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

  async function deleteMistake(mistake: Mistake) {
    if (!await commitRecoverable((current) => ({ ...current, mistakes: current.mistakes.filter((item) => item.id !== mistake.id) }))) return
    toast("Mistake deleted", { duration: 8000, action: { label: "Undo", onClick: () => setData((current) => restoreMissing(current, { ...EMPTY_APP_DATA, attempts: data.attempts.filter((attempt) => attempt.id === mistake.attemptId), mistakes: [mistake] })) } })
  }

  function toggleTrackedExam(id: string) {
    setData((current) => ops.setExamFlag(current, "tracked", id, !current.trackedExamIds.includes(id), new Date().toISOString()))
  }

  function clearTrackedExams() {
    const previous = data.trackedExamIds
    setData((current) => ({ ...current, trackedExamIds: subjectScoped ? current.trackedExamIds.filter((id) => !pageTimetable?.exams.some((exam) => exam.id === id)) : [], trackedExamIdsUpdatedAt: new Date().toISOString() }))
    toast("Tracked exams cleared", { duration: 8000, action: { label: "Undo", onClick: () => setData((current) => ({ ...current, trackedExamIds: previous, trackedExamIdsUpdatedAt: new Date().toISOString() })) } })
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
    const owner = recoveryOwner
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("Choose a backup smaller than 50 MB.")
      const text = await file.text()
      if (recoveryOwnerRef.current !== owner) throw new Error("The account changed. Choose the file again.")
      const parsed: unknown = JSON.parse(text)
      if (parsed && typeof parsed === "object" && "format" in parsed && parsed.format === "focal-recovery") {
        if (!recoveryOwner || recoveryOwnerRef.current !== recoveryOwner) throw new Error("Sign in before importing an account recovery backup.")
        const entry = validateRecovery(parsed)
        await saveRecovery(recoveryOwner, "backup", "Imported backup", entry.data, entry.sessions)
        window.dispatchEvent(new Event("focal:recovery-changed"))
        toast.success("Backup imported", { description: "Use Preview restore under Dated backups to choose what to recover." })
      } else { pendingImportOwner.current = owner; setPendingImport(parseAppDataFile(text)) }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import this file.")
    }
  }

  async function restoreRecovery(entry: RecoveryEntry, replace: boolean) {
    const owner = recoveryOwner
    if (!owner || entry.owner !== owner) throw new Error("This recovery copy belongs to a different account.")
    const saved = validateRecovery(entry)
    await recovery.backup("Before recovery restore")
    if (recoveryOwnerRef.current !== owner) throw new Error("The account changed. Reopen recovery before restoring.")
    for (const session of recoverySessionCandidates(saved, studySessionSync.sessions)) {
      if (recoveryOwnerRef.current !== owner) throw new Error("The account changed. Recovery stopped; reopen it to continue.")
      await studySessionSync.restore(session, saved.sessionIds[session.id], saved.createdAt)
    }
    if (recoveryOwnerRef.current !== owner) throw new Error("The account changed. Reopen recovery before restoring.")
    setData((current) => replace ? replacementData(saved.data, current, canonicalNow().toISOString()) : restoreMissing(current, saved.data, canonicalNow().toISOString()))
  }

  function planWeeklyTasks(drafts: TaskDraft[]) {
    setData((current) => ops.addPlannedTasks(current, drafts))
    toast.success("Review tasks added to Calendar")
  }

  // One subject picker: the mobile top bar and, on desktop, a quiet control above the page heading.
  const subjectMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="sm" aria-label={`Subject: ${subjectScoped ? subjectValue : "All subjects"}`} className="min-w-0 shrink text-muted-foreground" />}>
        {subjectScoped && <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: subjectColor(studySubjectId(subjectValue)) }} />}
        <span className="truncate" title={subjectScoped ? subjectValue : undefined}>{subjectScoped ? subjectValue : "All subjects"}</span>
        <ChevronDown aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[60dvh] w-60">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Subject</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={subjectScoped ? subjectValue : "all"} onValueChange={(value) => chooseSubject(value as string)}>
            {/* Your subjects (and the current one) first; every other VCE subject follows under its own label. */}
            {["all", ...mySubjects].map((subject) => <DropdownMenuRadioItem key={subject} value={subject} className="max-lg:min-h-10">{subject === "all" ? "All subjects" : subject}</DropdownMenuRadioItem>)}
            {otherSubjects.length > 0 && <><DropdownMenuSeparator /><DropdownMenuLabel>Other subjects</DropdownMenuLabel></>}
            {otherSubjects.map((subject) => <DropdownMenuRadioItem key={subject} value={subject} className="max-lg:min-h-10">{subject}</DropdownMenuRadioItem>)}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )

  function runOverviewAction(action: OverviewAction) {
    const subject = action.subject && pageSubjects.includes(action.subject) ? action.subject : undefined
    if (action.kind === "review") return openMistakeQueue(subject ?? (subjectScoped ? selectedSubject : "all"))
    if (action.kind === "focus") return startFocus(subject, action.intent ?? "")
    if (subject) chooseSubject(subject)
    if (action.view) setView(action.view)
  }

  return (
    <AIOverviewContext.Provider value={{ userId: sync.status === "sign-in-required" ? undefined : sync.user?.id, onAction: runOverviewAction }}>
    <SidebarProvider keyboardShortcut={!embedded} className={embedded ? "min-h-0" : undefined} defaultOpen={loadSidebarOpen(typeof document === "undefined" ? null : document.cookie)}>
      <a href="#main-content" className="fixed left-2 top-2 z-50 -translate-y-20 rounded-md bg-background px-3 py-2 text-sm shadow focus:translate-y-0">Skip to content</a>
      {!embedded && <AppSidebar
        view={navView}
        dueMistakes={dueMistakeCount}
        plannedTasks={dueStudyTaskCount}
        user={sync.user}
        syncStatus={sync.status}
        sessions={view === "focus" && timerMode === "focus" ? studySessionSync.sessions.filter((session) => session.kind !== "focus") : studySessionSync.sessions}
        onViewChange={setView}
        onSignOut={() => { void sync.signOut().catch((error: unknown) => { toast.error(error instanceof Error ? error.message : "Could not sign out.") }) }}
        onRetrySync={sync.retry}
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
        {/* Mobile: one compact row that scrolls away; the negative sticky top keeps only its safe-area padding pinned,
            and being sticky at the top edge makes iOS Safari tint the status bar from it instead of blurring it. */}
        {!embedded && <header className="mobile-app-header sticky -top-11 z-20 flex h-11 shrink-0 items-center gap-1 bg-background pr-2 pl-4 lg:hidden">
          <span className="min-w-0 shrink truncate font-heading text-lg font-medium">{ALL_NAVIGATION.find((item) => item.id === navView)?.label}</span>
          {showSubjectMenu && subjectMenu}
          <OfflineChip status={sync.status} />
          <Button variant="ghost" size="icon" aria-label="Friends" aria-current={navView === "friends" ? "page" : undefined} className={`ml-auto ${navView === "friends" ? "text-foreground" : "text-muted-foreground"}`} onClick={() => setView("friends")}><UsersRound aria-hidden /></Button>
          <Button variant="ghost" size="icon" aria-label="Search" className="text-muted-foreground" onClick={() => setCommandOpen(true)}><Search aria-hidden /></Button>
        </header>}
        {embedded && <nav aria-label="Exam tools" className="flex flex-wrap gap-1 border-b px-4 py-2">
          {ALL_NAVIGATION.toSorted((a, b) => Number(b.id === "exams") - Number(a.id === "exams")).map((item) => <Button key={item.id} size="sm" variant={view === item.id ? "secondary" : "ghost"} aria-current={view === item.id ? "page" : undefined} onClick={() => setView(item.id)}>{item.id === "exams" ? "Overview" : item.id === "settings" ? "Exam settings" : item.id === "focus" ? "Timed paper" : item.label}</Button>)}
          <span role="status" className="ml-auto self-center text-xs text-muted-foreground">{sync.status === "synced" ? "Synced" : sync.status === "syncing" ? "Syncing…" : sync.status === "error" ? "Sync failed" : "Saved locally"}</span>
        </nav>}
        <main id="main-content" data-view={view} aria-busy={navView !== view} tabIndex={-1} className={`w-full min-w-0 outline-none ${view === "chat" ? "flex h-[calc(100dvh-2.75rem-env(safe-area-inset-top)-var(--mobile-tabbar)-var(--keyboard-inset))] flex-col lg:h-dvh" : "px-4 pt-1 pb-[max(calc(1.5rem+var(--mobile-tabbar)),env(safe-area-inset-bottom))] sm:px-6 sm:py-8 lg:px-10 lg:py-9 2xl:px-12"}`}>
          {showSubjectMenu && <div className="-ml-2.5 mb-1 max-lg:hidden">{subjectMenu}</div>}
          {sync.status === "sign-in-required" && view !== "settings" ? <div role="status" className="mb-6 flex flex-wrap items-center gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-4 text-sm">
            <p className="min-w-0 flex-1">Your Focal session ended. Saved work stays on this device until you sign in again.</p>
            <Button size="sm" onClick={() => setView("settings")}>Sign in again</Button>
          </div> : null}
          <AlertDialog open={pendingImport !== null} onOpenChange={(open) => { if (!open && !importing) setPendingImport(null) }}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Replace current data?</AlertDialogTitle>
                <AlertDialogDescription>{pendingImport && `This replaces your app data with ${count(pendingImport.attempts.length, "exam")}, ${count(pendingImport.sacRecords.length, "SAC")}, and ${count(pendingImport.mistakes.length, "mistake")}. A dated safety backup is saved first. Study sessions are separate, and timers will not be restarted.`}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel disabled={importing}>Cancel</AlertDialogCancel>
                <Button disabled={importing} onClick={async () => {
                  if (!pendingImport) return
                  setImporting(true)
                  try {
                    if (pendingImportOwner.current !== recoveryOwnerRef.current) throw new Error("The account changed. Choose the file again.")
                    await recovery.backup("Before importing replacement data")
                    const previous = data
                    setData((current) => replacementData(pendingImport, current))
                    setPendingImport(null)
                    toast.success("Focal data imported", { duration: 8000, action: { label: "Undo", onClick: () => { if (pendingImportOwner.current === recoveryOwnerRef.current) setData((current) => replacementData(previous, current)) } } })
                  } catch (error) { toast.error(error instanceof Error ? error.message : "Could not save the safety backup. Your data has not been replaced.") }
                  finally { setImporting(false) }
                }}>{importing ? "Saving backup…" : "Back up and replace"}</Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Dialog open={pastStudyId !== null} onOpenChange={(open) => { if (!open) setPastStudyId(null) }}>
            <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
              <DialogHeader><DialogTitle>Log past study</DialogTitle><DialogDescription>{sync.user ? "Record study you’ve already done. It counts toward your shared study history." : "Saved in this browser only. Sign in before logging to share study with desktop."}</DialogDescription></DialogHeader>
              {pastStudyId && <Suspense fallback={PAGE_LOADING}><PastStudyForm key={pastStudyId} subjects={studySubjectOptions(selectedSubject === "all" ? [...data.subjects, ...references.map((reference) => reference.studyName)] : [selectedSubject])} onCancel={() => setPastStudyId(null)} onSave={async (entry) => {
                await studySessionSync.log(entry, pastStudyId)
                setPastStudyId(null)
                toast.success("Study logged")
              }} /></Suspense>}
            </DialogContent>
          </Dialog>
          
          <p role="status" className="sr-only">{ALL_NAVIGATION.find((item) => item.id === view)?.label}</p>
          {!embedded && <InstallNudge />}
          {data.activeExamTimer && view !== "focus" ? (
            <Alert className="mb-6">
              <AlertTitle>{data.activeExamTimer.pausedAt !== undefined ? "Saved exam" : "Exam in progress"} · {data.activeExamTimer.title}</AlertTitle>
              <AlertDescription><span>{data.activeExamTimer.paper || data.activeExamTimer.subject} · {count(data.activeExamTimer.workspaceItems?.filter((item) => item.status === "done").length ?? 0, "question")} done · {count(data.activeExamTimer.marks, "mark")}</span><span role="status">{examSaveStatus}</span></AlertDescription>
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
          {recordId && (view === "exams" && !editingAttempt || view === "mistakes" && !editingMistake) ? <Alert><AlertTitle>Record unavailable</AlertTitle><AlertDescription>This record is not on this device. Check your account and sync status.</AlertDescription><Button variant="outline" onClick={closeRecord}>Back to {view === "exams" ? "practice" : "mistakes"}</Button></Alert> : null}
          {/* Outside the keyed page, so a transition holds the current page until the next chunk is ready instead of flashing the loader. */}
          <Suspense fallback={PAGE_LOADING}>
          <div key={`${view}:${subjectScoped && view !== "mistakes" ? selectedSubject : "all"}`} className={`page-enter ${view === "chat" ? "flex min-h-0 flex-1 flex-col" : ""}`}>
          {view === "exams" ? (
            <ExamsPage
              scopedSubject={subjectScoped ? selectedSubject : undefined}
                data={pageData}
                references={pageReferences}
                comparisonYear={comparisonYear}
                onComparisonYearChange={setComparisonYear}
                timetable={pageTimetable}
                onLogExam={openNewExam}
                onLogMistakeForLatest={logMistakeForLatest}
                onOpenMistakes={() => openMistakeQueue(selectedSubject)}
                onOpenLibrary={() => setView("library")}
                onOpenCalendar={() => setView("calendar")}
                onOpenTracker={() => setTrackerOpen(true)}
                onEditExam={(attempt) => openRecord("exams", attempt.id)}
                onAddMistake={openNewMistake}
                onDeleteExam={deleteAttempt}
              />
          ) : null}
          {view === "today" ? <TodayPage now={now.getTime()} data={pageData} sessions={studySessionSync.sessions} timetable={pageTimetable} dueMistakes={dueMistakeCount} onNavigate={setView} onStartFocus={startFocus} onOpenAttempt={(id) => openRecord("exams", id)} /> : null}
          {view === "subjects" ? <SubjectOverview subject={selectedSubject} attempts={pageData.attempts} dueMistakes={dueMistakeCount} onNavigate={setView} onReview={() => openMistakeQueue(selectedSubject)} onOpenAttempt={(id) => openRecord("exams", id)} /> : null}
          {view === "timetable" ? <ClassTimetablePage config={data.classTimetable} subjects={data.subjects} onChange={saveClassTimetable} /> : null}
          {view === "calendar" ? <CalendarPage data={pageData} subjects={data.subjects} onPlanSessions={studySessionSync.plan} onLogStudy={(entry) => studySessionSync.log(entry, crypto.randomUUID())} onEditSession={studySessionSync.edit} onMergeSessions={studySessionSync.merge} onRemoveSession={removeStudySession} onConvertSession={async (session, events) => {
            // Persist the replacement before queuing deletion, so a failed conversion retains the study.
            const current = latestData.current
            const next = { ...current, events: [...current.events.filter((item) => !events.some((event) => event.id === item.id)), ...events] }
            saveAppData(next)
            latestData.current = next
            setData(next)
            try { await removeStudySession(session) }
            catch (error) { throw new Error(`Events saved, but the study session could not be removed. Retry conversion to finish. ${error instanceof Error ? error.message : ""}`) }
          }} classTimetable={data.classTimetable} onClassTimetableChange={saveClassTimetable} onEventsChange={saveEvents} onOpenTimetable={() => setView("timetable")} sessions={studySessionSync.sessions} timetable={pageTimetable} onChange={saveLearning} onNavigate={setView} onStartFocus={startFocus} /> : null}
          {view === "progress" ? <ProgressPage subject={subjectScoped ? selectedSubject : undefined} sessions={studySessionSync.sessions} data={pageData} onPlan={planWeeklyTasks} onLogExam={openNewExam} onNewSession={() => setView("focus")} /> : null}
          {view === "focus" ? <StudyTimerPage embedded={embedded} subjects={pageSubjects} preferredSubjects={pageData.subjects} mode={timerMode} onModeChange={(mode) => { setTimerMode(mode); setRouteSearch(mode === "exam" ? "?timer=exam" : "") }} focusPreset={focusPreset} company={notificationUserId ? <FriendStudySessions key={notificationUserId} compact userId={notificationUserId} onOpenTimer={openFriendsTimer} onOpenFriends={() => setView("friends")} /> : undefined} sessions={studySessionSync.sessions} onFocusSessionChange={queueFocusSession} onControlSession={studySessionSync.control} plannedActions={{ ...studySessionSync, remove: removeStudySession }} events={data.events} classTimetable={data.classTimetable} onStartFocus={startFocus} exam={{ progression: data.examProgression, onProgressionChange: saveExamProgression, attempts: data.attempts, references, studies: resourceStudies, preferredSubjects: data.subjects, initialExam: timerPreset, activeSession: data.activeExamTimer, saveStatus: examSaveStatus, syncAction: examSyncAction, onLeave: () => { setTimerMode("focus"); setRouteSearch("") }, onSessionChange: saveActiveExamTimer, onSave: (attempt) => { setTimerPreset(null); saveTimedAttempt(attempt) } }} /> : null}
          {view === "stoplight" ? <StoplightPage onRelatedMistakes={openMistakeQueue} data={pageData} subjects={pageSubjects} onChange={saveSubjectLearning} onApplyLinks={applyLinks} /> : null}
          {view === "goals" ? <GoalsPage data={pageData} references={pageReferences} subjects={pageSubjects} onChange={saveSubjectLearning} subjectScoped={subjectScoped} onPlanGoal={planGoal} /> : null}
          {view === "mistakes" ? <MistakesPage key={routeSearch} initialStatus={new URLSearchParams(routeSearch).get("status")} skillId={new URLSearchParams(routeSearch).get("skill")} workspaceSubject={subjectScoped ? selectedSubject : undefined} subjects={mistakeSubjects} onSubjectChange={(subject) => { setMistakesSubject(subject); setRouteSearch(`?${new URLSearchParams({ subject })}`) }} onSaveReviewPreferences={(mistakeReviewPreferences) => setData((current) => ({ ...current, mistakeReviewPreferences: { ...mistakeReviewPreferences, updatedAt: new Date().toISOString() } }))} onReduceReviews={(days, target) => {
            setData((current) => {
              const now = Date.now()
              const next = ops.postponeReviews(current, days, target, now, subjectScoped ? subjectWorkspace(current, selectedSubject).mistakes : current.mistakes)
              return { ...next, mistakeReviewPreferences: { ...normalizeMistakeReviewPreferences(current.mistakeReviewPreferences), lighterUntil: new Date(mistakeReviewDayStart(now, days)).toISOString(), lighterDailyTarget: target, updatedAt: new Date(now).toISOString() } }
            })
            toast.success("Lighter review period started")
          }} data={pageData} studies={pageStudies} onLog={() => openNewMistake()} onEdit={(mistake) => openRecord("mistakes", mistake.id)} onReview={reviewMistake} onToggleSuspend={toggleMistakeSuspension} onSetSuspended={setMistakesSuspended} onDelete={deleteMistake} onImportMistakes={importMistakes} onApplyAutofills={applyAutofills} onApplyMergePlan={applyMistakeMergePlan} onApplyEdits={applyBulkEdits} onSaveInsights={(mistakeInsights) => setData((current) => ({ ...current, mistakeInsights: { ...mistakeInsights, subject: subjectScoped ? selectedSubject : undefined } }))} onSaveAlternativeDeck={(deck) => setData((current) => {
            const scopedIds = new Set(pageData.mistakes.map((mistake) => mistake.id))
            return { ...current, alternativeMistakeDeck: { ...deck, cards: [...(subjectScoped ? current.alternativeMistakeDeck?.cards ?? [] : []).filter((card) => !scopedIds.has(card.sourceMistakeId)), ...deck.cards] } }
          })} /> : null}
          {view === "sacs" ? <SacPage openTimerRequest={sacTimerRequest} scopedSubject={subjectScoped ? selectedSubject : undefined} records={pageData.sacRecords} subjects={pageSubjects} preferredSubjects={pageData.subjects} activeTimer={data.activeSacTimer} onTimerChange={saveActiveSacTimer} onSave={saveSac} onDelete={deleteSac} /> : null}
          {view === "library" ? <>{referencesLoading ? PAGE_LOADING : <ExamLibrary selectedPaperId={recordId} onSelectPaper={(id) => openRecord("library", id)} onClosePaper={closeRecord} references={references} studies={resourceStudies} attempts={data.attempts} completedExamIds={data.completedExamIds} generatedAt={resourcesGeneratedAt ?? referencesGeneratedAt} preferredSubjects={pageData.subjects} onToggleCompleted={toggleCompletedExam} onStart={(preset) => { setTimerPreset(preset); setTimerMode("exam"); setView("focus", undefined, "?timer=exam") }} onCompare={openVcaaComparison} />}</> : null}
          {view === "predictor" ? <>{referencesStatus === "loading" || scalingStatus === "loading" ? PAGE_LOADING : <StudyScorePredictor data={pageData} references={pageReferences} scalingReferences={scalingReferences} onLogExam={openNewExam} onOpenAtar={() => setView("atar")} />}</> : null}
          {view === "atar" ? <>{referencesStatus === "loading" || scalingStatus === "loading" ? PAGE_LOADING : <AtarEstimator data={pageData} references={pageReferences} scalingReferences={scalingReferences} savedEstimates={data.atarEstimates} onSaveEstimate={saveAtarEstimate} onDeleteEstimate={deleteAtarEstimate} />}</> : null}
          {view === "vcaa" ? <>{referencesLoading ? PAGE_LOADING : <VcaaExplorer key={vcaaSelection?.key ?? "vcaa-default"} references={pageReferences} attempts={pageData.attempts} preferredSubjects={pageData.subjects} studies={pageStudies} initialSelection={vcaaSelection} onOpenLibrary={() => setView("library")} onStart={(preset) => { setTimerPreset(preset); setTimerMode("exam"); setView("focus", undefined, "?timer=exam") }} />}</> : null}
          {view === "friends" ? <FriendsPage key={`${sync.user?.id}:${sync.status === "sign-in-required"}`} signedIn={Boolean(sync.user) && sync.status !== "sign-in-required"} userId={sync.user?.id} sessions={studySessionSync.sessions} onSignIn={() => setView("settings")} onJoin={openFriendsTimer} /> : null}
          {view === "chat" ? <ChatPage key={`${sync.user?.id}:${sync.status === "sign-in-required"}`} userId={sync.status === "sign-in-required" ? undefined : sync.user?.id} subject={selectedSubject} onSignIn={() => { setSettingsSection("account"); setView("settings") }} onSettings={() => { setSettingsSection("ai"); setView("settings") }} /> : null}
          {view === "settings" ? <SettingsPage initialSection={settingsSection} sync={sync} subjects={pageSubjects} selectedSubjects={data.subjects} providers={[...new Set(data.attempts.map((attempt) => attempt.provider))]} examDifficulty={data.examDifficulty} onSubjectsChange={saveSubjects} onExamDifficultyChange={saveExamDifficulty} onExport={() => { void Promise.resolve(downloadAppData(data)).then(() => toast.success("Backup exported"), (error: unknown) => toast.error(error instanceof Error ? error.message : "Could not export your data.")) }} onImport={importData} onReplayOnboarding={() => setOnboarding(true)} onStartTour={() => setTouring(true)} recovery={<RecoveryPanel key={recoveryOwner ?? "unavailable"} owner={recoveryOwner} data={data} sessions={studySessionSync.sessions} error={recovery.error} onBackup={() => recovery.backup()} onRestore={restoreRecovery} />} /> : null}
          </div>
          </Suspense>
        </main>
        {!embedded && <MobileTabBar view={navView} dueMistakes={dueMistakeCount} plannedTasks={dueStudyTaskCount} onViewChange={setView} />}
      </SidebarInset>
      {(examOpen || view === "exams" && recordId && editingAttempt) && !markingAttempt ? (
        <Suspense fallback={null}>
          <ExamSheet key={editingAttempt?.id ?? "new"} attempts={data.attempts} references={references} preferredSubjects={selectedSubject === "all" ? data.subjects : [selectedSubject]} comparisonYear={comparisonYear} initialAttempt={editingAttempt} onOpenChange={(open) => { setExamOpen(open); if (!open) closeRecord() }} onSave={saveAttempt} />
        </Suspense>
      ) : null}
      {mistakeOpen || view === "mistakes" && recordId && editingMistake ? (
        <Suspense fallback={null}>
          <MistakeSheet key={editingMistake?.id ?? "new"} open initialSubject={selectedSubject === "all" ? undefined : selectedSubject} attempts={editingMistake ? data.attempts : workspace.attempts} studies={editingMistake ? resourceStudies : pageStudies} initialAttemptId={mistakeAttemptId} initialMistake={editingMistake} storageUserId={sync.user?.id} items={(editingMistake ? data : pageData).learning.curriculumAreas.filter((item) => item.group && !item.archivedAt)} onOpenChange={(open) => { setMistakeOpen(open); if (!open) closeRecord() }} onSave={saveMistake} />
        </Suspense>
      ) : null}
      {markingAttempt && data.attempts.some((attempt) => attempt.id === markingAttempt.id) ? <Suspense fallback={null}><MarkingMistakesDialog key={markingAttempt.id} attempt={markingAttempt} results={unloggedMistakes(markingAttempt, data.mistakes)} onClose={() => { closeRecord(); setMarkingAttempt(null) }} onSave={(incoming) => {
        const allowed = new Set(unloggedMistakes(markingAttempt, latestData.current.mistakes).map((result) => questionKey(result.label)))
        const mistakes = incoming.filter((mistake) => allowed.has(questionKey(mistake.question)))
        if (mistakes.length) {
          importMistakes(mistakes)
          const demoted = demoteGreens(data.learning, mistakes)
          if (demoted.previous.length) { saveLearning((current) => demoteGreens(current, mistakes).learning); notifyDemoted(demoted.previous) }
        }
        closeRecord()
        setMarkingAttempt(null)
        if (mistakes.length) toast.success("Mistakes ready to review", { action: { label: "Review now", onClick: () => openMistakeQueue(markingAttempt.subject) } })
      }} /></Suspense> : null}
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
      {onboarding && !sync.passwordRecovery ? <Suspense fallback={null}><OnboardingDialog subjects={[...new Set(references.map((reference) => reference.studyName))]} selectedSubjects={data.subjects} signedIn={Boolean(sync.user)} onSubjectsChange={saveSubjects} onFinish={finishOnboarding} /></Suspense> : null}
      {!embedded && <Toaster position="bottom-right" offset={{ bottom: "calc(var(--mobile-tabbar) + var(--keyboard-inset) + 1.5rem)" }} mobileOffset={{ bottom: "calc(var(--mobile-tabbar) + var(--keyboard-inset) + 0.75rem)" }} />}
    </SidebarProvider>
    </AIOverviewContext.Provider>
  )
}
