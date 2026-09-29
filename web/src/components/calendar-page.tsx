import { useMemo, useState } from "react"
import { Archive, CalendarDays, Check, ChevronLeft, ChevronRight, Plus, RotateCcw, SkipForward, Timer } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { PageHeader } from "@/components/page-header"
import { MetricCard, MetricGrid, SectionHeading, WorkspacePage } from "@/components/workspace-layout"
import {
  addTask,
  archiveTask,
  buildCalendarMonth,
  buildDayPlan,
  moveTask,
  overdueTasks,
  setTaskStatus,
  shiftMonth,
  weekdayLabels,
  type DayItem,
  type DayPlanSource,
} from "@/lib/day-plan"
import { localDate, type LearningWorkspace, type LearningWorkspaceUpdate } from "@/lib/learning-workspace"
import type { Timetable } from "@/lib/timetable"
import { cn } from "@/lib/utils"
import type { CanonicalStudySession } from "../../../src/lib/sync/sessionContract"

const today = () => localDate(new Date())

function formatDayTitle(date: string) {
  const parsed = new Date(`${date}T00:00:00`)
  if (!Number.isFinite(parsed.getTime())) return date
  const todayValue = today()
  const tomorrow = new Date()
  tomorrow.setDate(tomorrow.getDate() + 1)
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const label = parsed.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })
  if (date === todayValue) return `Today · ${label}`
  if (date === localDate(tomorrow)) return `Tomorrow · ${label}`
  if (date === localDate(yesterday)) return `Yesterday · ${label}`
  return label
}

function formatMinutes(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

const CHIP: Record<DayItem["kind"], string> = {
  task: "bg-chart-2/20",
  sac: "bg-chart-4/25",
  exam: "bg-destructive/20",
  session: "bg-chart-1/25",
  "logged-exam": "bg-muted",
  mistakes: "bg-chart-3/25",
}

export function CalendarPage({
  data,
  sessions,
  onChange,
  onNavigate,
  onStartFocus,
  timetable,
}: {
  data: DayPlanSource
  /** The shared study sessions, so the web calendar lists the same sittings the desktop does. */
  sessions: CanonicalStudySession[]
  onChange: (update: LearningWorkspaceUpdate) => void
  onNavigate: (view: "mistakes" | "sacs" | "focus") => void
  onStartFocus: (subject: string | undefined, intent: string) => void
  timetable: Timetable | null
}) {
  const [month, setMonth] = useState(() => new Date())
  const [selected, setSelected] = useState(today)
  const [title, setTitle] = useState("")
  const [minutes, setMinutes] = useState(30)
  const [subject, setSubject] = useState("")
  const [error, setError] = useState<string | null>(null)

  const source = useMemo(() => ({ ...data, sessions }), [data, sessions])
  const days = useMemo(() => buildCalendarMonth(month, source, timetable), [month, source, timetable])
  const plan = useMemo(() => buildDayPlan(selected, source, timetable), [selected, source, timetable])
  const overdue = useMemo(
    () => (selected >= today() ? overdueTasks(data.learning.tasks, today()) : []),
    [data.learning.tasks, selected],
  )
  const monthLabel = month.toLocaleDateString("en-AU", { month: "long", year: "numeric" })
  const completion = plan.plannedMinutes ? Math.min(100, plan.completedMinutes / plan.plannedMinutes * 100) : 0

  function commit(update: (current: LearningWorkspace) => LearningWorkspace) {
    onChange((current) => ({ ...update(current), updatedAt: new Date().toISOString() }))
  }

  function changeStatus(id: string, status: "completed" | "skipped" | "planned") {
    commit((current) => setTaskStatus(current, id, status))
  }

  function move(id: string, date: string) {
    if (!date) return
    commit((current) => moveTask(current, id, date))
    setSelected(date)
  }

  function add() {
    if (!title.trim()) return setError("Enter a task name.")
    if (!Number.isFinite(minutes) || minutes < 5 || minutes > 360) return setError("Duration must be between 5 and 360 minutes.")
    commit((current) => addTask(current, { title, date: selected, minutes, subject }))
    setTitle("")
    setError(null)
    toast("Task added to the day")
  }

  return (
    <WorkspacePage>
      <PageHeader
        title="Calendar and day plan"
        description="Everything scheduled for a day, in one place: study tasks, SACs, exams, and what your revision queue owes you."
      >
        <Button onClick={() => { setMonth(new Date()); setSelected(today()) }} variant="outline"><RotateCcw />Today</Button>
      </PageHeader>

      <MetricGrid>
        <MetricCard label="Planned" value={formatMinutes(plan.plannedMinutes)}><span>For {formatDayTitle(selected).split(" · ").at(-1)}</span></MetricCard>
        <MetricCard label="Completed" value={formatMinutes(plan.completedMinutes)}><Progress value={completion} /></MetricCard>
        <MetricCard label="Due for review" value={plan.dueMistakes}><span>{plan.dueMistakes ? "Mistakes ready" : "Queue is clear"}</span></MetricCard>
      </MetricGrid>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)] lg:gap-8">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{monthLabel}</CardTitle>
              <div className="flex items-center gap-1">
                <Button aria-label="Previous month" onClick={() => setMonth((current) => shiftMonth(current, -1))} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
                <Button aria-label="Next month" onClick={() => setMonth((current) => shiftMonth(current, 1))} size="icon-sm" variant="ghost"><ChevronRight /></Button>
              </div>
            </div>
            <CardDescription>Select a day to plan it. Dots mark work, sessions, SACs, exams, and reviews.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-1">
            <div className="grid grid-cols-7 gap-1 text-xs font-medium text-muted-foreground">
              {weekdayLabels().map((label) => <div className="px-1 py-1" key={label}>{label}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {days.map((day) => {
                const active = day.date === selected
                return (
                  <button
                    aria-current={day.isToday ? "date" : undefined}
                    aria-label={`${day.date}, ${day.load} item${day.load === 1 ? "" : "s"}`}
                    aria-pressed={active}
                    className={cn(
                      "flex min-h-20 flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors hover:bg-accent",
                      !day.inMonth && "opacity-40",
                      active && "border-primary bg-accent",
                      day.isToday && !active && "border-primary/40",
                    )}
                    key={day.date}
                    onClick={() => setSelected(day.date)}
                    type="button"
                  >
                    <span className={cn("text-xs font-medium tabular-nums", day.isToday && "text-primary")}>{day.day}</span>
                    <span className="flex flex-wrap gap-0.5">
                      {day.items.slice(0, 4).map((item) => (
                        <span className={cn("size-1.5 rounded-full", CHIP[item.kind])} key={`${item.kind}-${item.id}`} />
                      ))}
                    </span>
                    {day.items.length ? (
                      <span className="truncate text-[10px] leading-tight text-muted-foreground">
                        {day.items[0].title}
                        {day.load > 1 ? ` +${day.load - 1}` : ""}
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <aside className="grid gap-4 lg:sticky lg:top-20">
          <Card size="sm">
            <CardHeader>
              <CardTitle>{formatDayTitle(selected)}</CardTitle>
              <CardDescription>{plan.items.length} item{plan.items.length === 1 ? "" : "s"} · {formatMinutes(plan.plannedMinutes)} planned</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              {plan.items.length ? plan.items.map((item) => (
                <DayItemRow
                  item={item}
                  key={`${item.kind}-${item.id}`}
                  onArchive={(id) => commit((current) => archiveTask(current, id))}
                  onMove={move}
                  onNavigate={onNavigate}
                  onStartFocus={onStartFocus}
                  onStatus={changeStatus}
                />
              )) : (
                <Empty className="min-h-40 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><CalendarDays /></EmptyMedia>
                    <EmptyTitle>Nothing planned</EmptyTitle>
                    <EmptyDescription>Add a task below to plan this day.</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
            </CardContent>
          </Card>

          {overdue.length ? (
            <Card size="sm">
              <CardHeader>
                <CardTitle>Carried over</CardTitle>
                <CardDescription>Planned for an earlier day and still open.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-2">
                {overdue.map((task) => (
                  <div className="flex items-center gap-2 rounded-lg border p-2" key={task.id}>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{task.title}</p>
                      <p className="text-xs text-muted-foreground">{task.plannedFor} · {task.durationMinutes} min</p>
                    </div>
                    <Button onClick={() => move(task.id, selected)} size="sm" variant="outline">Move here</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          ) : null}

          <Card size="sm">
            <CardHeader>
              <CardTitle>Add a task</CardTitle>
              <CardDescription>Goes straight into the plan for {formatDayTitle(selected).split(" · ").at(-1)}.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="calendar-task">Task</FieldLabel>
                <Input id="calendar-task" onChange={(event) => { setTitle(event.target.value); setError(null) }} placeholder="Redo the 2023 organic paper" value={title} />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field>
                  <FieldLabel htmlFor="calendar-subject">Subject</FieldLabel>
                  <Input id="calendar-subject" list="calendar-subjects" onChange={(event) => setSubject(event.target.value)} value={subject} />
                  <datalist id="calendar-subjects">
                    {data.learning.tasks.map((task) => task.subject).filter((value): value is string => Boolean(value)).map((value) => <option key={value} value={value} />)}
                  </datalist>
                </Field>
                <Field>
                  <FieldLabel htmlFor="calendar-minutes">Minutes</FieldLabel>
                  <Input id="calendar-minutes" min={5} max={360} onChange={(event) => setMinutes(event.target.valueAsNumber)} type="number" value={minutes} />
                </Field>
              </div>
              <FieldError>{error}</FieldError>
              <Button className="w-full" onClick={add}><Plus />Add task</Button>
            </CardContent>
          </Card>
        </aside>
      </div>

      <section className="grid gap-4" aria-labelledby="calendar-month-title">
        <SectionHeading
          id="calendar-month-title"
          title={`This month in ${monthLabel}`}
          description="Load across the whole month, so you can see where the study is actually going."
        />
        <MonthLoad days={days} />
      </section>
    </WorkspacePage>
  )
}

function DayItemRow({
  item,
  onArchive,
  onMove,
  onNavigate,
  onStartFocus,
  onStatus,
}: {
  item: DayItem
  onArchive: (id: string) => void
  onMove: (id: string, date: string) => void
  onNavigate: (view: "mistakes" | "sacs" | "focus") => void
  onStartFocus: (subject: string | undefined, intent: string) => void
  onStatus: (id: string, status: "completed" | "skipped" | "planned") => void
}) {
  const meta = [item.kind === "task" ? item.subject : item.detail, item.minutes ? `${item.minutes} min` : undefined, "startTime" in item ? item.startTime : undefined].filter(Boolean).join(" · ")

  if (item.kind !== "task") {
    return (
      <div className="flex items-center gap-2 rounded-lg border p-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{item.title}</p>
          <p className="text-xs text-muted-foreground">{meta}</p>
        </div>
        <Badge variant="outline">{item.kind === "mistakes" ? "Review" : item.kind === "sac" ? "SAC" : item.kind === "session"
          ? item.status === "completed" ? "Studied" : item.status === "in-progress" ? "Studying" : "Planned"
          : "Exam"}</Badge>
        {item.kind === "mistakes" ? <Button onClick={() => onNavigate("mistakes")} size="sm" variant="ghost">Review</Button> : null}
        {item.kind === "sac" ? <Button onClick={() => onNavigate("sacs")} size="sm" variant="ghost">Open</Button> : null}
      </div>
    )
  }

  const done = item.status === "completed"
  return (
    <div className="grid gap-2 rounded-lg border p-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", done && "text-muted-foreground line-through")}>{item.title}</p>
          <p className="text-xs text-muted-foreground">{meta || item.detail}</p>
        </div>
        {done ? <Badge variant="secondary">Done</Badge> : item.status === "skipped" ? <Badge variant="outline">Skipped</Badge> : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {item.status === "planned" ? (
          <>
            <Button onClick={() => onStartFocus(item.subject, item.title)} size="sm" variant="outline"><Timer />Focus</Button>
            <Button onClick={() => onStatus(item.id, "completed")} size="sm" variant="ghost"><Check />Done</Button>
            <Button onClick={() => onStatus(item.id, "skipped")} size="sm" variant="ghost"><SkipForward />Skip</Button>
          </>
        ) : (
          <Button onClick={() => onStatus(item.id, "planned")} size="sm" variant="ghost"><RotateCcw />Reopen</Button>
        )}
        <Input aria-label={`Move ${item.title} to another day`} className="w-36" onChange={(event) => onMove(item.id, event.target.value)} type="date" />
        <Button aria-label={`Archive ${item.title}`} onClick={() => onArchive(item.id)} size="icon-sm" variant="ghost"><Archive /></Button>
      </div>
    </div>
  )
}

function MonthLoad({ days }: { days: ReturnType<typeof buildCalendarMonth> }) {
  const week = useMemo(() => {
    const rows: { label: string; minutes: number; width: number }[] = []
    for (let index = 0; index < 6; index++) {
      const row = days.slice(index * 7, index * 7 + 7)
      const minutes = row.reduce((total, day) => total + day.minutes, 0)
      rows.push({ label: `Week ${index + 1}`, minutes, width: 0 })
    }
    const peak = Math.max(1, ...rows.map((row) => row.minutes))
    return rows.map((row) => ({ ...row, width: row.minutes / peak * 100 }))
  }, [days])

  return (
    <div className="grid gap-2">
      {week.map((row) => (
        <div className="flex items-center gap-3" key={row.label}>
          <span className="w-16 shrink-0 text-xs text-muted-foreground">{row.label}</span>
          <div className="h-6 min-w-0 flex-1 overflow-hidden rounded bg-muted">
            <div className="h-full rounded bg-chart-2/60" style={{ width: `${row.width}%` }} />
          </div>
          <span className="w-16 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatMinutes(row.minutes)}</span>
        </div>
      ))}
    </div>
  )
}
