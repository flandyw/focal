import { useEffect, useMemo, useRef, useState, type FormEvent } from "react"
import { Check, Clock3, Pause, Play, RotateCcw } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress, ProgressLabel } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { SubjectCombobox } from "@/components/subject-combobox"
import { PerformanceContextFields } from "@/components/performance-context-fields"
import { useTickingNow } from "@/hooks/use-ticking-now"
import { formatTimer } from "@/lib/exam-timer"
import { getSacTimerState, SAC_UNITS, validateSac, type SacRecord, type SacUnit } from "@/lib/sac"
import {
  createFocalTimerLink,
  pauseFocalTimer,
  publishFocalTimer,
  resumeFocalTimer,
} from "@/lib/focal-timer"
import { prioritiseSubjects } from "@/lib/subjects"
import { hasPerformanceContext, type PerformanceContext } from "@/lib/performance-context"
import { isSacTimerSession, type SacTimerSession } from "@/lib/ongoing-timers"

type SacTimerProps = {
  records: SacRecord[]
  subjects: string[]
  preferredSubjects: string[]
  initialRecord?: SacRecord | null
  activeSession?: SacTimerSession
  onSessionChange: (session: SacTimerSession | undefined) => void
  onSave: (record: SacRecord) => void
}

const STORAGE_KEY = "examtrack.sac-timer"
const today = () => new Date().toISOString().slice(0, 10)

function loadSession(): SacTimerSession | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Record<string, unknown> | null
    if (value && typeof value.provider !== "string") value.provider = "School"
    return isSacTimerSession(value) ? value : null
  } catch {
    return null
  }
}

export function SacTimer({ records, subjects, preferredSubjects, initialRecord, activeSession, onSessionChange, onSave }: SacTimerProps) {
  const migratedLegacySession = useRef(false)
  const session = activeSession ?? null
  const availableSubjects = useMemo(() => prioritiseSubjects(subjects, preferredSubjects), [preferredSubjects, subjects])
  const [subject, setSubject] = useState(initialRecord?.subject ?? preferredSubjects[0] ?? availableSubjects[0] ?? "")
  const [provider, setProvider] = useState(initialRecord?.provider ?? "")
  const [title, setTitle] = useState(initialRecord?.title ?? "")
  const [sacNumber, setSacNumber] = useState(initialRecord?.sacNumber ?? "")
  const [unit, setUnit] = useState<SacUnit | null>(initialRecord?.unit ?? null)
  const [areaOfStudy, setAreaOfStudy] = useState(initialRecord?.areaOfStudy ?? "")
  const [scheduledAt, setScheduledAt] = useState(initialRecord?.scheduledAt ?? today())
  const [durationMinutes, setDurationMinutes] = useState(initialRecord?.durationMinutes ?? 50)
  const [maxScore, setMaxScore] = useState(initialRecord?.maxScore ?? 50)
  const [markingOpen, setMarkingOpen] = useState(false)
  const [score, setScore] = useState(0)
  const [notes, setNotes] = useState(initialRecord?.notes ?? "")
  const [performanceContext, setPerformanceContext] = useState<PerformanceContext>(initialRecord?.performanceContext ?? {})
  const [error, setError] = useState<string | null>(null)
  const now = useTickingNow(session ? 1000 : 60_000)

  useEffect(() => {
    if (!migratedLegacySession.current) {
      migratedLegacySession.current = true
      const legacySession = loadSession()
      if (!activeSession && legacySession) onSessionChange(legacySession)
    }
    if (activeSession) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(activeSession))
    else sessionStorage.removeItem(STORAGE_KEY)
  }, [activeSession, onSessionChange])

  function saveSession(next: SacTimerSession | undefined) {
    if (next) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    else sessionStorage.removeItem(STORAGE_KEY)
    onSessionChange(next)
  }
  const timer = useMemo(() => session
    ? getSacTimerState(session.pausedAt ?? now.getTime(), session.startedAt, session.durationMinutes)
    : null, [now, session])

  function start(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (unit === null) return setError("Choose the unit for this assessment.")
    const validationError = validateSac({ subject, provider, title, unit, scheduledAt, durationMinutes, maxScore: undefined, score: undefined, weighting: initialRecord?.weighting }) ??
      (!Number.isFinite(maxScore) || maxScore <= 0 ? "Total marks must be greater than zero." : null)
    if (validationError) return setError(validationError)
    const focal = createFocalTimerLink("sac", subject, title, durationMinutes * 60)
    const next: SacTimerSession = {
      recordId: initialRecord?.id,
      subject: subject.trim(),
      provider: provider.trim(),
      title: title.trim(),
      sacNumber: sacNumber.trim() || undefined,
      unit,
      areaOfStudy: areaOfStudy.trim() || undefined,
      scheduledAt,
      durationMinutes,
      maxScore,
      weighting: initialRecord?.weighting,
      notes: initialRecord?.notes,
      createdAt: initialRecord?.createdAt,
      startedAt: Date.now(),
      pausedSeconds: 0,
      focal,
    }
    saveSession(next)
    setError(null)
    void publishFocalTimer(focal, "in-progress")
  }

  function pause() {
    if (!session || session.pausedAt) return
    const focal = session.focal ? pauseFocalTimer(session.focal) : undefined
    const next = { ...session, pausedAt: Date.now(), focal }
    saveSession(next)
    if (focal) void publishFocalTimer(focal, "in-progress")
  }

  function resume() {
    if (!session?.pausedAt) return
    const pauseDuration = Date.now() - session.pausedAt
    const focal = session.focal ? resumeFocalTimer(session.focal) : undefined
    const next = {
      ...session,
      startedAt: session.startedAt + pauseDuration,
      pausedAt: undefined,
      pausedSeconds: session.pausedSeconds + Math.floor(pauseDuration / 1000),
      focal,
    }
    saveSession(next)
    if (focal) void publishFocalTimer(focal, "in-progress")
  }

  function discard() {
    if (!window.confirm("Discard this timed SAC and return to setup?")) return
    if (session?.focal) void publishFocalTimer(session.focal, "delete")
    saveSession(undefined)
    setMarkingOpen(false)
  }

  function openMarking() {
    pause()
    setError(null)
    setMarkingOpen(true)
  }

  function closeMarking() {
    setMarkingOpen(false)
    resume()
  }

  function saveResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!session || !timer) return
    const validationError = validateSac({
      subject: session.subject,
      provider: session.provider,
      title: session.title,
      unit: session.unit,
      scheduledAt: session.scheduledAt,
      durationMinutes: session.durationMinutes,
      score,
      maxScore: session.maxScore,
      weighting: session.weighting,
    })
    if (validationError) return setError(validationError)
    const existing = session.recordId ? records.find((record) => record.id === session.recordId) : undefined
    const timestamp = new Date().toISOString()
    onSave({
      id: session.recordId ?? crypto.randomUUID(),
      subject: session.subject,
      provider: session.provider,
      title: session.title,
      sacNumber: session.sacNumber,
      unit: session.unit,
      areaOfStudy: session.areaOfStudy,
      scheduledAt: session.scheduledAt,
      durationMinutes: session.durationMinutes,
      score,
      maxScore: session.maxScore,
      weighting: session.weighting,
      completedAt: today(),
      notes: notes.trim() || session.notes,
      performanceContext: hasPerformanceContext(performanceContext) ? performanceContext : undefined,
      timing: {
        plannedSeconds: session.durationMinutes * 60,
        actualSeconds: timer.elapsedSeconds,
        overtimeSeconds: timer.overtimeSeconds,
        pausedSeconds: session.pausedSeconds,
      },
      createdAt: existing?.createdAt ?? session.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    if (session.focal) void publishFocalTimer(session.focal, "completed")
    saveSession(undefined)
    setMarkingOpen(false)
  }

  if (!session || !timer) {
    return (
      <Card>
        <CardHeader><CardTitle>Set up a timed SAC</CardTitle><CardDescription>Use a planned SAC or enter the conditions for a practice run.</CardDescription></CardHeader>
        <CardContent>
          <form onSubmit={start}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field><FieldLabel htmlFor="sac-timer-subject">Subject</FieldLabel><SubjectCombobox id="sac-timer-subject" subjects={availableSubjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={setSubject} allowCustom required placeholder="Search or enter a subject" /></Field>
                <Field><FieldLabel htmlFor="sac-timer-provider">School / provider</FieldLabel><Input id="sac-timer-provider" value={provider} onChange={(event) => setProvider(event.target.value)} required placeholder="School or practice provider" /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
                <Field><FieldLabel htmlFor="sac-timer-title">SAC title</FieldLabel><Input id="sac-timer-title" value={title} onChange={(event) => setTitle(event.target.value)} required placeholder="Assessment topic" /></Field>
                <Field><FieldLabel htmlFor="sac-timer-number">SAC number <span className="text-muted-foreground">(optional)</span></FieldLabel><Input id="sac-timer-number" value={sacNumber} onChange={(event) => setSacNumber(event.target.value)} placeholder="e.g. 2 or 3A" /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <Field><FieldLabel htmlFor="sac-timer-unit">Unit</FieldLabel><Select value={unit === null ? null : String(unit)} onValueChange={(value) => setUnit(value === null ? null : Number(value) as SacUnit)}><SelectTrigger id="sac-timer-unit" className="w-full"><SelectValue placeholder="Select unit" /></SelectTrigger><SelectContent>{SAC_UNITS.map((option) => <SelectItem key={option} value={String(option)}>Unit {option}</SelectItem>)}</SelectContent></Select></Field>
                <Field><FieldLabel htmlFor="sac-timer-aos">Area of Study</FieldLabel><Input id="sac-timer-aos" value={areaOfStudy} onChange={(event) => setAreaOfStudy(event.target.value)} placeholder="Optional" /></Field>
                <Field><FieldLabel htmlFor="sac-timer-date">Date</FieldLabel><Input id="sac-timer-date" type="date" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required /></Field>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field><FieldLabel htmlFor="sac-timer-duration">Time allowed (min)</FieldLabel><Input id="sac-timer-duration" type="number" min="1" max="360" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.valueAsNumber)} required /></Field>
                <Field><FieldLabel htmlFor="sac-timer-marks">Total marks</FieldLabel><Input id="sac-timer-marks" type="number" min="0.5" max="500" step="0.5" value={maxScore} onChange={(event) => setMaxScore(event.target.valueAsNumber)} required /></Field>
              </div>
              <Alert><Clock3 /><AlertTitle>{(durationMinutes / maxScore || 0).toFixed(2)} minutes per mark</AlertTitle><AlertDescription>The timer records pauses and overtime, then saves both with your result.</AlertDescription></Alert>
              <FieldError>{error}</FieldError>
              <Button type="submit" size="lg">Start SAC timer</Button>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    )
  }

  const overtime = timer.phase === "overtime"
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div><h2 className="text-xl font-semibold">{session.title}</h2><p className="text-sm text-muted-foreground">{session.subject} · {session.provider}{session.sacNumber ? ` · SAC ${session.sacNumber}` : ""} · Unit {session.unit} · {session.durationMinutes} min · {session.maxScore} marks</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="ghost" onClick={discard}><RotateCcw />Discard</Button><Button variant="outline" onClick={session.pausedAt ? resume : pause}>{session.pausedAt ? <Play /> : <Pause />}{session.pausedAt ? "Resume" : "Pause"}</Button><Button onClick={openMarking}><Check />Finish & mark</Button></div>
      </div>
      {session.focal ? <Alert><Clock3 /><AlertTitle>Focal study logging active</AlertTitle><AlertDescription>Timer changes are queued and mirrored when your separate Focal account is connected and online.</AlertDescription></Alert> : null}
      <section className="grid gap-6 py-8 text-center">
        <div><p className={overtime ? "text-sm font-medium text-destructive" : "text-sm font-medium text-muted-foreground"}>{overtime ? "Overtime" : session.pausedAt ? "Paused" : "Time remaining"}</p><p role="timer" className={overtime ? "mt-2 text-7xl font-semibold tracking-tight text-destructive tabular-nums sm:text-8xl" : "mt-2 text-7xl font-semibold tracking-tight tabular-nums sm:text-8xl"}>{overtime ? `+${formatTimer(timer.overtimeSeconds)}` : formatTimer(timer.remainingSeconds)}</p></div>
        <Progress value={timer.progress} className="mx-auto w-full max-w-2xl"><ProgressLabel>{overtime ? "Time elapsed" : "SAC progress"}</ProgressLabel><span className="ml-auto text-sm text-muted-foreground tabular-nums">{Math.round(timer.progress)}%</span></Progress>
      </section>
      <div className="grid gap-4 sm:grid-cols-2"><Card><CardHeader><CardDescription>Pace</CardDescription><CardTitle className="text-3xl tabular-nums">{(session.durationMinutes / session.maxScore).toFixed(2)} min / mark</CardTitle></CardHeader></Card><Card><CardHeader><CardDescription>Expected progress</CardDescription><CardTitle className="text-3xl tabular-nums">{Math.min(session.maxScore, (timer.elapsedSeconds / (session.durationMinutes * 60)) * session.maxScore).toFixed(1)} / {session.maxScore} marks</CardTitle></CardHeader></Card></div>
      {overtime ? <Alert variant="destructive"><Clock3 /><AlertTitle>Time has ended</AlertTitle><AlertDescription>The timer is recording overtime. Finish and mark when you put your pen down.</AlertDescription></Alert> : null}
      <Dialog open={markingOpen} onOpenChange={(open) => open ? setMarkingOpen(true) : closeMarking()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl"><DialogHeader><DialogTitle>Mark and log SAC</DialogTitle><DialogDescription>Save the result, conditions, and timing evidence to your SAC statistics.</DialogDescription></DialogHeader><form id="sac-timer-result" onSubmit={saveResult}><FieldGroup><div className="grid grid-cols-2 gap-4"><Field data-invalid={error ? true : undefined}><FieldLabel htmlFor="sac-timer-score">Mark</FieldLabel><Input id="sac-timer-score" type="number" min="0" max={session.maxScore} step="0.5" value={score} onChange={(event) => setScore(event.target.valueAsNumber)} autoFocus required /></Field><Field><FieldLabel>Out of</FieldLabel><Input value={session.maxScore} disabled /></Field></div><PerformanceContextFields value={performanceContext} onChange={setPerformanceContext} idPrefix="sac-timer-context" /><Field><FieldLabel htmlFor="sac-timer-notes">Notes <span className="text-muted-foreground">(optional)</span></FieldLabel><Textarea id="sac-timer-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="What went well or what needs revision?" /></Field><FieldError>{error}</FieldError></FieldGroup></form><DialogFooter><Button variant="outline" onClick={closeMarking}>Keep timing</Button><Button type="submit" form="sac-timer-result">Log SAC result</Button></DialogFooter></DialogContent>
      </Dialog>
    </div>
  )
}
