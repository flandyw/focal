import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Check, ExternalLink, LogOut, MoreHorizontal, Pause, Play, SkipForward, SlidersHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ExamProgressionPanel, type ExamProgressionProps } from "./exam-progression"
import { ExamConditionsDialog } from "./exam-conditions-dialog"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { SubjectCombobox } from "./subject-combobox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { Field, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { WorkspacePage } from "./workspace-layout"
import { QuestionResultsEditor } from "./question-results-editor"
import { PerformanceContextFields } from "./performance-context-fields"
import { ExamWorkspace } from "./exam-workspace"
import { useTickingNow } from "../hooks/use-ticking-now"
import { formatExamTitle, formatReferenceName, validateAttempt, validateQuestionResults, type AssessmentReference, type ExamAttempt, type QuestionResult } from "../lib/exam-data"
import { buildCompanyExamSuggestions, buildExamSuggestions, findLatestAttempt, type ExamSuggestion } from "../lib/exam-suggestions"
import { getKnownExamConditions } from "../lib/exam-conditions"
import { formatTimer, getExamClock, type ExamClock } from "../lib/exam-timer"
import { loadAppData } from "../lib/storage"
import { firstPreferredSubject, prioritiseSubjects } from "../lib/subjects"
import { hasPerformanceContext, type PerformanceContext } from "../lib/performance-context"
import { cn } from "../lib/utils"
import type { VcaaStudyResources } from "../lib/vcaa-resources"
import { pauseExamSession, resumeExamSession, skipExamReading, type ExamTimerSession } from "../lib/ongoing-timers"

export type ExamTimerPreset = Pick<ExamTimerSession, "subject" | "provider" | "examYear" | "paper" | "marks"> & Partial<Pick<ExamTimerSession, "readingMinutes" | "writingMinutes">>

export type ExamTimerModeProps = ExamProgressionProps & {
  attempts: ExamAttempt[]
  references: AssessmentReference[]
  studies: VcaaStudyResources[]
  preferredSubjects: string[]
  initialExam?: ExamTimerPreset | null
  activeSession?: ExamTimerSession
  saveStatus: string
  syncAction?: { label: string; onClick: () => void }
  onLeave: () => void
  onSessionChange: (session: ExamTimerSession | undefined, action?: "cancel" | "complete") => void
  onSave: (attempt: ExamAttempt) => void
}

const today = () => new Date().toISOString().slice(0, 10)
const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
const minutes = (value: number) => `${value} min`

function SuggestionButton({ suggestion, onClick, showProvider = false }: {
  suggestion: ExamSuggestion
  onClick: (suggestion: ExamSuggestion) => void
  showProvider?: boolean
}) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-auto min-w-0 justify-start whitespace-normal px-3 py-2 text-left"
      onClick={() => onClick(suggestion)}
    >
      <span className="grid gap-1">
        <span className="font-medium">{showProvider ? `${suggestion.provider} · ${suggestion.paper}` : suggestion.subject}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {showProvider ? `${suggestion.subject} · ${suggestion.examYear}` : `${suggestion.examYear} · ${suggestion.paper}`} · {suggestion.marks} marks
        </span>
      </span>
    </Button>
  )
}

/**
 * The paper drawn to scale: reading, then writing, each filling as it is used.
 * Overtime has no planned length, so it shows as the writing bar turning red.
 */
function ExamTimeline({ readingMinutes, writingMinutes, clock, endsAt }: {
  readingMinutes: number
  writingMinutes: number
  clock?: ExamClock
  endsAt: { reading: number; writing: number }
}) {
  const readingMs = clock?.writingStartMs ?? readingMinutes * 60_000
  const writingMs = writingMinutes * 60_000
  const elapsed = clock?.elapsedMs ?? 0
  const readingFill = readingMs ? Math.min(1, elapsed / readingMs) : 1
  const writingFill = Math.min(1, Math.max(0, elapsed - readingMs) / writingMs)
  const overtime = clock?.phase === "overtime"
  const segments = [
    ...(readingMs > 0 ? [{ key: "reading", label: "Reading", length: readingMs, fill: readingFill, ends: endsAt.reading, active: clock?.phase === "reading" }] : []),
    { key: "writing", label: "Writing", length: writingMs, fill: writingFill, ends: endsAt.writing, active: clock?.phase === "writing" || overtime },
  ]
  return (
    <div className="flex w-full gap-3" role="img" aria-label={`${readingMinutes} minutes reading, then ${writingMinutes} minutes writing, ending ${clockTime(endsAt.writing)}`}>
      {segments.map((segment) => (
        <div key={segment.key} className="grid min-w-32 gap-1.5" style={{ flexGrow: segment.length, flexBasis: 0 }}>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className={cn("h-full rounded-full transition-[width] duration-1000 ease-linear", segment.active ? overtime ? "bg-destructive" : "bg-primary" : "bg-primary/40")} style={{ width: `${segment.fill * 100}%` }} />
          </div>
          <div className="flex justify-between gap-2 text-xs whitespace-nowrap text-muted-foreground tabular-nums">
            <span className={cn(segment.active && "font-medium text-foreground")}>{segment.label}</span>
            <span>{clockTime(segment.ends)}</span>
          </div>
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: "warning" }) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-sm font-medium tabular-nums", tone === "warning" && "text-destructive")}>{value}</dd>
    </div>
  )
}

export function ExamTimerMode({ progression, onProgressionChange, attempts, references, studies, preferredSubjects, initialExam, activeSession, saveStatus, syncAction, onLeave, onSessionChange, onSave }: ExamTimerModeProps) {
  const session = activeSession ?? null
  const now = useTickingNow(session && session.pausedAt === undefined ? 1000 : 30_000)
  const [subject, setSubject] = useState(initialExam?.subject ?? firstPreferredSubject(references.map((item) => item.studyName), preferredSubjects))
  const [provider, setProvider] = useState(initialExam?.provider ?? "VCAA")
  const [examYear, setExamYear] = useState(initialExam?.examYear ?? now.getFullYear())
  const [paper, setPaper] = useState(initialExam?.paper ?? "")
  const initialConditions = getKnownExamConditions(initialExam?.subject ?? "", initialExam?.paper ?? "")
  const [readingMinutes, setReadingMinutes] = useState(initialExam?.readingMinutes ?? initialConditions?.readingMinutes ?? 15)
  const [writingMinutes, setWritingMinutes] = useState(initialExam?.writingMinutes ?? initialConditions?.writingMinutes ?? 120)
  const [marks, setMarks] = useState(initialExam?.marks ?? initialConditions?.marks ?? 100)
  const [markingOpen, setMarkingOpen] = useState(false)
  const [conditionsOpen, setConditionsOpen] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [rawScore, setRawScore] = useState(0)
  const [rawMax, setRawMax] = useState(initialExam?.marks ?? initialConditions?.marks ?? 100)
  const [comment, setComment] = useState("")
  const [performanceContext, setPerformanceContext] = useState<PerformanceContext>({})
  const [completedAt, setCompletedAt] = useState(today)
  const [markingError, setMarkingError] = useState<string | null>(null)
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>([])
  const lastAutofilledKey = useRef<string | null>(null)
  const history = useMemo(() => loadAppData(), [])
  const suggestions = useMemo(
    () => buildExamSuggestions(attempts, references, preferredSubjects, 4, studies),
    [attempts, preferredSubjects, references, studies],
  )
  const companySuggestions = useMemo(
    () => buildCompanyExamSuggestions(attempts, references, preferredSubjects, history.examDifficulty, 4),
    [attempts, history.examDifficulty, preferredSubjects, references],
  )
  const latestAttempt = useMemo(() => findLatestAttempt(attempts), [attempts])
  const study = studies.find((item) => item.studyName.toLowerCase() === (session?.subject ?? subject).toLowerCase())
  const year = session?.examYear ?? examYear
  const reportUrl = study?.resources.find((resource) => resource.kind === "report" && resource.year === year)?.url
  const paperUrl = study?.resources.find((resource) => resource.kind === "exam" && resource.year === year && (!session?.paper || resource.label.toLowerCase().includes(session.paper.toLowerCase()) || session.paper.toLowerCase().includes(resource.label.toLowerCase())))?.url

  useEffect(() => {
    if (session || !paper.trim()) return
    const conditions = getKnownExamConditions(subject, paper)
    if (!conditions) return
    const key = `${subject.trim().toLowerCase()}\u0000${paper.trim().toLowerCase()}`
    if (lastAutofilledKey.current === key) return
    lastAutofilledKey.current = key
    setReadingMinutes(conditions.readingMinutes)
    setWritingMinutes(conditions.writingMinutes)
    setMarks(conditions.marks)
    setRawMax(conditions.marks)
  }, [paper, session, subject])

  const subjects = useMemo(() => prioritiseSubjects(references.map((item) => item.studyName), preferredSubjects), [preferredSubjects, references])
  const paperOptions = useMemo(
    () => [...new Set(references
      .filter((item) => item.studyName.toLowerCase() === subject.trim().toLowerCase())
      .map((item) => formatReferenceName(item.name)))].toSorted(),
    [references, subject],
  )
  const clock = session ? getExamClock(session, now.getTime()) : null
  const paused = session?.pausedAt !== undefined

  function applySuggestion(suggestion: ExamSuggestion) {
    const conditions = getKnownExamConditions(suggestion.subject, suggestion.paper)
    setSubject(suggestion.subject)
    setProvider(suggestion.provider)
    setExamYear(suggestion.examYear)
    setPaper(suggestion.paper)
    setMarks(suggestion.marks)
    setRawMax(suggestion.marks)
    if (conditions) {
      setReadingMinutes(conditions.readingMinutes)
      setWritingMinutes(conditions.writingMinutes)
    }
  }

  function start(event: FormEvent) {
    event.preventDefault()
    onSessionChange({
      subject: subject.trim(), provider: provider.trim(), title: formatExamTitle(provider, examYear, subject), examYear, paper: paper.trim(),
      id: crypto.randomUUID(), phase: readingMinutes > 0 ? "reading" : "writing",
      readingMinutes, writingMinutes, marks, startedAt: now.getTime(), pausedSeconds: 0, workspaceItems: [],
    })
    setRawMax(marks)
  }

  function discard() {
    onSessionChange(undefined, "cancel")
    setMarkingOpen(false)
    setDiscardOpen(false)
    setQuestionResults([])
    setRawScore(0)
    setComment("")
    setPerformanceContext({})
  }

  function pause() {
    if (session && !paused) onSessionChange(pauseExamSession(session, now.getTime()))
  }

  function resume() {
    if (session && paused) onSessionChange(resumeExamSession(session, now.getTime()))
  }

  function openMarking() {
    if (!session) return
    pause()
    setRawMax(session.marks)
    if (!questionResults.length && session.workspaceItems?.length) {
      setQuestionResults(session.workspaceItems.map((item) => ({
        id: item.id,
        label: item.label,
        marksAwarded: 0,
        maxMarks: item.marks,
        confidence: item.confidence,
        examinerNote: [item.status === "flagged" ? "Flagged during the timed attempt" : "", item.note ?? ""].filter(Boolean).join(" · ") || undefined,
      })))
    }
    setMarkingError(null)
    setMarkingOpen(true)
  }

  function saveMark(event: FormEvent) {
    event.preventDefault()
    if (!session || !clock) return
    const error = validateAttempt({ rawScore, rawMax })
    if (error) return setMarkingError(error)
    const questionError = validateQuestionResults(questionResults)
    if (questionError) return setMarkingError(questionError)
    const questionMaximum = questionResults.reduce((total, result) => total + result.maxMarks, 0)
    const questionScore = questionResults.reduce((total, result) => total + result.marksAwarded, 0)
    if (questionResults.length && Math.abs(questionMaximum - rawMax) < 0.01 && Math.abs(questionScore - rawScore) >= 0.01) {
      return setMarkingError(`The question results total ${questionScore}/${questionMaximum}, but the overall mark is ${rawScore}/${rawMax}. Make the totals match.`)
    }
    const timestamp = new Date().toISOString()
    onSave({
      id: crypto.randomUUID(),
      subject: session.subject,
      provider: session.provider,
      title: session.title,
      examYear: session.examYear,
      paper: session.paper,
      completedAt,
      rawScore,
      rawMax,
      comment: comment.trim() || undefined,
      performanceContext: hasPerformanceContext(performanceContext) ? performanceContext : undefined,
      questionResults: questionResults.length ? questionResults : undefined,
      timing: {
        plannedReadingMinutes: session.readingMinutes,
        plannedWritingMinutes: session.writingMinutes,
        actualWritingSeconds: clock.writingElapsedSeconds,
        overtimeSeconds: clock.overtimeSeconds,
        pausedSeconds: session.pausedSeconds ?? 0,
      },
      referenceId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    onSessionChange(undefined, "complete")
    setMarkingOpen(false)
  }

  if (!session || !clock) {
    const startAt = now.getTime()
    const ready = readingMinutes >= 0 && writingMinutes > 0 && marks > 0
    return (
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 gap-5">
          <CardHeader>
            <CardTitle>New timed paper</CardTitle>
            <CardDescription>Pick a paper and its conditions. Reading moves into writing automatically, and overtime is recorded.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={start}>
              <FieldGroup className="gap-5">
                <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <Field>
                    <FieldLabel htmlFor="exam-mode-subject">Subject</FieldLabel>
                    <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={setSubject} id="exam-mode-subject" allowCustom required placeholder="Search or enter a subject" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="exam-mode-paper">Paper</FieldLabel>
                    <Input id="exam-mode-paper" list="exam-mode-paper-options" value={paper} onChange={(event) => setPaper(event.target.value)} placeholder="e.g. Exam 1" />
                    <datalist id="exam-mode-paper-options">{paperOptions.map((item) => <option key={item} value={item} />)}</datalist>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="exam-mode-provider">Provider</FieldLabel>
                    <Input id="exam-mode-provider" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="VCAA" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="exam-mode-year">Year</FieldLabel>
                    <Input id="exam-mode-year" type="number" min="1990" max="2100" value={examYear} onChange={(event) => setExamYear(event.target.valueAsNumber)} required />
                  </Field>
                </div>

                <div className="grid grid-cols-3 gap-3 border-t pt-5">
                  <Field>
                    <FieldLabel htmlFor="exam-mode-reading">Reading (min)</FieldLabel>
                    <Input id="exam-mode-reading" type="number" min="0" max="180" value={readingMinutes} onChange={(event) => setReadingMinutes(event.target.valueAsNumber)} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="exam-mode-writing">Writing (min)</FieldLabel>
                    <Input id="exam-mode-writing" type="number" min="1" max="360" value={writingMinutes} onChange={(event) => setWritingMinutes(event.target.valueAsNumber)} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="exam-mode-marks">Marks</FieldLabel>
                    <Input id="exam-mode-marks" type="number" min="1" max="500" value={marks} onChange={(event) => setMarks(event.target.valueAsNumber)} required />
                  </Field>
                </div>

                {ready ? <div className="grid gap-3 rounded-lg border bg-muted/30 p-4">
                  <ExamTimeline readingMinutes={readingMinutes} writingMinutes={writingMinutes} endsAt={{ reading: startAt + readingMinutes * 60_000, writing: startAt + (readingMinutes + writingMinutes) * 60_000 }} />
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {minutes(readingMinutes + writingMinutes)} in total · {(writingMinutes / marks).toFixed(2)} min per mark · pens down at {clockTime(startAt + (readingMinutes + writingMinutes) * 60_000)} if you start now
                  </p>
                </div> : null}

                <Button className="w-full sm:w-auto sm:self-end" type="submit" size="lg"><Play />{readingMinutes ? "Start reading time" : "Start writing time"}</Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <aside className="min-w-0">
          <Card size="sm" className="min-w-0 gap-4">
            <CardHeader>
              <CardTitle>Up next</CardTitle>
              <CardDescription>
                {latestAttempt
                  ? `After ${latestAttempt.examYear} ${latestAttempt.subject} · ${latestAttempt.paper}.`
                  : "From your subjects and the VCAA papers available."}
                {" "}Choose one to fill the form.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-5">
              <ExamProgressionPanel compact progression={progression} onProgressionChange={onProgressionChange} attempts={attempts} subjects={preferredSubjects} onSelect={applySuggestion} />
              {suggestions.length ? <section className="grid gap-2" aria-labelledby="official-suggestions-title">
                <h3 id="official-suggestions-title" className="text-sm font-medium">VCAA papers</h3>
                <div className="grid grid-cols-2 gap-2">
                  {suggestions.map((suggestion) => (
                    <SuggestionButton key={`${suggestion.subject}-${suggestion.provider}-${suggestion.examYear}-${suggestion.paper}`} suggestion={suggestion} onClick={applySuggestion} />
                  ))}
                </div>
              </section> : null}
              {companySuggestions.length ? <section className="grid gap-2" aria-labelledby="company-suggestions-title">
                <div><h3 id="company-suggestions-title" className="text-sm font-medium">Company papers</h3><p className="text-xs text-muted-foreground">Finish a provider&apos;s set, then move to harder companies.</p></div>
                <div className="grid grid-cols-2 gap-2">
                  {companySuggestions.map((suggestion) => (
                    <SuggestionButton key={`${suggestion.subject}-${suggestion.provider}-${suggestion.examYear}-${suggestion.paper}`} suggestion={suggestion} onClick={applySuggestion} showProvider />
                  ))}
                </div>
              </section> : null}
            </CardContent>
          </Card>
        </aside>
      </div>
    )
  }

  const overtime = clock.phase === "overtime"
  const phaseLabel = clock.phase === "reading" ? "Reading" : clock.phase === "writing" ? "Writing" : "Overtime"
  const items = session.workspaceItems ?? []
  const doneMarks = items.filter((item) => item.status === "done").reduce((total, item) => total + item.marks, 0)
  const paceDelta = doneMarks - clock.expectedMarks
  // ponytail: pace is only meaningful once questions are mapped; a ±5 mark band is the "on pace" heuristic.
  const pace = !items.length || clock.phase === "reading" ? undefined
    : paceDelta < -5 ? `${Math.round(-paceDelta)} behind` : paceDelta > 5 ? `${Math.round(paceDelta)} ahead` : "On pace"

  return (
    <WorkspacePage className="gap-4 lg:gap-4">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold tracking-tight">{session.title}{session.paper ? ` · ${session.paper}` : ""}</h2>
          <p className="text-sm text-muted-foreground tabular-nums">
            {minutes(session.readingMinutes)} reading · {minutes(session.writingMinutes)} writing · {session.marks} marks
            <span role="status" className="ml-2">{saveStatus}</span>
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {paperUrl ? <Button nativeButton={false} variant="ghost" size="sm" render={<a href={paperUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Paper</Button> : null}
          {reportUrl ? <Button nativeButton={false} variant="ghost" size="sm" render={<a href={reportUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Report</Button> : null}
          {syncAction ? <Button size="sm" variant="outline" onClick={syncAction.onClick}>{syncAction.label}</Button> : null}
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="icon-sm" aria-label="More exam actions" />}><MoreHorizontal /></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setConditionsOpen(true)}><SlidersHorizontal />Edit conditions</DropdownMenuItem>
              <DropdownMenuItem onClick={() => { pause(); onLeave() }}><LogOut />{paused ? "Leave" : "Pause and leave"}</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={() => setDiscardOpen(true)}><Trash2 />Discard exam</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <Card className="min-w-0">
        <CardContent className="grid gap-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="grid gap-2">
              <div className="flex items-center gap-2">
                <Badge variant={overtime ? "destructive" : clock.phase === "reading" ? "secondary" : "default"}>{phaseLabel}</Badge>
                <span className="text-sm text-muted-foreground">{paused ? "Paused, clock frozen" : overtime ? "Writing time is over" : clock.phase === "reading" ? `Writing starts ${clockTime(clock.endsAt.reading)}` : `Pens down ${clockTime(clock.endsAt.writing)}`}</span>
              </div>
              <p
                role="timer"
                aria-label={`${phaseLabel}, ${overtime ? `${formatTimer(clock.overtimeSeconds)} over` : `${formatTimer(clock.remainingSeconds)} remaining`}`}
                className={cn("text-[clamp(3.5rem,11vw,7.5rem)] leading-none font-semibold tracking-tighter tabular-nums", overtime && "text-destructive", paused && "text-muted-foreground")}
              >
                {overtime ? `+${formatTimer(clock.overtimeSeconds)}` : formatTimer(clock.remainingSeconds)}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {clock.phase === "reading" && !paused ? <Button size="lg" variant="ghost" onClick={() => onSessionChange(skipExamReading(session, now.getTime()))}><SkipForward />Start writing</Button> : null}
              <Button size="lg" variant={paused ? "default" : "outline"} onClick={paused ? resume : pause}>{paused ? <Play /> : <Pause />}{paused ? "Resume" : "Pause"}</Button>
              <Button size="lg" variant={paused ? "outline" : "default"} onClick={openMarking}><Check />Finish and mark</Button>
            </div>
          </div>

          <ExamTimeline readingMinutes={session.readingMinutes} writingMinutes={session.writingMinutes} clock={clock} endsAt={clock.endsAt} />

          <dl className="grid grid-cols-2 gap-4 border-t pt-4 sm:grid-cols-4">
            <Stat label="Pace" value={`${(session.writingMinutes / session.marks).toFixed(2)} min / mark`} />
            <Stat label="Expected by now" value={clock.phase === "reading" ? "0 marks" : `${clock.expectedMarks.toFixed(1)} / ${session.marks}`} />
            <Stat label="Done" value={items.length ? `${doneMarks} / ${session.marks}${pace ? ` · ${pace}` : ""}` : "Map questions below"} tone={paceDelta < -5 && pace ? "warning" : undefined} />
            <Stat label="Paused" value={formatTimer(Math.round(session.pausedSeconds ?? 0))} />
          </dl>
        </CardContent>
      </Card>

      <ExamWorkspace items={items} totalMarks={session.marks} onChange={(workspaceItems) => onSessionChange({ ...session, workspaceItems })} />

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Discard this exam?</DialogTitle><DialogDescription>This removes the timer, your question map, and the shared study session. Pause instead to keep it for later.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDiscardOpen(false)}>Keep exam</Button><Button variant="destructive" onClick={discard}>Discard exam</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {conditionsOpen ? <ExamConditionsDialog session={session} now={now.getTime()} onClose={() => setConditionsOpen(false)} onSave={(next) => {
        onSessionChange(next)
        setRawMax(next.marks)
        toast.success("Exam conditions updated")
      }} /> : null}

      <Dialog open={markingOpen} onOpenChange={setMarkingOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Mark and log exam</DialogTitle>
            <DialogDescription className="tabular-nums">
              {formatTimer(clock.writingElapsedSeconds)} writing{clock.overtimeSeconds ? ` + ${formatTimer(clock.overtimeSeconds)} overtime` : ""}. The clock is paused while you mark.
            </DialogDescription>
          </DialogHeader>
          <form id="timer-marking-form" onSubmit={saveMark}>
            <FieldGroup>
              <div className="grid grid-cols-3 gap-4">
                <Field data-invalid={markingError ? true : undefined}>
                  <FieldLabel htmlFor="timer-score">Mark</FieldLabel>
                  <Input id="timer-score" type="number" min="0" step="0.5" value={rawScore} onChange={(event) => setRawScore(event.target.valueAsNumber)} autoFocus required />
                </Field>
                <Field data-invalid={markingError ? true : undefined}>
                  <FieldLabel htmlFor="timer-maximum">Out of</FieldLabel>
                  <Input id="timer-maximum" type="number" min="0.5" step="0.5" value={rawMax} onChange={(event) => setRawMax(event.target.valueAsNumber)} required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="timer-completed">Completed</FieldLabel>
                  <Input id="timer-completed" type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} required />
                </Field>
              </div>
              <QuestionResultsEditor value={questionResults} onChange={(results) => {
                setQuestionResults(results)
                const maximum = results.reduce((total, result) => total + result.maxMarks, 0)
                if (Math.abs(maximum - rawMax) < 0.01) setRawScore(results.reduce((total, result) => total + result.marksAwarded, 0))
                setMarkingError(null)
              }} />
              <PerformanceContextFields value={performanceContext} onChange={setPerformanceContext} idPrefix="exam-timer-context" />
              <Field>
                <FieldLabel htmlFor="timer-comment">Comment <span className="text-muted-foreground">(optional)</span></FieldLabel>
                <Textarea id="timer-comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What went well, and what to change next time?" />
              </Field>
              <FieldError>{markingError}</FieldError>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkingOpen(false)}>Back to exam</Button>
            <Button type="submit" form="timer-marking-form">Log attempt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspacePage>
  )
}
