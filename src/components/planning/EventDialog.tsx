import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from"react"
import { addMinutes, format, parseISO, addWeeks, addMonths, startOfDay } from"date-fns"
import { CalendarIcon, CheckCircle2, Clock, Copy, MapPin, Repeat, Tag, Trash2, X } from"lucide-react"
import {
 Dialog,
 DialogBody,
 DialogContent,
 DialogDescription,
 DialogFooter,
 DialogHeader,
 DialogTitle,
} from"@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import { DatePickerField, FormField, FormSection, SelectField } from "@/components/ui/form-controls"
import TimePicker from "@/components/ui/time-picker"
import { VCE_SUBJECTS, type CalendarEvent, type EventType, type Subject, type TimetableConfig } from"@/lib/types"
import { getTimetablePeriodsForDate, resolveTimetableSubject } from "@/lib/timetable"
import { cn, formatTime, getSubjectById } from"@/lib/utils"

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

const fieldLabelClass ="text-control font-medium text-muted-foreground"
const sectionIconClass ="h-3.5 w-3.5 text-muted-foreground"
const sectionClass ="rounded-lg border border-border/70 bg-muted/20 p-3 dark:border-input/70 dark:bg-input/20"

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
 }) => void
 onSubmitMultiple?: (events: {
 title: string
 description?: string
 startTime: string
 endTime?: string
 eventType: EventType
 subjectId?: string
 location?: string
 }[]) => void
 onDelete?: (id: string) => void
 onDuplicate?: (event: CalendarEvent) => void | Promise<void>
}

// ── Helpers ─────────────────────────────────────────────────────

function getDurationMinutes(event: CalendarEvent) {
 if (!event.endTime) return""
 const durationMs = parseISO(event.endTime).getTime() - parseISO(event.startTime).getTime()
 return String(Math.round(durationMs / (1000 * 60)))
}

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
 onCancel,
 onSubmit,
 showFinishedControl = false,
 footerStart,
 showRecurrence = true,
}: EventFormProps) {
 const [title, setTitle] = useState(initialValues?.title ??"")
 const [description, setDescription] = useState(initialValues?.description ??"")
 const [eventType, setEventType] = useState<EventType>(initialValues?.eventType ??"exam")
 const [subjectId, setSubjectId] = useState(initialValues?.subjectId ??"")
 const [location, setLocation] = useState(initialValues?.location ??"")
 const [eventDate, setEventDate] = useState<Date | undefined>(() => initialValues?.date ?? new Date())
 const [endDate, setEndDate] = useState<Date | undefined>(() => initialValues?.endDate ?? undefined)
 const [startTime, setStartTime] = useState(initialValues?.startTime ??"09:00")
 const [duration, setDuration] = useState(initialValues?.duration ??"120")
 const [endTimeMode, setEndTimeMode] = useState<"duration" |"end">(() => {
 if (initialValues?.endTime) return"end"
 return"duration"
 })
 const [explicitEndTime, setExplicitEndTime] = useState<string>(() => {
 if (initialValues?.endTime) {
 const parsed = parseISO(initialValues.endTime)
 if (!Number.isNaN(parsed.getTime())) {
 return format(parsed,"HH:mm")
 }
 }
 return""
 })
 const [isFinished, setIsFinished] = useState(initialValues?.isFinished ?? false)
 const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern>("none")
 const [recurrenceEndDate, setRecurrenceEndDate] = useState<Date | undefined>(undefined)
 const [timetablePromptDismissed, setTimetablePromptDismissed] = useState(false)

 const baseSubjects = availableSubjects ?? [...VCE_SUBJECTS, ...customSubjects]
 const initialSubject = getSubjectById(initialValues?.subjectId)
 const subjects = initialSubject && !baseSubjects.some((subject) => subject.id === initialSubject.id)
 ? [initialSubject, ...baseSubjects]
 : baseSubjects
 const multiDaySpanDays = useMemo(() => {
 if (!eventDate || !endDate) return 1
 const raw = format(endDate,"yyyy-MM-dd") !== format(eventDate,"yyyy-MM-dd")
 if (!raw) return 1
 return Math.round((new Date(endDate).setHours(0,0,0,0) - new Date(eventDate).setHours(0,0,0,0)) / (1000 * 60 * 60 * 24)) + 1
 }, [eventDate, endDate])

 const isMultiDay = multiDaySpanDays > 1
 const dayTimetablePeriods = useMemo(() => {
 if (!eventDate || !timetableConfig) return []
 return getTimetablePeriodsForDate(eventDate, timetableConfig)
 }, [eventDate, timetableConfig])
 const timetableClasses = dayTimetablePeriods.map((period) => {
 const subject = resolveTimetableSubject(period.subject, subjects)
 return { period, subject }
 })
 const suggestedTimetableClasses = subjectId
 ? timetableClasses.filter(({ subject }) => subject?.id === subjectId)
 : timetableClasses

 const effectiveEndTime = useMemo(() => {
 const [sh, sm] = startTime.split(":").map(Number)
 const start = new Date(eventDate ?? new Date())
 start.setHours(sh, sm, 0, 0)

 const endDateToUse = isMultiDay ? endDate : eventDate
 if (!endDateToUse) return undefined

 if (endTimeMode ==="end" && explicitEndTime) {
 const [eh, em] = explicitEndTime.split(":").map(Number)
 const end = new Date(endDateToUse)
 end.setHours(eh, em, 0, 0)
 if (end > start) return end
 return undefined
 }

 const durationMinutes = Number.parseInt(duration, 10)
 if (Number.isFinite(durationMinutes) && durationMinutes > 0) {
 if (isMultiDay && endDate) {
 const end = new Date(endDate)
 end.setHours(sh, sm, 0, 0)
 return end >= start ? end : undefined
 }
 return addMinutes(start, durationMinutes)
 }
 return undefined
 }, [startTime, eventDate, endDate, isMultiDay, duration, endTimeMode, explicitEndTime])
 const isUsingTimetablePeriod = suggestedTimetableClasses.some(({ period }) => (
 period.startTime === startTime
 && effectiveEndTime
 && period.endTime === format(effectiveEndTime,"HH:mm")
 ))
 const applyTimetablePeriod = (period: (typeof dayTimetablePeriods)[number], selectedSubjectId?: string) => {
 if (selectedSubjectId) setSubjectId(selectedSubjectId)
 setStartTime(period.startTime)
 setExplicitEndTime(period.endTime)
 setEndTimeMode("end")
 setEndDate(eventDate)
 }

 const computedDurationMinutes = useMemo(() => {
 if (endTimeMode !=="end" || !explicitEndTime) return undefined
 const [sh, sm] = startTime.split(":").map(Number)
 const [eh, em] = explicitEndTime.split(":").map(Number)
 const start = new Date(eventDate ?? new Date())
 start.setHours(sh, sm, 0, 0)
 const end = new Date(endDate ?? eventDate ?? new Date())
 end.setHours(eh, em, 0, 0)
 if (end <= start) return undefined
 return Math.round((end.getTime() - start.getTime()) / (1000 * 60))
 }, [startTime, eventDate, endDate, explicitEndTime, endTimeMode])

 const handleSubmit = (event: FormEvent) => {
 event.preventDefault()
 if (!title.trim() || !eventDate) return

 const [hours, minutes] = startTime.split(":").map(Number)
 const start = new Date(eventDate)
 start.setHours(hours, minutes, 0, 0)

 onSubmit({
 title: title.trim(),
 description: description.trim() ? description.trim() : undefined,
 startTime: start.toISOString(),
 endTime: effectiveEndTime?.toISOString(),
 eventType,
 subjectId: subjectId || undefined,
 location: location.trim() ? location.trim() : undefined,
 isFinished,
 finishedAt: isFinished ? (initialValues?.finishedAt ?? new Date().toISOString()) : undefined,
 recurrence: recurrencePattern !=="none" ? {
 pattern: recurrencePattern,
 endDate: recurrenceEndDate?.toISOString(),
 } : undefined,
 })
 }

 const computeEndTimeFromCurrent = () => {
 const [sh, sm] = startTime.split(":").map(Number)
 const d = new Date(eventDate ?? new Date())
 d.setHours(sh, sm, 0, 0)
 const minutes = Number.parseInt(duration, 10)
 d.setMinutes(d.getMinutes() + (Number.isFinite(minutes) && minutes > 0 ? minutes : 60))
 return format(d,"HH:mm")
 }

 const computeDurationFromCurrent = () => {
 if (!explicitEndTime) return
 const [sh, sm] = startTime.split(":").map(Number)
 const [eh, em] = explicitEndTime.split(":").map(Number)
 const startMin = sh * 60 + sm
 const endMin = eh * 60 + em
 const delta = endMin - startMin
 if (delta > 0) setDuration(String(delta))
 }

 const handleEndTimeChange = (value: string) => {
 setExplicitEndTime(value)
 if (value) setEndTimeMode("end")
 }

 const handleDurationChange = (value: string) => {
 setDuration(value)
 setEndTimeMode("duration")
 }

 return (
 <form onSubmit={handleSubmit} className="grid min-h-0">
 <DialogBody className="flex max-h-[min(72vh,40rem)]">
 <ScrollArea className="min-h-0 flex-1">
 <div className="grid gap-5 px-5 py-5">
 <section className="grid gap-3">
 <FormField
 label="Event title"
 labelClassName={fieldLabelClass}
 labelAccessory={
 <span className="text-micro font-medium uppercase tracking-normal text-muted-foreground/70">
 Required
 </span>
 }
 >
 <Input
 placeholder="e.g. Methods exam"
 value={title}
 onChange={(event) => setTitle(event.target.value)}
 required
 className="h-10 rounded-lg bg-background/65 text-base"
 />
 </FormField>
 </section>

 <FormSection
 title="Classification"
 icon={<Tag className={sectionIconClass} />}
 className="rounded-lg border border-border/70 bg-muted/20 p-3"
 >
 <div className="grid gap-3 sm:grid-cols-2">
 <SelectField
 label="Type"
 labelClassName={fieldLabelClass}
 value={eventType}
 onValueChange={(value) => setEventType(value as EventType)}
 options={EVENT_TYPE_OPTIONS}
 />
 <SelectField
 label="Subject"
 labelClassName={fieldLabelClass}
 value={subjectId ||"_none"}
 onValueChange={(value) => setSubjectId(value ==="_none" ?"" : value)}
 placeholder="No subject"
 options={[
 { value:"_none", label:"No subject" },
 ...subjects.map((subject) => ({ value: subject.id, label: `${subject.shortCode} ${subject.name}` })),
 ]}
 />
 </div>
 {showFinishedControl && (
 <Button
 type="button"
 onClick={() => setIsFinished((current) => !current)}
 variant={isFinished ? "secondary" : "outline"}
 className="h-auto w-full justify-between px-3 py-2.5 text-left whitespace-normal"
 aria-pressed={isFinished}
 >
 <span className="min-w-0">
 <span className="block text-sm font-medium">Finished</span>
 <span className="block text-xs text-muted-foreground">
 Past events are marked finished automatically.
 </span>
 </span>
 <CheckCircle2 className={cn("h-4 w-4 shrink-0", isFinished &&"text-primary")} />
 </Button>
 )}
 </FormSection>

 <FormSection
 title="Schedule"
 icon={<CalendarIcon className={sectionIconClass} />}
 className={sectionClass}
 >
 <div className="grid gap-3 sm:grid-cols-2">
 <DatePickerField
 label="Start date"
 date={eventDate}
 onDateChange={setEventDate}
 buttonClassName="h-10 rounded-lg bg-background/65"
 />
 <DatePickerField
 label="End date"
 date={endDate ?? eventDate}
 onDateChange={(date) => setEndDate(date)}
 disabledDays={eventDate ? { before: startOfDay(eventDate) } : undefined}
 buttonClassName="h-10 rounded-lg bg-background/65"
 />
 </div>

 {isMultiDay && (
 <div className="flex items-center gap-2 rounded-lg bg-primary/8 px-3 py-2">
 <span className="text-xs font-semibold text-primary tabular-nums">{multiDaySpanDays} days</span>
 <span className="text-xs text-muted-foreground">
 {format(eventDate!,"MMM d")} &ndash; {format(endDate!,"MMM d, yyyy")}
 </span>
 </div>
 )}

 <div className="mt-3 grid gap-3 sm:grid-cols-2">            <FormField label="Start time" labelClassName={fieldLabelClass}>
              <TimePicker
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                className="h-10 bg-background/65 text-sm"
                aria-label="Start time"
              />
            </FormField>

 <FormField
 label={endTimeMode ==="end" ?"End time" :"Duration"}
 labelClassName={fieldLabelClass}
 labelAccessory={!isMultiDay && (
 <Button
 type="button"
 onClick={() => {
 if (endTimeMode ==="end") {
 computeDurationFromCurrent()
 setEndTimeMode("duration")
 } else {
 setExplicitEndTime(computeEndTimeFromCurrent())
 setEndTimeMode("end")
 }
 }}
 variant="link"
 size="xs"
 className="h-auto p-0 text-muted-foreground"
 >
 {endTimeMode ==="end" ?"Use duration" :"Use end time"}
 </Button>
 )}
 >              {endTimeMode === "end" ? (
                <TimePicker
                  value={explicitEndTime}
                  onChange={(e) => handleEndTimeChange(e.target.value)}
                  className="h-10 bg-background/65 text-sm"
                  aria-label="End time"
                />
              ) : isMultiDay ? (
                <TimePicker
                  value={explicitEndTime || startTime}
                  onChange={(e) => {
                    setExplicitEndTime(e.target.value)
                    setEndTimeMode("end")
                  }}
                  className="h-10 bg-background/65 text-sm"
                  aria-label="End time"
                />
              ) : (
 <div className="flex items-center gap-1.5">
 <Input
 type="number"
 min="1"
 step="1"
 value={duration}
 onChange={(e) => handleDurationChange(e.target.value)}
 className="h-10 rounded-lg bg-background/65"
 />
 <span className="text-sm text-muted-foreground">min</span>
 </div>
 )}
 </FormField>
 </div>
 {!isUsingTimetablePeriod && suggestedTimetableClasses.length > 0 && (timetablePromptDismissed ? (
 <Button
 type="button"
 variant="ghost"
 size="xs"
 onClick={() => setTimetablePromptDismissed(false)}
 className="mt-2 h-auto gap-1.5 px-2 py-1 text-muted-foreground"
 >
 <Clock />
 Show timetable times
 </Button>
 ) : (
 <div className="mt-3 rounded-lg border border-primary/20 bg-primary/8 px-3 py-2.5">
 <div className="flex items-start gap-2">
 <Clock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
 <div className="min-w-0 flex-1">
 <p className="text-xs text-muted-foreground">
 {subjectId
 ? "This subject is on the timetable for this day. Align the event to its class time?"
 : "Timetable entries on this day. Choose one to align the event time."}
 </p>
 <div className="mt-2 flex flex-wrap gap-1.5">
 {suggestedTimetableClasses.map(({ period, subject }) => (
 <div
 key={`${period.subject}-${period.period}-${period.startTime}-${period.endTime}`}
 className="flex rounded-md border border-border bg-background"
 >
 <Button
 type="button"
 variant="ghost"
 size="xs"
 onClick={() => applyTimetablePeriod(period, subject?.id)}
 className={cn("h-auto px-2 py-1", subject && "rounded-r-none border-r border-border")}
 >
 {subject?.shortCode ?? (period.subject.trim() || period.period)} · {period.period} · {formatTime(period.startTime, timetableConfig?.viewSettings?.use24Hour ?? false)}
 {" – "}
 {formatTime(period.endTime, timetableConfig?.viewSettings?.use24Hour ?? false)}
 </Button>
 {subject && (
 <Button
 type="button"
 variant="ghost"
 size="icon-xs"
 onClick={() => applyTimetablePeriod(period)}
 aria-label={`Use ${subject.name} class time only`}
 title="Use time only"
 className="rounded-l-none"
 >
 <Clock />
 </Button>
 )}
 </div>
 ))}
 </div>
 </div>
 <Button
 type="button"
 variant="ghost"
 size="icon-xs"
 onClick={() => setTimetablePromptDismissed(true)}
 aria-label="Dismiss timetable suggestions"
 title="Dismiss"
 className="-mr-1 -mt-1 shrink-0 text-muted-foreground"
 >
 <X />
 </Button>
 </div>
 </div>
 ))}
 {endDate && eventDate && endDate < eventDate && (
 <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
 End date is before start date.
 </p>
 )}
 {endTimeMode ==="end" && computedDurationMinutes !== undefined && !isMultiDay && (
 <p className="mt-2 text-xs text-muted-foreground">
 {computedDurationMinutes} minutes
 </p>
 )}
 </FormSection>

 {showRecurrence && (
 <FormSection
 title="Repeat"
 icon={<Repeat className={sectionIconClass} />}
 className="rounded-lg border border-border/70 bg-muted/20 p-3"
 >
 <div className="grid gap-3 sm:grid-cols-2">
 <SelectField
 label="Frequency"
 labelClassName={fieldLabelClass}
 value={recurrencePattern}
 onValueChange={(value) => setRecurrencePattern(value as RecurrencePattern)}
 options={RECURRENCE_OPTIONS}
 />
 {recurrencePattern !=="none" && (
 <DatePickerField
 label="End date (optional)"
 date={recurrenceEndDate}
 onDateChange={setRecurrenceEndDate}
 disabledDays={eventDate ? { before: startOfDay(eventDate) } : undefined}
 buttonClassName="h-10 rounded-lg bg-background/65"
 />
 )}
 </div>
 {recurrencePattern !=="none" && (
 <p className="mt-2 text-xs text-muted-foreground">
 Creates {recurrencePattern ==="weekly" ?"weekly" : recurrencePattern ==="biweekly" ?"bi-weekly" :"monthly"} events until {recurrenceEndDate ? format(recurrenceEndDate,"MMM d, yyyy") :"manually stopped"}.
 </p>
 )}
 </FormSection>
 )}

 <FormSection
 title="Context"
 icon={<MapPin className={sectionIconClass} />}
 className={sectionClass}
 >
 <div className="grid items-start gap-3 sm:grid-cols-2">
 <FormField label="Location" labelClassName={fieldLabelClass}>
 <div className="relative">
 <MapPin className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
 <Input
 placeholder="Room, hall, campus"
 value={location}
 onChange={(event) => setLocation(event.target.value)}
 className="pl-9"
 />
 </div>
 </FormField>
 <FormField label="Notes" labelClassName={fieldLabelClass}>
 <Textarea
 placeholder="Optional notes or requirements"
 value={description}
 onChange={(event) => setDescription(event.target.value)}
 className="resize-none"
 />
 </FormField>
 </div>
 </FormSection>
 </div>
 </ScrollArea>
 </DialogBody>

 <DialogFooter className={cn("m-0 rounded-none px-5 py-3", footerStart &&"sm:justify-between")}>
 {footerStart}
 <div className="flex gap-2">
 <Button type="button" variant="outline" onClick={onCancel}>
 Cancel
 </Button>
 <Button type="submit" disabled={!title.trim()}>
 {submitLabel}
 </Button>
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
}: EventDialogProps) {
 const submittingRef = useRef(false)
 const isEditMode = Boolean(event)
 const existingEvent = isEditMode ? event! : null

 useEffect(() => {
 if (open) submittingRef.current = false
 }, [open])

 const handleSubmit = (values: EventFormValues) => {
 if (submittingRef.current) return
 submittingRef.current = true
 if (existingEvent) {
 const { id } = existingEvent
 onSubmit?.({
 id,
 ...values,
 } as Parameters<NonNullable<typeof onSubmit>>[0])
 onOpenChange(false)
 return
 }

 if (values.recurrence && values.recurrence.pattern !=="none" && onSubmitMultiple) {
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
 onSubmitMultiple(recurringEvents as Parameters<typeof onSubmitMultiple>[0])
 } else if (onSubmit) {
 onSubmit(values)
 }
 onOpenChange(false)
 }

 const handleDuplicate = () => {
 if (!existingEvent || !onDuplicate) return
 void onDuplicate(existingEvent)
 onOpenChange(false)
 }

 const handleDelete = () => {
 if (!existingEvent || !onDelete) return
 const { id } = existingEvent
 onDelete(id)
 onOpenChange(false)
 }

 const start = existingEvent ? parseISO(existingEvent.startTime) : (initialDate ? new Date(initialDate) : new Date())
 const end = existingEvent?.endTime ? parseISO(existingEvent.endTime) : null
 const endTimeLabel = end
 ? `${format(start,"h:mm a")} — ${format(end,"h:mm a")}`
 : format(start,"h:mm a")

 const dateLabel = format(start,"EEEE, MMMM d")

 return (
 <Dialog open={open} onOpenChange={onOpenChange}>
 <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-2xl">
 <DialogHeader className="border-b px-5 pb-4 pt-5">
 <div className="space-y-2">
 <DialogTitle>{isEditMode ?"Edit Event" :"Add Event"}</DialogTitle>
 <DialogDescription asChild>
 <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
 <Clock className="h-3.5 w-3.5 shrink-0" />
 <span>{dateLabel} · {isEditMode ? endTimeLabel : format(start,"h:mm a")}</span>
 </div>
 </DialogDescription>
 </div>
 </DialogHeader>
 <EventForm
 key={isEditMode && existingEvent ? `edit-${existingEvent.id}` : 'new'}
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
 startTime: format(start,"HH:mm"),
 duration: getDurationMinutes(existingEvent),
 endTime: existingEvent.endTime,
 endDate: end && format(end,"yyyy-MM-dd") !== format(start,"yyyy-MM-dd") ? end : undefined,
 isFinished: existingEvent.isFinished,
 finishedAt: existingEvent.finishedAt,
 } : { date: initialDate ? new Date(initialDate) : new Date() }}
 submitLabel={isEditMode ?"Save Changes" :"Add Event"}
 showFinishedControl={isEditMode}
 footerStart={isEditMode && (onDuplicate || onDelete) ? (
 <div className="flex flex-wrap gap-2">
 {onDuplicate && (
 <Button
 type="button"
 variant="outline"
 size="sm"
 onClick={handleDuplicate}
 className="gap-2"
 >
 <Copy className="h-4 w-4" />
 Duplicate next week
 </Button>
 )}
 {onDelete && (
 <Button
 type="button"
 variant="destructive"
 size="sm"
 onClick={handleDelete}
 className="gap-2"
 >
 <Trash2 className="h-4 w-4" />
 Delete
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
