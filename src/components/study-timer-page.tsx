import { Suspense, lazy, useMemo, useRef, useState } from "react"
import {
  Bell,
  CalendarPlus,
  Pencil,
  BellOff,
  Check,
  Coffee,
  Smartphone,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Square,
  Timer as TimerIcon,
  Volume2,
  VolumeX,
} from "lucide-react"

import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Field, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Skeleton } from "./ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { SectionHeading, WorkspacePage } from "./workspace-layout"
import { SubjectCombobox } from "./subject-combobox"
import { TimerReadout } from "./timer-readout"
import { requestTimerNotifications, useStudyTimer } from "../hooks/use-study-timer"
import type { useStudySessionSync } from "../lib/study-session-sync"
import { StudySessionDialog } from "./study-session-dialog"
import type { StudySessionEdit } from "../lib/sync/sessionContract"
import type { FocusSessionSink } from "../lib/focus-session"
import { sessionItem } from "../lib/day-plan"
import { localDate } from "../lib/learning-workspace"
import { canContinue, isPaused, isRunning, isPlanned, studySessionPlan, studySessionActiveMilliseconds, type StudySessionAction, type CanonicalStudySession } from "../lib/sync/sessionContract"
import { useTickingNow } from "../hooks/use-ticking-now"
import { VCE_SUBJECTS } from "../lib/types"
import { StudyPlanCard } from "./study-plan-card"
import { AI_ENABLED } from "../lib/host"
import type { StudyPlan } from "../lib/study-plan"
import {
  DEFAULT_SETTINGS,
  loadFocusSession,
  MAX_DAILY_GOAL,
  MAX_DURATION_MINUTES,
  MAX_LONG_BREAK_INTERVAL,
  MIN_LONG_BREAK_INTERVAL,
  MODE_LABEL,
  TIMER_PRESETS,
  formatFocusTime,
  formatTimer,
  type FocusBlock,
} from "../lib/study-timer"
import type { ExamTimerModeProps } from "./exam-timer-mode"
import { EclairHome } from "./eclair-home"

export type StudyTimerMode = "focus" | "exam"

const ECLAIR_KEY = "focal:eclair-launcher:v1"

const ExamTimerMode = lazy(() =>
  import("./exam-timer-mode").then((module) => ({ default: module.ExamTimerMode })),
)

function ToggleRow({ label, description, pressed, onToggle, icon }: {
  label: string
  description: string
  pressed: boolean
  onToggle: () => void
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="max-w-[68ch] text-xs text-pretty text-muted-foreground">{description}</p>
      </div>
      <Button aria-pressed={pressed} className="shrink-0" onClick={onToggle} size="sm" variant={pressed ? "secondary" : "outline"}>
        {icon}
        {pressed ? "On" : "Off"}
      </Button>
    </div>
  )
}

function NumberField({ id, label, value, min, max, onChange }: {
  id: string
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}) {
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        max={max}
        min={min}
        onChange={(event) => onChange(event.target.valueAsNumber)}
        step={1}
        type="number"
        value={Number.isFinite(value) ? value : min}
      />
    </Field>
  )
}

function formatClock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
}

/** Real wall-clock endpoints, with the time actually worked called out separately: a block
 *  that was paused spans a gap, and reading its length as its duration would bill the pause. */
function blockSummary(block: FocusBlock) {
  const minutes = Math.max(0, Math.round(block.activeSeconds / 60))
  return `${formatClock(block.startedAt)} – ${formatClock(block.endedAt)} · ${minutes} min`
}

function FocusBlocks({ subjects, preferredSubjects, onSessionChange, preset, sessions, onControlSession, plannedActions, onTimedPaper, eclair, setEclair, examActive = false }: {
  subjects: string[]
  preferredSubjects: string[]
  plannedActions?: Pick<ReturnType<typeof useStudySessionSync>, "plan" | "edit" | "remove">
  examActive?: boolean
  onTimedPaper: () => void
  eclair: boolean
  setEclair: (on: boolean) => void
  onSessionChange?: FocusSessionSink
  /** Subject and intent handed over from a day plan, if any. */
  preset?: { subject?: string; intent: string }
  /** The shared sittings, so Focal's own study shows here as well as the calendar's. */
  sessions?: CanonicalStudySession[]
  onControlSession?: (session: CanonicalStudySession, action: Extract<StudySessionAction, "start" | "pause" | "resume" | "complete" | "cancel">) => Promise<void>
}) {
  const [planFilter, setPlanFilter] = useState("all")
  const [planSearch, setPlanSearch] = useState("")
  const [planLimit, setPlanLimit] = useState(10)
  const [planBusy, setPlanBusy] = useState<string | null>(null)
  const planBusyRef = useRef(false)
  const [planError, setPlanError] = useState("")
  const [continueError, setContinueError] = useState("")
  const [editingPlan, setEditingPlan] = useState<CanonicalStudySession | null>(null)
  const [creatingPlan, setCreatingPlan] = useState(false)
  const [subject, setSubject] = useState(preset?.subject ?? "")
  const [intent, setIntent] = useState(preset?.intent ?? "")

  const localSessionId = loadFocusSession()?.id
  const activeSession = (sessions ?? [])
    .filter((session) => session.kind === "focus" && (isRunning(session) || isPaused(session)))
    .toSorted((left, right) => Number(isRunning(right)) - Number(isRunning(left)) || right.updated_at.localeCompare(left.updated_at))[0]
  const sharedSession = activeSession?.id === localSessionId ? undefined : activeSession
  const local = useStudyTimer({ subject, intent, onSessionChange, enabled: !sharedSession })
  const { settings, blocks, blocksToday, focusSecondsToday, updateSettings } = local
  const [sharedBusy, setSharedBusy] = useState(false)
  const sharedBusyRef = useRef(false)
  const [sharedFailure, setSharedFailure] = useState<{ key: string; message: string } | null>(null)
  const now = useTickingNow(sharedSession && isRunning(sharedSession) ? 1000 : 60_000)
  const planned = useMemo(() => (sessions ?? []).filter((session) => session.kind === "focus" && isPlanned(session))
    .toSorted((a, b) => Date.parse(studySessionPlan(a).blocks[0]?.start ?? "9999-01-01") - Date.parse(studySessionPlan(b).blocks[0]?.start ?? "9999-01-01")), [sessions])
  const todayEnd = new Date(now); todayEnd.setHours(24, 0, 0, 0)
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const visiblePlans = planned.filter((session) => {
    const plan = studySessionPlan(session)
    const text = [session.title, session.subject_id, VCE_SUBJECTS.find((subject) => subject.id === session.subject_id)?.name, plan.description, ...plan.topics].join(" ").toLowerCase()
    if (!text.includes(planSearch.trim().toLowerCase())) return false
    if (planFilter === "overdue") return !!plan.blocks.length && Date.parse(plan.blocks.at(-1)!.end) < now.getTime()
    if (planFilter === "today") return plan.blocks.some((block) => Date.parse(block.start) < todayEnd.getTime() && Date.parse(block.end) > todayStart.getTime())
    if (planFilter === "upcoming") return plan.blocks.some((block) => Date.parse(block.end) >= now.getTime())
    return true
  })
  const blockedPlan = examActive ? "Stop the exam timer before starting a plan."
    : localSessionId || activeSession || local.state.running ? "Finish your current session before starting a plan." : ""
  async function startPlan(session: CanonicalStudySession, action: "start" | "resume" = "start") {
    if (!onControlSession || planBusyRef.current || blockedPlan) return
    planBusyRef.current = true; setPlanBusy(session.id); setPlanError(""); setContinueError("")
    try { await onControlSession(session, action) }
    catch (error) {
      const message = error instanceof Error ? error.message : "Could not start the session."
      if (action === "resume") setContinueError(message)
      else setPlanError(message)
    }
    finally { planBusyRef.current = false; setPlanBusy(null) }
  }
  async function copyPlan(patch: StudySessionEdit) {
    if (!plannedActions || !patch.blocks?.length) throw new Error("Enter at least one time block.")
    const metadata = patch.metadata ?? {}
    const legacy = metadata.legacy_metadata
    const details = legacy && typeof legacy === "object" && !Array.isArray(legacy) ? { ...legacy, ...metadata } : metadata
    await plannedActions.plan([{ title: patch.title ?? "Study", subjectId: patch.subject_id ?? undefined,
      start: patch.blocks[0].start, end: patch.blocks.at(-1)!.end, blocks: patch.blocks,
      description: typeof details.description === "string" ? details.description : undefined,
      topics: Array.isArray(details.topics) ? details.topics.filter((topic): topic is string => typeof topic === "string") : undefined }])
  }
  function newPlan() {
    const start = new Date(now); start.setSeconds(0, 0)
    const end = new Date(start.getTime() + 30 * 60_000)
    const id = crypto.randomUUID(), stamp = start.toISOString()
    setCreatingPlan(true)
    setEditingPlan({ id, kind: "focus", completed: false, phase: "focus", revision: 0,
      title: "", subject_id: subject || null, originating_app: "examtrack", created_at: stamp, updated_at: stamp,
      started_at: null, paused_at: null, completed_at: null, cancelled_at: null, accumulated_active_ms: 0,
      segment_started_at: null, metadata: {}, segments: [{ id: crypto.randomUUID(), session_id: id,
        started_at: stamp, ended_at: end.toISOString(), phase: "focus", source_device_id: null }] })
  }
  const sharedSessionKey = sharedSession ? `${sharedSession.id}:${sharedSession.revision}:${isRunning(sharedSession)}` : ""
  const sharedError = sharedFailure?.key === sharedSessionKey ? sharedFailure.message : ""

  async function controlShared(action: Extract<StudySessionAction, "start" | "pause" | "resume" | "complete" | "cancel">) {
    if (!sharedSession || !onControlSession || sharedBusyRef.current) return
    sharedBusyRef.current = true
    setSharedBusy(true)
    setSharedFailure(null)
    try {
      await onControlSession(sharedSession, action)
    } catch (error) {
      setSharedFailure({ key: sharedSessionKey, message: error instanceof Error ? error.message : "Could not update the study session." })
    } finally {
      sharedBusyRef.current = false
      setSharedBusy(false)
    }
  }

  // The canonical intervals own shared time; viewing a session never creates a second local log.
  const state = sharedSession ? {
    ...local.state, mode: "free" as const, freeStudy: true, studyOvertime: false,
    running: isRunning(sharedSession), secondsLeft: 0, totalSeconds: 0, cycles: 0,
    overtimeSeconds: Math.floor(studySessionActiveMilliseconds(sharedSession, now.getTime()) / 1000),
  } : local.state
  const progress = sharedSession ? 0 : local.progress
  const sessionBusy = sharedBusy || local.sessionBusy || (!!sharedSession && !onControlSession)
  const actions = sharedSession ? {
    ...local,
    toggle: () => void controlShared(isRunning(sharedSession) ? "pause" : "resume"),
    reset: () => void controlShared("cancel"),
    finishFreeStudy: () => void controlShared("complete"),
    selectMode: () => {},
  } : local

  const isFreeStudy = state.mode === "free"
  const displayMode = isFreeStudy ? "Free study" : state.studyOvertime ? "Overtime" : MODE_LABEL[state.mode]
  const [notificationBlockedMode, setNotificationBlockedMode] = useState<string | null>(null)
  if (notificationBlockedMode && notificationBlockedMode !== displayMode) setNotificationBlockedMode(null)
  const announcement = notificationBlockedMode === displayMode ? "Notifications are blocked for this site." : `${displayMode} started.`
  const readout = isFreeStudy ? formatTimer(state.overtimeSeconds) : state.studyOvertime ? `+${formatTimer(state.overtimeSeconds)}` : formatTimer(state.secondsLeft)
  const onBreak = !isFreeStudy && !state.studyOvertime && state.mode !== "work"
  // Every block lands in the study record under a subject, so there is nothing
  // to start until one is chosen.
  const subjectChosen = !!sharedSession || subject.trim() !== ""
  const statusLabel = isFreeStudy || state.studyOvertime ? (state.running ? "Counting up" : "Held") : state.running ? "Running" : "Paused"
  const inSet = state.cycles === 0 ? 0 : state.cycles % settings.longBreakEvery || settings.longBreakEvery

  const todaysBlocks = useMemo(() => {
    const dayStart = new Date(now.getTime())
    dayStart.setHours(0, 0, 0, 0)
    return blocks.filter((block) => block.endedAt >= dayStart.getTime()).reverse()
  }, [blocks, now])

  // The timer mirrors each of its own work blocks into a shared sitting, so the sittings are
  // a superset of these blocks and the local list would double every minute. Signed in, the
  // shared record is the truth -- it also holds the study done in Focal or Folio. Signed out
  // there is no shared record at all, so the local blocks are the only one that exists.
  //
  // ponytail: a block logged while signed out and never replayed is not in the shared record,
  // so it drops off this list once the account signs in. Upgrade path: replay local blocks to
  // the server on sign-in rather than letting the two records overlap.
  const todaysSittings = useMemo(() => {
    const today = localDate(now)
    return (sessions ?? []).flatMap((session) => {
      const projected = sessionItem(session, today, now.getTime())
      if (!projected || projected.item.kind !== "session" || !(projected.item.done || projected.item.live)) return []
      return [projected.item]
    })
  }, [now, sessions])
  const todaysRecord = todaysSittings.length > 0 ? todaysSittings : null
  // Finished study from today can be picked up again: the same session, its time kept.
  const continuable = useMemo(() => {
    const today = localDate(now)
    return new Map((sessions ?? []).filter((session) => canContinue(session) && localDate(new Date(session.completed_at!)) === today)
      .map((session) => [session.id, session]))
  }, [now, sessions])
  const lastFinished = [...continuable.values()].toSorted((a, b) => b.completed_at!.localeCompare(a.completed_at!))[0]
  const timerIdle = !sharedSession && !state.running && !state.studyOvertime && state.overtimeSeconds === 0 && (isFreeStudy || state.secondsLeft === state.totalSeconds)
  const offerContinue = timerIdle && !blockedPlan && onControlSession && lastFinished ? lastFinished : undefined
  const continueLabel = offerContinue
    ? `Continue ${VCE_SUBJECTS.find((item) => item.id === offerContinue.subject_id)?.name ?? offerContinue.subject_id ?? offerContinue.title} · ${Math.round(offerContinue.accumulated_active_ms / 60_000)} min`
    : ""
  const recordCount = todaysRecord?.length ?? blocksToday
  const recordSeconds = todaysRecord
    ? Math.round(todaysRecord.reduce((total, item) => total + item.minutes, 0)) * 60
    : focusSecondsToday

  // One authored moment: the readout re-enters when the phase changes, and a
  // single status line carries it for anyone not watching the animation.
  /** One atomic apply: a plan never lands half-configured, and the block in
   *  progress keeps its place (settings sync) rather than restarting. */
  function applyPlan(plan: StudyPlan) {
    setSubject(plan.subject)
    setIntent(plan.intent)
    updateSettings({
      workMinutes: plan.workMinutes,
      breakMinutes: plan.breakMinutes,
      longBreakMinutes: plan.longBreakMinutes,
      longBreakEvery: plan.longBreakEvery,
    })
    actions.selectMode("work")
    if (plan.startNow && !state.running) actions.toggle()
  }
  function applyPreset(preset: (typeof TIMER_PRESETS)[number]) {
    updateSettings({
      workMinutes: preset.workMinutes,
      breakMinutes: preset.breakMinutes,
      longBreakMinutes: preset.longBreakMinutes,
    })
  }

  async function toggleNotifications() {
    if (settings.notificationsEnabled) return updateSettings({ notificationsEnabled: false })
    const granted = await requestTimerNotifications()
    updateSettings({ notificationsEnabled: granted })
    if (!granted) setNotificationBlockedMode(displayMode)
  }

  const caption = isFreeStudy ? "Study at your own pace. Pause when you need to; finish to save your time." : state.studyOvertime
    ? isFreeStudy
      ? state.running
        ? "Free study has no end. Finish it when you are done and it lands in your record."
        : "Free study is held. Your time is safe until you continue."
      : "Break time is being logged as study time."
    : onBreak
      ? "Rest properly. The next focus block starts itself if you left auto-start on."
      : "Stay with one task until the block ends."

  return (
    <div className="grid gap-6 lg:gap-8">
      <Card className="min-w-0 gap-0 py-0">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3 sm:px-6">
          <div className="flex gap-1 border-b pb-2" aria-label="Study mode" role="group">
            <Button aria-pressed={!isFreeStudy} disabled={!!sharedSession || sessionBusy || state.running || state.overtimeSeconds > 0 || state.secondsLeft < state.totalSeconds} onClick={() => actions.selectMode("work")} size="sm" variant={!isFreeStudy ? "default" : "ghost"}>Pomodoro</Button>
            <Button aria-pressed={isFreeStudy} disabled={!!sharedSession || sessionBusy || state.running || state.overtimeSeconds > 0 || state.secondsLeft < state.totalSeconds} onClick={() => actions.selectMode("free")} size="sm" variant={isFreeStudy ? "default" : "ghost"}>Free study</Button>
          </div>
          {sharedSession ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{VCE_SUBJECTS.find((item) => item.id === sharedSession.subject_id)?.name ?? sharedSession.subject_id ?? "Study"}</span>
              {sharedSession.title ? ` · ${sharedSession.title}` : ""}
            </p>
          ) : (
            <div className="grid w-full min-w-0 gap-2 sm:grid-cols-2 lg:w-auto lg:max-w-[34rem] lg:flex-1">
              <SubjectCombobox allowCustom id="timer-subject" onValueChange={setSubject} placeholder={subjectChosen ? "Subject" : "Pick a subject to start"} preferredSubjects={preferredSubjects} required subjects={subjects} value={subject} />
              <Input aria-label="Intent" id="timer-intent" maxLength={120} onChange={(event) => setIntent(event.target.value)} placeholder="Intent, e.g. redo the 2023 organic paper" value={intent} />
            </div>
          )}
        </div>
        <CardContent className="px-4 py-10 sm:px-6 sm:py-14">
          <TimerReadout
            animationKey={`${displayMode}:${state.cycles}`}
            caption={caption}
            countUp={isFreeStudy}
            display={readout}
            marks={isFreeStudy ? undefined : { total: settings.longBreakEvery, filled: inSet, label: `Set ${Math.min(inSet + 1, settings.longBreakEvery)} of ${settings.longBreakEvery}` }}
            mode={displayMode}
            onCaption={announcement}
            overtime={state.studyOvertime && !state.freeStudy}
            progress={progress}
            status={statusLabel}
          >
            <div className="flex flex-wrap items-center gap-2">
              {/* A lifecycle command is one transaction with the server: its button
                  stays down until the server has answered for the boundary. */}
              <Button className="min-w-40" disabled={sessionBusy || (!state.running && !subjectChosen)} onClick={actions.toggle} size="lg">
                {state.running ? <><Pause />Pause</> : <><Play />{sharedSession ? "Resume" : "Start"}</>}
              </Button>
              {isFreeStudy ? (
                <Button disabled={sessionBusy || (!sharedSession && state.overtimeSeconds === 0)} onClick={actions.finishFreeStudy} size="lg" variant="outline"><Square />Finish</Button>
              ) : null}
              <Button disabled={sessionBusy} onClick={actions.reset} size="lg" variant="outline"><RotateCcw />{sharedSession ? "Discard" : "Reset"}</Button>
              {onBreak ? <Button onClick={actions.skipBreak} size="lg" variant="outline"><SkipForward />Skip break</Button> : null}
            </div>
            {offerContinue ? (
              <Button disabled={!!planBusy} onClick={() => void startPlan(offerContinue, "resume")} variant="ghost">
                <Play />{planBusy === offerContinue.id ? "Continuing…" : continueLabel}
              </Button>
            ) : null}
            {continueError ? <p className="text-sm text-destructive" role="alert">{continueError}</p> : null}
            {!state.studyOvertime && !isFreeStudy ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={() => actions.addTime(5)} variant="ghost"><Plus />5 min</Button>
                <Button onClick={() => actions.addTime(10)} variant="ghost"><Plus />10 min</Button>
                {onBreak ? <Button disabled={!subjectChosen} onClick={actions.startOvertime} variant="ghost"><Coffee />Keep studying</Button> : null}
              </div>
            ) : state.studyOvertime ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button onClick={actions.returnToBreak} variant="ghost"><Coffee />Back to break</Button>
              </div>
            ) : null}
          </TimerReadout>
          {sharedSession && studySessionPlan(sharedSession).milliseconds > 0 ? <p className="mt-4 text-center text-sm text-muted-foreground">
            {Math.round(studySessionActiveMilliseconds(sharedSession, now.getTime()) / 60_000)} of {Math.round(studySessionPlan(sharedSession).milliseconds / 60_000)} planned minutes worked
            {studySessionActiveMilliseconds(sharedSession, now.getTime()) >= studySessionPlan(sharedSession).milliseconds ? " · Goal reached; finish when you’re ready." : ""}
          </p> : null}
          {sharedError && <p role="alert" className="mt-4 text-center text-sm text-destructive">{sharedError}</p>}
        </CardContent>
        <div className="grid grid-cols-3 divide-x border-t text-center">
          <div className="px-2 py-4"><p className="text-xs text-muted-foreground">Focus today</p><p className="mt-1 font-heading text-3xl font-normal tabular-nums">{formatFocusTime(recordSeconds)}</p></div>
          <div className="px-2 py-4"><p className="text-xs text-muted-foreground">{isFreeStudy ? "Sessions" : "Blocks"}</p><p className="mt-1 font-heading text-3xl font-normal tabular-nums">{settings.dailyGoal && !isFreeStudy ? `${recordCount} / ${settings.dailyGoal}` : recordCount}</p></div>
          <div className="px-2 py-4"><p className="text-xs text-muted-foreground">Rhythm</p><p className="mt-1 font-heading text-3xl font-normal tabular-nums">{settings.workMinutes}/{settings.breakMinutes}m</p></div>
        </div>
      </Card>

      <section className="grid gap-3" aria-labelledby="planned-study-title">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionHeading id="planned-study-title" title={`Planned study · ${planned.length}`} description="Start the same session here or in Folio. Only time you work counts." />
          {plannedActions ? <Button onClick={newPlan} variant="outline"><CalendarPlus />Plan study</Button> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Input aria-label="Search planned study" className="sm:max-w-xs" placeholder="Search title, subject or topics" value={planSearch} onChange={(event) => { setPlanSearch(event.target.value); setPlanLimit(10) }} />
          {[["all", "All"], ["today", "Today"], ["overdue", "Overdue"], ["upcoming", "Upcoming"]].map(([value, label]) =>
            <Button key={value} aria-pressed={planFilter === value} size="sm" variant={planFilter === value ? "secondary" : "outline"} onClick={() => { setPlanFilter(value); setPlanLimit(10) }}>{label}</Button>)}
        </div>
        {blockedPlan && planned.length ? <p className="text-sm text-muted-foreground">{blockedPlan}</p> : null}
        {planError ? <p role="alert" className="text-sm text-destructive">{planError}</p> : null}
        {visiblePlans.slice(0, planLimit).map((session) => {
          const plan = studySessionPlan(session)
          return <Card key={session.id} size="sm"><CardContent className="grid gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><h3 className="break-words font-medium">{session.title}</h3><p className="text-sm text-muted-foreground">{VCE_SUBJECTS.find((subject) => subject.id === session.subject_id)?.name ?? session.subject_id ?? "No subject"} · {Math.round(plan.milliseconds / 60_000)} min planned</p></div>
              <div className="flex gap-2"><Button disabled={!!blockedPlan || !!planBusy || !onControlSession} onClick={() => void startPlan(session)} size="sm"><Play />{planBusy === session.id ? "Starting…" : "Start session"}</Button>
                {plannedActions ? <Button aria-label={`Edit ${session.title}`} onClick={() => { setCreatingPlan(false); setEditingPlan(session) }} size="icon-sm" variant="outline"><Pencil /></Button> : null}</div>
            </div>
            <div className="text-xs text-muted-foreground">{plan.blocks.slice(0, 3).map((block) => <p key={block.start}>{new Date(block.start).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })} – {new Date(block.end).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</p>)}{plan.blocks.length > 3 ? <p>{plan.blocks.length} scheduled blocks</p> : null}</div>
            {plan.description ? <p className="line-clamp-3 whitespace-pre-wrap text-sm">{plan.description}</p> : null}
            {plan.topics.length ? <p className="text-sm text-muted-foreground">Topics: {plan.topics.join(" · ")}</p> : null}
          </CardContent></Card>
        })}
        {!visiblePlans.length ? <p className="rounded-lg border p-4 text-sm text-muted-foreground">{planned.length ? "No plans match these filters." : "Plan study here or on the calendar. Your plans also appear in Folio when you connect the same account."}</p> : null}
        {visiblePlans.length > planLimit ? <Button onClick={() => setPlanLimit((limit) => limit + 10)} variant="outline">Show more plans</Button> : null}
      </section>
      {eclair ? <EclairHome
        display={readout} mode={displayMode} status={statusLabel} running={state.running}
        seconds={isFreeStudy || state.studyOvertime ? state.overtimeSeconds : state.secondsLeft}
        totalSeconds={isFreeStudy || state.studyOvertime ? null : state.totalSeconds}
        onBreak={onBreak} free={isFreeStudy} busy={sessionBusy} shared={!!sharedSession}
        locked={state.running || state.overtimeSeconds > 0 || state.secondsLeft < state.totalSeconds}
        subject={subject} intent={intent} subjects={[...new Set([...preferredSubjects, ...subjects])]}
        settings={settings} focusSeconds={recordSeconds} blocks={recordCount} planBlocked={blockedPlan}
        continueLabel={offerContinue ? continueLabel : undefined}
        onContinue={offerContinue ? () => void startPlan(offerContinue, "resume") : undefined}
        plans={planned.map((session) => ({ id: session.id, title: session.title || "Study",
          detail: new Date(studySessionPlan(session).blocks[0]?.start ?? now).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" }),
          start: () => void startPlan(session) }))}
        actions={{
          toggle: actions.toggle, reset: actions.reset, finish: actions.finishFreeStudy, skipBreak: actions.skipBreak,
          addTime: actions.addTime, selectMode: actions.selectMode, preset: applyPreset, setting: updateSettings,
          notifications: () => void toggleNotifications(), subject: setSubject, intent: setIntent,
          paper: () => { setEclair(false); onTimedPaper() }, exit: () => setEclair(false),
        }}
      /> : null}
      {editingPlan && plannedActions ? <StudySessionDialog key={editingPlan.id}
        session={(sessions ?? []).find((session) => session.id === editingPlan.id) ?? editingPlan}
        subjects={preferredSubjects} allowConvert={false} creating={creatingPlan} onCreate={copyPlan}
        onClose={() => setEditingPlan(null)} onEdit={plannedActions.edit} onRemove={plannedActions.remove}
        onDuplicate={copyPlan} onConvert={async () => { throw new Error("Convert study to events from the calendar.") }} /> : null}

      <div className="grid items-start gap-6 lg:gap-8 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <section className="grid min-w-0 gap-3" aria-labelledby="today-title">
          <SectionHeading
            id="today-title"
            title="Today's log"
            description="Study logged since midnight, across every app on your account."
          />
          {todaysRecord ? (
            <div className="grid gap-2">
              {todaysRecord.map((item) => (
                <div className="flex flex-col gap-2 border-b py-3 sm:flex-row sm:items-center sm:justify-between" key={item.id}>
                  <div className="min-w-0">
                    <p className="font-medium">{item.title || "Focus block"}</p>
                    <p className="text-sm text-muted-foreground">
                      {[item.detail || subject, `${Math.round(item.minutes)} min`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  {continuable.has(item.id) && onControlSession ? (
                    <Button aria-label={`Continue ${item.title || "focus block"}`} className="shrink-0 self-start sm:self-auto" disabled={!!blockedPlan || !!planBusy} onClick={() => void startPlan(continuable.get(item.id)!, "resume")} size="sm" variant="outline">
                      <Play />Continue
                    </Button>
                  ) : <Check aria-hidden className="size-4 shrink-0 text-muted-foreground" />}
                </div>
              ))}
            </div>
          ) : todaysBlocks.length ? (
            <div className="grid gap-2">
              {todaysBlocks.map((block) => (
                <div className="flex flex-col gap-2 border-b py-3 sm:flex-row sm:items-center sm:justify-between" key={block.id}>
                  <div className="min-w-0">
                    <p className="font-medium">{block.intent || "Focus block"}</p>
                    <p className="text-sm text-muted-foreground">
                      {[block.subject, block.source === "free-study" ? "Free study" : `Block ${block.cycleNumber}`, blockSummary(block)]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <Check aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                </div>
              ))}
            </div>
          ) : (
            <Empty className="items-start border p-4 text-left">
              <EmptyHeader className="max-w-none flex-row items-start gap-3">
                <EmptyMedia className="mb-0" variant="icon"><TimerIcon /></EmptyMedia>
                <div className="grid gap-1">
                  <EmptyTitle>No study logged today</EmptyTitle>
                  <EmptyDescription>Finish a study session and it will appear here with its subject and intent.</EmptyDescription>
                </div>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      <aside className="grid min-w-0 gap-4">
        {renderSettings()}
        {AI_ENABLED && !isFreeStudy && <details className="rounded-xl border bg-card">
          <summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Plan a session</summary>
          <StudyPlanCard
            className="rounded-none border-0 shadow-none"
            blocksToday={blocksToday}
            canStartNow={!state.running && !state.studyOvertime && state.mode === "work"}
            minutesLeft={Math.max(0, Math.round(state.secondsLeft / 60))}
            onApply={applyPlan}
            running={state.running}
            settings={settings}
            subjects={subjects}
            timerMode={displayMode}
          />
        </details>}
      </aside>
      </div>
    </div>
  )

  function renderSettings() {
    return (
      <Card size="sm" className="min-w-0 gap-4">
        <CardHeader>
          <CardTitle>Pomodoro settings</CardTitle>
          <CardDescription>Choose a preset or adjust your own rhythm.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-2">
          <h3 className="text-sm font-medium">Presets</h3>
          <div className="grid grid-cols-2 gap-2">
            {TIMER_PRESETS.map((preset) => {
              const active = preset.workMinutes === settings.workMinutes &&
                preset.breakMinutes === settings.breakMinutes &&
                preset.longBreakMinutes === settings.longBreakMinutes
              return (
                <Button
                  aria-pressed={active}
                  className="h-auto flex-col items-start gap-0.5"
                  key={preset.id}
                  onClick={() => applyPreset(preset)}
                  size="sm"
                  variant={active ? "secondary" : "outline"}
                >
                  <span className="font-medium">{preset.label}</span>
                  <span className="text-xs font-normal text-muted-foreground tabular-nums">{preset.description}</span>
                </Button>
              )
            })}
          </div>
          </div>
          <div className="grid gap-3 border-t pt-4">
            <h3 className="text-sm font-medium">Durations</h3>
          <div className="grid grid-cols-2 gap-3">
            <NumberField
              id="timer-work"
              label="Focus (min)"
              max={MAX_DURATION_MINUTES}
              min={1}
              onChange={(value) => updateSettings({ workMinutes: value })}
              value={settings.workMinutes}
            />
            <NumberField
              id="timer-break"
              label="Break (min)"
              max={MAX_DURATION_MINUTES}
              min={1}
              onChange={(value) => updateSettings({ breakMinutes: value })}
              value={settings.breakMinutes}
            />
            <NumberField
              id="timer-long-break"
              label="Long break (min)"
              max={MAX_DURATION_MINUTES}
              min={1}
              onChange={(value) => updateSettings({ longBreakMinutes: value })}
              value={settings.longBreakMinutes}
            />
            <NumberField
              id="timer-every"
              label="Long break every"
              max={MAX_LONG_BREAK_INTERVAL}
              min={MIN_LONG_BREAK_INTERVAL}
              onChange={(value) => updateSettings({ longBreakEvery: value })}
              value={settings.longBreakEvery}
            />
            <NumberField
              id="timer-goal"
              label="Daily goal (blocks)"
              max={MAX_DAILY_GOAL}
              min={0}
              onChange={(value) => updateSettings({ dailyGoal: value })}
              value={settings.dailyGoal}
            />
          </div>
          <p className="text-xs text-muted-foreground">Changes apply without losing your place.</p>
            <Button
              className="w-full"
              onClick={() => updateSettings({
                workMinutes: DEFAULT_SETTINGS.workMinutes,
                breakMinutes: DEFAULT_SETTINGS.breakMinutes,
                longBreakMinutes: DEFAULT_SETTINGS.longBreakMinutes,
                longBreakEvery: DEFAULT_SETTINGS.longBreakEvery,
                dailyGoal: DEFAULT_SETTINGS.dailyGoal,
              })}
              size="sm"
              variant="outline"
            >
              <RotateCcw />Restore defaults
            </Button>
          </div>
          <details className="border-t pt-3">
            <summary className="cursor-pointer text-sm font-medium">Alerts and flow</summary>
            <div className="mt-2 divide-y">
            <ToggleRow
              description="A short tone when a block or break ends."
              icon={settings.soundEnabled ? <Volume2 /> : <VolumeX />}
              label="Sound"
              onToggle={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
              pressed={settings.soundEnabled}
            />
            <ToggleRow
              description="A desktop notification when the timer changes phase. Needs your browser's permission."
              icon={settings.notificationsEnabled ? <Bell /> : <BellOff />}
              label="Notifications"
              onToggle={() => void toggleNotifications()}
              pressed={settings.notificationsEnabled}
            />
            <ToggleRow
              description="Roll straight into the break when a focus block ends."
              label="Auto-start breaks"
              onToggle={() => updateSettings({ autoStartBreak: !settings.autoStartBreak })}
              pressed={settings.autoStartBreak}
            />
            <ToggleRow
              description="Roll straight back into focus when a break ends."
              label="Auto-start focus"
              onToggle={() => updateSettings({ autoStartFocus: !settings.autoStartFocus })}
              pressed={settings.autoStartFocus}
            />
            </div>
          </details>
        </CardContent>
      </Card>
    )
  }
}

export function StudyTimerPage({
  subjects,
  preferredSubjects,
  mode,
  focusPreset,
  sessions,
  onModeChange,
  onFocusSessionChange,
  onControlSession,
  plannedActions,
  exam,
  embedded = false,
}: {
  subjects: string[]
  /** The student's own subjects, floated to the top of the picker. */
  preferredSubjects: string[]
  mode: StudyTimerMode
  plannedActions?: Pick<ReturnType<typeof useStudySessionSync>, "plan" | "edit" | "remove">
  focusPreset?: { subject?: string; intent: string }
  /** The shared sittings, so today's focus time includes study done in Focal or Folio. */
  sessions?: CanonicalStudySession[]
  onModeChange: (mode: StudyTimerMode) => void
  /** Focus blocks mirror as `kind: "focus"`; a paper mirrors as `kind: "exam"`. */
  onFocusSessionChange: FocusSessionSink
  onControlSession?: (session: CanonicalStudySession, action: Extract<StudySessionAction, "start" | "pause" | "resume" | "complete" | "cancel">) => Promise<void>
  exam: ExamTimerModeProps
  /** The desktop app owns the study timer, so only timed papers are offered. */
  embedded?: boolean
}) {
  const [eclair, setEclairState] = useState(() => typeof localStorage !== "undefined" && localStorage.getItem(ECLAIR_KEY) === "1")
  function setEclair(on: boolean) {
    setEclairState(on)
    try { localStorage.setItem(ECLAIR_KEY, on ? "1" : "0") } catch { /* the launcher still works without storage */ }
  }
  return (
    <WorkspacePage>
      <Tabs onValueChange={(value) => onModeChange(value as StudyTimerMode)} value={embedded ? "exam" : mode}>
        <div className="mb-6 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="focal-page-title text-balance">{embedded ? "Timed paper" : "Study timer"}</h1>
            <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-pretty text-muted-foreground">
              {embedded
                ? "Sit a timed paper. Every session feeds your study record."
                : "Study freely with an elapsed timer, use Pomodoro blocks, or sit a timed paper. Every session feeds your study record."}
            </p>
          </div>
          {!embedded && <div className="flex shrink-0 items-center gap-3">
            <TabsList className="h-auto! w-fit border-b-0 pb-0">
              <TabsTrigger value="focus">Study</TabsTrigger>
              <TabsTrigger value="exam">Timed paper</TabsTrigger>
            </TabsList>
            <span aria-hidden className="h-5 w-px bg-border" />
            <Button className="text-muted-foreground hover:text-foreground" onClick={() => { onModeChange("focus"); setEclair(true) }} title="Open the full-screen study launcher" variant="ghost"><Smartphone />Launcher</Button>
          </div>}
        </div>

        {!embedded && <TabsContent className="mt-0" value="focus">
          <FocusBlocks preferredSubjects={preferredSubjects} subjects={subjects} onSessionChange={onFocusSessionChange} preset={focusPreset} sessions={sessions} onControlSession={onControlSession} plannedActions={plannedActions} examActive={!!exam.activeSession} onTimedPaper={() => onModeChange("exam")} eclair={eclair} setEclair={setEclair} />
        </TabsContent>}
        <TabsContent className="mt-0" value="exam">
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <ExamTimerMode {...exam} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  )
}
