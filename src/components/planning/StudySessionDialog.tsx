import { useEffect, useMemo, useRef, useState } from "react"
import { format, parseISO } from "date-fns"
import { CheckCircle2, Copy, PlayCircle, Plus, Search, Trash2 } from "lucide-react"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { CompactField, DatePickerField, Pill } from "@/components/ui/form-controls"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import TimePicker from "@/components/ui/time-picker"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn, getSessionSubjectIds, getSubjectById } from "@/lib/utils"
import {
  VCE_SUBJECTS,
  type ConfidenceScore,
  type Project,
  type StudySession,
  type StudySessionDraft,
  type StudySessionStatus,
  type Subject,
} from "@/lib/types"

const REST_OPTIONS = [5, 10, 15, 30]
const LENGTH_OPTIONS = [25, 45, 60, 90]
const fieldLabelClass = "text-micro font-medium uppercase tracking-wide"
const controlClass = "h-8 text-sm"

interface Block { start: string; end: string }
const getMinutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + m }
const fromMinutes = (min: number) => { const c = Math.max(0, Math.min(min, 1439)); return `${String(Math.floor(c / 60)).padStart(2, "0")}:${String(c % 60).padStart(2, "0")}` }
const formatDurationStr = (totalMin: number) => totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin}m`
// Logged study defaults to the hour that just finished.
const pastHour = (): Block[] => {
  const now = new Date()
  const end = Math.floor((now.getHours() * 60 + now.getMinutes()) / 5) * 5
  return [{ start: fromMinutes(Math.max(0, end - 60)), end: fromMinutes(end) }]
}

interface StudySessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: Project[]
  customSubjects: Subject[]
  availableSubjects?: Subject[]
  session?: StudySession | null
  initialDate?: Date
  initialMode?: "plan" | "log"
  initialValues?: StudySessionDraft
  onSubmit: (data: {
    id?: string
    projectId?: string
    subjectIds: string[]
    title: string
    startTime: string
    endTime: string
    description?: string
    topics?: string[]
    notes?: string
    status?: StudySessionStatus
    confidence?: ConfidenceScore
    blockers?: string
    nextAction?: string
    completedAt?: string
    activeDurations?: { start: string; end: string }[]
  }) => void | Promise<void>
  onDelete?: (id: string) => Promise<unknown>
  onPlanAgain?: (session: StudySession) => void | Promise<void>
}

export function StudySessionDialog({
  open,
  onOpenChange,
  projects,
  customSubjects,
  availableSubjects,
  session,
  initialDate,
  initialMode = "plan",
  initialValues,
  onSubmit,
  onDelete,
  onPlanAgain,
}: StudySessionDialogProps) {
  const isEdit = Boolean(session)
  const [logging, setLogging] = useState(!session && !initialValues && initialMode === "log")
  const [projectId, setProjectId] = useState("")
  const [subjectIds, setSubjectIds] = useState<string[]>(initialValues?.subjectIds ?? [])
  const [subjectFilter, setSubjectFilter] = useState("")
  const [title, setTitle] = useState(initialValues?.title ?? "")
  const [description, setDescription] = useState(initialValues?.description ?? "")
  const [topicsInput, setTopicsInput] = useState("")
  const [notes, setNotes] = useState("")
  const [status, setStatus] = useState<StudySessionStatus>("planned")
  const [confidence, setConfidence] = useState<ConfidenceScore | undefined>(undefined)
  const [blockers, setBlockers] = useState("")
  const [nextAction, setNextAction] = useState("")
  const [startDate, setStartDate] = useState<Date | undefined>(() => initialValues ? parseISO(initialValues.startTime) : initialDate ? new Date(initialDate) : new Date())
  const [isDeleting, setIsDeleting] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [restDuration, setRestDuration] = useState(5)
  const [segments, setSegments] = useState<Block[]>(() =>
    initialValues
      ? [{ start: format(parseISO(initialValues.startTime), "HH:mm"), end: format(parseISO(initialValues.endTime), "HH:mm") }]
      : !session && initialMode === "log" ? pastHour() : [{ start: "14:00", end: "15:00" }])
  const initializedSessionIdRef = useRef<string | null>(null)

  const requestClose = (next: boolean) => { if (!savingRef.current) onOpenChange(next) }
  const saveSession = async (data: Parameters<typeof onSubmit>[0]) => {
    if (savingRef.current) throw new Error("Study session is already saving")
    savingRef.current = true
    setSaving(true)
    try { await onSubmit(data) } finally { savingRef.current = false; setSaving(false) }
  }

  // Preserve a converted event's full interval, including overnight/multi-day events, until its times are edited.
  const unchangedInitialTimes = Boolean(initialValues) && segments.length === 1
    && segments[0].start === format(parseISO(initialValues!.startTime), "HH:mm")
    && segments[0].end === format(parseISO(initialValues!.endTime), "HH:mm")
  const totalActive = unchangedInitialTimes
    ? (Date.parse(initialValues!.endTime) - Date.parse(initialValues!.startTime)) / 60000
    : segments.reduce((sum, seg) => sum + Math.max(0, getMinutes(seg.end) - getMinutes(seg.start)), 0)
  const sorted = useMemo(() => segments.map((seg, idx) => ({ seg, idx })).sort((a, b) => getMinutes(a.seg.start) - getMinutes(b.seg.start)), [segments])
  const firstStart = sorted[0]?.seg.start ?? "00:00"
  const lastEnd = sorted.length ? sorted[sorted.length - 1].seg.end : "00:00"
  const wallSpan = getMinutes(lastEnd) - getMinutes(firstStart)
  const totalRest = sorted.reduce((rest, { seg }, i) => i ? rest + Math.max(0, getMinutes(seg.start) - getMinutes(sorted[i - 1].seg.end)) : 0, 0)
  const blocksValid = unchangedInitialTimes || (segments.length > 0
    && sorted.every(({ seg }, i) => getMinutes(seg.end) > getMinutes(seg.start) && (i === 0 || getMinutes(seg.start) >= getMinutes(sorted[i - 1].seg.end))))

  const baseSubjects = availableSubjects ?? [...VCE_SUBJECTS, ...customSubjects]
  const hiddenSelected = subjectIds
    .map((id) => getSubjectById(id))
    .filter((subject): subject is Subject => Boolean(subject) && !baseSubjects.some((item) => item.id === subject!.id))
  const subjects = [...hiddenSelected, ...baseSubjects]
  const selectedSubjects = subjects.filter((subject) => subjectIds.includes(subject.id))
  const needle = subjectFilter.trim().toLowerCase()
  const visibleSubjects = needle ? subjects.filter((subject) => `${subject.name} ${subject.shortCode}`.toLowerCase().includes(needle)) : subjects

  const dateAt = (time: string) => {
    const d = new Date(startDate!)
    d.setHours(Math.floor(getMinutes(time) / 60), getMinutes(time) % 60, 0, 0)
    return d
  }
  const logEndsInFuture = logging && Boolean(startDate) && segments.some((seg) => dateAt(seg.end).getTime() > Date.now())
  const effectiveTitle = title.trim() || (logging && selectedSubjects[0] ? `${selectedSubjects[0].name} study` : "")
  const canSave = !saving && effectiveTitle.length > 0 && subjectIds.length > 0 && Boolean(startDate)
    && Number.isFinite(totalActive) && totalActive > 0 && blocksValid && !logEndsInFuture
  const showReview = isEdit || logging
  const issue = !blocksValid ? "Blocks must end after they start and not overlap" : logEndsInFuture ? "Logged study must have already finished" : ""

  useEffect(() => {
    if (!session) return
    // Keep unsaved edits when a sync refreshes the project or session props.
    if (initializedSessionIdRef.current === session.id) return
    initializedSessionIdRef.current = session.id
    const project = projects.find((p) => p.id === session.projectId)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProjectId(session.projectId ?? "")
    setSubjectIds(getSessionSubjectIds(session, project))
    setTitle(session.title)
    setDescription(session.description ?? "")
    setTopicsInput(session.topics?.join(", ") ?? "")
    setNotes(session.reflection?.notes ?? "")
    setStatus(session.execution.state)
    setConfidence(session.reflection?.confidence)
    setBlockers(session.reflection?.blockers ?? "")
    setNextAction(session.reflection?.nextAction ?? "")
    setIsDeleting(false)

    const start = parseISO(session.schedule.blocks[0].start)
    setStartDate(start)
    // Completed forms edit actual evidence; planning forms edit scheduled blocks.
    const ranges = session.execution.state === "planned" ? session.schedule.blocks : session.execution.intervals.flatMap((interval) => interval.end ? [{ start: interval.start, end: interval.end }] : [])
    if (ranges.length > 0) {
      setSegments([...ranges]
        .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
        .map((d) => ({ start: format(parseISO(d.start), "HH:mm"), end: format(parseISO(d.end), "HH:mm") })))
    } else {
      setSegments([{ start: format(start, "HH:mm"), end: format(parseISO(session.schedule.blocks[session.schedule.blocks.length - 1].end), "HH:mm") }])
    }
  }, [projects, session])

  const switchMode = (nextLogging: boolean) => {
    setLogging(nextLogging)
    if (!nextLogging) return
    if (segments.length === 1) setSegments(pastHour())
    setStartDate((current) => current && current <= new Date() ? current : new Date())
  }

  const addSegment = () => setSegments((prev) => {
    const start = (prev.length ? Math.max(...prev.map((seg) => getMinutes(seg.end))) : 540) + restDuration
    return [...prev, { start: fromMinutes(start), end: fromMinutes(start + 30) }]
  })
  const removeSegment = (index: number) => setSegments((prev) => prev.filter((_, i) => i !== index))
  const updateSegment = (index: number, field: "start" | "end", value: string) =>
    setSegments((prev) => prev.map((seg, i) => (i === index ? { ...seg, [field]: value } : seg)))
  // Length presets resize the latest block so you can build up a session quickly.
  const setLastLength = (minutes: number) => {
    const last = sorted[sorted.length - 1]
    if (last) updateSegment(last.idx, "end", fromMinutes(getMinutes(last.seg.start) + minutes))
  }

  const toggleSubject = (id: string) =>
    setSubjectIds((current) => current.includes(id) ? current.filter((subjectId) => subjectId !== id) : [...current, id])

  const handleProjectChange = (id: string) => {
    setProjectId(id)
    const subjectId = projects.find((item) => item.id === id)?.subjectId
    if (subjectId) setSubjectIds((current) => current.includes(subjectId) ? current : [...current, subjectId])
  }

  const buildSubmitData = (nextStatus: StudySessionStatus = logging ? "completed" : status) => {
    if (!effectiveTitle || !startDate || subjectIds.length === 0 || !blocksValid || logEndsInFuture) return null
    const topics = topicsInput.split(",").map((topic) => topic.trim()).filter(Boolean)
    const segStart = dateAt(segments[0].start)
    const segEnd = unchangedInitialTimes ? new Date(segStart.getTime() + totalActive * 60000) : dateAt(lastEnd)
    if (segEnd.getTime() <= segStart.getTime() || !Number.isFinite(totalActive) || totalActive <= 0) return null
    return {
      id: session?.id,
      projectId: projectId || undefined,
      subjectIds,
      title: effectiveTitle,
      description: description.trim() ? description : undefined,
      startTime: dateAt(firstStart).toISOString(),
      endTime: segEnd.toISOString(),
      activeDurations: sorted.map(({ seg }) => ({ start: dateAt(seg.start).toISOString(), end: unchangedInitialTimes ? segEnd.toISOString() : dateAt(seg.end).toISOString() })),
      topics: topics.length > 0 ? topics : undefined,
      notes: notes.trim() ? notes : undefined,
      status: nextStatus,
      confidence,
      blockers: blockers.trim() ? blockers : undefined,
      nextAction: nextAction.trim() ? nextAction : undefined,
      completedAt: nextStatus === "completed" ? (session?.execution.state === "completed" ? session.execution.completedAt : logging ? segEnd.toISOString() : new Date().toISOString()) : undefined,
    }
  }

  const submitAs = async (nextStatus?: StudySessionStatus, closeAfter = !isEdit) => {
    const data = buildSubmitData(nextStatus)
    if (!data) return
    try {
      await saveSession(data)
      if (nextStatus) setStatus(nextStatus)
      if (closeAfter) onOpenChange(false)
    } catch { /* The parent reports save failures; preserve the draft. */ }
  }

  const handleDelete = async () => {
    if (!session || !onDelete || savingRef.current) return
    setIsDeleting(true)
    try {
      // A cancelled confirmation or failed delete keeps the form open.
      if (await onDelete(session.id) === false) return
      onOpenChange(false)
    } finally {
      setIsDeleting(false)
    }
  }

  const heading = isEdit ? "Edit session" : initialValues ? "Plan from event" : logging ? "Log past study" : "New session"

  return (
    <Dialog open={open} onOpenChange={requestClose}>
      <DialogContent className="flex max-h-[min(92dvh,46rem)] w-[calc(100vw-1rem)] flex-col gap-0 overflow-hidden p-0 sm:w-[calc(100vw-2rem)] sm:max-w-3xl sm:p-0">
        <DialogHeader className="shrink-0 flex-row flex-wrap items-center gap-x-3 gap-y-1 border-b py-2.5 pl-4 pr-12">
          <DialogTitle className="text-sm">{heading}</DialogTitle>
          <DialogDescription className="sr-only">
            {logging ? "Record study you have already done. It counts toward your study history, not your plan." : "Plan study blocks for a subject and optionally link an assessment."}
            {initialValues ? " Saving replaces the original event." : ""}
          </DialogDescription>
          {!isEdit && !initialValues && (
            <div className="flex gap-1" role="group" aria-label="Session type">
              <Pill active={!logging} onClick={() => switchMode(false)}>Plan</Pill>
              <Pill active={logging} onClick={() => switchMode(true)}>Log past</Pill>
            </div>
          )}
          {isEdit && (
            <span className={cn(
              "rounded-md border px-1.5 py-0.5 text-micro font-semibold uppercase",
              status === "completed" ? "border-success/30 bg-success/15 text-success"
                : status === "in-progress" ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/70 bg-muted text-muted-foreground"
            )}>
              {status.replace("-", " ")}
            </span>
          )}
        </DialogHeader>

        <form
          onSubmit={(event) => { event.preventDefault(); void submitAs() }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,1fr)_15rem] md:overflow-hidden">
            <div className="grid content-start gap-3 p-4 md:overflow-y-auto">
              <Input
                aria-label="Session title"
                placeholder={logging ? "Title (optional) — defaults to “<subject> study”" : "Session title, e.g. Review Unit 3 notes"}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                autoFocus
                className="font-medium"
              />

              <div className="grid gap-2 sm:grid-cols-2">
                <DatePickerField
                  label="Date"
                  date={startDate}
                  onDateChange={setStartDate}
                  disabledDays={logging ? { after: new Date() } : undefined}
                  formatPattern="EEE d MMM yyyy"
                  labelClassName={fieldLabelClass}
                  buttonClassName={controlClass}
                />
                <CompactField label="Assessment">
                  <Select value={projectId || "_none"} onValueChange={(value) => handleProjectChange(value === "_none" ? "" : value)}>
                    <SelectTrigger className={cn(controlClass, "w-full")}><SelectValue placeholder="No assessment" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none">No assessment</SelectItem>
                      {projects.filter((project) => !project.isArchived || project.id === projectId).map((project) => (
                        <SelectItem key={project.id} value={project.id}>{project.icon} {project.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CompactField>
              </div>

              <section className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3" aria-label="Study blocks">
                <div className="flex items-center justify-between gap-2">
                  <h3 className={cn(fieldLabelClass, "text-muted-foreground")}>{logging ? "Time studied" : "Study blocks"}</h3>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    <b className="font-semibold text-foreground">{formatDurationStr(totalActive)}</b> active
                    {totalRest > 0 && <> · {formatDurationStr(totalRest)} rest</>}
                  </span>
                </div>
                {segments.length > 1 && wallSpan > 0 && (
                  <TimelineBar segments={segments} segmentWallSpan={wallSpan} computedSegmentStart={firstStart} computedSegmentEnd={lastEnd} onUpdateSegment={updateSegment} />
                )}
                <div className="grid gap-1.5">
                  {sorted.map(({ seg, idx }, i) => {
                    const gap = i ? Math.max(0, getMinutes(seg.start) - getMinutes(sorted[i - 1].seg.end)) : 0
                    return (
                      <div key={idx} className="flex items-center gap-1.5 rounded-md bg-primary/8 p-1">
                        <span className="flex size-6 shrink-0 items-center justify-center rounded bg-primary/12 text-caption font-semibold text-primary">{i + 1}</span>
                        <TimePicker showIcon={false} value={seg.start} onChange={(event) => updateSegment(idx, "start", event.target.value)} className="h-7 w-24 px-2 text-xs tabular-nums" aria-label={`Block ${i + 1} start time`} />
                        <span className="text-micro text-muted-foreground">to</span>
                        <TimePicker showIcon={false} value={seg.end} onChange={(event) => updateSegment(idx, "end", event.target.value)} className="h-7 w-24 px-2 text-xs tabular-nums" aria-label={`Block ${i + 1} end time`} />
                        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
                          {gap > 0 && <>{formatDurationStr(gap)} rest · </>}
                          <span className="font-medium text-foreground/80">{formatDurationStr(Math.max(0, getMinutes(seg.end) - getMinutes(seg.start)))}</span>
                        </span>
                        {segments.length > 1 && (
                          <Button type="button" variant="ghost" size="icon-xs" className="size-6" onClick={() => removeSegment(idx)} aria-label={`Remove block ${i + 1}`}>
                            <Trash2 className="size-3" />
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <div className="flex items-center gap-1" role="group" aria-label="Set last block length">
                    <span className="text-micro text-muted-foreground">Length</span>
                    {LENGTH_OPTIONS.map((minutes) => (
                      <Pill key={minutes} className="h-6 px-1.5" onClick={() => setLastLength(minutes)}>{formatDurationStr(minutes)}</Pill>
                    ))}
                  </div>
                  <div className="flex items-center gap-1" role="group" aria-label="Rest before new block">
                    <span className="text-micro text-muted-foreground">Rest</span>
                    {REST_OPTIONS.map((minutes) => (
                      <Pill key={minutes} active={restDuration === minutes} className="h-6 px-1.5" onClick={() => setRestDuration(minutes)}>{minutes}m</Pill>
                    ))}
                  </div>
                  <Button type="button" variant="outline" size="xs" className="ml-auto h-7" onClick={addSegment}><Plus />Block</Button>
                </div>
              </section>

              <div className="grid gap-2 sm:grid-cols-2">
                <CompactField label="Goal">
                  <Input placeholder={isEdit || logging ? "What did you achieve?" : "What do you want to achieve?"} value={description} onChange={(event) => setDescription(event.target.value)} className={controlClass} />
                </CompactField>
                <CompactField label="Topics">
                  <Input placeholder="Photosynthesis, exam Q4" value={topicsInput} onChange={(event) => setTopicsInput(event.target.value)} className={controlClass} />
                </CompactField>
              </div>
              <CompactField label="Notes">
                <Textarea placeholder="Key concepts, resources, or follow-up work." value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} className="min-h-0 resize-none text-sm" />
              </CompactField>

              {showReview && (
                <section className="grid gap-2 rounded-lg border border-border/70 bg-muted/20 p-3" aria-label="Review">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className={cn(fieldLabelClass, "text-muted-foreground")}>Review</h3>
                    <div className="flex items-center gap-1" role="group" aria-label="Confidence">
                      <span className="mr-1 text-micro text-muted-foreground">Confidence</span>
                      {([1, 2, 3, 4, 5] as ConfidenceScore[]).map((score) => (
                        <Pill key={score} active={confidence === score} className="w-7 justify-center px-0" onClick={() => setConfidence(confidence === score ? undefined : score)}>{score}</Pill>
                      ))}
                    </div>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <CompactField label="Blockers">
                      <Input placeholder="What still feels unclear?" value={blockers} onChange={(event) => setBlockers(event.target.value)} className={controlClass} />
                    </CompactField>
                    <CompactField label="Next action">
                      <Input placeholder="e.g. redo exam Q4" value={nextAction} onChange={(event) => setNextAction(event.target.value)} className={controlClass} />
                    </CompactField>
                  </div>
                </section>
              )}
            </div>

            <aside className="flex min-h-0 flex-col gap-2 border-t bg-muted/20 p-3 md:border-l md:border-t-0">
              <div className="flex items-center justify-between gap-2">
                <h3 className={cn(fieldLabelClass, "text-muted-foreground")}>Subjects</h3>
                <span className={cn("text-xs", subjectIds.length ? "text-muted-foreground" : "text-destructive")}>
                  {subjectIds.length ? `${subjectIds.length} selected` : "Choose at least one"}
                  {subjectIds.length > 0 && <button type="button" className="ml-2 underline underline-offset-2" onClick={() => setSubjectIds([])}>Clear</button>}
                </span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="Filter subjects" placeholder="Filter subjects" value={subjectFilter} onChange={(event) => setSubjectFilter(event.target.value)} className={cn(controlClass, "pl-8")} />
              </div>
              <div className="grid max-h-48 content-start gap-0.5 overflow-y-auto md:max-h-none md:flex-1" role="group" aria-label="Subjects">
                {visibleSubjects.map((subject) => {
                  const selected = subjectIds.includes(subject.id)
                  return (
                    <button
                      key={subject.id}
                      type="button"
                      aria-pressed={selected}
                      onClick={() => toggleSubject(subject.id)}
                      className={cn(
                        "flex min-w-0 items-center gap-2 rounded-md border px-2 py-1 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        selected ? "border-primary/35 bg-primary/10 text-foreground" : "border-transparent text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                      )}
                    >
                      <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: subject.color }} />
                      <span className="min-w-0 flex-1 truncate">{subject.icon} {subject.name}</span>
                      {selected && <CheckCircle2 className="size-3.5 shrink-0 text-primary" />}
                    </button>
                  )
                })}
                {visibleSubjects.length === 0 && <p className="px-2 py-1 text-xs text-muted-foreground">No matching subjects.</p>}
              </div>
            </aside>
          </div>

          <DialogFooter className="m-0 shrink-0 flex-wrap rounded-none px-4 py-2.5 sm:justify-between">
            <div className="flex flex-wrap items-center gap-1">
              {isEdit && onPlanAgain && (
                <Button type="button" variant="ghost" size="sm" onClick={() => void onPlanAgain(session!)}><Copy />Next week</Button>
              )}
              {isEdit && onDelete && (
                <Button type="button" variant="ghost" size="sm" onClick={handleDelete} disabled={isDeleting || saving} className="text-destructive hover:text-destructive">
                  <Trash2 />Delete
                </Button>
              )}
              {issue && <span role="alert" className="text-xs text-destructive">{issue}</span>}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => requestClose(false)} disabled={saving}>Cancel</Button>
              {isEdit && status === "planned" && (
                <Button type="button" variant="outline" size="sm" onClick={() => void submitAs("in-progress", true)} disabled={!canSave}><PlayCircle />Start</Button>
              )}
              {isEdit && status !== "completed" && (
                <Button type="button" variant="outline" size="sm" onClick={() => void submitAs("completed", true)} disabled={!canSave}><CheckCircle2 />Complete</Button>
              )}
              <Button type="submit" size="sm" disabled={!canSave}>{saving ? "Saving…" : isEdit ? "Save" : logging ? "Log study" : "Create"}</Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
function TimelineBar({
  segments,
  segmentWallSpan,
  computedSegmentStart,
  computedSegmentEnd,
  onUpdateSegment,
}: {
  segments: { start: string; end: string }[]
  segmentWallSpan: number
  computedSegmentStart: string
  computedSegmentEnd: string
  onUpdateSegment: (index: number, field: 'start' | 'end', value: string) => void
}) {
  const timelineRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{
  mode: 'resize' | 'move'
  startX: number
  origSegments: { start: string; end: string }[]
  barWidth: number
  wallSpan: number
  onUpdate: (index: number, field: 'start' | 'end', value: string) => void
  origIdx: number
  edge?: 'start' | 'end'
  origValue?: string
  origStart?: string
  origEnd?: string
  } | null>(null)
  const getMinutes = (time: string) => { const [h, m] = time.split(':').map(Number); return h * 60 + m }
  const formatDurationStr = (totalMin: number) =>
  totalMin >= 60 ? `${Math.floor(totalMin / 60)}h ${totalMin % 60}m` : `${totalMin}m`
  // Sort segments by start time and track original indices
  const sorted = useMemo(() => {
  return segments
  .map((seg, idx) => ({ seg, idx }))
  .sort((a, b) => getMinutes(a.seg.start) - getMinutes(b.seg.start))
  }, [segments])
  const startDrag = (
  e: React.MouseEvent,
  mode: 'resize' | 'move',
  origIdx: number,
  edge?: 'start' | 'end',
  ) => {
  e.preventDefault()
  e.stopPropagation()
  if (!timelineRef.current) return
  const seg = segments[origIdx]
  if (!seg) return
  dragRef.current = {
  mode,
  startX: e.clientX,
  origSegments: segments.map((s) => ({ ...s })),
  barWidth: timelineRef.current.clientWidth,
  wallSpan: segmentWallSpan,
  onUpdate: onUpdateSegment,
  origIdx,
  ...(mode === 'resize' && edge
  ? { edge, origValue: seg[edge] }
  : { origStart: seg.start, origEnd: seg.end }),
  }
  }
  useEffect(() => {
  const handleMouseMove = (e: MouseEvent) => {
  const d = dragRef.current
  if (!d) return
  e.preventDefault()
  const deltaX = e.clientX - d.startX
  const scale = d.barWidth > 0 && d.wallSpan > 0 ? d.wallSpan / d.barWidth : 0
  const deltaMinutes = Math.round(deltaX * scale)
  if (d.mode === 'resize') {
  const [origH, origM] = d.origValue!.split(':').map(Number)
  let newMin = origH * 60 + origM + deltaMinutes
  if (d.edge === 'start') {
  const endMin = getMinutes(d.origSegments[d.origIdx].end)
  const minBound = d.origIdx > 0 ? getMinutes(d.origSegments[d.origIdx - 1].end) : 0
  newMin = Math.max(minBound, Math.min(newMin, endMin - 1))
  } else {
  const startMin = getMinutes(d.origSegments[d.origIdx].start)
  const maxBound = d.origIdx < d.origSegments.length - 1
  ? getMinutes(d.origSegments[d.origIdx + 1].start)
  : 24 * 60
  newMin = Math.max(startMin + 1, Math.min(newMin, maxBound))
  }
  newMin = Math.max(0, newMin)
  const h = Math.floor(newMin / 60) % 24
  const m = newMin % 60
  d.onUpdate(d.origIdx, d.edge!, `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`)
  } else {
  const origStartMin = getMinutes(d.origStart!)
  const origEndMin = getMinutes(d.origEnd!)
  const dur = origEndMin - origStartMin
  let newStart = origStartMin + deltaMinutes
  if (d.origIdx > 0) {
  newStart = Math.max(newStart, getMinutes(d.origSegments[d.origIdx - 1].end))
  }
  if (d.origIdx < d.origSegments.length - 1) {
  newStart = Math.min(newStart, getMinutes(d.origSegments[d.origIdx + 1].start) - dur)
  }
  newStart = Math.max(0, newStart)
  const newEnd = newStart + dur
  const fmt = (min: number) => {
  const hh = Math.floor(min / 60) % 24
  const mm = min % 60
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
  }
  d.onUpdate(d.origIdx, 'start', fmt(newStart))
  d.onUpdate(d.origIdx, 'end', fmt(newEnd))
  }
  }
  const handleMouseUp = () => { dragRef.current = null }
  window.addEventListener('mousemove', handleMouseMove)
  window.addEventListener('mouseup', handleMouseUp)
  return () => {
  window.removeEventListener('mousemove', handleMouseMove)
  window.removeEventListener('mouseup', handleMouseUp)
  }
  }, [])
  const wallStartMin = getMinutes(computedSegmentStart)
  const slices: { type: 'active' | 'rest'; leftPct: number; widthPct: number; minutes: number; sortedIdx: number; origIdx: number }[] = []
  for (let i = 0; i < sorted.length; i++) {
  const { seg, idx } = sorted[i]
  const segStartMin = getMinutes(seg.start)
  const segEndMin = getMinutes(seg.end)
  if (i > 0) {
  const prevEndMin = getMinutes(sorted[i - 1].seg.end)
  const restMin = Math.max(0, segStartMin - prevEndMin)
  if (restMin > 0) {
  slices.push({
  type: 'rest',
  leftPct: ((prevEndMin - wallStartMin) / segmentWallSpan) * 100,
  widthPct: (restMin / segmentWallSpan) * 100,
  minutes: restMin,
  sortedIdx: i,
  origIdx: -1,
  })
  }
  }
  const activeMin = Math.max(0, segEndMin - segStartMin)
  slices.push({
  type: 'active',
  leftPct: ((segStartMin - wallStartMin) / segmentWallSpan) * 100,
  widthPct: (activeMin / segmentWallSpan) * 100,
  minutes: activeMin,
  sortedIdx: i,
  origIdx: idx,
  })
  }
  return (
  <div className="space-y-0.5">
  <div
  ref={timelineRef}
  className="relative h-7 rounded-md bg-muted/20 overflow-hidden border border-border/30 select-none"
  >
  {slices.map((slice, i) => (
  <div
  key={i}
  className={cn(
"absolute top-0 h-full",
  slice.type === 'active'
  ? 'bg-primary/25'
  : '',
  slice.type === 'active' && 'cursor-grab active:cursor-grabbing',
  )}
  style={{
  left: `${slice.leftPct}%`,
  width: `${Math.max(slice.widthPct, 0.5)}%`,
  }}
  title={slice.type === 'active'
  ? formatDurationStr(slice.minutes)
  : `Rest ${formatDurationStr(slice.minutes)}`
  }
  onMouseDown={slice.type === 'active'
  ? (e) => startDrag(e, 'move', slice.origIdx)
  : undefined
  }
  >
  {slice.type === 'active' && (
  <>
  <div
  className="absolute top-0 -left-1.5 w-3 h-full cursor-ew-resize flex items-center justify-center group/handle z-10"
  onMouseDown={(e) => startDrag(e, 'resize', slice.origIdx, 'start')}
  >
  <div className="w-2 h-5 rounded-full bg-primary/60 opacity-0 group-hover/handle:opacity-100 transition-opacity shadow-sm" />
  </div>
  <div
  className="absolute top-0 -right-1.5 w-3 h-full cursor-ew-resize flex items-center justify-center group/handle z-10"
  onMouseDown={(e) => startDrag(e, 'resize', slice.origIdx, 'end')}
  >
  <div className="w-2 h-5 rounded-full bg-primary/60 opacity-0 group-hover/handle:opacity-100 transition-opacity shadow-sm" />
  </div>
  </>
  )}
  </div>
  ))}
  </div>
  <div className="flex justify-between text-[10px] text-muted-foreground/50 tabular-nums">
  <span>{computedSegmentStart}</span>
  <span>{computedSegmentEnd}</span>
  </div>
  </div>
  )
}
