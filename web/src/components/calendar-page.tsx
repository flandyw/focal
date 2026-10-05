import { useMemo, useState, type ReactNode } from "react"
import { Archive, CalendarDays, ClipboardPaste, Check, ChevronLeft, ChevronRight, MoreHorizontal, Plus, RotateCcw, SkipForward, Timer } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Field, FieldError, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Progress } from "./ui/progress"
import { CalendarChatbotImportDialog, type ImportedTask } from "./calendar-chatbot-import"
import { PageHeader } from "./page-header"
import { WorkspacePage } from "./workspace-layout"
import {
  addTask,
  archiveTask,
  buildCalendarMonth,
  buildDayPlan,
  isDayItemDone,
  moveTask,
  overdueTasks,
  setTaskStatus,
  shiftMonth,
  weekdayLabels,
  type DayItem,
  type DayPlan,
  type DayPlanSource,
} from "../lib/day-plan"
import { localDate, type LearningWorkspace, type LearningWorkspaceUpdate } from "../lib/learning-workspace"
import type { Timetable } from "../lib/timetable"
import { cn } from "../lib/utils"
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

/** One solid mark per kind: at cell size a pale dot is a smudge, not a legend. */
const KIND_MARK: Record<DayItem["kind"], string> = {
  task: "bg-chart-2",
  sac: "bg-chart-4",
  exam: "bg-destructive",
  session: "bg-chart-1",
  "logged-exam": "bg-muted-foreground",
  mistakes: "bg-chart-3",
}

const KIND_LABEL: Record<DayItem["kind"], string> = {
  task: "Task",
  sac: "SAC",
  exam: "Exam",
  session: "Study session",
  "logged-exam": "Logged exam",
  mistakes: "Review",
}

/** The three lines a day cell can afford before it starts lying about what is there. */
const CELL_LINES = 3

export function CalendarPage({
  data,
  sessions,
  onChange,
  onNavigate,
  onStartFocus,
  timetable,
  subjects,
}: {
  data: DayPlanSource
  /** The shared study sessions, so the web calendar lists the same sittings the desktop does. */
  sessions: CanonicalStudySession[]
  onChange: (update: LearningWorkspaceUpdate) => void
  onNavigate: (view: "mistakes" | "sacs" | "focus") => void
  onStartFocus: (subject: string | undefined, intent: string) => void
  timetable: Timetable | null
  subjects: string[]
}) {
  const [month, setMonth] = useState(() => new Date())
  const [selected, setSelected] = useState(today)
  const [title, setTitle] = useState("")
  const [minutes, setMinutes] = useState(30)
  const [subject, setSubject] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [importOpen, setImportOpen] = useState(false)

  const source = useMemo(() => ({ ...data, sessions }), [data, sessions])
  const days = useMemo(() => buildCalendarMonth(month, source, timetable), [month, source, timetable])
  const plan = useMemo(() => buildDayPlan(selected, source, timetable), [selected, source, timetable])
  const overdue = useMemo(
    () => (selected >= today() ? overdueTasks(data.learning.tasks, today()) : []),
    [data.learning.tasks, selected],
  )
  const monthLabel = month.toLocaleDateString("en-AU", { month: "long", year: "numeric" })
  const completion = plan.totalCount ? plan.completedCount / plan.totalCount * 100 : 0
  const open = plan.items.filter((item) => !isDayItemDone(item))
  const banked = plan.items.filter(isDayItemDone)

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

  function importTasks(tasks: ImportedTask[]) {
    commit((current) => tasks.reduce((workspace, task) => addTask(workspace, task), current))
    setSelected(tasks[0]?.date ?? selected)
    toast(`${tasks.length} item${tasks.length === 1 ? "" : "s"} added to your calendar`)
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
        <Button onClick={() => setImportOpen(true)} variant="outline"><ClipboardPaste />Import from chatbot</Button>
        <Button onClick={() => { setMonth(new Date()); setSelected(today()) }} variant="outline"><RotateCcw />Today</Button>
        <CalendarChatbotImportDialog open={importOpen} subjects={subjects} onOpenChange={setImportOpen} onImport={importTasks} />
      </PageHeader>

      <DayStats dueMistakes={plan.dueMistakes} plan={plan} progress={completion} />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(22rem,27rem)] lg:gap-8">
        {/* The month and the load bars that summarise it are one thing, read together. */}
        <div className="grid min-w-0 content-start gap-4">
        <Card>
          <CardHeader className="gap-1 pb-2">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{monthLabel}</CardTitle>
              <div className="flex items-center gap-1">
                <Button aria-label="Previous month" onClick={() => setMonth((current) => shiftMonth(current, -1))} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
                <Button aria-label="Next month" onClick={() => setMonth((current) => shiftMonth(current, 1))} size="icon-sm" variant="ghost"><ChevronRight /></Button>
              </div>
            </div>
            <CardDescription>Select a day to plan it. Each line is one piece of work; the bar is that day's load.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-0.5">
            {/* minmax(0,1fr), not 1fr: a plain 1fr track floors at its content's min-width,
                so one long title or a "6h 20m" stamp pushed the seventh column off a phone. */}
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] text-[0.6875rem] font-medium text-muted-foreground">
              {weekdayLabels().map((label) => <div className="truncate px-1.5 py-1" key={label}>{label}</div>)}
            </div>
            <div className="grid grid-cols-[repeat(7,minmax(0,1fr))] gap-0.5">
              {days.map((day) => {
                const active = day.date === selected
                const visible = day.items.slice(0, CELL_LINES)
                const overflow = day.load - visible.length
                return (
                  <button
                    aria-current={day.isToday ? "date" : undefined}
                    aria-label={`${day.date}, ${day.load} item${day.load === 1 ? "" : "s"}, ${formatMinutes(day.minutes)} of study`}
                    aria-pressed={active}
                    className={cn(
                      // Cells size to their content and floor at three lines: a month is mostly
                      // light days, and a fixed tall cell spent 300px of the page on nothing.
                      "flex min-w-0 flex-col gap-1 rounded-md border p-1 text-left transition-colors hover:bg-accent/60",
                      !day.inMonth && "opacity-40",
                      active && "border-primary bg-accent",
                      day.isToday && !active && "border-primary/40",
                    )}
                    key={day.date}
                    onClick={() => setSelected(day.date)}
                    type="button"
                  >
                    <span className="flex items-baseline justify-between gap-1">
                      <span className={cn("text-xs leading-none font-medium tabular-nums", day.isToday && "text-primary")}>{day.day}</span>
                      {day.minutes > 0 ? <span className="truncate text-[0.625rem] leading-none text-muted-foreground tabular-nums">{formatMinutes(day.minutes)}</span> : null}
                    </span>
                    {/* Below `sm` a cell is 54px wide, where a word like "Methods" is a smudge.
                        A phone gets the date, the minutes and the load bar; the detail is one
                        tap away in the day panel. */}
                    {visible.length ? (
                      <span className="hidden min-w-0 gap-px sm:grid">
                        {visible.map((item) => (
                          <span className="flex min-w-0 items-center gap-1 text-[0.625rem] leading-[0.875rem]" key={`${item.kind}-${item.id}`}>
                            <span aria-hidden className={cn("size-1 shrink-0 rounded-full", KIND_MARK[item.kind])} />
                            <span className={cn("min-w-0 truncate", isDayItemDone(item) && "text-muted-foreground line-through")}>{item.title}</span>
                          </span>
                        ))}
                        {overflow > 0 ? <span className="text-[0.625rem] leading-[0.875rem] text-muted-foreground tabular-nums">+{overflow} more</span> : null}
                      </span>
                    ) : null}
                    {/* An empty cell still says something: how heavy that day is against the
                        month. No track at all on a day with no study -- a grey rule on 35
                        blank cells reads as 35 pieces of content, not as 35 empty days. */}
                    {day.minutes > 0 ? (
                      <span aria-hidden className="mt-auto h-0.5 overflow-hidden rounded-full bg-muted">
                        <span className={cn("block h-full rounded-full", active ? "bg-primary" : "bg-chart-2/70")} style={{ width: `${day.loadBar}%` }} />
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

          {/* Part of the calendar, not a page section of its own, so it does not borrow the
              page's heading scale to describe six bars. */}
          <div aria-labelledby="calendar-month-title" className="grid gap-2 px-0.5">
            <p className="text-sm font-semibold" id="calendar-month-title">Study load in {monthLabel}</p>
            <MonthLoad days={days} />
          </div>

          <KindLegend />
        </div>

        <aside className="grid content-start gap-4">
          <Card size="sm">
            <CardHeader className="gap-1 pb-2">
              <CardTitle>{formatDayTitle(selected)}</CardTitle>
              <CardDescription>
                {plan.totalCount ? `${plan.completedCount} of ${plan.totalCount} done` : "Nothing planned"} · {formatMinutes(plan.plannedMinutes + plan.completedMinutes)} of study
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              <DaySection title="Planned" count={open.length}>
                {open.length ? (
                  <ul className="min-w-0 divide-y rounded-md border">
                    {open.map((item) => (
                      <DayItemRow
                        item={item}
                        key={`${item.kind}-${item.id}`}
                        onArchive={(id) => commit((current) => archiveTask(current, id))}
                        onMove={move}
                        onNavigate={onNavigate}
                        onStartFocus={onStartFocus}
                        onStatus={changeStatus}
                      />
                    ))}
                  </ul>
                ) : (
                  <Empty className="min-h-32 border">
                    <EmptyHeader>
                      <EmptyMedia variant="icon"><CalendarDays /></EmptyMedia>
                      <EmptyTitle>Nothing planned</EmptyTitle>
                      <EmptyDescription>Add a task below to plan this day.</EmptyDescription>
                    </EmptyHeader>
                  </Empty>
                )}
              </DaySection>
              {banked.length ? (
                <DaySection muted title="Completed" count={banked.length}>
                  <ul className="min-w-0 divide-y rounded-md border">
                    {banked.map((item) => (
                      <DayItemRow
                        item={item}
                        key={`${item.kind}-${item.id}`}
                        onArchive={(id) => commit((current) => archiveTask(current, id))}
                        onMove={move}
                        onNavigate={onNavigate}
                        onStartFocus={onStartFocus}
                        onStatus={changeStatus}
                      />
                    ))}
                  </ul>
                </DaySection>
              ) : null}

              {/* The form writes into the list directly above it, so it lives in the same card
                  rather than in a card of its own two scrolls away. */}
              <div className="grid gap-2 border-border border-t pt-3">
                <p className="text-xs font-semibold">Add a task</p>
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel className="sr-only" htmlFor="calendar-task">Task</FieldLabel>
                  <Input id="calendar-task" onChange={(event) => { setTitle(event.target.value); setError(null) }} placeholder={`Add a task to ${formatDayTitle(selected).split(" · ").at(-1)}`} value={title} />
                </Field>
                <div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2">
                  <Field>
                    <FieldLabel className="sr-only" htmlFor="calendar-subject">Subject</FieldLabel>
                    <Input id="calendar-subject" list="calendar-subjects" onChange={(event) => setSubject(event.target.value)} placeholder="Subject" value={subject} />
                    <datalist id="calendar-subjects">
                      {data.learning.tasks.map((task) => task.subject).filter((value): value is string => Boolean(value)).map((value) => <option key={value} value={value} />)}
                    </datalist>
                  </Field>
                  <Field>
                    <FieldLabel className="sr-only" htmlFor="calendar-minutes">Minutes</FieldLabel>
                    <Input id="calendar-minutes" min={5} max={360} onChange={(event) => setMinutes(event.target.valueAsNumber)} placeholder="Min" type="number" value={minutes} />
                  </Field>
                </div>
                <FieldError>{error}</FieldError>
                <Button className="w-full" onClick={add}><Plus />Add task</Button>
              </div>
            </CardContent>
          </Card>

          {overdue.length ? (
            <Card size="sm">
              <CardHeader className="gap-1 pb-2">
                <CardTitle>Carried over</CardTitle>
                <CardDescription>Planned for an earlier day and still open.</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="min-w-0 divide-y rounded-md border">
                  {overdue.map((task) => (
                    <li className="flex items-center gap-2 px-2 py-1.5" key={task.id}>
                      <span aria-hidden className={cn("size-1 shrink-0 rounded-full", KIND_MARK.task)} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{task.title}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{task.plannedFor} · {task.durationMinutes} min</p>
                      </div>
                      <Button onClick={() => move(task.id, selected)} size="sm" variant="outline">Move here</Button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          ) : null}
        </aside>
      </div>
    </WorkspacePage>
  )
}

/**
 * Four figures in one rule-bounded strip rather than four tall cards: the day panel is the
 * thing you read, and these are the numbers you check it against. Hairlines do the dividing
 * so the strip costs one row instead of a card row.
 */
function DayStats({ plan, progress, dueMistakes }: {
  plan: DayPlan
  progress: number
  dueMistakes: number
}) {
  const cells = [
    {
      label: "Planned",
      value: formatMinutes(plan.plannedMinutes),
      note: `${plan.plannedCount} item${plan.plannedCount === 1 ? "" : "s"} left`,
    },
    {
      label: "Completed",
      value: formatMinutes(plan.completedMinutes),
      note: plan.totalCount ? `${plan.completedCount} of ${plan.totalCount} done` : "Nothing logged yet",
      bar: <Progress className="mt-1 h-1" value={progress} />,
    },
    {
      label: "Study logged",
      value: formatMinutes(plan.plannedMinutes + plan.completedMinutes),
      note: `${plan.totalCount} of ${plan.totalCount} item${plan.totalCount === 1 ? "" : "s"} on the day`,
    },
    {
      label: "Due for review",
      value: dueMistakes,
      note: dueMistakes ? "Mistakes ready" : "Queue is clear",
    },
  ]
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-lg border sm:grid-cols-4">
      {cells.map((cell, index) => (
        // Hairlines only between cells: the container's own border is the outer edge, so a
        // hairline that repeated the grid would read as a heavier, second frame.
        <div
          className={cn(
            "min-w-0 p-3",
            index % 2 === 1 && "border-border border-l",
            index >= 2 && "border-border border-t sm:border-t-0",
            index === 2 && "sm:border-border sm:border-l",
          )}
          key={cell.label}
        >
          <dt className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">{cell.label}</dt>
          <dd className="mt-0.5 flex flex-col text-xl leading-none font-semibold tabular-nums">
            {cell.value}
            {cell.bar}
            <span className="mt-1 text-xs font-normal text-muted-foreground">{cell.note}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The grid's marks are its only colour, so they are named once, in one place, rather than
 *  left for the reader to infer from a row of dots. */
function KindLegend() {
  return (
    <ul className="flex flex-wrap gap-x-3 gap-y-1 px-0.5 text-xs text-muted-foreground" role="list">
      {(Object.keys(KIND_MARK) as DayItem["kind"][]).map((kind) => (
        <li className="flex items-center gap-1.5" key={kind}>
          <span aria-hidden className={cn("size-1.5 rounded-full", KIND_MARK[kind])} />
          {KIND_LABEL[kind]}
        </li>
      ))}
    </ul>
  )
}

function DaySection({ title, count, muted, children }: { title: string; count: number; muted?: boolean; children: ReactNode }) {
  if (count === 0) return null
  return (
    <section aria-label={title} className={cn("grid min-w-0 gap-1.5", muted && "opacity-85")}>
      <p className="flex items-baseline gap-2 text-xs font-semibold">
        {title}
        <span className="font-normal text-muted-foreground tabular-nums">{count} {count === 1 ? "item" : "items"}</span>
      </p>
      {children}
    </section>
  )
}

/**
 * One list row, not one card per item. A day with six pieces of work used to spend six
 * borders and six padding boxes saying "these are separate", which is what `divide-y` and a
 * kind mark say in the space of one hairline.
 *
 * ponytail: the row is one line wide, so only the two things you do while scanning stay on
 * it (start, finish) and the rare ones -- reschedule, archive, skip -- hide behind "more".
 * Upgrade path if it is still tight at 2xl: a right-hand actions column on `xl` and up.
 */
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
  const [more, setMore] = useState(false)
  const done = isDayItemDone(item)
  const isTask = item.kind === "task"
  const meta = [
    item.kind === "task" ? item.subject : item.detail,
    item.minutes ? `${item.minutes} min` : undefined,
    "startTime" in item ? item.startTime : undefined,
  ].filter(Boolean).join(" · ")

  return (
    <li className="px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", KIND_MARK[item.kind])} />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", done && "text-muted-foreground line-through")}>{item.title}</p>
          {meta ? <p className="truncate text-xs text-muted-foreground">{meta}</p> : null}
        </div>
          {item.kind === "session" ? (
            <Badge className="shrink-0" variant="outline">
              {item.status === "completed" ? "Studied" : item.status === "in-progress" ? "Studying" : "Planned"}
            </Badge>
          ) : item.kind === "task" ? (
            done ? (
              <Badge className="shrink-0" variant="secondary">Done</Badge>
            ) : item.status === "skipped" ? (
              <Badge className="shrink-0" variant="outline">Skipped</Badge>
            ) : null
          ) : item.kind === "mistakes" ? null : (
            // No badge on the review row: its title already says what it is, and a "Review"
            // badge beside a "Review" button read as two different controls.
            <Badge className="shrink-0" variant="outline">{KIND_LABEL[item.kind]}</Badge>
          )}
        <span className="flex shrink-0 items-center gap-0.5">
          {isTask ? (
            item.status === "planned" ? (
              <>
                <Button onClick={() => onStartFocus(item.subject, item.title)} size="sm" variant="outline"><Timer />Focus</Button>
                <Button aria-label={`Mark ${item.title} done`} onClick={() => onStatus(item.id, "completed")} size="icon-sm" variant="ghost"><Check /></Button>
              </>
            ) : (
              <Button aria-label={`Reopen ${item.title}`} onClick={() => onStatus(item.id, "planned")} size="icon-sm" variant="ghost"><RotateCcw /></Button>
            )
          ) : item.kind === "mistakes" ? (
            <Button onClick={() => onNavigate("mistakes")} size="sm" variant="ghost">Review</Button>
          ) : item.kind === "sac" ? (
            <Button onClick={() => onNavigate("sacs")} size="sm" variant="ghost">Open</Button>
          ) : null}
          {isTask ? (
            <Button
              aria-expanded={more}
              aria-label={`More actions for ${item.title}`}
              onClick={() => setMore((open) => !open)}
              size="icon-sm"
              variant="ghost"
            >
              <MoreHorizontal />
            </Button>
          ) : null}
        </span>
      </div>
      {more ? (
        <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-3.5">
          {isTask && item.status === "planned" ? (
            <Button aria-label={`Skip ${item.title}`} onClick={() => onStatus(item.id, "skipped")} size="sm" variant="outline"><SkipForward />Skip</Button>
          ) : null}          <Input
            aria-label={`Move ${item.title} to another day`}
            className="h-7 w-32 px-1.5 text-xs"
            onChange={(event) => onMove(item.id, event.target.value)}
            type="date"
          />
          <Button onClick={() => onArchive(item.id)} size="sm" variant="outline"><Archive />Archive</Button>
        </div>
      ) : null}
    </li>
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

  // Two weeks per column: six bars stacked full width is six rows of scrolling to read a
  // shape that is already obvious. Two columns put the whole month above the fold.
  return (
    <div className="grid gap-x-6 gap-y-1.5 sm:grid-cols-2 xl:grid-cols-3">
      {week.map((row) => (
        <div className="flex items-center gap-2" key={row.label}>
          <span className="w-12 shrink-0 text-xs text-muted-foreground">Week {row.label.at(-1)}</span>
          <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-chart-2/70" style={{ width: `${row.width}%` }} />
          </div>
          <span className="w-14 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{formatMinutes(row.minutes)}</span>
        </div>
      ))}
    </div>
  )
}
