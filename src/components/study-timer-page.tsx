import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react"
import {
  Bell,
  BellOff,
  Check,
  Coffee,
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
import type { FocusSessionSink } from "../lib/focus-session"
import { sessionItem } from "../lib/day-plan"
import { localDate } from "../lib/learning-workspace"
import { studySessionActiveMilliseconds, type StudySessionAction, type CanonicalStudySession } from "../lib/sync/sessionContract"
import { canonicalNow } from "../lib/study-session-sync"
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

export type StudyTimerMode = "focus" | "exam"

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

function FocusBlocks({ subjects, preferredSubjects, onSessionChange, preset, sessions, onControlSession }: {
  subjects: string[]
  preferredSubjects: string[]
  onSessionChange?: FocusSessionSink
  /** Subject and intent handed over from a day plan, if any. */
  preset?: { subject?: string; intent: string }
  /** The shared sittings, so Focal's own study shows here as well as the calendar's. */
  sessions?: CanonicalStudySession[]
  onControlSession?: (session: CanonicalStudySession, action: Extract<StudySessionAction, "pause" | "resume" | "complete" | "cancel">) => Promise<void>
}) {
  const [subject, setSubject] = useState(preset?.subject ?? "")
  const [intent, setIntent] = useState(preset?.intent ?? "")
  const [announcement, setAnnouncement] = useState("")

  const localSessionId = loadFocusSession()?.id
  const activeSession = (sessions ?? [])
    .filter((session) => session.kind === "focus" && (session.state === "running" || session.state === "paused"))
    .toSorted((left, right) => Number(right.state === "running") - Number(left.state === "running") || right.updated_at.localeCompare(left.updated_at))[0]
  const sharedSession = activeSession?.id === localSessionId ? undefined : activeSession
  const local = useStudyTimer({ subject, intent, onSessionChange, enabled: !sharedSession })
  const { settings, blocks, blocksToday, focusSecondsToday, updateSettings } = local
  const [sharedNow, setSharedNow] = useState(() => canonicalNow().getTime())
  const [sharedBusy, setSharedBusy] = useState(false)
  const sharedBusyRef = useRef(false)
  const [sharedError, setSharedError] = useState("")

  useEffect(() => {
    setSharedError("")
    setSharedNow(canonicalNow().getTime())
    if (sharedSession?.state !== "running") return
    const interval = window.setInterval(() => setSharedNow(canonicalNow().getTime()), 1000)
    return () => window.clearInterval(interval)
  }, [sharedSession?.id, sharedSession?.revision, sharedSession?.state])

  async function controlShared(action: Extract<StudySessionAction, "pause" | "resume" | "complete" | "cancel">) {
    if (!sharedSession || !onControlSession || sharedBusyRef.current) return
    sharedBusyRef.current = true
    setSharedBusy(true)
    setSharedError("")
    try {
      await onControlSession(sharedSession, action)
    } catch (error) {
      setSharedError(error instanceof Error ? error.message : "Could not update the study session.")
    } finally {
      sharedBusyRef.current = false
      setSharedBusy(false)
    }
  }

  // The canonical intervals own shared time; viewing a session never creates a second local log.
  const state = sharedSession ? {
    ...local.state, mode: "free" as const, freeStudy: true, studyOvertime: false,
    running: sharedSession.state === "running", secondsLeft: 0, totalSeconds: 0, cycles: 0,
    overtimeSeconds: Math.floor(studySessionActiveMilliseconds(sharedSession, sharedNow) / 1000),
  } : local.state
  const progress = sharedSession ? 0 : local.progress
  const sessionBusy = sharedBusy || local.sessionBusy || (!!sharedSession && !onControlSession)
  const actions = sharedSession ? {
    ...local,
    toggle: () => void controlShared(sharedSession.state === "running" ? "pause" : "resume"),
    reset: () => void controlShared("cancel"),
    finishFreeStudy: () => void controlShared("complete"),
    selectMode: () => {},
  } : local

  const isFreeStudy = state.mode === "free"
  const displayMode = isFreeStudy ? "Free study" : state.studyOvertime ? "Overtime" : MODE_LABEL[state.mode]
  const readout = isFreeStudy ? formatTimer(state.overtimeSeconds) : state.studyOvertime ? `+${formatTimer(state.overtimeSeconds)}` : formatTimer(state.secondsLeft)
  const onBreak = !isFreeStudy && !state.studyOvertime && state.mode !== "work"
  // Every block lands in the study record under a subject, so there is nothing
  // to start until one is chosen.
  const subjectChosen = !!sharedSession || subject.trim() !== ""
  const inSet = state.cycles === 0 ? 0 : state.cycles % settings.longBreakEvery || settings.longBreakEvery

  const todaysBlocks = useMemo(() => {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    return blocks.filter((block) => block.endedAt >= dayStart.getTime()).reverse()
  }, [blocks])

  // The timer mirrors each of its own work blocks into a shared sitting, so the sittings are
  // a superset of these blocks and the local list would double every minute. Signed in, the
  // shared record is the truth -- it also holds the study done in Focal or Folio. Signed out
  // there is no shared record at all, so the local blocks are the only one that exists.
  //
  // ponytail: a block logged while signed out and never replayed is not in the shared record,
  // so it drops off this list once the account signs in. Upgrade path: replay local blocks to
  // the server on sign-in rather than letting the two records overlap.
  const todaysSittings = useMemo(() => {
    const today = localDate(new Date())
    return (sessions ?? []).flatMap((session) => {
      const projected = sessionItem(session)
      if (!projected || projected.date !== today || projected.item.kind !== "session" || projected.item.status === "planned") return []
      return [projected.item]
    })
  }, [sessions])
  const todaysRecord = todaysSittings.length > 0 ? todaysSittings : null
  const recordCount = todaysRecord?.length ?? blocksToday
  const recordSeconds = todaysRecord
    ? todaysRecord.reduce((total, item) => total + item.minutes * 60, 0)
    : focusSecondsToday

  // One authored moment: the readout re-enters when the phase changes, and a
  // single status line carries it for anyone not watching the animation.
  useEffect(() => {
    setAnnouncement(`${displayMode} started.`)
  }, [displayMode])

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
    if (!granted) setAnnouncement("Notifications are blocked for this site.")
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
          <div className="flex gap-1 rounded-lg bg-muted p-1" aria-label="Study mode" role="group">
            <Button aria-pressed={!isFreeStudy} disabled={!!sharedSession || sessionBusy || state.running || state.overtimeSeconds > 0 || state.secondsLeft < state.totalSeconds} onClick={() => actions.selectMode("work")} size="sm" variant={!isFreeStudy ? "default" : "ghost"}>Pomodoro</Button>
            <Button aria-pressed={isFreeStudy} disabled={!!sharedSession || sessionBusy || state.running || state.overtimeSeconds > 0 || state.secondsLeft < state.totalSeconds} onClick={() => actions.selectMode("free")} size="sm" variant={isFreeStudy ? "default" : "ghost"}>Free study</Button>
          </div>
          {sharedSession ? (
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{VCE_SUBJECTS.find((item) => item.id === sharedSession.subject_id)?.name ?? sharedSession.subject_id ?? "Study"}</span>
              {sharedSession.title ? ` · ${sharedSession.title}` : ""}
            </p>
          ) : (
            <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-[16rem_18rem]">
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
            status={isFreeStudy || state.studyOvertime ? (state.running ? "Counting up" : "Held") : state.running ? "Running" : "Paused"}
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
          {sharedError && <p role="alert" className="mt-4 text-center text-sm text-destructive">{sharedError}</p>}
        </CardContent>
        <div className="grid grid-cols-3 divide-x border-t text-center">
          <div className="px-2 py-4"><p className="text-xs text-muted-foreground">Focus today</p><p className="text-xl font-semibold tabular-nums">{formatFocusTime(recordSeconds)}</p></div>
          <div className="px-2 py-4"><p className="text-xs text-muted-foreground">{isFreeStudy ? "Sessions" : "Blocks"}</p><p className="text-xl font-semibold tabular-nums">{settings.dailyGoal && !isFreeStudy ? `${recordCount} / ${settings.dailyGoal}` : recordCount}</p></div>
          <div className="px-2 py-4"><p className="text-xs text-muted-foreground">Rhythm</p><p className="text-xl font-semibold tabular-nums">{settings.workMinutes}/{settings.breakMinutes}m</p></div>
        </div>
      </Card>

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
                      {[item.detail || subject, `${item.minutes} min`].filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <Check aria-hidden className="size-4 shrink-0 text-muted-foreground" />
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
          <div className="grid grid-cols-2 gap-3 [&_[data-slot=field]]:gap-1.5">
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
  exam,
  embedded = false,
}: {
  subjects: string[]
  /** The student's own subjects, floated to the top of the picker. */
  preferredSubjects: string[]
  mode: StudyTimerMode
  focusPreset?: { subject?: string; intent: string }
  /** The shared sittings, so today's focus time includes study done in Focal or Folio. */
  sessions?: CanonicalStudySession[]
  onModeChange: (mode: StudyTimerMode) => void
  /** Focus blocks mirror as `kind: "focus"`; a paper mirrors as `kind: "exam"`. */
  onFocusSessionChange: FocusSessionSink
  onControlSession?: (session: CanonicalStudySession, action: Extract<StudySessionAction, "pause" | "resume" | "complete" | "cancel">) => Promise<void>
  exam: ExamTimerModeProps
  /** The desktop app owns the study timer, so only timed papers are offered. */
  embedded?: boolean
}) {
  return (
    <WorkspacePage>
      <Tabs onValueChange={(value) => onModeChange(value as StudyTimerMode)} value={embedded ? "exam" : mode}>
        <div className="mb-4 flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance xl:text-3xl">{embedded ? "Timed paper" : "Study timer"}</h1>
            <p className="max-w-[68ch] text-sm text-pretty text-muted-foreground">
              {embedded
                ? "Sit a timed paper. Every session feeds your study record."
                : "Study freely with an elapsed timer, use Pomodoro blocks, or sit a timed paper. Every session feeds your study record."}
            </p>
          </div>
          {!embedded && <TabsList className="h-auto! w-fit shrink-0 border-b-0 pb-0">
            <TabsTrigger value="focus">Study</TabsTrigger>
            <TabsTrigger value="exam">Timed paper</TabsTrigger>
          </TabsList>}
        </div>

        {!embedded && <TabsContent className="mt-0" value="focus">
          <FocusBlocks preferredSubjects={preferredSubjects} subjects={subjects} onSessionChange={onFocusSessionChange} preset={focusPreset} sessions={sessions} onControlSession={onControlSession} />
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
