import { useMemo, useState } from "react"
import { parseISO } from "date-fns"
import { ArrowRight, CalendarClock, CalendarPlus, CalendarRange, ChartColumn, Check, CircleCheck, Clock, FileText, Flame, Hourglass, Layers, ListChecks, Play, Sun, Target } from "lucide-react"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Popover, PopoverContent, PopoverDescription, PopoverTitle, PopoverTrigger } from "./ui/popover"
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group"
import { PageHeader } from "./page-header"
import { AIOverview } from "./ai-overview"
import { Delta, EmptyState, Meter, Panel, StatGrid, StatTile } from "./workspace-layout"
import { buildDayPlan, continuableToday, isDayItemDone, type DayPlanSource } from "../lib/day-plan"
import { isCompletedSac } from "../lib/sac"
import { isPaused, isRunning, type CanonicalStudySession } from "../lib/sync/sessionContract"
import { localDate, type LearningWorkspace } from "../lib/learning-workspace"
import { formatExamLabel, getExamStart, type Timetable } from "../lib/timetable"
import type { AppView } from "../lib/app-view"
import { cn, count } from "../lib/utils"

const DAY = 86_400_000
const hours = (raw: number) => { const minutes = Math.round(raw); return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` }
const daysUntil = (date: string, today: string) => Math.round((Date.parse(date) - Date.parse(today)) / DAY)
type StudyPreferences = LearningWorkspace["preferences"]
// Monday first; values are Date#getDay() so they match the planner's studyDays.
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0].map((day) => ({ day, date: new Date(2024, 0, day || 7) }))
const greeting = (hour: number) => hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"

/** The personal starting page over the same day plan the calendar uses, with one way into each kind of work. */
/** Edits the daily study target the adaptive planner already schedules to. */
function StudyTargetPopover({ preferences, onChange }: { preferences: StudyPreferences; onChange: (preferences: StudyPreferences) => void }) {
  const [open, setOpen] = useState(false)
  const [minutes, setMinutes] = useState(preferences.dailyMinutes)
  const [days, setDays] = useState(preferences.studyDays)
  const valid = Number.isInteger(minutes) && minutes >= 5 && minutes <= 1440
  return (
    <Popover open={open} onOpenChange={(next) => { if (next) { setMinutes(preferences.dailyMinutes); setDays(preferences.studyDays) } setOpen(next) }}>
      <PopoverTrigger render={<Button variant="ghost" size="sm" />} aria-label="Set daily study target" title="Set daily study target"><Target data-icon="inline-start" /><span>Target</span></PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverTitle>Daily study target</PopoverTitle>
        <PopoverDescription className="text-xs">Auto-plan fills each study day up to this amount.</PopoverDescription>
        <form className="flex flex-col gap-3" onSubmit={(event) => {
          event.preventDefault()
          if (!valid) return
          onChange({ dailyMinutes: minutes, studyDays: WEEKDAYS.map(({ day }) => day).filter((day) => days.includes(day)) })
          setOpen(false)
        }}>
          <div className="grid gap-1.5">
            <Label htmlFor="today-target-minutes">Minutes a day</Label>
            <Input id="today-target-minutes" type="number" inputMode="numeric" min={5} max={1440} step={5} required value={Number.isFinite(minutes) ? minutes : ""} aria-invalid={!valid || undefined} onChange={(event) => setMinutes(event.target.valueAsNumber)} />
            {!valid ? <p className="text-xs text-destructive">Enter whole minutes from 5 to 1440.</p> : null}
          </div>
          <div className="grid gap-1.5">
            <span id="today-target-days" className="text-sm font-medium">Study days</span>
            <ToggleGroup multiple size="sm" variant="outline" spacing={0} aria-labelledby="today-target-days" value={days.map(String)} onValueChange={(value) => setDays(value.map(Number))}>
              {WEEKDAYS.map(({ day, date }) => <ToggleGroupItem key={day} value={String(day)} aria-label={date.toLocaleDateString(undefined, { weekday: "long" })} className="w-9 aria-pressed:bg-primary aria-pressed:text-primary-foreground hover:aria-pressed:bg-primary/90">{date.toLocaleDateString(undefined, { weekday: "narrow" })}</ToggleGroupItem>)}
            </ToggleGroup>
          </div>
          <Button type="submit" size="sm" className="self-end" disabled={!valid}>Save target</Button>
        </form>
      </PopoverContent>
    </Popover>
  )
}

export function TodayPage({ now, data, sessions, timetable, dueMistakes, onNavigate, onStartFocus, onOpenAttempt, onOpenSac, onPreferencesChange }: {
  now: number
  data: DayPlanSource
  sessions: CanonicalStudySession[]
  timetable: Timetable | null
  dueMistakes: number
  onNavigate: (view: AppView) => void
  onStartFocus: (subject: string | undefined, intent: string, sessionId?: string) => void
  onOpenAttempt: (id: string) => void
  onOpenSac: (id: string) => void
  onPreferencesChange: (preferences: StudyPreferences) => void
}) {
  const today = localDate(new Date(now))
  // Exam and SAC time already has its own rows; include focus sessions without counting assessments twice.
  const source = useMemo(() => ({ ...data, sessions: sessions.filter((session) => session.kind === "focus") }), [data, sessions])
  const plan = useMemo(() => buildDayPlan(today, source, timetable, now), [today, source, timetable, now])
  const focusSession = sessions.filter((session) => session.kind === "focus" && (isRunning(session) || isPaused(session) || continuableToday(session, now)))
    .toSorted((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || Number(isPaused(b)) - Number(isPaused(a)) || b.updated_at.localeCompare(a.updated_at))[0]
  const items = plan.items.filter((item) => item.kind !== "mistakes")
  const done = items.filter(isDayItemDone).length

  // Past days only change when the data does, so they skip the per-tick `now`.
  const { week, streak } = useMemo(() => {
    const history = new Map<number, { date: Date; minutes: number }>()
    const minutesOn = (offset: number) => {
      const cached = history.get(offset)
      if (cached) return cached
      const date = new Date(`${today}T12:00:00`)
      date.setDate(date.getDate() - offset)
      const result = { date, minutes: buildDayPlan(localDate(date), source, timetable).completedMinutes }
      history.set(offset, result)
      return result
    }
    const week = Array.from({ length: 7 }, (_, index) => minutesOn(6 - index))
    // shortcut: streak stops counting at 60 days, raise the cap if anyone notices.
    let streak = 0
    for (let offset = 1; offset <= 60 && minutesOn(offset).minutes > 0; offset++) streak++
    return { week, streak }
  }, [today, source, timetable])
  const todayMinutes = plan.completedMinutes
  const days = week.map((day, index) => index === 6 ? { ...day, minutes: todayMinutes } : day)
  const weekMinutes = days.reduce((sum, day) => sum + day.minutes, 0)
  const { preferences } = data.learning
  const targetFor = (date: Date) => preferences.studyDays.includes(date.getDay()) ? preferences.dailyMinutes : 0
  const todayTarget = targetFor(new Date(now))
  const targetDays = days.filter((day) => targetFor(day.date))
  const onTarget = targetDays.filter((day) => day.minutes >= targetFor(day.date)).length
  const peak = Math.max(30, ...days.map((day) => Math.max(day.minutes, targetFor(day.date))))
  const totalStreak = streak + (todayMinutes > 0 ? 1 : 0)

  const tracked = new Set(data.trackedExamIds)
  const upcoming = [
    ...data.sacRecords.filter((sac) => !isCompletedSac(sac)).map((sac) => ({ id: sac.id, date: localDate(new Date(sac.scheduledAt)), label: `${sac.subject} · ${sac.title}`, kind: "SAC" })),
    ...(timetable?.exams ?? []).filter((exam) => tracked.has(exam.id)).map((exam) => ({ id: exam.id, date: localDate(getExamStart(exam)), label: formatExamLabel(exam), kind: "Exam" })),
  ].filter((item) => item.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
  const next = upcoming[0]

  // Latest papers with the change from the previous paper in the same subject.
  const papers = useMemo(() => {
    const sorted = data.attempts.filter((attempt) => attempt.rawMax > 0).sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    const percent = (attempt: (typeof sorted)[number]) => Math.round((attempt.rawScore / attempt.rawMax) * 100)
    return sorted.slice(0, 4).map((attempt, index) => {
      const previous = sorted.slice(index + 1).find((other) => other.subject === attempt.subject)
      return { attempt, score: percent(attempt), delta: previous ? percent(attempt) - percent(previous) : null }
    })
  }, [data.attempts])

  const row = "flex items-center justify-between gap-3 border-b border-border px-4 py-2.5 text-sm last:border-b-0 sm:px-5"
  return (
    <div className="flex flex-col gap-5">
      <PageHeader icon={Sun} title={greeting(new Date(now).getHours())} description={new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}>
        {dueMistakes ? <Button variant="outline" onClick={() => onNavigate("mistakes")}><Layers data-icon="inline-start" />Review {dueMistakes}</Button> : null}
        <Button className="min-w-0 max-w-full" title={focusSession ? `Resume ${focusSession.title}` : undefined} onClick={() => focusSession ? onStartFocus(undefined, focusSession.title, focusSession.id) : onStartFocus(undefined, "")}><Play data-icon="inline-start" /><span className="truncate">{focusSession ? `Resume ${focusSession.title}` : "Start studying"}</span></Button>
      </PageHeader>

      <StatGrid>
        <StatTile icon={Clock} tone={todayTarget && todayMinutes >= todayTarget ? "success" : "default"} label="Studied today" value={hours(todayMinutes)} hint={todayTarget ? `${todayMinutes >= todayTarget ? "Target met" : `${hours(todayTarget - todayMinutes)} to go`} · ${hours(todayTarget)} target` : plan.plannedMinutes ? `Rest day · ${hours(plan.plannedMinutes)} planned` : "Rest day"} />
        <StatTile icon={CalendarRange} label="This week" value={hours(weekMinutes)} hint={`${days.filter((day) => day.minutes > 0).length} of 7 days active`} spark={days.map((day) => day.minutes)} onClick={() => onNavigate("progress")} />
        <StatTile icon={Flame} tone={totalStreak ? "warning" : "default"} label="Streak" value={count(totalStreak, "day")} hint={totalStreak ? (todayMinutes ? "Kept alive today" : "Study today to keep it") : "Start one today"} />
        <StatTile icon={Hourglass} tone={next && daysUntil(next.date, today) <= 3 ? "danger" : "default"} label="Next up" value={next ? `${daysUntil(next.date, today)}d` : "—"} hint={next ? next.label : "No exams or SACs tracked"} onClick={next ? () => next.kind === "SAC" ? onOpenSac(next.id) : onNavigate("exams") : undefined} />
      </StatGrid>

      <AIOverview area="today" fingerprint={`${dueMistakes}:${items.length}:${done}:${next?.id ?? ""}`} />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-5">
          <Panel flush id="today-plan" icon={ListChecks} title="Plan" description={items.length ? `${done} of ${items.length} done` : undefined} action={<Button variant="ghost" size="sm" onClick={() => onNavigate("calendar")}>Open calendar<ArrowRight data-icon="inline-end" /></Button>}>
            {items.length ? (
              <>
                <div className="h-1 bg-muted" role="progressbar" aria-label="Plan progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
                  <div className="h-full bg-primary transition-[width] duration-500" style={{ width: `${(done / items.length) * 100}%` }} />
                </div>
                <ul>{items.map((item) => {
                  const finished = isDayItemDone(item)
                  const action = item.kind === "task" && !finished && item.status !== "skipped" ? "Start" : item.kind === "session" && (!finished || item.live || item.paused || item.continuable) && !(item.id === focusSession?.id && isRunning(focusSession)) ? item.live || item.paused ? "Resume" : item.continuable ? "Continue" : "Start" : null
                  return (
                    <li key={`${item.kind}:${item.id}`} className={cn(row, "min-h-11")}>
                      <span className={cn("flex min-w-0 items-center gap-2.5", finished && "text-muted-foreground line-through")}>
                        <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border transition-colors", finished ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{finished ? <Check aria-hidden className="size-3" /> : null}</span>
                        {"startTime" in item && item.startTime ? <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">{item.startTime}</span> : null}
                        <span className="truncate">{item.title}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-xs text-muted-foreground tabular-nums">{item.minutes ? hours(item.minutes) : ""}</span>
                        {action && (item.kind === "task" || item.kind === "session") ? <Button variant="outline" size="sm" className="shrink-0" aria-label={`${action} ${item.title}`} onClick={() => item.kind === "task" ? onStartFocus(item.subject, item.title) : onStartFocus(undefined, item.title, item.id)}><Play data-icon="inline-start" />{action}</Button> : null}
                      </span>
                    </li>
                  )
                })}</ul>
              </>
            ) : (
              <EmptyState icon={ListChecks} title="Nothing planned yet" description="Block out study on the calendar, or start a session now and it is logged here." action={<>
                <Button size="sm" onClick={() => onNavigate("calendar")}><CalendarPlus data-icon="inline-start" />Plan the day</Button>
                <Button variant="outline" size="sm" onClick={() => onStartFocus(undefined, "")}><Play data-icon="inline-start" />Just start</Button>
              </>} />
            )}
          </Panel>

          <Panel flush id="today-papers" icon={FileText} title="Recent papers" description="Change is against your last paper in that subject" action={<Button variant="ghost" size="sm" onClick={() => onNavigate("exams")}>All papers<ArrowRight data-icon="inline-end" /></Button>}>
            {papers.length ? <ul>{papers.map(({ attempt, score, delta }) => (
              <li key={attempt.id} className="border-b border-border last:border-b-0">
                <button type="button" className="focal-row-action flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5" onClick={() => onOpenAttempt(attempt.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{attempt.title || `${attempt.provider} ${attempt.examYear} ${attempt.paper}`}</span>
                    <span className="block truncate text-xs text-muted-foreground">{attempt.subject} · {parseISO(attempt.completedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</span>
                  </span>
                  <Meter value={score} className="hidden w-24 sm:block" />
                  <span className="w-10 shrink-0 text-right font-semibold tabular-nums">{score}%</span>
                  <span className="flex w-12 shrink-0 justify-end">{delta == null ? <Badge variant="outline">new</Badge> : <Delta value={delta} />}</span>
                </button>
              </li>
            ))}</ul> : <EmptyState icon={FileText} title="No marked papers yet" description="Log a practice exam to see your marks and how they move." action={<Button size="sm" onClick={() => onNavigate("exams")}>Go to Practice<ArrowRight data-icon="inline-end" /></Button>} />}
          </Panel>
        </div>

        <div className="flex flex-col gap-5">
          <Panel id="today-reviews" icon={Layers} title="Reviews due">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2">
                <span className="focal-stat-value">{dueMistakes}</span>
                <span className="truncate text-sm text-muted-foreground">{dueMistakes ? `${dueMistakes === 1 ? "mistake" : "mistakes"} ready to review` : "Nothing due. Nice work."}</span>
              </div>
              {dueMistakes ? <Button onClick={() => onNavigate("mistakes")}>Review<ArrowRight data-icon="inline-end" /></Button> : <CircleCheck aria-hidden className="size-5 text-success" />}
            </div>
          </Panel>

          <Panel id="today-week" icon={ChartColumn} title="Last 7 days" description={`${hours(weekMinutes)} total${targetDays.length ? ` · ${onTarget} of ${targetDays.length} on target` : ""}`} action={<>
            <StudyTargetPopover preferences={preferences} onChange={onPreferencesChange} />
            <Button variant="ghost" size="sm" onClick={() => onNavigate("progress")}>Progress<ArrowRight data-icon="inline-end" /></Button>
          </>}>
            <ol className="flex h-32 items-end gap-2">
              {days.map((day, index) => {
                const target = targetFor(day.date)
                const label = `${day.date.toLocaleDateString(undefined, { weekday: "long" })}: ${hours(day.minutes)}${target ? ` of ${hours(target)} target` : ""}`
                return (
                  <li key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={label}>
                    <span className="sr-only">{label}</span>
                    <div className="relative flex w-full flex-1 flex-col items-center justify-end gap-1.5">
                      {day.minutes ? <span aria-hidden className="text-[10px] tabular-nums text-muted-foreground">{hours(day.minutes)}</span> : null}
                      <div className={cn("focal-bar w-full rounded-sm", index === 6 ? "bg-primary" : day.minutes ? "bg-primary/40" : "bg-muted")} style={{ height: `${Math.max(4, (day.minutes / peak) * 80)}%`, animationDelay: `${index * 30}ms` }} />
                      {target ? <span aria-hidden className="absolute -inset-x-0.5 border-t border-dashed border-foreground/50" style={{ bottom: `${(target / peak) * 80}%` }} /> : null}
                    </div>
                    <span aria-hidden className={cn("text-[11px] text-muted-foreground", index === 6 && "font-semibold text-foreground")}>{day.date.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                  </li>
                )
              })}
            </ol>
          </Panel>

          <Panel flush id="today-upcoming" icon={CalendarClock} title="Coming up">
            {upcoming.length ? <ul>{upcoming.map((item) => {
              const away = daysUntil(item.date, today)
              return (
                <li key={`${item.kind}:${item.id}`} className="border-b border-border last:border-b-0">
                  <button type="button" className="focal-row-action flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-5" onClick={() => item.kind === "SAC" ? onOpenSac(item.id) : onNavigate("exams")}>
                    <span className="flex min-w-0 items-center gap-2">
                      <Badge variant={item.kind === "Exam" ? "default" : "secondary"}>{item.kind}</Badge>
                      <span className="truncate">{item.label}</span>
                    </span>
                    <Badge variant={away <= 3 ? "warning" : "outline"} className="shrink-0 tabular-nums">{away === 1 ? "Tomorrow" : `${away} days`}</Badge>
                  </button>
                </li>
              )
            })}</ul> : <EmptyState icon={CalendarClock} title="Nothing coming up" description="Track an exam or add a SAC to see a countdown here." action={<Button variant="outline" size="sm" onClick={() => onNavigate("sacs")}>Add a SAC</Button>} />}
          </Panel>
        </div>
      </div>
    </div>
  )
}
