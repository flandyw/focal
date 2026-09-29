import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react"
import {
  AlertCircle,
  Download,
  MoreHorizontal,
  Plus,
  Upload,
} from "lucide-react"
import { toast } from "sonner"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { Skeleton } from "@/components/ui/skeleton"
import { Toaster } from "@/components/ui/sonner"
import { ModeToggle } from "@/components/mode-toggle"
import {
  EMPTY_APP_DATA,
  getDueMistakes,
  recordMistakeReview,
  type ReviewRating,
  removeAttempt,
  type AppData,
  type ExamAttempt,
  type Mistake,
  type SavedAtarEstimate,
} from "@/lib/exam-data"
import { downloadAppData, loadAppData, parseAppDataFile, saveAppData } from "@/lib/storage"
import { useSupabaseSync } from "@/lib/sync"
import { saveTimerSessionChange, useStudySessionSync } from "@/lib/study-session-sync"
import { suggestTimetableForAttempt, formatExamLabel } from "@/lib/timetable"
import { ExamTrackerPicker } from "@/components/exam-tracker-picker"
import type { ExamTimerPreset } from "@/components/exam-timer-mode"
import type { StudyTimerMode } from "@/components/study-timer-page"
import type { ExamDifficultySettings } from "@/lib/exam-difficulty"
import type { SacRecord } from "@/lib/sac"
import type { FocusTimerSession } from "@/lib/ongoing-timers"
import { loadAppView, loadSidebarOpen, saveAppView, type AppView } from "@/lib/app-view"
import {
  AppSidebar,
  CommandMenuTrigger,
} from "@/components/app-navigation"
import { getViewLabel } from "@/lib/navigation"
import { useReferenceData } from "@/hooks/use-reference-data"
import { SharedStudySessions } from "@/components/shared-study-sessions"
import { localDate, materialiseTask, type LearningWorkspaceUpdate, type StudyGoal } from "@/lib/learning-workspace"
import { applyMistakeAutofills, applyMistakeFieldMergePlan, type MistakeAutofill, type MistakeFieldMergePlan } from "@/lib/mistake-autofill"
import type { VcaaExplorerPreset } from "@/components/vcaa-explorer"

const ExamSheet = lazy(() =>
  import("@/components/exam-sheet").then((module) => ({ default: module.ExamSheet })),
)
const MistakeSheet = lazy(() =>
  import("@/components/mistake-sheet").then((module) => ({ default: module.MistakeSheet })),
)
const Dashboard = lazy(() =>
  import("@/components/dashboard").then((module) => ({ default: module.Dashboard })),
)
const VcaaExplorer = lazy(() =>
  import("@/components/vcaa-explorer").then((module) => ({ default: module.VcaaExplorer })),
)
const SettingsPage = lazy(() =>
  import("@/components/settings-page").then((module) => ({ default: module.SettingsPage })),
)
const StudyScorePredictor = lazy(() =>
  import("@/components/study-score-predictor").then((module) => ({ default: module.StudyScorePredictor })),
)
const ExamLibrary = lazy(() =>
  import("@/components/exam-library").then((module) => ({ default: module.ExamLibrary })),
)
const MistakesPage = lazy(() =>
  import("@/components/mistakes-page").then((module) => ({ default: module.MistakesPage })),
)
const SacPage = lazy(() =>
  import("@/components/sac-page").then((module) => ({ default: module.SacPage })),
)
const AppCommandMenu = lazy(() =>
  import("@/components/app-command-menu").then((module) => ({ default: module.AppCommandMenu })),
)
const StudyTimerPage = lazy(() =>
  import("@/components/study-timer-page").then((module) => ({ default: module.StudyTimerPage })),
)
const MasteryPage = lazy(() =>
  import("@/components/mastery-page").then((module) => ({ default: module.MasteryPage })),
)
const GoalsPage = lazy(() =>
  import("@/components/goals-page").then((module) => ({ default: module.GoalsPage })),
)
const CalendarPage = lazy(() =>
  import("@/components/calendar-page").then((module) => ({ default: module.CalendarPage })),
)

export default function App() {
  const [view, setView] = useState<AppView>(() => loadAppView(
    typeof localStorage === "undefined" ? null : localStorage,
    typeof location === "undefined" ? "" : location.search,
  ))
  const [data, setData] = useState<AppData>(() => (typeof localStorage === "undefined" ? EMPTY_APP_DATA : loadAppData()))
  const [timerPreset, setTimerPreset] = useState<ExamTimerPreset | null>(null)
  // A timed paper is a mode of the study timer, so the mode is app state: the
  // library, the VCAA explorer, and ?timer=exam all land in the same place.
  const [timerMode, setTimerMode] = useState<StudyTimerMode>(() =>
    typeof location !== "undefined" && new URLSearchParams(location.search).get("timer") === "exam"
      ? "exam"
      : "focus")
  const [comparisonYear, setComparisonYear] = useState(2025)
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
  const importInput = useRef<HTMLInputElement>(null)
  const sync = useSupabaseSync(data, setData)
  const studySessionSync = useStudySessionSync(sync.user?.id, data, setData)
  const examSaveStatus = sync.status === "synced"
    ? "Saved to your account. Open Focal on another device and sign in to the same account to continue."
    : sync.status === "syncing" ? "Saving to your account. Wait for confirmation before switching devices."
    : sync.status === "error" ? "Saved on this device. Cloud sync failed; reconnect before switching devices."
    : sync.status === "unconfigured" ? "Saved on this device. Cloud sync is not configured."
    : "Saved on this device. Sign in to save across devices."
  const examSyncAction = sync.status === "error" ? { label: "Retry sync", onClick: sync.retry }
    : sync.status === "signed-out" ? { label: "Sign in", onClick: () => setView("settings") } : undefined
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
  } = useReferenceData()

  const referenceLoadFailed = [referencesStatus, studiesStatus, scalingStatus].includes("error")
  const referencesLoading = referencesStatus === "loading" || studiesStatus === "loading"

  const dueMistakeCount = useMemo(() => getDueMistakes(data.mistakes).length, [data.mistakes])
  const dueStudyTaskCount = useMemo(() => data.learning.tasks.filter((task) => !task.archivedAt && task.status === "planned" && task.plannedFor <= localDate(new Date())).length, [data.learning.tasks])

  const subjectExamIds = useMemo(() => {
    if (!timetable) return []
    const ids = new Set<string>()
    for (const attempt of data.attempts) {
      for (const entry of suggestTimetableForAttempt(attempt, timetable, data.trackedExamIds)) {
        ids.add(entry.id)
      }
    }
    return [...ids]
  }, [data.attempts, data.trackedExamIds, timetable])

  useEffect(() => {
    // Serialize the full store off the critical path: a keystroke currently
    // triggers a multi-hundred-KB JSON.stringify on every render commit.
    const id = window.setTimeout(() => saveAppData(data), 400)
    return () => window.clearTimeout(id)
  }, [data])
  useEffect(() => saveAppView(typeof localStorage === "undefined" ? null : localStorage, view), [view])
  useEffect(() => {
    const openCommandMenu = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setCommandOpen((current) => !current)
      }
    }
    document.addEventListener("keydown", openCommandMenu)
    return () => document.removeEventListener("keydown", openCommandMenu)
  }, [])
  function saveAttempt(attempt: ExamAttempt, logMistake = false) {
    const isNew = !editingAttempt
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

  // A timer action is one call to the server state machine. If it cannot be published there
  // is nothing to replay later, so say so plainly and leave the timer on screen to retry.
  function reportSessionFailure(action: string, error: unknown) {
    console.error(`Could not ${action} the study session:`, error)
    toast.error(`Couldn't ${action}`, {
      description: error instanceof Error && error.message ? error.message : "Check your connection and try again.",
    })
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
  // only place it is written: it reaches Focal analytics through the server.
  async function queueFocusSession(
    previous: FocusTimerSession | undefined,
    next: FocusTimerSession | undefined,
    action?: "cancel" | "complete",
  ): Promise<FocusTimerSession | undefined> {
    try {
      return await saveTimerSessionChange(previous, next, "focus", action)
    } catch (error) {
      reportSessionFailure(action ?? "save", error)
      return undefined
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
  }

  function saveTimedAttempt(attempt: ExamAttempt) {
    setData((current) => ({ ...current, attempts: [...current.attempts, attempt] }))
    setView("dashboard")
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
    const latest = [...data.attempts].toSorted((first, second) =>
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
    // straight to the server (see pushAppChanges) — nothing waits on the retry loop.
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

  function reviewMistake(mistake: Mistake, rating: ReviewRating) {
    setData((current) => ({
      ...current,
      mistakes: current.mistakes.map((item) => item.id === mistake.id ? recordMistakeReview(item, rating) : item),
    }))
    toast.success(`${rating[0].toUpperCase()}${rating.slice(1)} recorded`)
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

  function importMistakes(imported: Mistake[]) {
    setData((current) => ({ ...current, mistakes: [...current.mistakes, ...imported] }))
    toast.success(`${imported.length} mistake${imported.length === 1 ? "" : "s"} imported`)
  }

  function applyAutofills(autofills: MistakeAutofill[]) {
    const updatedAt = new Date().toISOString()
    setData((current) => ({
      ...current,
      mistakes: applyMistakeAutofills(current.mistakes, autofills, updatedAt),
    }))
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
    setData((current) => ({ ...current, trackedExamIds: [], trackedExamIdsUpdatedAt: new Date().toISOString() }))
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
      const imported = parseAppDataFile(await file.text())
      if (!window.confirm(`Replace current data with ${imported.attempts.length} exams, ${imported.sacRecords.length} SACs, and ${imported.mistakes.length} mistakes?`)) return
      setData(imported)
      toast.success("Focal data imported")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not import this file.")
    }
  }

  return (
    <SidebarProvider defaultOpen={loadSidebarOpen(typeof document === "undefined" ? null : document.cookie)}>
      <a href="#main-content" className="fixed left-2 top-2 z-50 -translate-y-20 rounded-md bg-background px-3 py-2 text-sm shadow focus:translate-y-0">Skip to content</a>
      <AppSidebar
        view={view}
        dueMistakes={dueMistakeCount}
        plannedTasks={dueStudyTaskCount}
        syncLabel={sync.status === "synced" ? "Synced with Supabase" : sync.status === "syncing" ? "Syncing…" : sync.status === "error" ? "Sync needs retry" : "Stored on this device"}
        onViewChange={setView}
      />
      <SidebarInset className="min-w-0">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/95 px-3 backdrop-blur supports-backdrop-filter:bg-background/80 sm:px-4 lg:px-6 2xl:px-8">
          <SidebarTrigger />
          <span className="text-sm font-medium">{getViewLabel(view)}</span>
          <div className="ml-auto flex items-center gap-1">
            <CommandMenuTrigger onClick={() => setCommandOpen(true)} />
            <Button size="sm" onClick={openNewExam}>
              <Plus />
              <span className="hidden sm:inline">Log exam</span>
              <span className="sr-only sm:hidden">Log exam</span>
            </Button>
            <ModeToggle />
            <input ref={importInput} className="sr-only" type="file" accept="application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importData(file); event.currentTarget.value = "" }} />
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}><MoreHorizontal /><span className="sr-only">Data actions</span></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => downloadAppData(data)}><Download />Export data</DropdownMenuItem>
                <DropdownMenuItem onClick={() => importInput.current?.click()}><Upload />Import data</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </header>
        <main id="main-content" className="w-full min-w-0 p-4 sm:p-5 lg:p-6 2xl:p-8">
          <SharedStudySessions userId={sync.user?.id} sessions={studySessionSync.sessions} onControl={studySessionSync.control} />
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
          {view === "dashboard" ? (
            <Suspense fallback={<div className="h-96" />}>
              <Dashboard
                data={data}
                references={references}
                comparisonYear={comparisonYear}
                onComparisonYearChange={setComparisonYear}
                timetable={timetable}
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
          {view === "calendar" ? <Suspense fallback={<Skeleton className="h-96 w-full" />}><CalendarPage data={data} timetable={timetable} onChange={saveLearning} onNavigate={setView} onStartFocus={(subject, intent) => { setFocusPreset({ subject, intent }); setTimerMode("focus"); setView("focus") }} /></Suspense> : null}
          {view === "focus" ? <Suspense fallback={<Skeleton className="h-96 w-full" />}><StudyTimerPage subjects={[...new Set(references.map((reference) => reference.studyName))]} preferredSubjects={data.subjects} mode={timerMode} onModeChange={setTimerMode} focusPreset={focusPreset} onFocusSessionChange={queueFocusSession} exam={{ progression: data.examProgression, onProgressionChange: saveExamProgression, attempts: data.attempts, references, studies: resourceStudies, preferredSubjects: data.subjects, initialExam: timerPreset, activeSession: data.activeExamTimer, saveStatus: examSaveStatus, syncAction: examSyncAction, onLeave: () => setTimerMode("focus"), onSessionChange: saveActiveExamTimer, onSave: (attempt) => { setTimerPreset(null); saveTimedAttempt(attempt) } }} /></Suspense> : null}
          {view === "mastery" ? <Suspense fallback={<Skeleton className="h-96 w-full" />}><MasteryPage data={data} subjects={[...new Set(references.map((reference) => reference.studyName))]} onChange={saveLearning} /></Suspense> : null}
          {view === "goals" ? <Suspense fallback={<Skeleton className="h-96 w-full" />}><GoalsPage data={data} references={references} subjects={[...new Set(references.map((reference) => reference.studyName))]} onChange={saveLearning} onPlanGoal={planGoal} /></Suspense> : null}
          {view === "mistakes" ? <Suspense fallback={<Skeleton className="h-96 w-full" />}><MistakesPage data={data} studies={resourceStudies} onLog={() => openNewMistake()} onEdit={(mistake) => { setEditingMistake(mistake); setMistakeOpen(true) }} onReview={reviewMistake} onToggleSuspend={toggleMistakeSuspension} onSetSuspended={setMistakesSuspended} onDelete={deleteMistake} onImportMistakes={importMistakes} onApplyAutofills={applyAutofills} onApplyMergePlan={applyMistakeMergePlan} onSaveInsights={(mistakeInsights) => setData((current) => ({ ...current, mistakeInsights }))} onSaveAlternativeDeck={(alternativeMistakeDeck) => setData((current) => ({ ...current, alternativeMistakeDeck }))} /></Suspense> : null}
          {view === "sacs" ? <Suspense fallback={<Skeleton className="h-96 w-full" />}><SacPage records={data.sacRecords} subjects={references.map((reference) => reference.studyName)} preferredSubjects={data.subjects} activeTimer={data.activeSacTimer} onTimerChange={saveActiveSacTimer} onSave={saveSac} onDelete={deleteSac} /></Suspense> : null}
          {view === "library" ? <>{referencesLoading ? <Skeleton className="h-96 w-full" /> : <Suspense fallback={<Skeleton className="h-96 w-full" />}><ExamLibrary references={references} studies={resourceStudies} attempts={data.attempts} completedExamIds={data.completedExamIds} generatedAt={resourcesGeneratedAt ?? referencesGeneratedAt} preferredSubjects={data.subjects} onToggleCompleted={toggleCompletedExam} onStart={(preset) => { setTimerPreset(preset); setTimerMode("exam"); setView("focus") }} onCompare={openVcaaComparison} /></Suspense>}</> : null}
          {view === "predictor" ? <>{referencesLoading || scalingStatus === "loading" ? <Skeleton className="h-96 w-full" /> : <Suspense fallback={<Skeleton className="h-96 w-full" />}><StudyScorePredictor data={data} references={references} scalingReferences={scalingReferences} onSaveAtarEstimate={saveAtarEstimate} onDeleteAtarEstimate={deleteAtarEstimate} /></Suspense>}</> : null}
          {view === "vcaa" ? <>{referencesLoading ? <Skeleton className="h-96 w-full" /> : <Suspense fallback={<Skeleton className="h-96 w-full" />}><VcaaExplorer key={vcaaSelection?.key ?? "vcaa-default"} references={references} attempts={data.attempts} preferredSubjects={data.subjects} studies={resourceStudies} initialSelection={vcaaSelection} onOpenLibrary={() => setView("library")} onStart={(preset) => { setTimerPreset(preset); setTimerMode("exam"); setView("focus") }} /></Suspense>}</> : null}
          {view === "settings" ? <Suspense fallback={<Skeleton className="h-96 w-full" />}><SettingsPage sync={sync} subjects={[...new Set(references.map((reference) => reference.studyName))]} selectedSubjects={data.subjects} providers={[...new Set(data.attempts.map((attempt) => attempt.provider))]} examDifficulty={data.examDifficulty} onSubjectsChange={saveSubjects} onExamDifficultyChange={saveExamDifficulty} /></Suspense> : null}
        </main>
      </SidebarInset>
      {examOpen ? (
        <Suspense fallback={null}>
          <ExamSheet progression={data.examProgression} onProgressionChange={saveExamProgression} open references={references} attempts={data.attempts} studies={resourceStudies} preferredSubjects={data.subjects} comparisonYear={comparisonYear} difficultySettings={data.examDifficulty} initialAttempt={editingAttempt} onOpenChange={setExamOpen} onSave={saveAttempt} />
        </Suspense>
      ) : null}
      {mistakeOpen ? (
        <Suspense fallback={null}>
          <MistakeSheet open attempts={data.attempts} studies={resourceStudies} initialAttemptId={mistakeAttemptId} initialMistake={editingMistake} storageUserId={sync.user?.id} onOpenChange={setMistakeOpen} onSave={saveMistake} />
        </Suspense>
      ) : null}
      {timetable ? (
        <ExamTrackerPicker
          open={trackerOpen}
          onOpenChange={setTrackerOpen}
          entries={timetable.exams}
          trackedIds={data.trackedExamIds}
          onToggle={toggleTrackedExam}
          onClearAll={clearTrackedExams}
          onTrackSubjects={trackExamSubjects}
          subjectMatchCount={subjectExamIds.length}
          trackedCount={data.trackedExamIds.length}
        />
      ) : null}
      {commandOpen ? (
        <Suspense fallback={null}>
          <AppCommandMenu
            open
            onOpenChange={setCommandOpen}
            onViewChange={setView}
            onLogExam={openNewExam}
            onLogMistake={() => openNewMistake()}
            onExport={() => downloadAppData(data)}
            onImport={() => importInput.current?.click()}
          />
        </Suspense>
      ) : null}
      <Toaster position="bottom-right" />
    </SidebarProvider>
  )
}
