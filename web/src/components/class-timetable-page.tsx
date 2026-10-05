import { useState } from "react"
import { CalendarClock, ClipboardCheck, ClipboardCopy, Plus, Trash2, Upload } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
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
  parseTimetableImport,
  periodSubjectName,
} from "../lib/class-timetable"
import type { SchoolHoliday, TimetableConfig, TimetablePeriod } from "../../../src/lib/types"

const byStart = (a: TimetablePeriod, b: TimetablePeriod) => a.startTime.localeCompare(b.startTime)

function withDay(config: TimetableConfig, dayLabel: number, periods: TimetablePeriod[]): TimetableConfig {
  const others = config.entries.filter((entry) => entry.dayLabel !== dayLabel)
  const entries = periods.length ? [...others, { dayLabel, periods }] : others
  return { ...config, entries: entries.toSorted((a, b) => a.dayLabel - b.dayLabel) }
}

export function ClassTimetablePage({ config, subjects, onChange }: {
  config: TimetableConfig | undefined
  subjects: string[]
  onChange: (config: TimetableConfig) => void
}) {
  const [importOpen, setImportOpen] = useState(false)
  const cycleLength = config?.cycleLength ?? 10
  const today = config ? getDayLabelForDate(new Date(),  config.day1Starts, config.holidays, cycleLength, config.weekendTimetables) : null

  return (
    <WorkspacePage>
      <PageHeader title="Class timetable" description="Your school cycle. It syncs with the desktop app, shows classes on the calendar, and lets events snap to class times.">
        <Button onClick={() => setImportOpen(true)} variant="outline"><Upload />Import from chatbot</Button>
        {!config ? <Button onClick={() => onChange(defaultClassTimetable())}><Plus />Start from scratch</Button> : null}
      </PageHeader>
      {importOpen ? <ImportDialog current={config ?? defaultClassTimetable()} onClose={() => setImportOpen(false)} onImport={(next) => { onChange(next); setImportOpen(false); toast("Timetable imported") }} /> : null}

      {!config ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><CalendarClock /></EmptyMedia>
            <EmptyTitle>No class timetable yet</EmptyTitle>
            <EmptyDescription>Import a screenshot of your timetable through any chatbot, or build it by hand. If you already set one up on desktop it will appear here after sync.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-6">
          <Settings config={config} today={today} onChange={onChange} />
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: cycleLength }, (_, index) => index + 1).map((dayLabel) => (
              <DayCard config={config} dayLabel={dayLabel} isToday={today === dayLabel} key={dayLabel} onChange={onChange} subjects={subjects} />
            ))}
          </div>
          <Holidays config={config} onChange={onChange} />
        </div>
      )}
    </WorkspacePage>
  )
}

function Settings({ config, today, onChange }: { config: TimetableConfig; today: number | null; onChange: (config: TimetableConfig) => void }) {
  return (
    <Card size="sm">
      <CardHeader className="gap-1 pb-2">
        <CardTitle>Cycle</CardTitle>
        <CardDescription>{today ? `Today is Day ${today}.` : "Today isn't a school day."}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 sm:grid-cols-3">
        <Field>
          <FieldLabel htmlFor="tt-day1">Day 1 starts</FieldLabel>
          <Input id="tt-day1" type="date" value={config.day1Starts} onChange={(e) => e.target.value && onChange({ ...config, day1Starts: e.target.value })} />
        </Field>
        <Field>
          <FieldLabel htmlFor="tt-cycle">Days in cycle</FieldLabel>
          <Input id="tt-cycle" max={60} min={1} type="number" value={config.cycleLength ?? 10} onChange={(e) => {
            const value = e.target.valueAsNumber
            if (Number.isInteger(value) && value >= 1 && value <= 60) onChange({ ...config, cycleLength: value, dayToWeekday: undefined, entries: config.entries.filter((entry) => entry.dayLabel <= value) })
          }} />
          <FieldDescription>Shrinking the cycle removes periods on the dropped days.</FieldDescription>
        </Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm">
          <input className="size-4 accent-primary" type="checkbox" checked={Boolean(config.weekendTimetables)} onChange={(e) => onChange({ ...config, weekendTimetables: e.target.checked })} />
          Weekends are school days
        </label>
      </CardContent>
    </Card>
  )
}

function DayCard({ config, dayLabel, isToday, subjects, onChange }: {
  config: TimetableConfig; dayLabel: number; isToday: boolean; subjects: string[]; onChange: (config: TimetableConfig) => void
}) {
  const periods = config.entries.filter((entry) => entry.dayLabel === dayLabel).flatMap((entry) => entry.periods)
  const save = (next: TimetablePeriod[]) => onChange(withDay(config, dayLabel, next))
  const update = (index: number, patch: Partial<TimetablePeriod>) => save(periods.map((period, i) => i === index ? { ...period, ...patch } : period))
  const last = periods.at(-1)

  return (
    <Card size="sm">
      <CardHeader className="gap-1 pb-2">
        <CardTitle className="flex items-center gap-2">Day {dayLabel}{isToday ? <Badge variant="secondary">Today</Badge> : null}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-2">
        {periods.length === 0 ? <p className="text-sm text-muted-foreground">No periods yet.</p> : null}
        {periods.map((period, index) => {
          const error = getTimetablePeriodError(period)
          return (
            <div className="grid gap-1.5 rounded-md border p-2" key={index}>
              <div className="flex gap-1.5">
                <Input aria-label="Period name" className="w-24 shrink-0" value={period.period} onChange={(e) => update(index, { period: e.target.value })} />
                <Input aria-label="Subject" list="tt-subjects" placeholder="Subject" value={period.subject ? periodSubjectName(period) : ""} onChange={(e) => update(index, { subject: e.target.value })} />
                <Button aria-label={`Remove ${period.period}`} onClick={() => save(periods.filter((_, i) => i !== index))} size="icon-sm" variant="ghost"><Trash2 /></Button>
              </div>
              <div className="flex gap-1.5">
                <Input aria-label="Start time" type="time" value={period.startTime} onChange={(e) => update(index, { startTime: e.target.value })} onBlur={() => save(periods.toSorted(byStart))} />
                <Input aria-label="End time" type="time" value={period.endTime} onChange={(e) => update(index, { endTime: e.target.value })} />
                <Input aria-label="Room" placeholder="Room" value={period.location ?? ""} onChange={(e) => update(index, { location: e.target.value })} />
              </div>
              {error ? <FieldError>{error}</FieldError> : null}
            </div>
          )
        })}
        <datalist id="tt-subjects">{subjects.map((name) => <option key={name} value={name} />)}</datalist>
        <Button onClick={() => save([...periods, { period: `Period ${periods.length + 1}`, subject: "", location: "", startTime: last?.endTime ?? "09:00", endTime: last ? bump(last.endTime) : "10:00" }])} size="sm" variant="outline"><Plus />Add period</Button>
      </CardContent>
    </Card>
  )
}

function bump(time: string) {
  const [hours, minutes] = time.split(":").map(Number)
  const total = Math.min(hours * 60 + minutes + 50, 1439)
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function Holidays({ config, onChange }: { config: TimetableConfig; onChange: (config: TimetableConfig) => void }) {
  const [draft, setDraft] = useState<SchoolHoliday>({ name: "", startDate: "", endDate: "" })
  const valid = draft.name.trim() && draft.startDate && draft.endDate >= draft.startDate
  return (
    <Card size="sm">
      <CardHeader className="gap-1 pb-2">
        <CardTitle>School holidays</CardTitle>
        <CardDescription>Days in these ranges don't count toward the cycle.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {config.holidays.length ? (
          <ul className="divide-y rounded-md border">
            {config.holidays.map((holiday, index) => (
              <li className="flex items-center gap-2 px-3 py-1.5 text-sm" key={`${holiday.name}-${index}`}>
                <span className="min-w-0 flex-1 truncate font-medium">{holiday.name}</span>
                <span className="text-xs text-muted-foreground tabular-nums">{holiday.startDate} – {holiday.endDate}</span>
                <Button aria-label={`Remove ${holiday.name}`} onClick={() => onChange({ ...config, holidays: config.holidays.filter((_, i) => i !== index) })} size="icon-sm" variant="ghost"><Trash2 /></Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto_auto]">
          <Input aria-label="Holiday name" placeholder="Term 3 break" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <Input aria-label="Holiday start" type="date" value={draft.startDate} onChange={(e) => setDraft({ ...draft, startDate: e.target.value, endDate: draft.endDate || e.target.value })} />
          <Input aria-label="Holiday end" min={draft.startDate} type="date" value={draft.endDate} onChange={(e) => setDraft({ ...draft, endDate: e.target.value })} />
          <Button disabled={!valid} onClick={() => { onChange({ ...config, holidays: [...config.holidays, { ...draft, name: draft.name.trim() }].toSorted((a, b) => a.startDate.localeCompare(b.startDate)) }); setDraft({ name: "", startDate: "", endDate: "" }) }}><Plus />Add</Button>
        </div>
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
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Import timetable from chatbot</DialogTitle>
          <DialogDescription>Send the prompt to any chatbot with a screenshot of your timetable, then paste its JSON reply. This replaces your current periods.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>1. Copy the prompt</FieldLabel>
              <Button onClick={() => void copy()} size="sm" type="button" variant="outline">{copied ? <ClipboardCheck /> : <ClipboardCopy />}{copied ? "Copied" : "Copy prompt"}</Button>
            </div>
          </Field>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="tt-import">2. Paste the reply</FieldLabel>
            <Textarea aria-invalid={error ? true : undefined} className="font-mono text-xs" id="tt-import" rows={7} value={text} onChange={(e) => { setText(e.target.value); setError(null) }} />
            {error ? <FieldError>{error}</FieldError> : null}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button onClick={onClose} type="button" variant="outline">Cancel</Button>
          <Button disabled={!text.trim()} onClick={() => {
            try { onImport(parseTimetableImport(text, "pasted.json", current)) } catch (e) { setError(e instanceof Error ? e.message : "Could not read this timetable.") }
          }} type="button">Import</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
