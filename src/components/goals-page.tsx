import { normaliseScalingStudyName, type ScalingReference } from "../lib/scaling"
import { useMemo, useState, type FormEvent } from "react"
import { Archive, CalendarClock, CalendarPlus, CircleCheck, Flag, Gauge, Pencil, Plus, Target } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Field, FieldError, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "./ui/sheet"
import { DiscardChangesDialog } from "./discard-changes-dialog"
import { PageHeader } from "./page-header"
import { SubjectCombobox } from "./subject-combobox"
import { Panel, Ring, StatGrid, StatTile, WorkspacePage } from "./workspace-layout"
import { useTickingNow } from "../hooks/use-ticking-now"
import { canonicalNow } from "../lib/study-session-sync"
import type { AppData, AssessmentReference } from "../lib/exam-data"
import { getGoalProgress, localDate, type LearningWorkspace, type LearningWorkspaceUpdate, type StudyGoal, type StudyGoalKind } from "../lib/learning-workspace"

function defaultDeadline() {
  const date = new Date()
  const target = new Date(date.getFullYear(), date.getMonth() + 3, 1)
  return localDate(new Date(target.getFullYear(), target.getMonth(), Math.min(date.getDate(), new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate())))
}

function kindLabel(kind: StudyGoalKind) {
  return kind === "study-score" ? "Raw study score" : kind === "exam-percentage" ? "Exam average" : "ATAR"
}

function validateGoal(kind: StudyGoalKind, subject: string, target: number, deadline: string) {
  const maximum = kind === "study-score" ? 50 : kind === "atar" ? 99.95 : 100
  if (kind !== "atar" && !subject.trim()) return "Choose a subject."
  if (!Number.isFinite(target) || target <= 0 || target > maximum) return `Target must be between 1 and ${maximum}.`
  if (!deadline || deadline < localDate(new Date())) return "Choose today or a future deadline."
  return null
}

function GoalEditSheet({ goal, data, subjects, scopedSubject, onClose, onSave }: {
  goal: StudyGoal
  data: AppData
  subjects: string[]
  scopedSubject?: string
  onClose: () => void
  onSave: (goal: StudyGoal) => void
}) {
  const [kind, setKind] = useState(goal.kind)
  const initialSubject = goal.subject ?? scopedSubject ?? data.subjects[0] ?? ""
  const [subject, setSubject] = useState(initialSubject)
  const [target, setTarget] = useState(goal.target)
  const [deadline, setDeadline] = useState(goal.deadline)
  const [error, setError] = useState<string | null>(null)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const dirty = kind !== goal.kind || target !== goal.target || deadline !== goal.deadline || (kind !== "atar" && subject !== initialSubject)
  const now = useTickingNow()

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const validationError = validateGoal(kind, subject, target, deadline)
    if (validationError) return setError(validationError)
    onSave({
      ...goal,
      kind,
      subject: kind === "atar" ? undefined : subject.trim(),
      target,
      deadline,
      updatedAt: new Date().toISOString(),
    })
  }

  return (
    <Sheet open onOpenChange={(open) => { if (!open) { if (dirty) setConfirmingClose(true); else onClose() } }}>
      <SheetContent resizable className="w-full">
        <SheetHeader>
          <SheetTitle>Edit goal</SheetTitle>
          <SheetDescription>Update the score target or deadline while keeping its existing progress history.</SheetDescription>
        </SheetHeader>
        <form id="edit-goal-form" className="grid gap-5 px-4 pb-4" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="edit-goal-kind">Measure</FieldLabel>
            <Select value={kind} onValueChange={(value) => { const next = (value ?? "exam-percentage") as StudyGoalKind; setKind(next); setTarget(next === "study-score" ? 40 : next === "atar" ? 90 : 80); setError(null) }}>
              <SelectTrigger id="edit-goal-kind" className="w-full"><SelectValue>{kindLabel(kind)}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="exam-percentage">Exam average</SelectItem><SelectItem value="study-score">Raw study score</SelectItem>{!scopedSubject ? <SelectItem value="atar">ATAR</SelectItem> : null}</SelectContent>
            </Select>
          </Field>
          {kind !== "atar" ? <Field>
            <FieldLabel htmlFor="edit-goal-subject">Subject</FieldLabel>
            {scopedSubject ? <Input id="edit-goal-subject" value={subject} readOnly /> : <SubjectCombobox id="edit-goal-subject" subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={(value) => { setSubject(value); setError(null) }} allowCustom required />}
          </Field> : null}
          <Field data-invalid={error ? true : undefined}><FieldLabel htmlFor="edit-goal-target">Target</FieldLabel><Input id="edit-goal-target" type="number" min="1" max={kind === "study-score" ? 50 : kind === "atar" ? 99.95 : 100} step={kind === "atar" ? 0.05 : 1} value={Number.isFinite(target) ? target : ""} onChange={(event) => { setTarget(event.target.valueAsNumber); setError(null) }} required /></Field>
          <Field><FieldLabel htmlFor="edit-goal-deadline">By</FieldLabel><Input id="edit-goal-deadline" type="date" min={localDate(now)} value={deadline} onChange={(event) => { setDeadline(event.target.value); setError(null) }} required /></Field>
          <FieldError>{error}</FieldError>
        </form>
        <SheetFooter><Button type="submit" form="edit-goal-form" disabled={!dirty}>Save changes</Button></SheetFooter>
      </SheetContent>
      <DiscardChangesDialog open={confirmingClose} onKeep={() => setConfirmingClose(false)} onDiscard={onClose} />
    </Sheet>
  )
}

export function GoalsPage({ data, references, subjects, scopedSubject, onChange, onPlanGoal, scalingReferences }: {
  data: AppData
  references: AssessmentReference[]
  subjects: string[]
  scopedSubject?: string
  onChange: (learning: LearningWorkspaceUpdate) => void
  onPlanGoal: (goal: StudyGoal) => void
  scalingReferences?: ScalingReference[]
}) {
  const [kind, setKind] = useState<StudyGoalKind>("exam-percentage")
  const [subject, setSubject] = useState(scopedSubject ?? data.subjects[0] ?? "")
  const [target, setTarget] = useState(80)
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [editingGoal, setEditingGoal] = useState<StudyGoal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const now = useTickingNow()
  const progress = useMemo(() => data.learning.goals.filter((goal) => !goal.archivedAt).map((goal) => {
    const progress = getGoalProgress(goal, data, references, scalingReferences)
    if (goal.kind === "atar" || progress.current === null) return { goal, progress, movement: "" }
    const createdAt = new Date(goal.createdAt)
    const baselineAttempts = data.attempts.filter((attempt) => new Date(attempt.createdAt || attempt.completedAt).getTime() <= createdAt.getTime())
    const baseline = getGoalProgress(goal, { ...data, attempts: baselineAttempts }, references, scalingReferences).current
    const newPapers = data.attempts.filter((attempt) => (!goal.subject || (goal.kind === "study-score" ? normaliseScalingStudyName(attempt.subject) === normaliseScalingStudyName(goal.subject) : attempt.subject.toLowerCase() === goal.subject.toLowerCase())) && new Date(attempt.createdAt || attempt.completedAt).getTime() > createdAt.getTime()).length
    const setOn = createdAt.toLocaleDateString("en-AU", { day: "numeric", month: "short" })
    const change = baseline === null ? 0 : Number((progress.current - baseline).toFixed(1))
    const movement = !newPapers ? `No new papers since you set this on ${setOn}.`
      : baseline === null ? `No baseline when you set this on ${setOn}; now ${progress.current.toFixed(1)}.`
      : `${change === 0 ? "No change" : `${change > 0 ? "Up" : "Down"} ${Math.abs(change).toFixed(1)}`} since you set this on ${setOn}, from ${baseline.toFixed(1)} across ${newPapers} new paper${newPapers === 1 ? "" : "s"}.`
    return { goal, progress, movement }
  }), [data, references, scalingReferences])
  const archivedGoals = data.learning.goals.filter((goal) => goal.archivedAt)
  const daysTo = (deadline: string) => Math.round((new Date(`${deadline}T00:00:00`).getTime() - new Date(`${localDate(now)}T00:00:00`).getTime()) / 86_400_000)
  const isReached = ({ goal, progress: item }: (typeof progress)[number]) => item.current !== null && item.current >= goal.target
  const reached = progress.filter(isReached).length
  const nextDeadline = progress.filter((entry) => !isReached(entry) && daysTo(entry.goal.deadline) >= 0).map((entry) => daysTo(entry.goal.deadline)).sort((a, b) => a - b)[0]

  function commit(update: (current: LearningWorkspace) => LearningWorkspace) {
    onChange((current) => ({ ...update(current), updatedAt: new Date().toISOString() }))
  }

  function addGoal() {
    const validationError = validateGoal(kind, subject, target, deadline)
    if (validationError) return setError(validationError)
    const timestamp = new Date().toISOString()
    commit((current) => ({
      ...current,
      goals: [...current.goals, { id: crypto.randomUUID(), kind, subject: kind === "atar" ? undefined : subject.trim(), target, deadline, createdAt: timestamp, updatedAt: timestamp }],
    }))
    setError(null)
    toast.success(`${kind === "atar" ? "" : `${subject.trim()} `}${kindLabel(kind).toLowerCase()} goal added`)
  }

  function removeGoal(id: string) {
    const updatedAt = canonicalNow().toISOString()
    commit((current) => ({ ...current, goals: current.goals.map((goal) => goal.id === id ? { ...goal, archivedAt: updatedAt, updatedAt } : goal) }))
    toast.success("Goal archived", { duration: 8000, action: { label: "Undo", onClick: () => restoreGoal(id) } })
  }

  function saveEditedGoal(updated: StudyGoal) {
    commit((current) => ({ ...current, goals: current.goals.map((goal) => goal.id === updated.id ? updated : goal) }))
    setEditingGoal(null)
  }

  function restoreGoal(id: string) {
    const updatedAt = canonicalNow().toISOString()
    commit((current) => ({ ...current, goals: current.goals.map((goal) => goal.id === id ? { ...goal, archivedAt: undefined, updatedAt } : goal) }))
  }

  return (
    <WorkspacePage>
      <PageHeader icon={Target} title="Score goals" description="Targets with a deadline, measured against what you have logged." />
      {progress.length ? <StatGrid>
        <StatTile icon={Flag} label="Active goals" value={progress.length} hint={archivedGoals.length ? `${archivedGoals.length} archived` : "Each tracks one measure"} />
        <StatTile icon={CircleCheck} tone="success" label="Reached" value={`${reached} / ${progress.length}`} hint={reached === progress.length ? "All targets met" : `${progress.length - reached} still open`} />
        <StatTile icon={Gauge} label="Average progress" value={`${Math.round(progress.reduce((sum, { progress: item }) => sum + item.progress, 0) / progress.length)}%`} hint="Towards each target" />
        <StatTile icon={CalendarClock} tone={nextDeadline != null && nextDeadline <= 14 ? "warning" : "default"} label="Next deadline" value={nextDeadline == null ? "—" : `${nextDeadline}d`} hint={nextDeadline == null ? "No open deadlines" : "Until the closest open goal"} />
      </StatGrid> : null}
      <Panel icon={Plus} title="Set a goal" description="Predictions are estimates. Goals show direction and evidence, not guaranteed outcomes.">
        <form className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12 xl:items-end" onSubmit={(event) => { event.preventDefault(); addGoal() }}>
          <Field className="xl:col-span-2"><FieldLabel htmlFor="goal-kind">Measure</FieldLabel><Select value={kind} onValueChange={(value) => { const next = (value ?? "exam-percentage") as StudyGoalKind; setKind(next); setTarget(next === "study-score" ? 40 : next === "atar" ? 90 : 80); setError(null) }}><SelectTrigger id="goal-kind" className="w-full"><SelectValue>{kindLabel(kind)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="exam-percentage">Exam average</SelectItem><SelectItem value="study-score">Raw study score</SelectItem>{!scopedSubject ? <SelectItem value="atar">ATAR</SelectItem> : null}</SelectContent></Select></Field>
          {kind !== "atar" ? <Field className="xl:col-span-4">
            <FieldLabel htmlFor="goal-subject">Subject</FieldLabel>
            {scopedSubject ? <Input id="goal-subject" value={subject} readOnly /> : <SubjectCombobox id="goal-subject" subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={(value) => { setSubject(value); setError(null) }} allowCustom required />}
          </Field> : <div className="hidden xl:col-span-4 xl:block" />}
          <Field className="xl:col-span-2" data-invalid={error ? true : undefined}><FieldLabel htmlFor="goal-target">Target</FieldLabel><Input id="goal-target" type="number" min="1" max={kind === "study-score" ? 50 : kind === "atar" ? 99.95 : 100} step={kind === "atar" ? 0.05 : 1} value={Number.isFinite(target) ? target : ""} required onChange={(event) => { setTarget(event.target.valueAsNumber); setError(null) }} /></Field>
          <Field className="xl:col-span-2"><FieldLabel htmlFor="goal-deadline">By</FieldLabel><Input id="goal-deadline" type="date" min={localDate(now)} value={deadline} required onChange={(event) => { setDeadline(event.target.value); setError(null) }} /></Field>
          <Button type="submit" className="w-full xl:col-span-2"><Plus />Add goal</Button>
          <FieldError className="sm:col-span-2 xl:col-span-full">{error}</FieldError>
        </form>
      </Panel>

      {progress.length ? <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3 max-lg:order-first">{progress.map(({ goal, progress: item, movement }) => {
        const achieved = item.current !== null && item.current >= goal.target
        const expired = !achieved && goal.deadline < localDate(now)
        const digits = goal.kind === "atar" ? 2 : 1
        const daysLeft = daysTo(goal.deadline)
        const status = expired ? "Expired" : achieved ? "Reached" : item.gap === null ? "Needs baseline" : `${item.gap.toFixed(digits)} to go`
        return <Card key={goal.id} className="focal-tile gap-4 hover:border-primary/40">
          <CardHeader>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-medium text-muted-foreground">{kindLabel(goal.kind)}</p>
                <CardTitle className="mt-0.5 text-pretty">{goal.subject ?? "Overall ATAR"}</CardTitle>
              </div>
              <Badge className="shrink-0" variant={expired ? "destructive" : achieved ? "success" : "outline"}>{status}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-4">
            {/* The number is the point of the card: current against target, with the clock beside it. */}
            <div className="flex min-w-0 items-center gap-4">
              <Ring value={item.progress / 100} size={72} tone={expired ? "var(--destructive)" : achieved ? "var(--success)" : "var(--primary)"}><span role="progressbar" aria-label={`${goal.subject ? `${goal.subject} ` : ""}${kindLabel(goal.kind)} progress to ${goal.target}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(item.progress)} className="text-sm font-semibold tabular-nums">{Math.round(item.progress)}%</span></Ring>
              <div className="min-w-0 flex-1">
                <p className="tabular-nums"><span className="focal-stat-value">{item.current === null ? "—" : item.current.toFixed(digits)}</span><span className="ml-1.5 text-sm text-muted-foreground">/ {goal.target}</span></p>
                <p className="mt-1 truncate text-xs text-muted-foreground">{item.label} · {item.evidence}</p>
              </div>
              <p className={`shrink-0 text-right text-xs tabular-nums ${expired ? "text-destructive" : "text-muted-foreground"}`}>{daysLeft < 0 ? `Ended ${-daysLeft}d ago` : daysLeft === 0 ? "Due today" : `${daysLeft} day${daysLeft === 1 ? "" : "s"} left`}<span className="block">by {new Date(`${goal.deadline}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</span></p>
            </div>
            <p className="text-sm text-pretty">{expired ? "The deadline has passed. Edit it to keep going, or archive this goal." : item.gap === null ? "Log compatible evidence to calculate a pathway." : achieved ? "Maintain this result with spaced review and full-paper practice." : `${movement ? `${movement} ` : ""}About ${(item.gap / Math.max(1, daysLeft / 7)).toFixed(digits)} a week closes the gap by the deadline.`}</p>
            <div className="flex flex-wrap items-center gap-2 border-t pt-3">
              <Button size="sm" variant={achieved ? "outline" : "default"} onClick={() => onPlanGoal(goal)}><CalendarPlus />Plan work</Button>
              <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setEditingGoal(goal)}><Pencil />Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => removeGoal(goal.id)}><Archive />Archive</Button>
            </div>
          </CardContent>
        </Card>
      })}</div> : <Empty className="min-h-56 border"><EmptyHeader><EmptyMedia variant="icon"><Flag /></EmptyMedia><EmptyTitle>No score goals yet</EmptyTitle><EmptyDescription>Add a target above to see your current baseline and the gap to close.</EmptyDescription></EmptyHeader></Empty>}
      {archivedGoals.length ? <Card><CardHeader><CardTitle>Archived goals</CardTitle></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{archivedGoals.map((goal) => <div key={goal.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{goal.subject ? `${goal.subject} · ` : ""}{kindLabel(goal.kind)}</p><p className="text-xs text-muted-foreground tabular-nums">Target {goal.target} by {new Date(`${goal.deadline}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p></div><Button size="sm" variant="outline" onClick={() => restoreGoal(goal.id)}>Restore</Button></div>)}</CardContent></Card> : null}
      {editingGoal ? <GoalEditSheet key={editingGoal.id} goal={editingGoal} data={data} subjects={subjects} scopedSubject={scopedSubject} onClose={() => setEditingGoal(null)} onSave={saveEditedGoal} /> : null}
    </WorkspacePage>
  )
}
