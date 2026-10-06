import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Check, Clock3, Pause, Play, SlidersHorizontal, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { ExamProgressionPanel, type ExamProgressionProps } from "./exam-progression"
import { ExamConditionsDialog } from "./exam-conditions-dialog"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
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
import { Field, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { PageHeader } from "./page-header"
import { WorkspacePage } from "./workspace-layout"
import { QuestionResultsEditor } from "./question-results-editor"
import { PerformanceContextFields } from "./performance-context-fields"
import { ExamWorkspace } from "./exam-workspace"
import { TimerReadout } from "./timer-readout"
import { useTickingNow } from "../hooks/use-ticking-now"
import { formatExamTitle, formatReferenceName, validateAttempt, validateQuestionResults, type AssessmentReference, type ExamAttempt, type QuestionResult } from "../lib/exam-data"
import { buildCompanyExamSuggestions, buildExamSuggestions, findLatestAttempt, type ExamSuggestion } from "../lib/exam-suggestions"
import { getKnownExamConditions } from "../lib/exam-conditions"
import { formatTimer, getExamTimerState } from "../lib/exam-timer"
import { loadAppData } from "../lib/storage"
import { firstPreferredSubject, prioritiseSubjects } from "../lib/subjects"
import { hasPerformanceContext, type PerformanceContext } from "../lib/performance-context"
import type { VcaaStudyResources } from "../lib/vcaa-resources"
import { pauseExamSession, resumeExamSession, type ExamTimerSession } from "../lib/ongoing-timers"

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

export function ExamTimerMode({ progression, onProgressionChange, attempts, references, studies, preferredSubjects, initialExam, activeSession, saveStatus, syncAction, onLeave, onSessionChange, onSave }: ExamTimerModeProps) {
  const session = activeSession ?? null
  const now = useTickingNow(session ? 1000 : 60_000)
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
  const reportUrl = useMemo(() => studies.find((study) => study.studyName.toLowerCase() === (session?.subject ?? subject).toLowerCase())?.resources.find((resource) => resource.kind === "report" && resource.year === (session?.examYear ?? examYear))?.url, [examYear, session?.examYear, session?.subject, studies, subject])
  const paperUrl = studies.find((study) => study.studyName.toLowerCase() === (session?.subject ?? subject).toLowerCase())?.resources.find((resource) => resource.kind === "exam" && resource.year === (session?.examYear ?? examYear) && (!session?.paper || resource.label.toLowerCase().includes(session.paper.toLowerCase()) || session.paper.toLowerCase().includes(resource.label.toLowerCase())))?.url

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

  function saveSession(next: ExamTimerSession | undefined, action?: "cancel" | "complete") {
    onSessionChange(next, action)
  }

  const subjects = useMemo(() => prioritiseSubjects(references.map((item) => item.studyName), preferredSubjects), [preferredSubjects, references])
  const paperOptions = useMemo(
    () => [...new Set(references
      .filter((item) => item.studyName.toLowerCase() === subject.trim().toLowerCase())
      .map((item) => formatReferenceName(item.name)))].toSorted(),
    [references, subject],
  )
  const timer = useMemo(() => session
    ? getExamTimerState(session.pausedAt ?? now.getTime(), session.startedAt, session.readingMinutes, session.writingMinutes, session.marks)
    : null, [now, session])
  const timerPhase = timer ? timer.phase === "reading" ? "reading" : "writing" : null

  useEffect(() => {
    if (!session || !timerPhase || session.pausedAt !== undefined || session.phase === timerPhase) return
    onSessionChange({ ...session, phase: timerPhase })
  }, [session, timerPhase, onSessionChange])

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
    const next = {
      subject: subject.trim(), provider: provider.trim(), title: formatExamTitle(provider, examYear, subject), examYear, paper: paper.trim(),
      id: crypto.randomUUID(), phase: readingMinutes > 0 ? "reading" as const : "writing" as const,
      readingMinutes, writingMinutes, marks, startedAt: now.getTime(), pausedSeconds: 0, workspaceItems: [],
    }
    saveSession(next)
    setRawMax(marks)
  }

  function reset() {
    saveSession(undefined, "cancel")
    setMarkingOpen(false)
    setDiscardOpen(false)
    setQuestionResults([])
    setRawScore(0)
    setComment("")
    setPerformanceContext({})
  }

  function skipReading() {
    if (!session || !timer) return
    const next = { ...session, startedAt: (session.pausedAt ?? now.getTime()) - session.readingMinutes * 60_000, phase: "writing" as const }
    saveSession(next)
  }

  function pause() {
    if (!session || session.pausedAt !== undefined) return
    saveSession(pauseExamSession(session, now.getTime()))
  }

  function resume() {
    if (!session || session.pausedAt === undefined) return
    saveSession(resumeExamSession(session, now.getTime()))
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
    if (!session || !timer) return
    const error = validateAttempt({ rawScore, rawMax })
    if (error) {
      setMarkingError(error)
      return
    }
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
        actualWritingSeconds: timer.writingElapsedSeconds,
        overtimeSeconds: timer.overtimeSeconds,
        pausedSeconds: session.pausedSeconds ?? 0,
      },
      referenceId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    })
    saveSession(undefined, "complete")
    setMarkingOpen(false)
  }

  function renderSuggestions() {
    return (
        <Card size="sm" className="min-w-0 gap-4">
          <CardHeader>
            <CardTitle>Suggested next exams</CardTitle>
            <CardDescription>
              {latestAttempt
                ? `Based on your latest logged paper: ${latestAttempt.examYear} ${latestAttempt.subject} · ${latestAttempt.paper}.`
                : "Based on your preferred subjects and the available VCAA references."}
              {" "}Choose one to fill the setup form.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <ExamProgressionPanel compact progression={progression} onProgressionChange={onProgressionChange} attempts={attempts} subjects={preferredSubjects} onSelect={applySuggestion} />
            {suggestions.length ? <section className="grid gap-2" aria-labelledby="official-suggestions-title">
              <div><h3 id="official-suggestions-title" className="text-sm font-medium">Official VCAA papers</h3><p className="text-xs text-muted-foreground">Continue through available papers and years for your current subject.</p></div>
              <div className="grid grid-cols-2 gap-2">
                {suggestions.map((suggestion) => (
                  <SuggestionButton key={`${suggestion.subject}-${suggestion.provider}-${suggestion.examYear}-${suggestion.paper}`} suggestion={suggestion} onClick={applySuggestion} />
                ))}
              </div>
            </section> : null}
            {companySuggestions.length ? <section className="grid gap-2" aria-labelledby="company-suggestions-title">
              <div><h3 id="company-suggestions-title" className="text-sm font-medium">Company exam progression</h3><p className="text-xs text-muted-foreground">Finish this provider&apos;s paper set, then progress from easier companies towards harder ones.</p></div>
              <div className="grid grid-cols-2 gap-2">
                {companySuggestions.map((suggestion) => (
                  <SuggestionButton key={`${suggestion.subject}-${suggestion.provider}-${suggestion.examYear}-${suggestion.paper}`} suggestion={suggestion} onClick={applySuggestion} showProvider />
                ))}
              </div>
            </section> : null}
          </CardContent>
        </Card>
    )
  }

  if (!session || !timer) {
    return (
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card className="min-w-0 gap-4">
          <CardHeader>
            <CardTitle>Set up your exam</CardTitle>
            <CardDescription>Enter the paper details and timed conditions.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={start}>
              <FieldGroup className="gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="exam-mode-subject">Subject</FieldLabel>
                    <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={setSubject} id="exam-mode-subject" allowCustom required placeholder="Search or enter a subject" />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="exam-mode-provider">Provider</FieldLabel>
                    <Input id="exam-mode-provider" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="VCAA" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="exam-mode-year">Exam year</FieldLabel>
                    <Input id="exam-mode-year" type="number" min="1990" max="2100" value={examYear} onChange={(event) => setExamYear(event.target.valueAsNumber)} required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="exam-mode-paper">Paper</FieldLabel>
                    <Input id="exam-mode-paper" list="exam-mode-paper-options" value={paper} onChange={(event) => setPaper(event.target.value)} placeholder="Exam, paper, or assessment name" />
                    <datalist id="exam-mode-paper-options">{paperOptions.map((item) => <option key={item} value={item} />)}</datalist>
                  </Field>
                </div>

                <div className="border-t pt-4">
                  <p className="mb-3 text-sm font-medium">Timed conditions</p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    <Field>
                      <FieldLabel htmlFor="exam-mode-reading">Reading (min)</FieldLabel>
                      <Input id="exam-mode-reading" type="number" min="0" max="180" value={readingMinutes} onChange={(event) => setReadingMinutes(event.target.valueAsNumber)} required />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="exam-mode-writing">Writing (min)</FieldLabel>
                      <Input id="exam-mode-writing" type="number" min="1" max="360" value={writingMinutes} onChange={(event) => setWritingMinutes(event.target.valueAsNumber)} required />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="exam-mode-marks">Total marks</FieldLabel>
                      <Input id="exam-mode-marks" type="number" min="1" max="500" value={marks} onChange={(event) => setMarks(event.target.valueAsNumber)} required />
                    </Field>
                  </div>
                </div>
                <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-sm font-medium tabular-nums">{(writingMinutes / marks || 0).toFixed(2)} minutes per mark</p>
                    <p className="max-w-[68ch] text-xs text-muted-foreground">Reading moves to writing automatically. Overtime is recorded.</p>
                  </div>
                  <Button className="w-full lg:w-auto" type="submit" size="lg">{readingMinutes ? "Begin reading time" : "Begin writing time"}</Button>
                </div>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        <aside className="min-w-0">{renderSuggestions()}</aside>
      </div>
    )
  }

  const phaseLabel = timer.phase === "reading" ? "Reading time" : timer.phase === "writing" ? "Writing time" : "Overtime"
  const overtime = timer.phase === "overtime"
  const phaseCaption = timer.phase === "reading"
    ? "Reading time. The clock moves to writing on its own, and you can skip ahead if the paper is already open."
    : timer.phase === "writing"
      ? "Writing time. Pace yourself against the expected mark progress below."
      : "Writing time has ended. The clock is recording overtime until you finish and mark."

  return (
    <WorkspacePage className="gap-4 lg:gap-4">
      <PageHeader title={session.title} description={`${session.subject} · ${session.readingMinutes} min reading · ${session.writingMinutes} min writing · ${session.marks} marks`} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <Card className="min-w-0 gap-0">
      <CardContent className="py-4">
        <TimerReadout
          animationKey={`${phaseLabel}:${session.startedAt}`}
          caption={phaseCaption}
          display={overtime ? `+${formatTimer(timer.overtimeSeconds)}` : formatTimer(timer.remainingSeconds)}
          marks={{
            total: 2,
            filled: timer.phase === "reading" ? 0 : timer.phase === "writing" ? 1 : 2,
            label: timer.phase === "reading" ? "Reading next, then writing" : timer.phase === "writing" ? "Reading done, writing next" : "Both phases complete",
          }}
          mode={phaseLabel}
          onCaption={`${phaseLabel} ${overtime ? "overtime" : "started"}.`}
          overtime={overtime}
          progress={timer.progress}
          status={session.pausedAt !== undefined ? "Paused" : overtime ? "Recording overtime" : "Running"}
        >
          <div className="grid gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="lg" variant={session.pausedAt !== undefined ? "default" : "outline"} onClick={session.pausedAt !== undefined ? resume : pause}>{session.pausedAt !== undefined ? <Play /> : <Pause />}{session.pausedAt !== undefined ? "Resume exam" : "Pause and save"}</Button>
              <Button size="lg" variant={session.pausedAt !== undefined ? "outline" : "default"} onClick={openMarking}><Check />Finish & mark</Button>
              {timer.phase === "reading" ? <Button variant="outline" onClick={skipReading}>Skip to writing time</Button> : null}
            </div>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button size="sm" variant="outline" onClick={() => setConditionsOpen(true)}><SlidersHorizontal />Edit conditions</Button>
              <Button variant="ghost" size="sm" onClick={() => setDiscardOpen(true)}><Trash2 />Discard exam</Button>
            </div>
          </div>
        </TimerReadout>
      </CardContent>
      </Card>

      <Card size="sm" className="min-w-0 gap-3" aria-label="Session save status">
        <CardHeader><CardTitle>Session overview</CardTitle></CardHeader>
        <CardContent className="grid gap-3">
          <dl className="grid gap-3 text-sm">
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Planned pace</dt><dd className="font-medium tabular-nums">{(session.writingMinutes / session.marks).toFixed(2)} min / mark</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted-foreground">Expected progress</dt><dd className="font-medium tabular-nums">{timer.phase === "reading" ? "Starts in writing" : `${timer.expectedMarks.toFixed(1)} / ${session.marks} marks`}</dd></div>
          </dl>
          <div className="grid gap-2 border-t pt-3">
            <p className="text-sm font-medium">{session.pausedAt !== undefined ? "Paused · ready when you are" : "Exam in progress"}</p>
            <p className="text-xs text-muted-foreground">{session.pausedAt !== undefined ? `Paused ${new Date(session.pausedAt).toLocaleString()}. Your remaining time is frozen.` : "Pause before leaving to stop the clock."}</p>
            <p role="status" className="text-sm text-muted-foreground">{saveStatus}</p>
            {syncAction ? <Button size="sm" variant="outline" onClick={syncAction.onClick}>{syncAction.label}</Button> : null}
            <Button variant="outline" onClick={() => { pause(); onLeave() }}>{session.pausedAt !== undefined ? "Back to focus blocks" : "Pause, save & exit"}</Button>
            {session.id ? <p className="text-xs text-muted-foreground">This timer is shared with Focal when you sign in to the same account.</p> : null}
          </div>
        </CardContent>
      </Card>
      </div>

      <ExamWorkspace
        items={session.workspaceItems ?? []}
        expectedMarks={timer.expectedMarks}
        totalMarks={session.marks}
        paperUrl={paperUrl}
        reportUrl={reportUrl}
        onChange={(workspaceItems) => saveSession({ ...session, workspaceItems })}
      />

      {overtime ? <Alert variant="destructive"><Clock3 /><AlertTitle>Writing time has ended</AlertTitle><AlertDescription>{session.pausedAt !== undefined ? "Overtime is paused. Resume to continue, adjust conditions, or finish and mark." : "The timer is now recording overtime. Finish and mark when you put your pen down."}</AlertDescription></Alert> : null}

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Discard this exam?</DialogTitle><DialogDescription>This removes your timer, question progress, and shared study session. Pause and save to keep your work for later.</DialogDescription></DialogHeader>
          <DialogFooter><Button variant="outline" onClick={() => setDiscardOpen(false)}>Keep exam</Button><Button variant="destructive" onClick={reset}>Discard exam</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {conditionsOpen ? <ExamConditionsDialog session={session} now={now.getTime()} onClose={() => setConditionsOpen(false)} onSave={(next) => {
        saveSession(next)
        setRawMax(next.marks)
        toast.success("Exam conditions updated")
      }} /> : null}

      <Dialog open={markingOpen} onOpenChange={(open) => open ? setMarkingOpen(true) : setMarkingOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Mark and log exam</DialogTitle>
            <DialogDescription>Enter your result to add this timed attempt to Focal.</DialogDescription>
          </DialogHeader>
          <form id="timer-marking-form" onSubmit={saveMark}>
            <FieldGroup>
              <div className="grid grid-cols-2 gap-4">
                <Field data-invalid={markingError ? true : undefined}>
                  <FieldLabel htmlFor="timer-score">Mark</FieldLabel>
                  <Input id="timer-score" type="number" min="0" step="0.5" value={rawScore} onChange={(event) => setRawScore(event.target.valueAsNumber)} autoFocus required />
                </Field>
                <Field data-invalid={markingError ? true : undefined}>
                  <FieldLabel htmlFor="timer-maximum">Out of</FieldLabel>
                  <Input id="timer-maximum" type="number" min="0.5" step="0.5" value={rawMax} onChange={(event) => setRawMax(event.target.valueAsNumber)} required />
                </Field>
              </div>
              <Field>
                <FieldLabel htmlFor="timer-completed">Completed</FieldLabel>
                <Input id="timer-completed" type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} required />
              </Field>
              <PerformanceContextFields value={performanceContext} onChange={setPerformanceContext} idPrefix="exam-timer-context" />
              <QuestionResultsEditor value={questionResults} onChange={(results) => {
                setQuestionResults(results)
                const maximum = results.reduce((total, result) => total + result.maxMarks, 0)
                if (Math.abs(maximum - rawMax) < 0.01) setRawScore(results.reduce((total, result) => total + result.marksAwarded, 0))
                setMarkingError(null)
              }} />
              <Field>
                <FieldLabel htmlFor="timer-comment">Overall comment <span className="text-muted-foreground">(optional)</span></FieldLabel>
                <Textarea id="timer-comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What went well or what to improve next time?" />
              </Field>
              <FieldError>{markingError}</FieldError>
            </FieldGroup>
          </form>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMarkingOpen(false)}>Back to paused exam</Button>
            <Button type="submit" form="timer-marking-form">Log exam attempt</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </WorkspacePage>
  )
}
