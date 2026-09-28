import { Suspense, lazy, useEffect, useMemo, useState } from "react"
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
  Timer as TimerIcon,
  Volume2,
  VolumeX,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { MetricCard, MetricGrid, SectionHeading, WorkspacePage } from "@/components/workspace-layout"
import { TimerReadout } from "@/components/timer-readout"
import { requestTimerNotifications, useStudyTimer } from "@/hooks/use-study-timer"
import { StudyPlanCard } from "@/components/study-plan-card"
import type { StudyPlan } from "@/lib/study-plan"
import type { FocusTimerSession } from "@/lib/ongoing-timers"
import {
  DEFAULT_SETTINGS,
  MAX_DAILY_GOAL,
  MAX_DURATION_MINUTES,
  MAX_LONG_BREAK_INTERVAL,
  MIN_LONG_BREAK_INTERVAL,
  MODE_LABEL,
  TIMER_PRESETS,
  formatFocusTime,
  formatTimer,
  type FocusBlock,
} from "@/lib/study-timer"
import type { ExamTimerModeProps } from "@/components/exam-timer-mode"

export type StudyTimerMode = "focus" | "exam"

const ExamTimerMode = lazy(() =>
  import("@/components/exam-timer-mode").then((module) => ({ default: module.ExamTimerMode })),
)

function ToggleRow({ label, description, pressed, onToggle, icon }: {
  label: string
  description: string
  pressed: boolean
  onToggle: () => void
  icon?: React.ReactNode
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-2">
      <div className="min-w-0 space-y-0.5">
        <p className="text-sm font-medium">{label}</p>
        <p className="max-w-[68ch] text-sm text-pretty text-muted-foreground">{description}</p>
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

function blockSummary(block: FocusBlock) {
  const minutes = Math.max(0, Math.round((block.endedAt - block.startedAt) / 60_000))
  return `${formatClock(block.startedAt)} – ${formatClock(block.endedAt)} · ${minutes} min`
}

function FocusBlocks({ subjects, onSessionChange, preset }: {
  subjects: string[]
  onSessionChange?: (
    previous: FocusTimerSession | undefined,
    next: FocusTimerSession | undefined,
    terminal?: "complete" | "cancel",
  ) => void
  /** Subject and intent handed over from a day plan, if any. */
  preset?: { subject?: string; intent: string }
}) {
  const [subject, setSubject] = useState(preset?.subject ?? "")
  const [intent, setIntent] = useState(preset?.intent ?? "")
  const [announcement, setAnnouncement] = useState("")

  const { state, settings, blocks, blocksToday, focusSecondsToday, progress, updateSettings, ...actions } =
    useStudyTimer({ subject, intent, onSessionChange })

  // Free study repurposes the break window rather than counting it down, so
  // `secondsLeft` stays frozen and the elapsed time lands in `overtimeSeconds`.
  // While paused it is held in `breakSeconds` instead.
  const isFreeStudy = state.studyOvertime && state.freeStudy
  const displayMode = state.studyOvertime ? (isFreeStudy ? (state.running ? "Free study" : "Break") : "Overtime") : MODE_LABEL[state.mode]
  const readout = !state.studyOvertime
    ? formatTimer(state.secondsLeft)
    : isFreeStudy && !state.running
      ? formatTimer(state.breakSeconds)
      : `${isFreeStudy ? "" : "+"}${formatTimer(state.overtimeSeconds)}`
  const onBreak = !state.studyOvertime && state.mode !== "work"
  const inSet = state.cycles === 0 ? 0 : state.cycles % settings.longBreakEvery || settings.longBreakEvery

  const todaysBlocks = useMemo(() => {
    const dayStart = new Date()
    dayStart.setHours(0, 0, 0, 0)
    return blocks.filter((block) => block.endedAt >= dayStart.getTime()).reverse()
  }, [blocks])

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

  const caption = state.studyOvertime
    ? isFreeStudy
      ? state.running
        ? "Free study has no end. Stop whenever you are done."
        : "Free study is held. Your time is safe until you continue."
      : "Break time is being logged as study time."
    : onBreak
      ? "Rest properly. The next focus block starts itself if you left auto-start on."
      : "Stay with one task until the block ends."

  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)] lg:gap-8">
      <div className="grid gap-6 lg:gap-8">
        <Card>
          <CardContent className="pt-(--card-spacing)">
            <TimerReadout
              animationKey={`${displayMode}:${state.cycles}`}
              caption={caption}
              display={readout}
              marks={{ total: settings.longBreakEvery, filled: inSet, label: `Set ${Math.min(inSet + 1, settings.longBreakEvery)} of ${settings.longBreakEvery}` }}
              mode={displayMode}
              onCaption={announcement}
              overtime={state.studyOvertime && !state.freeStudy}
              progress={progress}
              status={state.studyOvertime ? (state.running ? "Counting up" : "Held") : state.running ? "Running" : "Paused"}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Button className="min-w-32" onClick={actions.toggle} size="lg">
                  {state.running ? <><Pause />Pause</> : <><Play />Start</>}
                </Button>
                <Button onClick={actions.reset} size="lg" variant="outline"><RotateCcw />Reset</Button>
                {onBreak ? <Button onClick={actions.skipBreak} size="lg" variant="outline"><SkipForward />Skip break</Button> : null}
                {!state.studyOvertime ? (
                  <>
                    <Button onClick={() => actions.addTime(5)} size="lg" variant="ghost"><Plus />5 min</Button>
                    <Button onClick={() => actions.addTime(10)} size="lg" variant="ghost"><Plus />10 min</Button>
                  </>
                ) : null}
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t pt-4">
                {state.studyOvertime ? (
                  <Button onClick={actions.returnToBreak} size="sm" variant="outline"><Coffee />Back to break</Button>
                ) : onBreak ? (
                  <Button onClick={actions.startOvertime} size="sm" variant="outline"><Coffee />Keep studying</Button>
                ) : (
                  <Button onClick={actions.startFreeStudy} size="sm" variant="outline"><TimerIcon />Start free study</Button>
                )}
                <p className="text-sm text-pretty text-muted-foreground">
                  {state.studyOvertime
                    ? "Overtime and free study still count towards today's focus time."
                    : "Sticking with the plan? Let the break run its course."}
                </p>
              </div>
            </TimerReadout>
          </CardContent>
        </Card>

        <StudyPlanCard
          blocksToday={blocksToday}
          canStartNow={!state.running && !state.studyOvertime && state.mode === "work"}
          minutesLeft={Math.max(0, Math.round(state.secondsLeft / 60))}
          onApply={applyPlan}
          running={state.running}
          settings={settings}
          subjects={subjects}
          timerMode={displayMode}
        />

        <Card>
          <CardHeader>
            <CardTitle>What you are working on</CardTitle>
            <CardDescription className="max-w-[68ch]">Naming the block makes the record worth reading later. Both are optional.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="timer-subject">Subject</FieldLabel>
              <Input
                id="timer-subject"
                list="study-timer-subjects"
                onChange={(event) => setSubject(event.target.value)}
                placeholder="Chemistry"
                value={subject}
              />
              <datalist id="study-timer-subjects">
                {subjects.map((option) => <option key={option} value={option} />)}
              </datalist>
            </Field>
            <Field>
              <FieldLabel htmlFor="timer-intent">Intent</FieldLabel>
              <Input
                id="timer-intent"
                maxLength={120}
                onChange={(event) => setIntent(event.target.value)}
                placeholder="Redo the 2023 organic paper"
                value={intent}
              />
              <FieldDescription>Up to 120 characters.</FieldDescription>
            </Field>
          </CardContent>
        </Card>

        <section className="grid gap-4" aria-labelledby="today-title">
          <SectionHeading
            id="today-title"
            title="Today's focus"
            description="Blocks completed since midnight on this device."
          />
          <MetricGrid>
            <MetricCard label="Focus time" value={formatFocusTime(focusSecondsToday)}>
              <span>Across {blocksToday} block{blocksToday === 1 ? "" : "s"}</span>
            </MetricCard>
            <MetricCard label="Daily goal" value={settings.dailyGoal ? `${blocksToday} / ${settings.dailyGoal}` : "Off"}>
              <Progress value={settings.dailyGoal ? (blocksToday / settings.dailyGoal) * 100 : 0} />
            </MetricCard>
            <MetricCard label="Block length" value={`${settings.workMinutes}m`}>
              <span>{settings.breakMinutes}m break every {settings.longBreakEvery} blocks</span>
            </MetricCard>
          </MetricGrid>

          {todaysBlocks.length ? (
            <div className="grid gap-2">
              {todaysBlocks.map((block) => (
                <div className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between" key={block.id}>
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
            <Empty className="min-h-48 border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><TimerIcon /></EmptyMedia>
                <EmptyTitle>No blocks logged today</EmptyTitle>
                <EmptyDescription>Finish one focus block and it will appear here with its subject and intent.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </section>
      </div>

      <aside className="grid gap-4 lg:sticky lg:top-20">
        <Card size="sm">
          <CardHeader>
            <CardTitle>Presets</CardTitle>
            <CardDescription>Sets block length, break, and long break together.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
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
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Durations</CardTitle>
            <CardDescription>Changes apply to the block in progress without losing your place.</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
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
          </CardContent>
          <CardContent className="grid">
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
          </CardContent>
        </Card>

        <Card size="sm">
          <CardHeader>
            <CardTitle>Alerts and flow</CardTitle>
          </CardHeader>
          <CardContent className="divide-y">
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
          </CardContent>
        </Card>
      </aside>
    </div>
  )
}

export function StudyTimerPage({
  subjects,
  mode,
  focusPreset,
  onModeChange,
  onFocusSessionChange,
  exam,
}: {
  subjects: string[]
  mode: StudyTimerMode
  focusPreset?: { subject?: string; intent: string }
  onModeChange: (mode: StudyTimerMode) => void
  /** Focus blocks mirror as `kind: "focus"`; a paper mirrors as `kind: "exam"`. */
  onFocusSessionChange: (
    previous: FocusTimerSession | undefined,
    next: FocusTimerSession | undefined,
    terminal?: "complete" | "cancel",
  ) => void
  exam: ExamTimerModeProps
}) {
  return (
    <WorkspacePage>
      <Tabs onValueChange={(value) => onModeChange(value as StudyTimerMode)} value={mode}>
        <div className="flex flex-col gap-3 border-b pb-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight text-balance xl:text-3xl">Study timer</h1>
            <p className="max-w-[68ch] text-sm text-pretty text-muted-foreground">
              Run focus blocks with rest built in, or sit a full timed paper. Both feed your study record.
            </p>
          </div>
          <TabsList className="h-auto! w-fit shrink-0 border-b-0 pb-0">
            <TabsTrigger value="focus">Focus blocks</TabsTrigger>
            <TabsTrigger value="exam">Timed paper</TabsTrigger>
          </TabsList>
        </div>

        <TabsContent className="mt-0" value="focus">
          <FocusBlocks subjects={subjects} onSessionChange={onFocusSessionChange} preset={focusPreset} />
        </TabsContent>
        <TabsContent className="mt-0" value="exam">
          <Suspense fallback={<Skeleton className="h-96 w-full" />}>
            <ExamTimerMode {...exam} />
          </Suspense>
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  )
}
