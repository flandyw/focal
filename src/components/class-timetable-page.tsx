import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { subjectColor } from "../lib/studySubjects"
import { ArrowRight, CalendarClock, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardCopy, ClipboardPaste, Plus, RotateCcw, Settings2, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { useTickingNow } from "../hooks/use-ticking-now"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Progress } from "./ui/progress"
import { Textarea } from "./ui/textarea"
import { DiscardChangesDialog } from "./discard-changes-dialog"
import { WorkspacePage, WorkspaceSplit } from "./workspace-layout"
import {
  TIMETABLE_SCREENSHOT_PROMPT,
  defaultClassTimetable,
  getDayLabelForDate,
  getTimetablePeriodError,
  isTimetableBreakLabel,
  parseTimetableImport,
  periodSubjectName,
} from "../lib/class-timetable"
import { localDate } from "../lib/learning-workspace"
import { swipe } from "../lib/mobile"
import { cn } from "../lib/utils"
import type { SchoolHoliday, TimetableConfig, TimetablePeriod } from "../lib/types"
import { Checkbox } from "./ui/checkbox"
import { Label } from "./ui/label"

const byStart = (a: TimetablePeriod, b: TimetablePeriod) => a.startTime.localeCompare(b.startTime)
const dayPeriods = (config: TimetableConfig, day: number) => config.entries.filter((entry) => entry.dayLabel === day).flatMap((entry) => entry.periods).toSorted(byStart)
const minutes = (time: string) => { const [hours, mins] = time.split(":").map(Number); return hours * 60 + mins }
const timeLabel = (time: string) => new Date(2000, 0, 1, ...time.split(":").map(Number)).toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })
const dateLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
const isBreak = (period: TimetablePeriod) => isTimetableBreakLabel(period.subject) || isTimetableBreakLabel(period.period)
const periodTint = (period: TimetablePeriod) => isBreak(period) ? { className: "tt-break" } : { className: "tt-block", style: { "--tt-color": subjectColor(periodSubjectName(period)) ?? "var(--primary)" } as CSSProperties }
const classCount = (value: number) => `${value} ${value === 1 ? "class" : "classes"}`
const hourLabel = (hour: number) => new Date(2000, 0, 1, Math.floor(hour / 60) % 24).toLocaleTimeString("en-AU", { hour: "numeric" })

function withDay(config: TimetableConfig, dayLabel: number, periods: TimetablePeriod[]): TimetableConfig {
  const others = config.entries.filter((entry) => entry.dayLabel !== dayLabel)
  const entries = periods.length ? [...others, { dayLabel, periods: periods.toSorted(byStart) }] : others
  return { ...config, entries: entries.toSorted((a, b) => a.dayLabel - b.dayLabel) }
}

/** The next calendar date each cycle day falls on, so "Day 7" reads as a real day. */
function nextDates(config: TimetableConfig, from: string) {
  const [year, month, day] = from.split("-").map(Number)
  const found = new Map<number, string>()
  // ponytail: looks 120 days ahead; a cycle day behind a longer holiday shows no date. Widen the window if that matters.
  for (let i = 0; i < 120 && found.size < (config.cycleLength ?? 10); i++) {
    const date = new Date(year, month - 1, day + i)
    const label = getDayLabelForDate(date, config.day1Starts, config.holidays, config.cycleLength, config.weekendTimetables)
    if (label && !found.has(label)) found.set(label, i === 0 ? "Today" : i === 1 ? "Tomorrow" : date.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }))
  }
  return found
}

type PeriodEditor = { day: number; original?: TimetablePeriod; draft: TimetablePeriod }

export function ClassTimetablePage({ config, subjects, onChange }: {
  config: TimetableConfig | undefined
  subjects: string[]
  onChange: (config: TimetableConfig) => void
}) {
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const date = useTickingNow()
  const dateKey = localDate(date)
  const now = date.getHours() * 60 + date.getMinutes()
  const cycleLength = config?.cycleLength ?? 10
  const today = config ? getDayLabelForDate(date, config.day1Starts, config.holidays, config.cycleLength, config.weekendTimetables) : null
  const upcoming = useMemo(() => config ? nextDates(config, dateKey) : new Map<number, string>(), [config, dateKey])
  const [selectedDay, setSelectedDay] = useState(today ?? 1)
  const day = Math.min(selectedDay, cycleLength)
  const [editor, setEditor] = useState<PeriodEditor | null>(null)
  const periods = config ? dayPeriods(config, day) : []
  const firstDay = Math.floor((day - 1) / 5) * 5 + 1
  const days = Array.from({ length: Math.min(5, cycleLength - firstDay + 1) }, (_, i) => firstDay + i)
  const classes = periods.filter((period) => !isBreak(period))
  const breaks = periods.length - classes.length
  const finished = day === today ? classes.filter((period) => minutes(period.endTime) <= now).length : 0
  const totalPeriods = config?.entries.reduce((sum, entry) => sum + entry.periods.length, 0) ?? 0

  function addPeriod() {
    const last = periods.at(-1)
    const startTime = last && minutes(last.endTime) < 1439 ? last.endTime : "09:00"
    const end = Math.min(minutes(startTime) + 50, 1439)
    setEditor({ day, draft: { period: `Period ${periods.length + 1}`, subject: "", location: "", startTime, endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` } })
  }

  function edit(label: number, period: TimetablePeriod) {
    setSelectedDay(label)
    setEditor({ day: label, original: period, draft: { ...period, subject: periodSubjectName(period) } })
  }

  const step = (by: number) => setSelectedDay(Math.min(cycleLength, Math.max(1, day + by)))

  return (
    <WorkspacePage className="gap-5 lg:gap-6">
      {/* Same header as the calendar: where you are in the cycle, how to move, what you can add. */}
      <header data-slot="page-header" className="flex flex-col gap-3 border-b border-border pb-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase compact:hidden">Class timetable</p>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="focal-page-title" aria-live="polite">{!config ? "Class timetable" : days.length > 1 ? `Days ${firstDay}–${days.at(-1)}` : `Day ${firstDay}`}</h1>
            {config && cycleLength > 5 ? (
              <div className="flex items-center gap-0.5">
                <Button aria-label="Previous cycle days" disabled={firstDay === 1} onClick={() => setSelectedDay(firstDay - 5)} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
                <Button aria-label="Next cycle days" disabled={firstDay + 5 > cycleLength} onClick={() => setSelectedDay(firstDay + 5)} size="icon-sm" variant="ghost"><ChevronRight /></Button>
              </div>
            ) : null}
          </div>
          <p className="mt-2 text-sm text-muted-foreground tabular-nums">
            {config
              ? `${cycleLength}-day cycle · ${totalPeriods} ${totalPeriods === 1 ? "period" : "periods"} · ${config.weekendTimetables ? "weekends included" : "weekdays only"} · ${today ? `today is Day ${today}` : "no school today"}`
              : "No timetable set up yet"}
          </p>
        </div>
        <div data-tour="page-actions" className="flex flex-wrap items-center gap-2 [&>*]:max-sm:flex-1">
          {config ? <Button disabled={!today || day === today} onClick={() => today && setSelectedDay(today)} variant="outline"><RotateCcw />Today</Button> : null}
          <Button onClick={() => setImportOpen(true)} variant="outline"><ClipboardPaste />Import</Button>
          {config ? <Button onClick={() => setSettingsOpen(true)} variant="outline"><Settings2 />Cycle settings</Button> : null}
          <Button onClick={addPeriod}><Plus />Add period</Button>
        </div>
      </header>

      {!config ? (
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CalendarClock /></EmptyMedia>
            <EmptyTitle>No timetable yet</EmptyTitle>
            <EmptyDescription>Import a screenshot of your school timetable, or add periods one at a time. Your classes then appear on the calendar, ready to plan study around.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <WorkspaceSplit id="calendar" primary={
            <CycleBoard config={config} cycleLength={cycleLength} days={days} selected={day} today={today} now={now} upcoming={upcoming} onSelect={setSelectedDay} onEdit={edit} />
          } secondary={
            <aside className="calendar-day-pane min-w-0" {...swipe(() => step(-1), () => step(1))}>
              <Card size="sm" className="data-[size=sm]:[--card-spacing:--spacing(3)] calendar-day-card">
                <CardHeader className="shrink-0 gap-2 pb-1">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle>{day === today ? "Today · " : ""}Day {day}</CardTitle>
                    <div className="flex shrink-0 items-center gap-0.5">
                      <Button aria-label="Previous day" disabled={day === 1} onClick={() => step(-1)} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
                      <Button aria-label="Next day" disabled={day === cycleLength} onClick={() => step(1)} size="icon-sm" variant="ghost"><ChevronRight /></Button>
                    </div>
                  </div>
                  <CardDescription className="tabular-nums">
                    {[
                      !periods.length ? "Nothing scheduled" : day === today && classes.length ? `${finished} of ${classCount(classes.length)} done` : classCount(classes.length),
                      breaks ? `${breaks} ${breaks === 1 ? "break" : "breaks"}` : "",
                      periods.length ? `${timeLabel(periods[0].startTime)} – ${timeLabel(periods.reduce((end, period) => period.endTime > end ? period.endTime : end, periods[0].endTime))}` : "",
                      day === today ? "" : upcoming.has(day) ? `next ${upcoming.get(day)}` : "not coming up",
                    ].filter(Boolean).join(" · ")}
                  </CardDescription>
                  {day === today && classes.length ? <Progress aria-label="Classes finished today" className="h-1" value={finished / classes.length * 100} /> : null}
                </CardHeader>
                <CardContent className="grid shrink-0 gap-3" key={day}>
                  {periods.length ? (
                    <ul className="min-w-0 divide-y rounded-md border">
                      {periods.map((period, index) => {
                        const name = periodSubjectName(period) || period.period
                        const invalid = getTimetablePeriodError(period)
                        const live = day === today && minutes(period.startTime) <= now && now < minutes(period.endTime)
                        const past = day === today && minutes(period.endTime) <= now
                        return (
                          <li className="flex animate-in items-center gap-2 px-2 py-1.5 duration-400 ease-[var(--ease-spring)] fade-in-0" key={index}>
                            <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", periodTint(period).className)} style={periodTint(period).style} />
                            <div className="min-w-0 flex-1">
                              <p className={cn("truncate text-sm font-medium", (past || isBreak(period)) && "text-muted-foreground")} title={name}>{name}</p>
                              <p className="truncate text-xs text-muted-foreground tabular-nums">{[period.subject ? period.period : isBreak(period) ? "" : "Subject not set", `${timeLabel(period.startTime)} – ${timeLabel(period.endTime)}`, period.location].filter(Boolean).join(" · ")}</p>
                              {invalid ? <p className="text-xs text-destructive">{invalid}</p> : null}
                            </div>
                            {live ? <Badge className="shrink-0" variant="outline">Now</Badge> : isBreak(period) ? <Badge className="shrink-0" variant="secondary">Break</Badge> : null}
                            <Button aria-label={`Edit ${name}, ${timeLabel(period.startTime)} to ${timeLabel(period.endTime)}`} onClick={() => edit(day, period)} size="sm" variant="ghost">Edit</Button>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <Empty className="min-h-28 border">
                      <EmptyHeader>
                        <EmptyMedia variant="icon"><CalendarClock /></EmptyMedia>
                        <EmptyTitle>Nothing scheduled</EmptyTitle>
                        <EmptyDescription>Add a period above to give Day {day} its classes and breaks.</EmptyDescription>
                      </EmptyHeader>
                    </Empty>
                  )}
                </CardContent>
              </Card>
            </aside>
          } />
          <Holidays config={config} onChange={onChange} />
        </>
      )}
      {importOpen ? <ImportDialog current={config ?? defaultClassTimetable()} onClose={() => setImportOpen(false)} onImport={(next) => { const previous = config; onChange(next); setSelectedDay(1); setImportOpen(false); toast("Timetable imported", previous ? { duration: 8000, action: { label: "Undo", onClick: () => onChange(previous) } } : undefined) }} /> : null}
      {settingsOpen && config ? <SettingsDialog config={config} onClose={() => setSettingsOpen(false)} onSave={(next) => { onChange(next); setSettingsOpen(false); toast("Cycle settings saved") }} /> : null}
      {editor ? <PeriodDialog editor={editor} subjects={subjects} onClose={() => setEditor(null)} onSave={(period) => {
        const timetable = config ?? defaultClassTimetable()
        const current = dayPeriods(timetable, editor.day)
        if (editor.original && !current.includes(editor.original)) { toast.error("This period has changed. Reopen it to edit the latest version."); setEditor(null); return }
        const next = editor.original && period.subject === periodSubjectName(editor.original) ? { ...period, subject: editor.original.subject } : period
        onChange(withDay(timetable, editor.day, editor.original ? current.map((item) => item === editor.original ? next : item) : [...current, next]))
        setEditor(null)
        toast(editor.original ? "Period updated" : "Period added")
      }} onDelete={editor.original && config ? () => {
        const original = editor.original!
        const previous = config
        onChange(withDay(config, editor.day, dayPeriods(config, editor.day).filter((period) => period !== original)))
        setEditor(null)
        toast("Period removed", { duration: 8000, action: { label: "Undo", onClick: () => onChange(previous) } })
      } : undefined} /> : null}
    </WorkspacePage>
  )
}

/**
 * The cycle as the calendar draws a month: a header row of selectable days, the grid, and a
 * legend in the footer. A phone keeps the header row as its day picker and leaves the hours
 * to the day card, where there is room for words.
 */
function CycleBoard({ config, cycleLength, days, selected, today, now, upcoming, onSelect, onEdit }: {
  config: TimetableConfig; cycleLength: number; days: number[]; selected: number; today: number | null; now: number; upcoming: Map<number, string>; onSelect: (day: number) => void; onEdit: (day: number, period: TimetablePeriod) => void
}) {
  // ponytail: overlap checks are O(n²) on small school-day lists; use a sweep line if this becomes an event feed.
  const columns = days.map((day) => {
    const periods = dayPeriods(config, day)
    const lanes = Math.max(1, ...periods.map((period) => periods.filter((other) => minutes(other.startTime) <= minutes(period.startTime) && minutes(other.endTime) > minutes(period.startTime)).length))
    return { day, periods, lanes }
  })
  const validPeriods = columns.flatMap((column) => column.periods).filter((period) => !getTimetablePeriodError(period))
  const start = validPeriods.length ? Math.floor(Math.min(...validPeriods.map((period) => minutes(period.startTime))) / 60) * 60 : 8 * 60
  const end = validPeriods.length ? Math.ceil(Math.max(...validPeriods.map((period) => minutes(period.endTime))) / 60) * 60 : 15 * 60
  const height = Math.max(end - start, 240)
  const hours = Array.from({ length: Math.ceil(height / 60) }, (_, i) => start + i * 60)
  const legend = new Map<string, { count: number; period: TimetablePeriod }>()
  for (const period of config.entries.flatMap((entry) => entry.periods)) {
    if (isBreak(period) || !period.subject) continue
    const name = periodSubjectName(period)
    legend.set(name, { count: (legend.get(name)?.count ?? 0) + 1, period })
  }
  // A narrow pane scrolls the grid sideways: open on today, once, without fighting later scrolling.
  const grid = useRef<HTMLDivElement>(null)
  useEffect(() => { grid.current?.querySelector("[data-today]")?.scrollIntoView({ inline: "center", block: "nearest" }) }, [])

  return (
    <section aria-label="School cycle" className="min-w-0 overflow-hidden rounded-lg border border-border bg-card">
      <div ref={grid} className="overflow-x-auto overscroll-x-contain">
        <div className="grid grid-cols-[repeat(var(--tt-days),minmax(0,1fr))] md:min-w-[36rem] md:grid-cols-[3.5rem_repeat(var(--tt-days),minmax(0,1fr))]" style={{ "--tt-days": days.length } as CSSProperties}>
          <div className="hidden border-b border-border bg-muted/40 md:block" />
          {columns.map(({ day, periods }) => (
            <Button
              variant="ghost"
              aria-current={today === day ? "date" : undefined}
              aria-label={`Day ${day}, ${classCount(periods.filter((period) => !isBreak(period)).length)}${upcoming.has(day) ? `, ${upcoming.get(day)}` : ""}`}
              aria-pressed={selected === day}
              data-today={today === day ? "" : undefined}
              data-tt-day={day}
              key={day}
              onClick={() => onSelect(day)}
              onKeyDown={(event) => {
                const offset = { ArrowLeft: -1, ArrowRight: 1 }[event.key]
                const next = day + (offset ?? 0)
                if (!offset || next < 1 || next > cycleLength) return
                event.preventDefault()
                onSelect(next)
                requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(`[data-tt-day="${next}"]`)?.focus())
              }}
              className={cn(
                "relative h-auto min-w-0 flex-col items-stretch justify-start gap-1 rounded-none border-0 border-b border-l border-border bg-muted/40 p-2 text-left font-normal transition-[background-color,box-shadow] duration-300 ease-[var(--ease-spring)] hover:bg-accent/50 focus-visible:z-10 focus-visible:ring-inset max-md:first:border-l-0",
                selected === day && "z-10 bg-primary/[0.06] ring-2 ring-primary ring-inset hover:bg-primary/[0.09]",
              )}
            >
              <span className="flex items-center justify-between gap-1">
                <span className="flex items-center gap-1 text-[0.6875rem] font-medium tracking-wide text-muted-foreground uppercase">
                  Day
                  <span className={cn("grid size-6 place-items-center rounded-full text-xs text-foreground tabular-nums", today === day && "bg-primary text-primary-foreground")}>{day}</span>
                </span>
                <span className="hidden truncate text-[0.6875rem] text-muted-foreground tabular-nums lg:inline">{classCount(periods.filter((period) => !isBreak(period)).length)}</span>
              </span>
              <span className="truncate text-[0.6875rem] text-muted-foreground tabular-nums">{upcoming.get(day) ?? "Not coming up"}</span>
            </Button>
          ))}
          <div aria-hidden="true" className="relative hidden md:block" style={{ height: height * 1.35 }}>
            {hours.slice(1).map((hour) => <span className="absolute right-2 -translate-y-1/2 text-[0.6875rem] whitespace-nowrap text-muted-foreground tabular-nums" key={hour} style={{ top: (hour - start) * 1.35 }}>{hourLabel(hour)}</span>)}
          </div>
          {columns.map(({ day, periods, lanes }) => <div className={cn("relative hidden grid-flow-col-dense gap-x-1 border-l border-border px-1 md:grid", selected === day && "bg-primary/[0.04]")} key={day} style={{ height: height * 1.35, gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${height}, 1.35px)`, backgroundImage: "repeating-linear-gradient(to bottom, transparent 0px, transparent 80px, var(--border) 80px, var(--border) 81px)" }}>
            {periods.filter((period) => !getTimetablePeriodError(period)).map((period, index) => {
              const length = minutes(period.endTime) - minutes(period.startTime)
              return <Button variant="ghost" aria-label={`Day ${day}: ${periodSubjectName(period) || period.period}, ${timeLabel(period.startTime)} to ${timeLabel(period.endTime)}. Edit period.`} className={`z-10 ${periodTint(period).className} ${length < 20 ? "my-px" : "my-0.5"} h-auto min-w-0 flex-col items-stretch justify-start overflow-hidden rounded-xs border-0 px-2 text-left font-normal whitespace-normal hover:brightness-[0.97] dark:hover:brightness-115 ${length < 35 ? "justify-center py-0" : "py-1"}`} key={index} onClick={() => onEdit(day, period)} style={{ gridRow: `${minutes(period.startTime) - start + 1} / span ${length}`, gridColumn: periods.some((other) => other !== period && minutes(other.startTime) < minutes(period.endTime) && minutes(other.endTime) > minutes(period.startTime)) ? undefined : "1 / -1", ...periodTint(period).style }} title={`${periodSubjectName(period) || period.period} · ${period.period} · ${period.startTime}–${period.endTime}${period.location ? ` · ${period.location}` : ""}`} type="button">
                <span className={`block font-medium ${length < 20 ? "truncate text-[10px] leading-none" : "truncate text-xs leading-tight"}`}>{periodSubjectName(period) || period.period}</span>
                {length >= 35 ? <span className="mt-0.5 block truncate text-[0.6875rem] tabular-nums opacity-80">{timeLabel(period.startTime)}{period.location ? ` · ${period.location}` : ""}</span> : null}
              </Button>
            })}
            {today === day && now > start && now < start + height ? <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive" style={{ top: (now - start) * 1.35 - 1 }}><span className="absolute -top-[5px] -left-1.5 size-3 rounded-full bg-destructive" /></div> : null}
          </div>)}
        </div>
      </div>
      {legend.size ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border bg-muted/30 px-2 py-1.5 text-xs text-muted-foreground" role="list">
          {[...legend].map(([name, { count, period }]) => (
            <li className="flex items-center gap-1.5" key={name}>
              <span aria-hidden className="tt-block size-1.5 rounded-full" style={periodTint(period).style} />
              {name}
              <span className="tabular-nums opacity-70">{count}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}

function PeriodDialog({ editor, subjects, onClose, onSave, onDelete }: {
  editor: PeriodEditor; subjects: string[]; onClose: () => void; onSave: (period: TimetablePeriod) => void; onDelete?: () => void
}) {
  const [draft, setDraft] = useState(editor.draft)
  const [error, setError] = useState<string | null>(null)
  const [confirmingClose, setConfirmingClose] = useState(false)
  function update(patch: Partial<TimetablePeriod>) { setDraft({ ...draft, ...patch }); setError(null) }
  function requestClose() { if (JSON.stringify(draft) !== JSON.stringify(editor.draft)) setConfirmingClose(true); else onClose() }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><p className="focal-eyebrow text-primary">Day {editor.day}</p><DialogTitle>{editor.original ? "Edit a period" : "Add a period"}</DialogTitle><DialogDescription>Give this part of your day a time and a place.</DialogDescription></DialogHeader>
        <form className="contents" onSubmit={(event) => {
          event.preventDefault()
          const next = { ...draft, period: draft.period.trim(), subject: draft.subject.trim(), location: draft.location?.trim() }
          const invalid = getTimetablePeriodError(next)
          if (invalid) { setError(invalid); return }
          onSave(next)
        }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="tt-period">Period name</FieldLabel><Input id="tt-period" required value={draft.period} onChange={(e) => update({ period: e.target.value })} placeholder="Period 1, recess, or lunch" /></Field>
            <Field><FieldLabel htmlFor="tt-subject">Subject</FieldLabel><Input id="tt-subject" list="tt-subject-options" value={draft.subject} onChange={(e) => update({ subject: e.target.value })} placeholder="Choose or type a subject" /><datalist id="tt-subject-options">{subjects.map((subject) => <option key={subject} value={subject} />)}</datalist><FieldDescription>Leave blank for a break or other school activity.</FieldDescription></Field>
            <div className="grid grid-cols-2 gap-4"><Field><FieldLabel htmlFor="tt-start">Starts</FieldLabel><Input id="tt-start" required type="time" value={draft.startTime} onChange={(e) => update({ startTime: e.target.value })} /></Field><Field><FieldLabel htmlFor="tt-end">Ends</FieldLabel><Input id="tt-end" required type="time" value={draft.endTime} onChange={(e) => update({ endTime: e.target.value })} /></Field></div>
            <Field><FieldLabel htmlFor="tt-room">Room <span className="font-normal text-muted-foreground">(optional)</span></FieldLabel><Input id="tt-room" value={draft.location ?? ""} onChange={(e) => update({ location: e.target.value })} placeholder="e.g. B12" /></Field>
            {error ? <FieldError role="alert">{error}</FieldError> : null}
          </FieldGroup>
          <DialogFooter>{onDelete ? <Button className="sm:mr-auto" onClick={onDelete} type="button" variant="ghost"><Trash2 />Remove</Button> : null}<Button onClick={requestClose} type="button" variant="outline">Cancel</Button><Button type="submit">{editor.original ? "Save changes" : "Add period"}</Button></DialogFooter>
        </form>
      </DialogContent>
      <DiscardChangesDialog open={confirmingClose} onKeep={() => setConfirmingClose(false)} onDiscard={onClose} />
    </Dialog>
  )
}

function SettingsDialog({ config, onClose, onSave }: { config: TimetableConfig; onClose: () => void; onSave: (config: TimetableConfig) => void }) {
  const [start, setStart] = useState(config.day1Starts)
  const [length, setLength] = useState(String(config.cycleLength ?? 10))
  const [weekends, setWeekends] = useState(Boolean(config.weekendTimetables))
  const cycle = Number(length)
  const valid = start && Number.isInteger(cycle) && cycle >= 1 && cycle <= 60
  const removed = config.entries.filter((entry) => entry.dayLabel > cycle).reduce((sum, entry) => sum + entry.periods.length, 0)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Set your rhythm</DialogTitle><DialogDescription>Your cycle repeats on school days. Holidays pause it until school resumes.</DialogDescription></DialogHeader>
        <form className="contents" onSubmit={(event) => { event.preventDefault(); if (valid) onSave({ ...config, day1Starts: start, cycleLength: cycle, weekendTimetables: weekends, dayToWeekday: undefined, entries: config.entries.filter((entry) => entry.dayLabel <= cycle) }) }}>
          <FieldGroup>
            <Field><FieldLabel htmlFor="tt-day1">Day 1 starts</FieldLabel><Input id="tt-day1" required type="date" value={start} onChange={(e) => setStart(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="tt-cycle">Days in the cycle</FieldLabel><Input id="tt-cycle" required max={60} min={1} type="number" inputMode="numeric" value={length} onChange={(e) => setLength(e.target.value)} /><FieldDescription>Choose between 1 and 60 school days.</FieldDescription></Field>
            <Label className="flex items-center gap-3 text-sm"><Checkbox checked={weekends} onCheckedChange={(checked) => setWeekends(checked)} />Include weekends as school days</Label>
            {valid && removed > 0 ? <p className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive" role="alert">Saving this shorter cycle will remove {removed} {removed === 1 ? "period" : "periods"} from days after Day {cycle}.</p> : null}
          </FieldGroup>
          <DialogFooter><Button onClick={onClose} type="button" variant="outline">Cancel</Button><Button disabled={!valid} type="submit">{removed > 0 && valid ? "Save & remove periods" : "Save cycle"}</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function Holidays({ config, onChange }: { config: TimetableConfig; onChange: (config: TimetableConfig) => void }) {
  const [draft, setDraft] = useState<SchoolHoliday>({ name: "", startDate: "", endDate: "" })
  const valid = draft.name.trim() && draft.startDate && draft.endDate >= draft.startDate
  return (
    <Card size="sm" className="data-[size=sm]:[--card-spacing:--spacing(3)]">
      <CardHeader className="gap-1">
        <CardTitle>Holidays</CardTitle>
        <CardDescription className="tabular-nums">{config.holidays.length ? `${config.holidays.length} holiday ${config.holidays.length === 1 ? "range" : "ranges"} · ` : ""}The cycle pauses on these dates and picks up where it left off.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {config.holidays.length ? <ul className="min-w-0 divide-y rounded-md border">{config.holidays.map((holiday, index) => <li className="flex items-center gap-2 px-2 py-1.5" key={`${holiday.name}-${index}`}><span aria-hidden className="size-1.5 shrink-0 rounded-full bg-chart-5" /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{holiday.name}</p><p className="truncate text-xs text-muted-foreground tabular-nums">{dateLabel(holiday.startDate)} – {dateLabel(holiday.endDate)}</p></div><Button aria-label={`Remove ${holiday.name}`} onClick={() => { onChange({ ...config, holidays: config.holidays.filter((_, i) => i !== index) }); toast("Holiday removed", { duration: 8000, action: { label: "Undo", onClick: () => onChange(config) } }) }} size="icon-sm" variant="ghost"><Trash2 /></Button></li>)}</ul> : null}
        <form className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (!valid) return; onChange({ ...config, holidays: [...config.holidays, { ...draft, name: draft.name.trim() }].toSorted((a, b) => a.startDate.localeCompare(b.startDate)) }); setDraft({ name: "", startDate: "", endDate: "" }); toast("Holiday added") }}>
          <Field><FieldLabel htmlFor="tt-holiday-name">Holiday name</FieldLabel><Input id="tt-holiday-name" required autoComplete="off" placeholder="Term break" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field><FieldLabel htmlFor="tt-holiday-start">From</FieldLabel><Input id="tt-holiday-start" required type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value, endDate: draft.endDate >= e.target.value ? draft.endDate : e.target.value })} /></Field>
          <Field><FieldLabel htmlFor="tt-holiday-end">Until</FieldLabel><Input id="tt-holiday-end" required min={draft.startDate} type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></Field>
          <Button disabled={!valid} type="submit" variant="outline"><Plus />Add holiday</Button>
        </form>
      </CardContent>
    </Card>
  )
}

function ImportDialog({ current, onClose, onImport }: { current: TimetableConfig; onClose: () => void; onImport: (config: TimetableConfig) => void }) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(TIMETABLE_SCREENSHOT_PROMPT)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy the prompt. Check clipboard permission and try again.")
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><p className="focal-eyebrow text-primary">Bring your timetable along</p><DialogTitle>From screenshot to schedule.</DialogTitle><DialogDescription>Use any chatbot to turn a screenshot into timetable data. Importing replaces your current periods; your holidays stay in place.</DialogDescription></DialogHeader>
        <FieldGroup>
          <div className="flex items-start gap-4 border-y py-5"><span className="font-heading text-xl text-primary">01</span><div className="min-w-0 flex-1"><p className="font-medium">Share the screenshot</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Copy our prompt and send it to a chatbot with a screenshot of your timetable.</p><Button className="mt-3" onClick={() => void copy()} size="sm" type="button" variant="outline">{copied ? <ClipboardCheck /> : <ClipboardCopy />}{copied ? "Copied" : "Copy prompt"}</Button></div></div>
          <Field data-invalid={error ? true : undefined}><FieldLabel htmlFor="tt-import"><span className="mr-2 font-heading text-xl text-primary">02</span>Paste the reply</FieldLabel><Textarea aria-describedby={error ? "tt-import-error" : undefined} aria-invalid={error ? true : undefined} className="font-mono text-xs" id="tt-import" placeholder="Paste the chatbot’s JSON reply here…" rows={7} value={text} onChange={(e) => { setText(e.target.value); setError(null) }} />{error ? <FieldError id="tt-import-error" role="alert">{error}</FieldError> : null}</Field>
        </FieldGroup>
        <DialogFooter><Button onClick={onClose} type="button" variant="outline">Cancel</Button><Button disabled={!text.trim()} onClick={() => { try { onImport(parseTimetableImport(text, "pasted.json", current)) } catch (e) { setError(e instanceof Error ? e.message : "Could not read this timetable.") } }} type="button">Import timetable<ArrowRight /></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
