import { useMemo, useState } from "react"
import { CalendarClock, Copy, Trash2 } from "lucide-react"

import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Textarea } from "./ui/textarea"
import { classPeriodsOn, isTimetableBreakLabel, periodMatchesSubject, periodSubjectName, subjectIdFor, subjectNameFor } from "../lib/class-timetable"
import { localDate } from "../lib/learning-workspace"
import type { CalendarEvent, EventType, TimetableConfig, TimetablePeriod } from "../lib/types"

const TYPES: Array<{ value: EventType; label: string }> = [
  { value: "event", label: "Event" },
  { value: "sac", label: "SAC" },
  { value: "practice-sac", label: "Practice SAC" },
  { value: "exam", label: "Exam" },
  { value: "assignment", label: "Assignment" },
  { value: "homework", label: "Homework" },
  { value: "other", label: "Other" },
]
const REPEATS = [
  { value: "none", label: "Does not repeat" },
  { value: "weekly", label: "Every week" },
  { value: "biweekly", label: "Every 2 weeks" },
  { value: "monthly", label: "Every month" },
]
const DURATIONS = [30, 45, 60, 90, 120, 180]
const NO_SUBJECT = "__none"
const MAX_OCCURRENCES = 52

const toMinutes = (time: string) => { const [hours, minutes] = time.split(":").map(Number); return hours * 60 + minutes }
const fromMinutes = (total: number) => `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
const timeInput = (iso: string) => { const date = new Date(iso); return fromMinutes(date.getHours() * 60 + date.getMinutes()) }
const toIso = (date: string, time: string) => new Date(`${date}T${time}:00`).toISOString()

function shiftDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number)
  return localDate(new Date(year, month - 1, day + days))
}

function shift(date: string, repeat: string, step: number) {
  const [year, month, day] = date.split("-").map(Number)
  if (repeat === "monthly") return localDate(new Date(year, month - 1 + step, day))
  return shiftDays(date, step * (repeat === "weekly" ? 7 : 14))
}

export function EventDialog({ open, event, defaultDate, subjects, classTimetable, onOpenChange, onSave, onDelete }: {
  open: boolean
  event: CalendarEvent | null
  defaultDate: string
  subjects: string[]
  classTimetable?: TimetableConfig
  onOpenChange: (open: boolean) => void
  onSave: (events: CalendarEvent[], isNew: boolean) => void
  onDelete: (id: string) => void
}) {
  const start = event ? new Date(event.startTime) : null
  const end = event?.endTime ? new Date(event.endTime) : null
  const [title, setTitle] = useState(event?.title ?? "")
  const [type, setType] = useState<EventType>(event?.eventType ?? "event")
  const [subject, setSubject] = useState(subjectNameFor(event?.subjectId))
  const [date, setDate] = useState(start ? localDate(start) : defaultDate)
  const [endDate, setEndDate] = useState(start && end ? localDate(end) : "")
  const [startTime, setStartTime] = useState(event ? timeInput(event.startTime) : "09:00")
  const [endTime, setEndTime] = useState(event?.endTime ? timeInput(event.endTime) : "10:00")
  const [location, setLocation] = useState(event?.location ?? "")
  const [description, setDescription] = useState(event?.description ?? "")
  const [finished, setFinished] = useState(Boolean(event?.isFinished))
  const [repeat, setRepeat] = useState("none")
  const [repeatUntil, setRepeatUntil] = useState("")
  const [error, setError] = useState<string | null>(null)

  const multiDay = Boolean(endDate) && endDate !== date
  const subjectOptions = useMemo(() => [...new Set([...subjects, ...(subject ? [subject] : [])])], [subjects, subject])
  const periods = useMemo(() => classPeriodsOn(date, classTimetable).filter((period) => !isTimetableBreakLabel(period.period)), [date, classTimetable])
  const suggestions = periods.filter((period) => subject ? periodMatchesSubject(period, subject) : Boolean(period.subject))
  const aligned = !multiDay && suggestions.some((period) => period.startTime === startTime && period.endTime === endTime)
  const duration = !multiDay && toMinutes(endTime) > toMinutes(startTime) ? toMinutes(endTime) - toMinutes(startTime) : null

  function align(period: TimetablePeriod) {
    setStartTime(period.startTime)
    setEndTime(period.endTime)
    setEndDate("")
    if (!subject && period.subject) setSubject(periodSubjectName(period))
    if (!location && period.location) setLocation(period.location)
  }

  function submit() {
    if (!title.trim()) return setError("Give the event a title.")
    if (!date) return setError("Choose a date.")
    const finish = endDate || date
    if (finish < date || (finish === date && toMinutes(endTime) <= toMinutes(startTime))) {
      return setError(finish < date ? "The end date can't be before the start." : "The end time must be after the start time.")
    }
    if (!event && repeat !== "none" && (!repeatUntil || repeatUntil < date)) return setError("Choose the date the repeat ends.")
    const now = new Date().toISOString()
    const make = (day: string, id: string, created: string): CalendarEvent => {
      const offset = Math.round((new Date(`${finish}T00:00:00`).getTime() - new Date(`${date}T00:00:00`).getTime()) / 86_400_000)
      return {
        ...event,
        id,
        title: title.trim(),
        description: description.trim() || undefined,
        startTime: toIso(day, startTime),
        endTime: toIso(offset ? shiftDays(day, offset) : day, endTime),
        eventType: type,
        subjectId: subject ? subjectIdFor(subject) : undefined,
        location: location.trim() || undefined,
        isFinished: finished,
        finishedAt: finished ? event?.finishedAt ?? now : undefined,
        created_at: created,
        updated_at: now,
      }
    }
    if (event) return onSave([make(date, event.id, event.created_at)], false)
    const days = [date]
    if (repeat !== "none") {
      for (let step = 1; days.length < MAX_OCCURRENCES; step++) {
        const next = shift(date, repeat, step)
        if (next > repeatUntil) break
        days.push(next)
      }
    }
    onSave(days.map((day) => make(day, crypto.randomUUID(), now)), true)
  }

  function duplicate() {
    if (!event) return
    const now = new Date().toISOString()
    onSave([{ ...event, id: crypto.randomUUID(), isFinished: false, finishedAt: undefined, created_at: now, updated_at: now }], true)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{event ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription>Events sync with the Focal desktop app.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="event-title">Title</FieldLabel>
            <Input autoFocus id="event-title" value={title} onChange={(e) => { setTitle(e.target.value); setError(null) }} placeholder="Methods SAC 2" />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="event-type">Type</FieldLabel>
              <Select items={TYPES} value={type} onValueChange={(value) => value && setType(value as EventType)}>
                <SelectTrigger className="w-full" id="event-type"><SelectValue /></SelectTrigger>
                <SelectContent>{TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <Field>
              <FieldLabel htmlFor="event-subject">Subject</FieldLabel>
              <Select
                items={[{ value: NO_SUBJECT, label: "No subject" }, ...subjectOptions.map((name) => ({ value: name, label: name }))]}
                value={subject || NO_SUBJECT}
                onValueChange={(value) => setSubject(!value || value === NO_SUBJECT ? "" : value)}
              >
                <SelectTrigger className="w-full" id="event-subject"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_SUBJECT}>No subject</SelectItem>
                  {subjectOptions.map((name) => <SelectItem key={name} value={name}>{name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="event-date">Date</FieldLabel>
              <Input id="event-date" type="date" value={date} onChange={(e) => { setDate(e.target.value); setError(null) }} />
            </Field>
            <Field>
              <FieldLabel htmlFor="event-end-date">Ends on <span className="text-muted-foreground">(multi-day)</span></FieldLabel>
              <Input id="event-end-date" type="date" min={date} value={endDate} onChange={(e) => { setEndDate(e.target.value); setError(null) }} />
            </Field>
            <Field>
              <FieldLabel htmlFor="event-start">Start</FieldLabel>
              <Input id="event-start" type="time" value={startTime} onChange={(e) => { setStartTime(e.target.value); setError(null) }} />
            </Field>
            <Field>
              <FieldLabel htmlFor="event-end">End</FieldLabel>
              <Input id="event-end" type="time" value={endTime} onChange={(e) => { setEndTime(e.target.value); setError(null) }} />
            </Field>
          </div>
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Duration">
            {DURATIONS.map((minutes) => (
              <Button
                key={minutes}
                aria-pressed={duration === minutes}
                onClick={() => { setEndTime(fromMinutes(Math.min(toMinutes(startTime) + minutes, 1439))); setEndDate("") }}
                size="sm"
                type="button"
                variant={duration === minutes ? "secondary" : "outline"}
              >
                {minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}` : `${minutes}m`}
              </Button>
            ))}
          </div>

          {suggestions.length ? (
            <div className="grid gap-2 rounded-lg border bg-muted/30 p-3" aria-label="Timetable">
              <p className="flex items-center gap-2 text-sm font-medium">
                <CalendarClock className="size-4" />
                {aligned ? "Aligned to your timetable" : subject ? "This subject is on your timetable that day" : "Classes on your timetable that day"}
                {aligned ? <Badge variant="secondary">Aligned</Badge> : null}
              </p>
              {!aligned ? <p className="text-xs text-muted-foreground">Pick a class to use its time.</p> : null}
              <div className="flex flex-wrap gap-1.5">
                {suggestions.map((period, index) => (
                  <Button key={`${period.period}-${index}`} onClick={() => align(period)} size="sm" type="button" variant={period.startTime === startTime && period.endTime === endTime ? "secondary" : "outline"}>
                    {period.period} · {periodSubjectName(period)} · {period.startTime}–{period.endTime}
                  </Button>
                ))}
              </div>
            </div>
          ) : null}

          <Field>
            <FieldLabel htmlFor="event-location">Location <span className="text-muted-foreground">(optional)</span></FieldLabel>
            <Input id="event-location" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Room 12" />
          </Field>
          <Field>
            <FieldLabel htmlFor="event-description">Notes <span className="text-muted-foreground">(optional)</span></FieldLabel>
            <Textarea id="event-description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>

          {event ? (
            <label className="flex items-center gap-2 text-sm">
              <input className="size-4 accent-primary" type="checkbox" checked={finished} onChange={(e) => setFinished(e.target.checked)} />
              Mark as finished
            </label>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="event-repeat">Repeat</FieldLabel>
                <Select items={REPEATS} value={repeat} onValueChange={(value) => value && setRepeat(value)}>
                  <SelectTrigger className="w-full" id="event-repeat"><SelectValue /></SelectTrigger>
                  <SelectContent>{REPEATS.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              {repeat !== "none" ? (
                <Field>
                  <FieldLabel htmlFor="event-repeat-until">Until</FieldLabel>
                  <Input id="event-repeat-until" type="date" min={date} value={repeatUntil} onChange={(e) => setRepeatUntil(e.target.value)} />
                  <FieldDescription>Up to {MAX_OCCURRENCES} occurrences.</FieldDescription>
                </Field>
              ) : null}
            </div>
          )}
          {error ? <FieldError>{error}</FieldError> : null}
        </FieldGroup>
        <DialogFooter className="sm:justify-between">
          {event ? (
            <div className="flex gap-1.5">
              <Button onClick={() => onDelete(event.id)} type="button" variant="outline"><Trash2 />Delete</Button>
              <Button onClick={duplicate} type="button" variant="outline"><Copy />Duplicate</Button>
            </div>
          ) : <span />}
          <div className="flex gap-1.5">
            <Button onClick={() => onOpenChange(false)} type="button" variant="outline">Cancel</Button>
            <Button onClick={submit} type="button">{event ? "Save changes" : "Add event"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
