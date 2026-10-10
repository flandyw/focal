import { useState } from "react"
import { ArrowRight, CalendarClock, ChevronLeft, ChevronRight, ClipboardCheck, ClipboardCopy, Clock3, Pencil, Plus, Settings2, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { PageHeader } from "./page-header"
import { WorkspacePage } from "./workspace-layout"
import {
  TIMETABLE_SCREENSHOT_PROMPT,
  defaultClassTimetable,
  getDayLabelForDate,
  getTimetablePeriodError,
  isTimetableBreakLabel,
  parseTimetableImport,
  periodSubjectName,
} from "../lib/class-timetable"
import { subjectColor } from "../lib/studySubjects"
import type { SchoolHoliday, TimetableConfig, TimetablePeriod } from "../lib/types"

const byStart = (a: TimetablePeriod, b: TimetablePeriod) => a.startTime.localeCompare(b.startTime)
const dayPeriods = (config: TimetableConfig, day: number) => config.entries.filter((entry) => entry.dayLabel === day).flatMap((entry) => entry.periods).toSorted(byStart)
const minutes = (time: string) => { const [hours, mins] = time.split(":").map(Number); return hours * 60 + mins }
const timeLabel = (time: string) => new Date(2000, 0, 1, ...time.split(":").map(Number)).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
const dateLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })
const isBreak = (period: TimetablePeriod) => isTimetableBreakLabel(period.subject) || isTimetableBreakLabel(period.period)
const periodColour = (period: TimetablePeriod) => isBreak(period) ? "var(--muted-foreground)" : subjectColor(periodSubjectName(period)) ?? "var(--primary)"

function withDay(config: TimetableConfig, dayLabel: number, periods: TimetablePeriod[]): TimetableConfig {
  const others = config.entries.filter((entry) => entry.dayLabel !== dayLabel)
  const entries = periods.length ? [...others, { dayLabel, periods: periods.toSorted(byStart) }] : others
  return { ...config, entries: entries.toSorted((a, b) => a.dayLabel - b.dayLabel) }
}

type PeriodEditor = { day: number; original?: TimetablePeriod; draft: TimetablePeriod }

export function ClassTimetablePage({ config, subjects, onChange }: {
  config: TimetableConfig | undefined
  subjects: string[]
  onChange: (config: TimetableConfig) => void
}) {
  const [importOpen, setImportOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [date] = useState(() => new Date())
  const cycleLength = config?.cycleLength ?? 10
  const today = config ? getDayLabelForDate(date, config.day1Starts, config.holidays, cycleLength, config.weekendTimetables) : null
  const [selectedDay, setSelectedDay] = useState(today ?? 1)
  const day = Math.min(selectedDay, cycleLength)
  const [editor, setEditor] = useState<PeriodEditor | null>(null)
  const periods = config ? dayPeriods(config, day) : []
  const firstDay = Math.floor((day - 1) / 5) * 5 + 1
  const days = Array.from({ length: Math.min(5, cycleLength - firstDay + 1) }, (_, i) => firstDay + i)
  const classes = periods.filter((period) => !isBreak(period)).length
  const totalPeriods = config?.entries.reduce((sum, entry) => sum + entry.periods.length, 0) ?? 0

  function addPeriod() {
    const last = periods.at(-1)
    const startTime = last && minutes(last.endTime) < 1439 ? last.endTime : "09:00"
    const end = Math.min(minutes(startTime) + 50, 1439)
    setEditor({ day, draft: { period: `Period ${periods.length + 1}`, subject: "", location: "", startTime, endTime: `${String(Math.floor(end / 60)).padStart(2, "0")}:${String(end % 60).padStart(2, "0")}` } })
  }

  return (
    <WorkspacePage>
      <PageHeader title="Class timetable" description="Your school cycle, with space for every class and break.">
        <Button onClick={() => setImportOpen(true)} variant="outline"><Upload />Import timetable</Button>
        {config ? <Button onClick={() => setSettingsOpen(true)} variant="outline"><Settings2 />Cycle settings</Button> : null}
      </PageHeader>

      {!config ? (
        <section className="grid overflow-hidden border-y border-border md:grid-cols-[1fr_0.75fr]">
          <div className="py-12 pr-6 sm:py-16">
            <p className="focal-eyebrow text-primary">Make room for your day</p>
            <h2 className="mt-5 max-w-md font-heading text-4xl leading-tight sm:text-5xl">Your school rhythm,<br />all in one place.</h2>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-muted-foreground">Bring in your existing timetable, or build a cycle from scratch. Your classes will also appear on the calendar, ready to plan study around.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button onClick={() => { onChange(defaultClassTimetable()); addPeriod() }}><Plus />Build my timetable</Button>
              <Button onClick={() => setImportOpen(true)} variant="ghost">Import instead<ArrowRight /></Button>
            </div>
          </div>
          <div className="flex flex-col justify-center border-t bg-secondary/45 p-8 md:border-t-0 md:border-l sm:p-12">
            <CalendarClock className="mb-6 size-9 text-primary" strokeWidth={1.25} />
            <p className="font-heading text-2xl">Built around your cycle.</p>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">Five days, ten days, or something different. Keep class times, rooms, breaks, and school holidays together.</p>
            <p className="mt-6 border-t pt-4 text-xs leading-relaxed text-muted-foreground">Already set up on desktop? Your timetable will appear here after sync.</p>
          </div>
        </section>
      ) : (
        <>
          <section aria-label="School cycle" className="min-w-0">
            <div className="flex flex-wrap items-end justify-between gap-4 pb-5">
              <div>
                <p className="focal-eyebrow text-muted-foreground">The school rhythm</p>
                <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-2">
                  <h2 className="font-heading text-3xl">Your {cycleLength}-day cycle</h2>
                  <span className="text-xs text-muted-foreground">{totalPeriods} {totalPeriods === 1 ? "period" : "periods"} · {config.weekendTimetables ? "Weekends included" : "Weekdays only"}</span>
                </div>
              </div>
              <Button disabled={today === null} onClick={() => today && setSelectedDay(today)} size="sm" variant="ghost"><span className={`size-1.5 rounded-full ${today ? "bg-primary" : "bg-muted-foreground"}`} />{today ? `Today · Day ${today}` : "No classes today"}</Button>
            </div>

            <div className="flex items-center justify-between gap-3 border-y py-3">
              <p className="text-xs font-medium">Days {firstDay}–{days.at(-1)} <span className="ml-2 hidden font-normal text-muted-foreground sm:inline">of {cycleLength}</span></p>
              <div className="flex items-center gap-1">
                <Button aria-label="Previous cycle days" disabled={firstDay === 1} onClick={() => setSelectedDay(firstDay - 5)} size="icon-sm" variant="ghost"><ChevronLeft /></Button>
                <Button aria-label="Next cycle days" disabled={firstDay + 5 > cycleLength} onClick={() => setSelectedDay(firstDay + 5)} size="icon-sm" variant="ghost"><ChevronRight /></Button>
              </div>
            </div>

            <div className="flex border-b md:hidden">
              {days.map((label) => <button aria-pressed={day === label} className={`min-h-16 min-w-0 flex-1 border-b-2 px-1 py-3 text-center ${day === label ? "border-primary bg-secondary/50 text-primary" : "border-transparent text-muted-foreground"}`} key={label} onClick={() => setSelectedDay(label)} type="button"><span className="block font-heading text-xl">Day {label}</span>{today === label ? <span className="text-[10px]">Today</span> : null}</button>)}
            </div>
            <div className="hidden md:block">
              <CycleBoard config={config} days={days} selected={day} today={today} onSelect={setSelectedDay} onEdit={(label, period) => { setSelectedDay(label); setEditor({ day: label, original: period, draft: { ...period, subject: periodSubjectName(period) } }) }} />
              <p className="mt-3 text-xs text-muted-foreground">Select a day to see its agenda. Select a period to edit it.</p>
            </div>
          </section>

          <section aria-labelledby="tt-agenda-heading" className="grid gap-6 border-t pt-6 lg:grid-cols-[0.65fr_1.35fr] lg:gap-12">
            <div>
              <p className="focal-eyebrow text-primary">One day at a time</p>
              <h2 className="mt-2 font-heading text-4xl" id="tt-agenda-heading">Day {day}{day === today ? <span className="ml-3 align-middle font-sans text-xs text-primary">Today</span> : null}</h2>
              <p className="mt-3 text-sm text-muted-foreground">{periods.length ? `${classes} ${classes === 1 ? "class" : "classes"}${periods.length > classes ? ` · ${periods.length - classes} ${periods.length - classes === 1 ? "break" : "breaks"}` : ""}` : "A blank page for your school day."}</p>
              {periods.length ? <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />{timeLabel(periods[0].startTime)} – {timeLabel(periods.reduce((end, period) => period.endTime > end ? period.endTime : end, periods[0].endTime))}</p> : null}
              <Button className="mt-5" onClick={addPeriod} size="sm"><Plus />Add a period</Button>
            </div>
            <div className="min-w-0">
              {periods.length ? <ol className="divide-y border-y">
                {periods.map((period, index) => <li key={index}>
                  <button aria-label={`Edit ${periodSubjectName(period) || period.period}, ${timeLabel(period.startTime)} to ${timeLabel(period.endTime)}`} className="group flex w-full items-center gap-3 py-4 text-left transition-colors hover:bg-secondary/40 sm:gap-5" onClick={() => setEditor({ day, original: period, draft: { ...period, subject: periodSubjectName(period) } })} type="button">
                    <div className="w-20 shrink-0 text-xs tabular-nums text-muted-foreground"><span className="block font-medium text-foreground">{timeLabel(period.startTime)}</span><span className="mt-1 block">{timeLabel(period.endTime)}</span></div>
                    <span className="h-9 w-0.5 shrink-0" style={{ backgroundColor: periodColour(period) }} />
                    <div className="min-w-0 flex-1"><span className={`block break-words ${isBreak(period) ? "text-sm text-muted-foreground" : "font-heading text-xl"}`}>{periodSubjectName(period) || period.period}</span><span className="mt-1 block text-xs text-muted-foreground">{period.subject ? period.period : isBreak(period) ? `${minutes(period.endTime) - minutes(period.startTime)} minutes` : "Subject not set"}{period.location ? ` · ${period.location}` : ""}</span>{getTimetablePeriodError(period) ? <span className="mt-1 block text-xs text-destructive">{getTimetablePeriodError(period)}</span> : null}</div>
                    <Pencil className="mr-2 size-3.5 shrink-0 text-muted-foreground opacity-50 group-hover:text-primary group-hover:opacity-100" />
                  </button>
                </li>)}
              </ol> : <div className="flex min-h-36 flex-col justify-center border-y border-dashed py-6"><p className="font-heading text-2xl">Start with the first bell.</p><p className="mt-2 text-sm text-muted-foreground">Add classes and breaks, with their times and rooms.</p></div>}
            </div>
          </section>
          <Holidays config={config} onChange={onChange} />
        </>
      )}
      {importOpen ? <ImportDialog current={config ?? defaultClassTimetable()} onClose={() => setImportOpen(false)} onImport={(next) => { onChange(next); setSelectedDay(1); setImportOpen(false); toast("Timetable imported") }} /> : null}
      {settingsOpen && config ? <SettingsDialog config={config} onClose={() => setSettingsOpen(false)} onSave={(next) => { onChange(next); setSettingsOpen(false); toast("Cycle settings saved") }} /> : null}
      {editor && config ? <PeriodDialog editor={editor} subjects={subjects} onClose={() => setEditor(null)} onSave={(period) => {
        const current = dayPeriods(config, editor.day)
        if (editor.original && !current.includes(editor.original)) { toast.error("This period has changed. Reopen it to edit the latest version."); setEditor(null); return }
        const next = editor.original && period.subject === periodSubjectName(editor.original) ? { ...period, subject: editor.original.subject } : period
        onChange(withDay(config, editor.day, editor.original ? current.map((item) => item === editor.original ? next : item) : [...current, next]))
        setEditor(null)
        toast(editor.original ? "Period updated" : "Period added")
      }} onDelete={editor.original ? () => {
        const original = editor.original!
        onChange(withDay(config, editor.day, dayPeriods(config, editor.day).filter((period) => period !== original)))
        setEditor(null)
        toast("Period removed")
      } : undefined} /> : null}
    </WorkspacePage>
  )
}

function CycleBoard({ config, days, selected, today, onSelect, onEdit }: {
  config: TimetableConfig; days: number[]; selected: number; today: number | null; onSelect: (day: number) => void; onEdit: (day: number, period: TimetablePeriod) => void
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

  return (
    <div className="overflow-x-auto border-b bg-card">
      <div className="grid min-w-[640px]" style={{ gridTemplateColumns: `52px repeat(${days.length}, minmax(0, 1fr))` }}>
        <div className="border-b" />
        {columns.map(({ day, periods }) => <button aria-pressed={selected === day} className={`relative flex min-h-20 flex-col justify-center border-b border-l px-3 py-4 text-left transition-colors hover:bg-secondary/40 ${selected === day ? "bg-secondary/60 text-primary after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:bg-primary" : ""}`} key={day} onClick={() => onSelect(day)} type="button"><span className="flex flex-wrap items-center justify-between gap-1 font-heading text-2xl">Day {day}{today === day ? <span className="font-sans text-[10px] font-medium">Today</span> : null}</span><span className="mt-1 text-[10px] text-muted-foreground">{periods.filter((period) => !isBreak(period)).length} classes</span></button>)}
        <div aria-hidden="true" className="relative" style={{ height: height * 1.35 }}>
          {hours.map((hour) => <span className="absolute right-2 text-[10px] tabular-nums text-muted-foreground" key={hour} style={{ top: (hour - start) * 1.35 + 6 }}>{String(Math.floor(hour / 60) % 24).padStart(2, "0")}:00</span>)}
        </div>
        {columns.map(({ day, periods, lanes }) => <div className={`relative grid grid-flow-col-dense gap-x-1 border-l px-1.5 ${selected === day ? "bg-secondary/15" : ""}`} key={day} style={{ height: height * 1.35, gridTemplateColumns: `repeat(${lanes}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${height}, 1.35px)`, backgroundImage: "repeating-linear-gradient(to bottom, var(--border) 0px, var(--border) 1px, transparent 1px, transparent 81px)" }}>
          {periods.filter((period) => !getTimetablePeriodError(period)).map((period, index) => <button aria-label={`Day ${day}: ${periodSubjectName(period) || period.period}, ${timeLabel(period.startTime)} to ${timeLabel(period.endTime)}. Edit period.`} className={`z-10 my-0.5 min-w-0 overflow-hidden border-l-2 px-2 text-left transition-[filter] hover:brightness-95 ${isBreak(period) ? "border-dashed py-1" : "py-1.5"}`} key={index} onClick={() => onEdit(day, period)} style={{ gridRow: `${minutes(period.startTime) - start + 1} / span ${minutes(period.endTime) - minutes(period.startTime)}`, gridColumn: periods.some((other) => other !== period && minutes(other.startTime) < minutes(period.endTime) && minutes(other.endTime) > minutes(period.startTime)) ? undefined : "1 / -1", borderColor: periodColour(period), backgroundColor: `color-mix(in srgb, ${periodColour(period)} ${isBreak(period) ? 7 : 13}%, var(--card))` }} title={`${periodSubjectName(period) || period.period} · ${period.period} · ${period.startTime}–${period.endTime}${period.location ? ` · ${period.location}` : ""}`} type="button">
            <span className={`block break-words leading-tight ${isBreak(period) ? "text-xs text-muted-foreground" : "font-heading text-[17px]"}`}>{periodSubjectName(period) || period.period}</span>
            {minutes(period.endTime) - minutes(period.startTime) >= 35 ? <span className="mt-1 flex flex-wrap justify-between gap-x-1 text-[10px] tabular-nums text-muted-foreground"><span>{period.startTime}–{period.endTime}</span>{period.location ? <span className="truncate">{period.location}</span> : null}</span> : null}
          </button>)}
          {!periods.length ? <p className="pointer-events-none absolute inset-x-2 top-10 text-center font-heading text-lg text-muted-foreground/70">An open day</p> : null}
        </div>)}
      </div>
    </div>
  )
}

function PeriodDialog({ editor, subjects, onClose, onSave, onDelete }: {
  editor: PeriodEditor; subjects: string[]; onClose: () => void; onSave: (period: TimetablePeriod) => void; onDelete?: () => void
}) {
  const [draft, setDraft] = useState(editor.draft)
  const [error, setError] = useState<string | null>(null)
  function update(patch: Partial<TimetablePeriod>) { setDraft({ ...draft, ...patch }); setError(null) }
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
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
          <DialogFooter>{onDelete ? <Button className="sm:mr-auto" onClick={onDelete} type="button" variant="ghost"><Trash2 />Remove</Button> : null}<Button onClick={onClose} type="button" variant="outline">Cancel</Button><Button type="submit">{editor.original ? "Save changes" : "Add period"}</Button></DialogFooter>
        </form>
      </DialogContent>
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
            <Field><FieldLabel htmlFor="tt-cycle">Days in the cycle</FieldLabel><Input id="tt-cycle" required max={60} min={1} type="number" value={length} onChange={(e) => setLength(e.target.value)} /><FieldDescription>Choose between 1 and 60 school days.</FieldDescription></Field>
            <label className="flex items-center gap-3 text-sm"><input className="size-4 accent-primary" type="checkbox" checked={weekends} onChange={(e) => setWeekends(e.target.checked)} />Include weekends as school days</label>
            {valid && removed > 0 ? <p className="border-l-2 border-destructive bg-destructive/5 p-3 text-sm text-destructive" role="alert">Saving this shorter cycle will remove {removed} {removed === 1 ? "period" : "periods"} from days after Day {cycle}.</p> : null}
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
    <details className="group border-y">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 [&::-webkit-details-marker]:hidden"><div><h2 className="font-heading text-2xl">Time away from school</h2><p className="mt-1 text-xs text-muted-foreground">{config.holidays.length ? `${config.holidays.length} holiday ${config.holidays.length === 1 ? "range" : "ranges"} · ` : ""}Holidays pause your cycle.</p></div><ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" /></summary>
      <div className="grid gap-5 pb-6">
        {config.holidays.length ? <ul className="divide-y border-t">{config.holidays.map((holiday, index) => <li className="flex items-center justify-between gap-3 py-3" key={`${holiday.name}-${index}`}><div className="min-w-0"><p className="break-words text-sm font-medium">{holiday.name}</p><p className="mt-1 text-xs text-muted-foreground">{dateLabel(holiday.startDate)} – {dateLabel(holiday.endDate)}</p></div><Button aria-label={`Remove ${holiday.name}`} onClick={() => onChange({ ...config, holidays: config.holidays.filter((_, i) => i !== index) })} size="icon-sm" variant="ghost"><Trash2 /></Button></li>)}</ul> : null}
        <form className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-[1.2fr_1fr_1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (!valid) return; onChange({ ...config, holidays: [...config.holidays, { ...draft, name: draft.name.trim() }].toSorted((a, b) => a.startDate.localeCompare(b.startDate)) }); setDraft({ name: "", startDate: "", endDate: "" }); toast("Holiday added") }}>
          <Field><FieldLabel htmlFor="tt-holiday-name">Holiday name</FieldLabel><Input id="tt-holiday-name" required placeholder="Term break" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} /></Field>
          <Field><FieldLabel htmlFor="tt-holiday-start">From</FieldLabel><Input id="tt-holiday-start" required type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value, endDate: draft.endDate || e.target.value })} /></Field>
          <Field><FieldLabel htmlFor="tt-holiday-end">Until</FieldLabel><Input id="tt-holiday-end" required min={draft.startDate} type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} /></Field>
          <Button disabled={!valid} type="submit" variant="outline"><Plus />Add holiday</Button>
        </form>
      </div>
    </details>
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
          <div className="flex items-start gap-4 border-y py-5"><span className="font-heading text-3xl text-primary">01</span><div className="min-w-0 flex-1"><p className="font-medium">Share the screenshot</p><p className="mt-1 text-xs leading-relaxed text-muted-foreground">Copy our prompt and send it to a chatbot with a screenshot of your timetable.</p><Button className="mt-3" onClick={() => void copy()} size="sm" type="button" variant="outline">{copied ? <ClipboardCheck /> : <ClipboardCopy />}{copied ? "Copied" : "Copy prompt"}</Button></div></div>
          <Field data-invalid={error ? true : undefined}><FieldLabel htmlFor="tt-import"><span className="mr-2 font-heading text-3xl font-normal text-primary">02</span>Paste the reply</FieldLabel><Textarea aria-describedby={error ? "tt-import-error" : undefined} aria-invalid={error ? true : undefined} className="font-mono text-xs" id="tt-import" placeholder="Paste the chatbot’s JSON reply here…" rows={7} value={text} onChange={(e) => { setText(e.target.value); setError(null) }} />{error ? <FieldError id="tt-import-error" role="alert">{error}</FieldError> : null}</Field>
        </FieldGroup>
        <DialogFooter><Button onClick={onClose} type="button" variant="outline">Cancel</Button><Button disabled={!text.trim()} onClick={() => { try { onImport(parseTimetableImport(text, "pasted.json", current)) } catch (e) { setError(e instanceof Error ? e.message : "Could not read this timetable.") } }} type="button">Import timetable<ArrowRight /></Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
