import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from"react"
import { format, parseISO, addWeeks, addMonths, startOfDay } from "date-fns"
import { BookOpen, CheckCircle2, Clock, Copy, MapPin, Repeat, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CompactField, DatePickerField, Pill } from "@/components/ui/form-controls"
import TimePicker from "@/components/ui/time-picker"
import { VCE_SUBJECTS, type CalendarEvent, type EventType, type Subject, type TimetableConfig } from "@/lib/types"
import { getTimetablePeriodsForDate, resolveTimetableSubject } from "@/lib/timetable"
import { cn, formatTime, getSubjectById } from "@/lib/utils"

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
 { value:"exam", label:"Exam" },
 { value:"sac", label:"SAC" },
 { value:"practice-sac", label:"Practice SAC" },
 { value:"homework", label:"Homework" },
 { value:"assignment", label:"Assignment" },
 { value:"other", label:"Other" },
 { value:"event", label:"Event" },
]

const RECURRENCE_OPTIONS: { value: string; label: string }[] = [
 { value:"none", label:"No repeat" },
 { value:"weekly", label:"Weekly" },
 { value:"biweekly", label:"Every 2 weeks" },
 { value:"monthly", label:"Monthly" },
]

const DURATION_PRESETS = [30, 60, 90, 120, 180]
const fieldLabelClass = "text-micro font-medium uppercase tracking-wide"
const controlClass = "h-8 text-sm"

const toMin = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m }
const fromMin = (min: number) => { const c = Math.max(0, Math.min(min, 1439)); return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}` }
const formatDuration = (min: number) => min >= 60 ? `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ""}` : `${min}m`

export type RecurrencePattern ="none" |"weekly" |"biweekly" |"monthly"

export interface EventFormValues {
 title: string
 description?: string
 startTime: string
 endTime?: string
 eventType: EventType
 subjectId?: string
 location?: string
 isFinished?: boolean
 finishedAt?: string
 recurrence?: {
 pattern: RecurrencePattern
 endDate?: string
 }
}

interface EventFormInitialValues {
 title?: string
 description?: string
 eventType?: EventType
 subjectId?: string
 location?: string
 date?: Date
 startTime?: string
 duration?: string
 endTime?: string
 isFinished?: boolean
 endDate?: Date
 finishedAt?: string
}

interface EventFormProps {
 customSubjects: Subject[]
 availableSubjects?: Subject[]
 timetableConfig?: TimetableConfig
 initialValues?: EventFormInitialValues
 submitLabel: string
 saving?: boolean
 onCancel: () => void
 onSubmit: (values: EventFormValues) => void
 showFinishedControl?: boolean
 footerStart?: ReactNode
 showRecurrence?: boolean
}

export interface EventDialogProps {
 open: boolean
 onOpenChange: (open: boolean) => void
 event?: CalendarEvent | null
 customSubjects: Subject[]
 availableSubjects?: Subject[]
 timetableConfig?: TimetableConfig
 initialDate?: Date
 onSubmit?: (data: {
 title: string
 description?: string
 startTime: string
 endTime?: string
 eventType: EventType
 subjectId?: string
 location?: string
 }) => Promise<unknown>
 onSubmitMultiple?: (events: {
 title: string
 description?: string
 startTime: string
 endTime?: string
 eventType: EventType
 subjectId?: string
 location?: string
 }[]) => Promise<unknown>
 onDelete?: (id: string) => Promise<unknown>
 onDuplicate?: (event: CalendarEvent) => Promise<unknown>
 onConvertToSession?: (event: CalendarEvent) => void
}

// ── Helpers ─────────────────────────────────────────────────────

function generateRecurringEvents(
 base: Record<string, unknown>,
 pattern:"weekly" |"biweekly" |"monthly",
 endDate?: Date,
 maxEvents = 52,
): Record<string, unknown>[] {
 const events: Record<string, unknown>[] = []
 const start = new Date(base.startTime as string)
 const limit = endDate ?? addWeeks(start, 26)

 let current = start
 for (let i = 0; i < maxEvents && current <= limit; i++) {
 const offset = i === 0 ? 0 : 1
 const eventStart = i === 0 ? current : (
 pattern ==="weekly" ? addWeeks(current, offset) :
 pattern ==="biweekly" ? addWeeks(current, 2) :
 addMonths(current, offset)
 )
 if (eventStart > limit) break

 const baseStart = new Date(base.startTime as string)
 eventStart.setHours(baseStart.getHours(), baseStart.getMinutes(), 0, 0)

 const durationMs = base.endTime
 ? new Date(base.endTime as string).getTime() - baseStart.getTime()
 : 0
 const eventEnd = durationMs > 0 ? new Date(eventStart.getTime() + durationMs) : undefined

 events.push({
 ...base,
 startTime: eventStart.toISOString(),
 endTime: eventEnd?.toISOString(),
 })

 current = eventStart
 }

 return events
}

// ── EventForm (internal) ────────────────────────────────────────

function EventForm({
  customSubjects,
  availableSubjects,
  timetableConfig,
  initialValues,
  submitLabel,
  saving = false,
  onCancel,
  onSubmit,
  showFinishedControl = false,
  footerStart,
  showRecurrence = true,
}: EventFormProps) {
  const [title, setTitle] = useState(initialValues?.title ?? "")
  const [description, setDescription] = useState(initialValues?.description ?? "")
  const [eventType, setEventType] = useState<EventType>(initialValues?.eventType ?? "exam")
  const [subjectId, setSubjectId] = useState(initialValues?.subjectId ?? "")
  const [location, setLocation] = useState(initialValues?.location ?? "")
  const [eventDate, setEventDate] = useState<Date | undefined>(() => initialValues?.date ?? new Date())
  const [endDate, setEndDate] = useState<Date | undefined>(() => initialValues?.endDate)
  const [multiDay, setMultiDay] = useState(Boolean(initialValues?.endDate))
  const [startTime, setStartTime] = useState(initialValues?.startTime ?? "09:00")
  // Empty means "no end time"; new events default to a two hour block.
  const [endTime, setEndTime] = useState(() => {
    if (initialValues?.endTime) {
      const parsed = parseISO(initialValues.endTime)
      return Number.isNaN(parsed.getTime()) ? "" : format(parsed, "HH:mm")
    }
    return initialValues?.startTime ? "" : fromMin(toMin("09:00") + 120)
  })
  const [isFinished, setIsFinished] = useState(initialValues?.isFinished ?? false)
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>("none")
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<Date | undefined>(undefined)

  const baseSubjects = availableSubjects ?? [...VCE_SUBJECTS, ...customSubjects]
  const initialSubject = getSubjectById(initialValues?.subjectId)
  const subjects = initialSubject && !baseSubjects.some((subject) => subject.id === initialSubject.id)
    ? [initialSubject, ...baseSubjects]
    : baseSubjects

  const startAt = useMemo(() => {
    if (!eventDate) return undefined
    const d = new Date(eventDate)
    d.setHours(Math.floor(toMin(startTime) / 60), toMin(startTime) % 60, 0, 0)
    return d
  }, [eventDate, startTime])
  const effectiveEnd = useMemo(() => {
    if (!endTime || !startAt) return undefined
    const d = new Date(multiDay && endDate ? endDate : startAt)
    d.setHours(Math.floor(toMin(endTime) / 60), toMin(endTime) % 60, 0, 0)
    return d > startAt ? d : undefined
  }, [endTime, startAt, multiDay, endDate])
  const endInvalid = Boolean(endTime) && !effectiveEnd
  const durationMin = startAt && effectiveEnd ? Math.round((effectiveEnd.getTime() - startAt.getTime()) / 60000) : undefined

  const timetableClasses = eventDate && timetableConfig
    ? getTimetablePeriodsForDate(eventDate, timetableConfig).map((period) => ({ period, subject: resolveTimetableSubject(period.subject, subjects) }))
    : []
  const suggestions = subjectId ? timetableClasses.filter(({ subject }) => subject?.id === subjectId) : timetableClasses
  const usingTimetable = suggestions.some(({ period }) => period.startTime === startTime && period.endTime === endTime)
  const use24Hour = timetableConfig?.viewSettings?.use24Hour ?? false

  const changeStart = (value: string) => {
    // Keep the duration when the start moves on a single-day event.
    if (value && endTime && !multiDay && toMin(endTime) > toMin(startTime)) setEndTime(fromMin(toMin(value) + toMin(endTime) - toMin(startTime)))
    setStartTime(value)
  }
  const changeDate = (date: Date | undefined) => {
    setEventDate(date)
    if (date && endDate && endDate < date) setEndDate(date)
  }
  const toggleMultiDay = () => {
    setMultiDay((current) => !current)
    setEndDate((current) => current ?? eventDate)
  }

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !startAt || endInvalid) return
    onSubmit({
      title: title.trim(),
      description: description.trim() ? description.trim() : undefined,
      startTime: startAt.toISOString(),
      endTime: effectiveEnd?.toISOString(),
      eventType,
      subjectId: subjectId || undefined,
      location: location.trim() ? location.trim() : undefined,
      isFinished,
      finishedAt: isFinished ? (initialValues?.finishedAt ?? new Date().toISOString()) : undefined,
      recurrence: recurrencePattern !== "none" ? { pattern: recurrencePattern, endDate: recurrenceEndDate?.toISOString() } : undefined,
    })
  }

  return (
    <form onSubmit={handleSubmit} className="grid min-h-0 grid-rows-[minmax(0,1fr)_auto]">
      <div className="grid gap-3 overflow-y-auto p-4">
        <Input
          aria-label="Event title"
          placeholder="Event title, e.g. Methods exam"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          required
          autoFocus
          className="font-medium"
        />

        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Event type">
          {EVENT_TYPE_OPTIONS.map((option) => (
            <Pill key={option.value} active={eventType === option.value} onClick={() => setEventType(option.value as EventType)}>
              {option.label}
            </Pill>
          ))}
          {showFinishedControl && (
            <Pill active={isFinished} className="ml-auto" onClick={() => setIsFinished((current) => !current)}>
              <CheckCircle2 className={cn("size-3.5", isFinished && "text-primary")} />Finished
            </Pill>
          )}
        </div>

        <div className={cn("grid gap-2 sm:grid-cols-3", multiDay && "sm:grid-cols-[1.3fr_1fr_1.3fr_1fr]")}>
          <DatePickerField label={multiDay ? "Start date" : "Date"} date={eventDate} onDateChange={changeDate} formatPattern="EEE d MMM" labelClassName={fieldLabelClass} buttonClassName={controlClass} />
          <CompactField label="Start">
            <TimePicker value={startTime} onChange={(event) => changeStart(event.target.value)} className={controlClass} aria-label="Start time" />
          </CompactField>
          {multiDay && (
            <DatePickerField label="End date" date={endDate} onDateChange={setEndDate} disabledDays={eventDate ? { before: startOfDay(eventDate) } : undefined} formatPattern="EEE d MMM" labelClassName={fieldLabelClass} buttonClassName={controlClass} />
          )}
          <CompactField label="End">
            <TimePicker value={endTime} onChange={(event) => setEndTime(event.target.value)} className={cn(controlClass, endInvalid && "border-destructive")} aria-label="End time" aria-invalid={endInvalid} />
          </CompactField>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {DURATION_PRESETS.map((minutes) => (
            <Pill key={minutes} active={durationMin === minutes && !multiDay} disabled={multiDay} className="h-6 px-1.5" onClick={() => setEndTime(fromMin(toMin(startTime) + minutes))}>
              {formatDuration(minutes)}
            </Pill>
          ))}
          <Pill active={multiDay} className="h-6 px-1.5" onClick={toggleMultiDay}>Multi-day</Pill>
          <span className={cn("ml-auto text-xs tabular-nums", endInvalid ? "text-destructive" : "text-muted-foreground")}>
            {endInvalid ? "End must be after start" : durationMin !== undefined ? formatDuration(durationMin) : ""}
          </span>
        </div>

        {!usingTimetable && suggestions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <Clock className="size-3.5 text-primary" aria-hidden="true" />
            <span className="mr-1 text-xs text-muted-foreground">Timetable</span>
            {suggestions.map(({ period, subject }) => (
              <Pill
                key={`${period.subject}-${period.period}-${period.startTime}-${period.endTime}`}
                className="h-6 px-1.5"
                title={subject ? `Use ${subject.name} class time and subject` : "Use class time"}
                onClick={() => {
                  if (subject) setSubjectId(subject.id)
                  setStartTime(period.startTime)
                  setEndTime(period.endTime)
                  setMultiDay(false)
                  setEndDate(undefined)
                }}
              >
                {subject?.shortCode ?? (period.subject.trim() || period.period)} · {formatTime(period.startTime, use24Hour)}–{formatTime(period.endTime, use24Hour)}
              </Pill>
            ))}
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <CompactField label="Subject">
            <Select value={subjectId || "_none"} onValueChange={(value) => setSubjectId(value === "_none" ? "" : value)}>
              <SelectTrigger className={cn(controlClass, "w-full")}><SelectValue placeholder="No subject" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="_none">No subject</SelectItem>
                {subjects.map((subject) => <SelectItem key={subject.id} value={subject.id}>{subject.shortCode} {subject.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </CompactField>
          <CompactField label="Location">
            <div className="relative">
              <MapPin className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Room, hall, campus" value={location} onChange={(event) => setLocation(event.target.value)} className={cn(controlClass, "pl-8")} />
            </div>
          </CompactField>
          {showRecurrence && (
            <>
              <CompactField label="Repeat">
                <Select value={recurrencePattern} onValueChange={(value) => setRecurrencePattern(value as RecurrencePattern)}>
                  <SelectTrigger className={cn(controlClass, "w-full")}><Repeat className="size-3.5 text-muted-foreground" /><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {RECURRENCE_OPTIONS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </CompactField>
              {recurrencePattern !== "none" && (
                <DatePickerField label="Repeat until" placeholder="No end (26 weeks)" date={recurrenceEndDate} onDateChange={setRecurrenceEndDate} disabledDays={eventDate ? { before: startOfDay(eventDate) } : undefined} formatPattern="EEE d MMM yyyy" labelClassName={fieldLabelClass} buttonClassName={controlClass} />
              )}
            </>
          )}
        </div>

        <CompactField label="Notes">
          <Textarea placeholder="Optional notes or requirements" value={description} onChange={(event) => setDescription(event.target.value)} rows={2} className="min-h-0 resize-none text-sm" />
        </CompactField>
      </div>

      <DialogFooter className={cn("m-0 rounded-none px-4 py-2.5", footerStart && "sm:justify-between")}>
        {footerStart}
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="sm" disabled={!title.trim() || endInvalid || saving}>{saving ? "Saving…" : submitLabel}</Button>
        </div>
      </DialogFooter>
    </form>
  )
}

// ── EventDialog (exported) ──────────────────────────────────────

export function EventDialog({
  open,
  onOpenChange,
  event,
  customSubjects,
  availableSubjects,
  timetableConfig,
  initialDate,
  onSubmit,
  onSubmitMultiple,
  onDelete,
  onDuplicate,
  onConvertToSession,
}: EventDialogProps) {
  const submittingRef = useRef(false)
  const [saving, setSaving] = useState(false)
  const isEditMode = Boolean(event)
  const existingEvent = isEditMode ? event! : null

  useEffect(() => {
  if (open) submittingRef.current = false
  }, [open])

  // Errors keep the draft: `false` is the shared failure signal from the entry
  // points, and a rejected commit must not close the form.
  const handleSubmit = async (values: EventFormValues) => {
  if (submittingRef.current) return
  submittingRef.current = true
  setSaving(true)
  const finish = (result: unknown) => {
  if (result === false) { submittingRef.current = false; return }
  onOpenChange(false)
  }
  try {
  if (existingEvent) {
  const { id } = existingEvent
  finish(await onSubmit?.({
  id,
  ...values,
  } as Parameters<NonNullable<typeof onSubmit>>[0]))
  } else if (values.recurrence && values.recurrence.pattern !=="none" && onSubmitMultiple) {
  const recurringEvents = generateRecurringEvents(
  {
  title: values.title,
  description: values.description,
  startTime: values.startTime,
  endTime: values.endTime,
  eventType: values.eventType,
  subjectId: values.subjectId,
  location: values.location,
  },
  values.recurrence.pattern,
  values.recurrence.endDate ? new Date(values.recurrence.endDate) : undefined,
  )
finish(await onSubmitMultiple(recurringEvents as Parameters<typeof onSubmitMultiple>[0]))
  } else if (onSubmit) {
finish(await onSubmit(values))
  }
  } catch (error: unknown) {
  submittingRef.current = false
  console.error("Could not save the event:", error)
  } finally {
  setSaving(false)
  }
  }

  const handleDuplicate = async () => {
  if (!existingEvent || !onDuplicate) return
  submittingRef.current = true
  setSaving(true)
  try {
  await onDuplicate(existingEvent)
  onOpenChange(false)
  } catch (error: unknown) {
  submittingRef.current = false
  console.error("Could not duplicate the event:", error)
  } finally {
  setSaving(false)
  }
  }

  const handleDelete = async () => {
  if (!existingEvent || !onDelete) return
  const { id } = existingEvent
  if (await onDelete(id) === false) { submittingRef.current = false; return }
  onOpenChange(false)
  }

  const start = existingEvent ? parseISO(existingEvent.startTime) : (initialDate ? new Date(initialDate) : new Date())
  const end = existingEvent?.endTime ? parseISO(existingEvent.endTime) : null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="grid-rows-[auto_minmax(0,1fr)] gap-0 p-0 sm:max-w-xl sm:p-0">
        <DialogHeader className="gap-0 border-b py-2.5 pl-4 pr-12">
          <DialogTitle className="text-sm">{isEditMode ? "Edit event" : "New event"}</DialogTitle>
          <DialogDescription className="sr-only">
            {format(start, "EEEE, MMMM d")}{end ? ` · ${format(start, "h:mm a")} to ${format(end, "h:mm a")}` : ""}
          </DialogDescription>
        </DialogHeader>
        <EventForm
          key={isEditMode && existingEvent ? `edit-${existingEvent.id}` : "new"}
          customSubjects={customSubjects}
          availableSubjects={availableSubjects}
          timetableConfig={timetableConfig}
          initialValues={existingEvent ? {
            title: existingEvent.title,
            description: existingEvent.description,
            eventType: existingEvent.eventType,
            subjectId: existingEvent.subjectId,
            location: existingEvent.location,
            date: start,
            startTime: format(start, "HH:mm"),
            endTime: existingEvent.endTime,
            endDate: end && format(end, "yyyy-MM-dd") !== format(start, "yyyy-MM-dd") ? end : undefined,
            isFinished: existingEvent.isFinished,
            finishedAt: existingEvent.finishedAt,
          } : { date: initialDate ? new Date(initialDate) : new Date() }}
          submitLabel={isEditMode ? "Save" : "Add event"}
          saving={saving}
          showFinishedControl={isEditMode}
          showRecurrence={!isEditMode}
          footerStart={isEditMode && (onDuplicate || onDelete || onConvertToSession) ? (
            <div className="flex flex-wrap gap-1">
              {onConvertToSession && existingEvent && (
                <Button type="button" variant="ghost" size="sm" onClick={() => onConvertToSession(existingEvent)}>
                  <BookOpen />Study session
                </Button>
              )}
              {onDuplicate && (
                <Button type="button" variant="ghost" size="sm" onClick={handleDuplicate}>
                  <Copy />Next week
                </Button>
              )}
              {onDelete && (
                <Button type="button" variant="ghost" size="sm" onClick={handleDelete} className="text-destructive hover:text-destructive">
                  <Trash2 />Delete
                </Button>
              )}
            </div>
          ) : undefined}
          onCancel={() => onOpenChange(false)}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}
