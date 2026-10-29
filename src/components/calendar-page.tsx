import { useMemo, useState, type ReactNode } from "react"
import { Archive, CalendarDays, ClipboardPaste, Check, ChevronLeft, ChevronRight, MoreHorizontal, Play, Plus, RotateCcw, SkipForward, Timer } from "lucide-react"
import { toast } from "sonner"
import { useTickingNow } from "../hooks/use-ticking-now"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Input } from "./ui/input"
import { Progress } from "./ui/progress"
import { CalendarChatbotImportDialog } from "./calendar-chatbot-import"
import { StudySessionDialog } from "./study-session-dialog"
import { EventDialog } from "./event-dialog"
import { StudyTimeline } from "./study-timeline"
import { WorkspacePage, WorkspaceSplit } from "./workspace-layout"
import {
  archiveTask,
  buildCalendarMonth,
  buildDayPlan,
  isDayItemDone,
  moveTask,
  overdueTasks,
  setTaskStatus,
  shiftMonth,
  weekdayLabels,
  type CalendarDay,
  type DayItem,
  type DayPlanSource,
} from "../lib/day-plan"
import { classPeriodsOn, getTimetablePeriodError, periodSubjectName, subjectIdFor } from "../lib/class-timetable"
import { localDate, type LearningWorkspace, type LearningWorkspaceUpdate } from "../lib/learning-workspace"
import type { Timetable } from "../lib/timetable"
import { cn } from "../lib/utils"
import type { CalendarEvent, TimetableConfig, TimetablePeriod } from "../lib/types"
import type { TextEventDraft } from "../lib/calendarImport"
import { isPaused, isRunning, type StudySessionEdit, type SubjectSwitch, type CanonicalStudySession } from "../lib/sync/sessionContract"
import type { PastStudyLog } from "../lib/pastStudy"

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
  minutes = Math.round(minutes)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}

/** One solid mark per kind: at cell size a pale dot is a smudge, not a legend. */
const KIND_MARK: Record<DayItem["kind"], string> = {
  task: "bg-chart-2",
  event: "bg-chart-5",
  sac: "bg-chart-4",
  exam: "bg-destructive",
  session: "bg-chart-1",
  "logged-exam": "bg-muted-foreground",
  mistakes: "bg-chart-3",
}

const KIND_LABEL: Record<DayItem["kind"], string> = {
  task: "Task",
  event: "Event",
  sac: "SAC",
  exam: "Exam",
  session: "Study session",
  "logged-exam": "Logged exam",
  mistakes: "Review",
}

/** The three open lines a day cell can afford before it starts lying about what is there. */
const CELL_LINES = 3

/** Seven days plus the week's total; a phone drops the total and keeps the days. */
const WEEK_GRID = "grid grid-cols-7 sm:grid-cols-[repeat(7,minmax(0,1fr))_4.5rem]"

function shiftDay(date: string, amount: number) {
  const [year, month, day] = date.split("-").map(Number)
  return localDate(new Date(year, month - 1, day + amount))
}

export function CalendarPage({
  data,
  sessions,
  onChange,
  onNavigate,
  onStartFocus,
  timetable,
  subjects,
  classTimetable,
  onClassTimetableChange,
  onEventsChange,
  onOpenTimetable,
  onPlanSessions,
  onLogStudy,
  onRemoveSession,
  onEditSession,
  onMergeSessions,
  onConvertSession,
}: {
  data: DayPlanSource
  /** The shared study sessions, so the web calendar lists the same sittings the desktop does. */
  sessions: CanonicalStudySession[]
  onChange: (update: LearningWorkspaceUpdate) => void
  onNavigate: (view: "mistakes" | "sacs" | "focus") => void
  onStartFocus: (subject: string | undefined, intent: string, sessionId?: string) => void
  timetable: Timetable | null
  subjects: string[]
  classTimetable?: TimetableConfig
  onClassTimetableChange: (config: TimetableConfig) => void
  onEventsChange: (update: (events: CalendarEvent[]) => CalendarEvent[]) => void
  onOpenTimetable: () => void
  onPlanSessions: (entries: Array<{ title: string; subjectId?: string; subjectSwitches?: SubjectSwitch[]; start: string; end: string; description?: string; topics?: string[]; blocks?: { start: string; end: string }[] }>) => Promise<number>
  onLogStudy: (entry: PastStudyLog) => Promise<void>
  onRemoveSession: (session: CanonicalStudySession) => Promise<void>
  onConvertSession: (session: CanonicalStudySession, events: CalendarEvent[]) => Promise<void>
  onEditSession: (session: CanonicalStudySession, patch: StudySessionEdit) => Promise<void>
  onMergeSessions: (sessions: CanonicalStudySession[]) => Promise<void>
}) {
  const [month, setMonth] = useState(() => new Date())
  const [selected, setSelected] = useState(today)
  const [importOpen, setImportOpen] = useState(false)
  const [eventDialog, setEventDialog] = useState<{ event: CalendarEvent | null; key: number } | null>(null)
  const [editingSession, setEditingSession] = useState<CanonicalStudySession | null>(null)
  const now = useTickingNow(30_000)

  const source = useMemo(() => ({ ...data, sessions }), [data, sessions])
  const days = useMemo(() => buildCalendarMonth(month, source, timetable, now), [month, source, timetable, now])
  const plan = useMemo(() => buildDayPlan(selected, source, timetable, now.getTime()), [selected, source, timetable, now])
  const overdue = useMemo(
    () => (selected >= today() ? overdueTasks(data.learning.tasks, today()) : []),
    [data.learning.tasks, selected],
  )
  const monthLabel = month.toLocaleDateString("en-AU", { month: "long", year: "numeric" })
  const completion = plan.totalCount ? plan.completedCount / plan.totalCount * 100 : 0
  const open = plan.items.filter((item) => !isDayItemDone(item))
  const banked = plan.items.filter(isDayItemDone)
  // A trailing week wholly in the next month is padding, not part of this month.
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, index) => days.slice(index * 7, index * 7 + 7))
    .filter((week) => week.some((day) => day.inMonth))
    .map((week) => ({ days: week, minutes: week.reduce((total, day) => total + day.minutes, 0) })), [days])
  const weekPeak = Math.max(1, ...weeks.map((week) => week.minutes))
  const summary = useMemo(() => {
    const inMonth = days.filter((day) => day.inMonth)
    return {
      minutes: inMonth.reduce((total, day) => total + day.minutes, 0),
      studyDays: inMonth.filter((day) => day.minutes > 0).length,
      assessments: inMonth.flatMap((day) => day.items).filter((item) => item.kind === "sac" || item.kind === "exam").length,
    }
  }, [days])

  function commit(update: (current: LearningWorkspace) => LearningWorkspace) {
    onChange((current) => ({ ...update(current), updatedAt: new Date().toISOString() }))
  }

  function selectDay(date: string) {
    setSelected(date)
    const [year, month] = date.split("-").map(Number)
    setMonth(new Date(year, month - 1, 1))
  }

  function editSession(id: string) {
    const session = sessions.find((item) => item.id === id)
    if (!session || isRunning(session) || isPaused(session)) return
    setEditingSession(session)
  }

  async function setSessionDone(id: string, completed: boolean) {
    const session = sessions.find((item) => item.id === id)
    if (!session) return
    try {
      await onEditSession(session, { completed })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update that study.")
    }
  }

  function changeStatus(id: string, status: "completed" | "skipped" | "planned") {
    commit((current) => setTaskStatus(current, id, status))
  }

  function move(id: string, date: string) {
    if (!date) return
    commit((current) => moveTask(current, id, date))
    selectDay(date)
  }

  async function importDrafts(drafts: TextEventDraft[]) {
    const now = new Date().toISOString()
    const toEvent = (draft: TextEventDraft): CalendarEvent => {
      const start = new Date(`${draft.date}T${draft.startTime}:00`)
      const end = draft.endDate ? new Date(`${draft.endDate}T${draft.startTime}:00`) : new Date(start.getTime() + draft.durationMinutes * 60_000)
      const subject = draft.subjectIds[0]
      return {
        id: crypto.randomUUID(), title: draft.title, description: draft.description,
        startTime: start.toISOString(), endTime: end.toISOString(), eventType: draft.eventType,
        subjectId: subject ? subjectIdFor(subject) : undefined, location: draft.location,
        isFinished: false, created_at: now, updated_at: now,
      }
    }
    const sessions = drafts.filter((draft) => draft.kind === "session")
    const events = drafts.filter((draft) => draft.kind === "event").map(toEvent)
    if (sessions.length) {
      const entries = sessions.map((draft) => {
        const event = toEvent(draft)
        return { title: draft.title, subjectId: event.subjectId, start: event.startTime, end: event.endTime!, description: draft.description, topics: draft.topics }
      })
      await onPlanSessions(entries)
    }
    if (events.length) onEventsChange((current) => [...current, ...events])
    if (drafts[0]) selectDay(drafts[0].date)
  }

  function saveEvents(saved: CalendarEvent[], isNew: boolean) {
    onEventsChange((current) => isNew ? [...current, ...saved] : current.map((item) => saved.find((event) => event.id === item.id) ?? item))
    selectDay(localDate(new Date(saved[0].startTime)))
    setEventDialog(null)
    toast(isNew ? (saved.length === 1 ? "Event added" : `${saved.length} events added`) : "Event updated")
  }

  function deleteEvent(id: string) {
    const removed = data.events?.find((item) => item.id === id)
    onEventsChange((current) => current.filter((item) => item.id !== id))
    setEventDialog(null)
    toast("Event deleted", removed ? { action: { label: "Undo", onClick: () => onEventsChange((current) => [...current, removed]) } } : undefined)
  }

  const classes = useMemo(() => classPeriodsOn(selected, classTimetable), [selected, classTimetable])

  function editClass(period: TimetablePeriod, patch: { startTime: string; endTime: string }) {
    if (!classTimetable) throw new Error("The class timetable is unavailable.")
    const invalid = getTimetablePeriodError({ ...period, ...patch })
    if (invalid) throw new Error(invalid)
    onClassTimetableChange({ ...classTimetable, entries: classTimetable.entries.map((entry) => ({
      ...entry, periods: entry.periods.map((item) => item === period ? { ...item, ...patch } : item),
    })) })
  }

  const rowActions = {
    onArchive: (id: string) => commit((current) => archiveTask(current, id)),
    onEditEvent: (id: string) => setEventDialog({ event: data.events?.find((item) => item.id === id) ?? null, key: Date.now() }),
    onMove: move,
    onNavigate,
    onStartFocus,
    onEditSession: editSession,
    onSessionDone: setSessionDone,
    onStatus: changeStatus,
  }

  return (
    <WorkspacePage className="gap-5 lg:gap-6">
      {/* The month is the page title: one header carries where you are, how to move, and what
          you can add, so the grid starts above the fold instead of under a slogan and a strip
          of figures that repeated the day panel. */}
      <header className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase max-lg:hidden">Calendar</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="focal-page-title">{monthLabel}</h1>
            <div className="flex items-center gap-0.5">
              <Button aria-label="Previous month" onClick={() => selectDay(localDate(shiftMonth(month, -1)))} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
              <Button aria-label="Next month" onClick={() => selectDay(localDate(shiftMonth(month, 1)))} size="icon-sm" variant="ghost"><ChevronRight /></Button>
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground tabular-nums">
            {summary.minutes ? `${formatMinutes(summary.minutes)} of study across ${summary.studyDays} day${summary.studyDays === 1 ? "" : "s"}` : "No study planned this month"}
            {summary.assessments ? ` · ${summary.assessments} assessment${summary.assessments === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div data-tour="page-actions" className="flex flex-wrap items-center gap-2 [&>*]:max-sm:flex-1">
          <Button onClick={() => selectDay(today())} variant="outline"><RotateCcw />Today</Button>
          <Button onClick={() => setImportOpen(true)} variant="outline"><ClipboardPaste />Import</Button>
          <Button onClick={() => setEventDialog({ event: null, key: Date.now() })}><Plus />Add event</Button>
        </div>
        <CalendarChatbotImportDialog open={importOpen} subjects={subjects} onOpenChange={setImportOpen} onImport={importDrafts} />
      </header>

      {eventDialog ? (
        <EventDialog
          key={eventDialog.key}
          open
          event={eventDialog.event}
          defaultDate={selected}
          subjects={subjects}
          classTimetable={classTimetable}
          onOpenChange={(open) => { if (!open) setEventDialog(null) }}
          onSave={saveEvents}
          onDelete={deleteEvent}
        />
      ) : null}

      {editingSession ? <StudySessionDialog
        key={editingSession.id}
        session={sessions.find((item) => item.id === editingSession.id) ?? editingSession}
        subjects={subjects}
        onClose={() => setEditingSession(null)}
        onContinue={(session) => { setEditingSession(null); onStartFocus(session.subject_id ?? undefined, session.title, session.id) }}
        onEdit={async (session, patch) => {
          await onEditSession(session, patch)
          if (patch.blocks?.length) selectDay(localDate(new Date(patch.blocks[0].start)))
        }}
        onRemove={onRemoveSession}
        onConvert={async (session, events) => {
          await onConvertSession(session, events)
          selectDay(localDate(new Date(events[0].startTime)))
        }}
        onDuplicate={async (patch) => {
          const nested = patch.metadata?.legacy_metadata
          const metadata = nested && typeof nested === "object" ? nested as Record<string, unknown> : patch.metadata
          await onPlanSessions([{ title: patch.title!, subjectId: patch.subject_id ?? undefined,
            subjectSwitches: Array.isArray(patch.metadata?.subjectSwitches) ? patch.metadata.subjectSwitches as SubjectSwitch[] : undefined,
            start: patch.blocks![0].start, end: patch.blocks!.at(-1)!.end, blocks: patch.blocks,
            description: typeof metadata?.description === "string" ? metadata.description : undefined,
            topics: Array.isArray(metadata?.topics) ? metadata.topics.filter((topic): topic is string => typeof topic === "string") : undefined }])
          selectDay(localDate(new Date(patch.blocks![0].start)))
        }}
      /> : null}

      <WorkspaceSplit id="calendar" primary={
        <section aria-label={monthLabel} className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
          <div className={cn(WEEK_GRID, "border-b border-border bg-muted/40 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase")}>
            {weekdayLabels().map((label) => <div className="truncate px-2 py-2" key={label}>{label}</div>)}
            <div className="hidden px-2 py-2 text-right sm:block">Week</div>
          </div>
          <div key={monthLabel}>
          {weeks.map((week) => (
            <div className={cn(WEEK_GRID, "border-b border-border")} key={week.days[0].date}>
              {week.days.map((day, index) => (
                <DayCell
                  active={day.date === selected}
                  day={day}
                  key={day.date}
                  onSelect={selectDay}
                  weekend={index >= 5}
                />
              ))}
              {/* The week's total sits where the eye lands at the end of the row, which is what
                  the separate six-bar chart under the grid used to make you scroll for. */}
              <div className="hidden flex-col items-end gap-1.5 border-l border-border px-2 py-2.5 sm:flex">
                <span className={cn("text-xs tabular-nums", week.minutes ? "font-medium" : "text-muted-foreground")}>{week.minutes ? formatMinutes(week.minutes) : "–"}</span>
                {week.minutes ? (
                  <span aria-hidden className="h-1 w-full overflow-hidden rounded-full bg-muted">
                    <span className="block h-full origin-left rounded-full bg-primary/60 transition-transform duration-300 ease-[var(--ease-spring)]" style={{ transform: `scaleX(${week.minutes / weekPeak})` }} />
                  </span>
                ) : null}
              </div>
            </div>
          ))}
          </div>
          <KindLegend />
        </section>
        } secondary={
        <aside className="calendar-day-pane min-w-0">
          <Card size="sm" className="data-[size=sm]:[--card-spacing:--spacing(3)] calendar-day-card">
            <CardHeader className="shrink-0 gap-2 pb-1">
              <div className="flex items-start justify-between gap-2">
                <CardTitle className="text-xl">{formatDayTitle(selected)}</CardTitle>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button aria-label="Previous day" onClick={() => selectDay(shiftDay(selected, -1))} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
                  <Button aria-label="Next day" onClick={() => selectDay(shiftDay(selected, 1))} size="icon-sm" variant="ghost"><ChevronRight /></Button>
                </div>
              </div>
              <CardDescription className="tabular-nums">
                {plan.totalCount ? `${plan.completedCount} of ${plan.totalCount} done` : "Nothing planned"}
                {plan.plannedMinutes ? ` · ${formatMinutes(plan.plannedMinutes)} to go` : ""}
                {plan.completedMinutes ? ` · ${formatMinutes(plan.completedMinutes)} banked` : ""}
              </CardDescription>
              {plan.totalCount ? <Progress aria-label="Day completed" className="h-1" value={completion} /> : null}
              {plan.dueMistakes ? (
                <Button variant="ghost" size="xs" className="w-fit px-0 text-muted-foreground hover:bg-transparent" onClick={() => onNavigate("mistakes")}>
                  <span aria-hidden className={cn("size-1.5 rounded-full", KIND_MARK.mistakes)} />
                  {plan.dueMistakes} mistake{plan.dueMistakes === 1 ? "" : "s"} due for review
                </Button>
              ) : null}
            </CardHeader>
            <CardContent className="grid shrink-0 gap-3" key={selected}>
              {classes.length ? (
                <DaySection title="Classes" count={classes.length}>
                  <ul className="min-w-0 divide-y rounded-md border">
                    {classes.map((period, index) => (
                      <li className="flex items-center gap-2 px-2 py-1.5" key={`${period.period}-${index}`}>
                        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-muted-foreground/60" />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{period.subject ? periodSubjectName(period) : period.period}</p>
                          <p className="truncate text-xs text-muted-foreground tabular-nums">{period.period} · {period.startTime}–{period.endTime}{period.location ? ` · ${period.location}` : ""}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </DaySection>
              ) : classTimetable ? null : (
                <p className="text-xs text-muted-foreground">
                  <Button variant="link" className="h-auto p-0 text-inherit underline" onClick={onOpenTimetable}>Set up your class timetable</Button> to see classes here and align events to class times.
                </p>
              )}
              {open.length ? (
                <DaySection title="To do" count={open.length}>
                  <ul className="min-w-0 divide-y rounded-md border">
                    {open.map((item) => <DayItemRow item={item} key={`${item.kind}-${item.id}`} {...rowActions} />)}
                  </ul>
                </DaySection>
              ) : (
                <Empty className="min-h-28 border">
                  <EmptyHeader>
                    <EmptyMedia variant="icon"><CalendarDays /></EmptyMedia>
                    <EmptyTitle>{banked.length ? "All done" : "Nothing planned"}</EmptyTitle>
                    <EmptyDescription>{banked.length ? "Everything on this day is finished." : "Add an event or plan study in the timeline below."}</EmptyDescription>
                  </EmptyHeader>
                </Empty>
              )}
              {overdue.length ? (
                <DaySection title="Carried over" count={overdue.length}>
                  <ul className="min-w-0 divide-y rounded-md border">
                    {overdue.map((task) => (
                      <li className="flex items-center gap-2 px-2 py-1.5" key={task.id}>
                        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", KIND_MARK.task)} />
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{task.title}</p>
                          <p className="text-xs text-muted-foreground tabular-nums">{task.plannedFor} · {task.durationMinutes} min</p>
                        </div>
                        <Button onClick={() => move(task.id, selected)} size="sm" variant="outline">Move here</Button>
                      </li>
                    ))}
                  </ul>
                </DaySection>
              ) : null}
              {banked.length ? (
                <DaySection muted title="Done" count={banked.length}>
                  <ul className="min-w-0 divide-y rounded-md border">
                    {banked.map((item) => <DayItemRow item={item} key={`${item.kind}-${item.id}`} {...rowActions} />)}
                  </ul>
                </DaySection>
              ) : null}
            </CardContent>
          </Card>
        </aside>
      } />

      <StudyTimeline
        key={selected}
        classes={classes}
        date={selected}
        nowMs={now.getTime()}
        events={data.events ?? []}
        onDateChange={selectDay}
        onLog={onLogStudy}
        onPlan={(entry) => onPlanSessions([entry]).then(() => undefined)}
        onRemove={onRemoveSession}
        onEdit={onEditSession}
        onEditEvent={(event, patch) => onEventsChange((current) => current.map((item) => item.id === event.id ? { ...item, ...patch, updated_at: new Date().toISOString() } : item))}
        onEditClass={editClass}
        onOpenEvent={(event) => setEventDialog({ event, key: Date.now() })}
        onOpenClass={onOpenTimetable}
        onMerge={onMergeSessions}
        onOpenSession={(session) => editSession(session.id)}
        onStartFocus={onStartFocus}
        sessions={sessions}
        subjects={subjects}
      />
    </WorkspacePage>
  )
}

/** Assessments lead a cell: they are the fixed points the rest of the week is planned around. */
const CELL_ORDER: Record<DayItem["kind"], number> = { exam: 0, sac: 0, event: 1, session: 2, task: 2, mistakes: 3, "logged-exam": 4 }

/**
 * A cell lists what is still open and folds what is finished into one count. A past week
 * used to be a column of struck-through titles: every line spent saying "this is over".
 */
function DayCell({ day, active, weekend, onSelect }: {
  day: CalendarDay
  active: boolean
  weekend: boolean
  onSelect: (date: string) => void
}) {
  const open = day.items.filter((item) => !isDayItemDone(item)).sort((a, b) => CELL_ORDER[a.kind] - CELL_ORDER[b.kind])
  const done = day.items.length - open.length
  const visible = open.slice(0, CELL_LINES)
  const overflow = open.length - visible.length
  return (
    <Button
      variant="ghost"
      aria-current={day.isToday ? "date" : undefined}
      aria-label={`${day.date}, ${open.length} open, ${done} done, ${formatMinutes(day.minutes)} of study`}
      aria-pressed={active}
      data-calendar-date={day.date}
      onKeyDown={(event) => {
        const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key]
        if (!offset) return
        event.preventDefault()
        const next = shiftDay(day.date, offset)
        onSelect(next)
        requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-calendar-date="${next}"]`)?.focus())
      }}
      className={cn(
        "relative h-auto min-h-18 min-w-0 flex-col items-stretch justify-start gap-1 rounded-none border-0 border-l border-border p-1 text-left font-normal whitespace-normal transition-[background-color,box-shadow] duration-300 ease-[var(--ease-spring)] first:border-l-0 hover:bg-accent/50 focus-visible:z-10 focus-visible:ring-inset sm:min-h-32 sm:p-1",
        weekend && "bg-muted/25",
        !day.inMonth && "bg-muted/50 text-muted-foreground",
        active && "z-10 bg-primary/[0.06] ring-2 ring-primary ring-inset hover:bg-primary/[0.09]",
      )}
      onClick={() => onSelect(day.date)}
    >
      <span className="flex shrink-0 items-center justify-between gap-1 pl-0.5">
        <span className={cn(
          "grid size-6 place-items-center rounded-full text-xs font-medium tabular-nums",
          day.isToday && "bg-primary text-primary-foreground",
          !day.inMonth && !day.isToday && "opacity-60",
        )}>{day.day}</span>
        {day.minutes > 0 ? <span className="hidden truncate pr-0.5 text-[0.6875rem] text-muted-foreground tabular-nums sm:inline">{formatMinutes(day.minutes)}</span> : null}
      </span>

      {/* A phone cell is ~50px wide: titles there are smudges, so it gets one dot per piece of
          open work and the day panel carries the words. */}
      {open.length ? (
        <span aria-hidden className="flex flex-wrap gap-0.5 px-1 sm:hidden">
          {open.slice(0, 4).map((item) => <span className={cn("size-1.5 rounded-full", KIND_MARK[item.kind])} key={`${item.kind}-${item.id}`} />)}
        </span>
      ) : null}

      <span className="hidden min-w-0 flex-col gap-0.5 sm:flex">
        {visible.map((item) => {
          const fixed = item.kind === "exam" || item.kind === "sac"
          return (
            <span
              className={cn(
                "flex min-w-0 items-center gap-1.5 rounded-xs px-1 py-0.5 text-[0.6875rem] leading-tight",
                fixed ? "bg-destructive/10 font-medium" : item.kind === "event" ? "bg-chart-5/10" : "",
                !day.inMonth && "opacity-70",
              )}
              key={`${item.kind}-${item.id}`}
            >
              <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", KIND_MARK[item.kind])} />
              <span className="min-w-0 truncate">{item.title}</span>
            </span>
          )
        })}
        {overflow > 0 || done > 0 ? (
          <span className="flex flex-wrap items-center gap-x-2 px-1 pt-0.5 text-[0.6875rem] leading-tight whitespace-nowrap text-muted-foreground tabular-nums">
            {overflow > 0 ? <span>+{overflow} more</span> : null}
            {done > 0 ? <span className="flex items-center gap-0.5"><Check aria-hidden className="size-3" />{done} done</span> : null}
          </span>
        ) : null}
      </span>
    </Button>
  )
}

/** The grid's marks are its only colour, so they are named once, in the grid's own footer. */
function KindLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground" role="list">
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
  onEditEvent,
  onEditSession,
  onMove,
  onNavigate,
  onSessionDone,
  onStartFocus,
  onStatus,
}: {
  item: DayItem
  onArchive: (id: string) => void
  onEditSession: (id: string) => void
  onEditEvent: (id: string) => void
  onMove: (id: string, date: string) => void
  onNavigate: (view: "mistakes" | "sacs" | "focus") => void
  onSessionDone: (id: string, completed: boolean) => void
  onStartFocus: (subject: string | undefined, intent: string, sessionId?: string) => void
  onStatus: (id: string, status: "completed" | "skipped" | "planned") => void
}) {
  const [more, setMore] = useState(false)
  const done = isDayItemDone(item)
  const isTask = item.kind === "task"
  const meta = [
    item.kind === "task" ? item.subject : item.detail,
    item.minutes ? `${Math.round(item.minutes)} min` : undefined,
    "startTime" in item ? item.startTime : undefined,
  ].filter(Boolean).join(" · ")

  return (
    <li className="animate-in px-2 py-1.5 duration-400 ease-[var(--ease-spring)] fade-in-0">
      <div className="flex items-center gap-2">
        <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", KIND_MARK[item.kind])} />
        <div className="min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", done && "text-muted-foreground")}>{item.title}</p>
          {meta ? <p className="truncate text-xs text-muted-foreground">{meta}</p> : null}
        </div>
          {item.kind === "session" ? (
            item.live ? <Badge className="shrink-0" variant="outline">{item.paused ? "Paused" : "Studying"}</Badge>
              : done ? <Badge className="shrink-0" variant="secondary">Done</Badge> : null
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
          {item.kind === "session" && (!done || item.live) ? <Button onClick={() => onStartFocus(undefined, item.title, item.id)} size="sm" variant="outline"><Timer />{item.live ? "Open timer" : "Start"}</Button> : null}
          {item.kind === "session" && done && !item.live && item.continuable ? <Button onClick={() => onStartFocus(undefined, item.title, item.id)} size="sm" title="Keep going in this session; its time so far is kept" variant="outline"><Play />Continue</Button> : null}
          {item.kind === "session" && !item.live ? <Button onClick={() => onEditSession(item.id)} size="sm" variant="ghost">Edit</Button> : null}
          {isTask ? (
            item.status === "planned" ? (
              <>
                <Button onClick={() => onStartFocus(item.subject, item.title)} size="sm" variant="outline"><Timer />Focus</Button>
                <Button aria-label={`Mark ${item.title} done`} onClick={() => onStatus(item.id, "completed")} size="icon-sm" variant="ghost"><Check /></Button>
              </>
            ) : (
              <Button aria-label={`Reopen ${item.title}`} onClick={() => onStatus(item.id, "planned")} size="icon-sm" variant="ghost"><RotateCcw /></Button>
            )
          ) : item.kind === "session" ? (
            item.live ? null : done
              ? <Button aria-label={`Mark ${item.title} not done`} onClick={() => onSessionDone(item.id, false)} size="icon-sm" variant="ghost"><RotateCcw /></Button>
              : <Button aria-label={`Mark ${item.title} done`} onClick={() => onSessionDone(item.id, true)} size="icon-sm" variant="ghost"><Check /></Button>
          ) : item.kind === "mistakes" ? (
            <Button onClick={() => onNavigate("mistakes")} size="sm" variant="ghost">Review</Button>
          ) : item.kind === "sac" ? (
            <Button onClick={() => onNavigate("sacs")} size="sm" variant="ghost">Open</Button>
          ) : item.kind === "event" ? (
            <Button onClick={() => onEditEvent(item.id)} size="sm" variant="ghost">Edit</Button>
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
        <div className="mt-1 flex animate-in flex-wrap items-center gap-1.5 pl-3.5 duration-400 ease-[var(--ease-spring)] fade-in-0 slide-in-from-top-2">
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
