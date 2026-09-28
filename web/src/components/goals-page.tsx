import { useMemo, useState, type FormEvent } from "react"
import { Archive, CalendarPlus, Flag, Pencil, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { PageHeader } from "@/components/page-header"
import { SubjectCombobox } from "@/components/subject-combobox"
import { WorkspacePage } from "@/components/workspace-layout"
import type { AppData, AssessmentReference } from "@/lib/exam-data"
import { getGoalProgress, localDate, type LearningWorkspace, type LearningWorkspaceUpdate, type StudyGoal, type StudyGoalKind } from "@/lib/learning-workspace"

function defaultDeadline() {
  const date = new Date()
  date.setMonth(date.getMonth() + 3)
  return date.toISOString().slice(0, 10)
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

function GoalEditSheet({ goal, data, subjects, onClose, onSave }: {
  goal: StudyGoal
  data: AppData
  subjects: string[]
  onClose: () => void
  onSave: (goal: StudyGoal) => void
}) {
  const [kind, setKind] = useState(goal.kind)
  const [subject, setSubject] = useState(goal.subject ?? data.subjects[0] ?? subjects[0] ?? "")
  const [target, setTarget] = useState(goal.target)
  const [deadline, setDeadline] = useState(goal.deadline)
  const [error, setError] = useState<string | null>(null)

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
    <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Edit goal</SheetTitle>
          <SheetDescription>Update the score target or deadline while keeping its existing progress history.</SheetDescription>
        </SheetHeader>
        <form id="edit-goal-form" className="grid gap-5 px-4 pb-4" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="edit-goal-kind">Measure</FieldLabel>
            <Select value={kind} onValueChange={(value) => { const next = (value ?? "exam-percentage") as StudyGoalKind; setKind(next); setTarget(next === "study-score" ? 40 : next === "atar" ? 90 : 80); setError(null) }}>
              <SelectTrigger id="edit-goal-kind" className="w-full"><SelectValue>{kindLabel(kind)}</SelectValue></SelectTrigger>
              <SelectContent><SelectItem value="exam-percentage">Exam average</SelectItem><SelectItem value="study-score">Raw study score</SelectItem><SelectItem value="atar">ATAR</SelectItem></SelectContent>
            </Select>
          </Field>
          {kind !== "atar" ? <Field><FieldLabel htmlFor="edit-goal-subject">Subject</FieldLabel><SubjectCombobox id="edit-goal-subject" subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={(value) => { setSubject(value); setError(null) }} allowCustom required /></Field> : null}
          <Field data-invalid={error ? true : undefined}><FieldLabel htmlFor="edit-goal-target">Target</FieldLabel><Input id="edit-goal-target" type="number" min="1" max={kind === "study-score" ? 50 : kind === "atar" ? 99.95 : 100} step={kind === "atar" ? 0.05 : 1} value={target} onChange={(event) => { setTarget(event.target.valueAsNumber); setError(null) }} required /></Field>
          <Field><FieldLabel htmlFor="edit-goal-deadline">By</FieldLabel><Input id="edit-goal-deadline" type="date" value={deadline} onChange={(event) => { setDeadline(event.target.value); setError(null) }} required /></Field>
          <FieldError>{error}</FieldError>
        </form>
        <SheetFooter><Button type="submit" form="edit-goal-form"><Pencil />Save changes</Button></SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export function GoalsPage({ data, references, subjects, onChange, onOpenPlanner, onPlanGoal }: {
  data: AppData
  references: AssessmentReference[]
  subjects: string[]
  onChange: (learning: LearningWorkspaceUpdate) => void
  onOpenPlanner: () => void
  onPlanGoal: (goal: StudyGoal) => void
}) {
  const [kind, setKind] = useState<StudyGoalKind>("exam-percentage")
  const [subject, setSubject] = useState(data.subjects[0] ?? subjects[0] ?? "")
  const [target, setTarget] = useState(80)
  const [deadline, setDeadline] = useState(defaultDeadline)
  const [editingGoal, setEditingGoal] = useState<StudyGoal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const progress = useMemo(() => data.learning.goals.filter((goal) => !goal.archivedAt).map((goal) => ({ goal, progress: getGoalProgress(goal, data, references) })), [data, references])
  const archivedGoals = data.learning.goals.filter((goal) => goal.archivedAt)

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
  }

  function removeGoal(id: string) {
    const updatedAt = new Date().toISOString()
    commit((current) => ({ ...current, goals: current.goals.map((goal) => goal.id === id ? { ...goal, archivedAt: updatedAt, updatedAt } : goal) }))
  }

  function saveEditedGoal(updated: StudyGoal) {
    commit((current) => ({ ...current, goals: current.goals.map((goal) => goal.id === updated.id ? updated : goal) }))
    setEditingGoal(null)
  }

  function restoreGoal(id: string) {
    const updatedAt = new Date().toISOString()
    commit((current) => ({ ...current, goals: current.goals.map((goal) => goal.id === id ? { ...goal, archivedAt: undefined, updatedAt } : goal) }))
  }

  return (
    <WorkspacePage>
      <PageHeader title="Score goals" description="Set an outcome, measure the gap from current evidence, and turn it into a revision pathway.">
        <Button variant="outline" onClick={onOpenPlanner}>Open revision plan</Button>
      </PageHeader>
      <Card className="gap-5">
        <CardHeader><CardTitle>Set a goal</CardTitle><CardDescription>Predictions remain estimates. Goals show direction and evidence, not guaranteed outcomes.</CardDescription></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 xl:grid-cols-12 xl:items-end">
          <Field className="xl:col-span-2"><FieldLabel htmlFor="goal-kind">Measure</FieldLabel><Select value={kind} onValueChange={(value) => { const next = (value ?? "exam-percentage") as StudyGoalKind; setKind(next); setTarget(next === "study-score" ? 40 : next === "atar" ? 90 : 80); setError(null) }}><SelectTrigger id="goal-kind" className="w-full"><SelectValue>{kindLabel(kind)}</SelectValue></SelectTrigger><SelectContent><SelectItem value="exam-percentage">Exam average</SelectItem><SelectItem value="study-score">Raw study score</SelectItem><SelectItem value="atar">ATAR</SelectItem></SelectContent></Select></Field>
          {kind !== "atar" ? <Field className="xl:col-span-4"><FieldLabel htmlFor="goal-subject">Subject</FieldLabel><SubjectCombobox id="goal-subject" subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={setSubject} allowCustom required /></Field> : <div className="hidden xl:col-span-4 xl:block" />}
          <Field className="xl:col-span-2" data-invalid={error ? true : undefined}><FieldLabel htmlFor="goal-target">Target</FieldLabel><Input id="goal-target" type="number" min="1" max={kind === "study-score" ? 50 : kind === "atar" ? 99.95 : 100} step={kind === "atar" ? 0.05 : 1} value={target} onChange={(event) => { setTarget(event.target.valueAsNumber); setError(null) }} /></Field>
          <Field className="xl:col-span-2"><FieldLabel htmlFor="goal-deadline">By</FieldLabel><Input id="goal-deadline" type="date" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></Field>
          <Button className="w-full xl:col-span-2" onClick={addGoal}><Plus />Add goal</Button>
          <FieldError className="sm:col-span-2 xl:col-span-full">{error}</FieldError>
        </CardContent>
      </Card>

      {progress.length ? <div className="grid gap-4 lg:grid-cols-2">{progress.map(({ goal, progress: item }) => {
        const achieved = item.current !== null && item.current >= goal.target
        const expired = !achieved && goal.deadline < localDate(new Date())
        return <Card key={goal.id}>
          <CardHeader><div className="flex items-start justify-between gap-3"><div><CardTitle>{goal.subject ? `${goal.subject} · ` : ""}{kindLabel(goal.kind)}</CardTitle><CardDescription>Target {goal.target} by {new Date(`${goal.deadline}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</CardDescription></div><Badge variant={expired ? "destructive" : achieved ? "secondary" : "outline"}>{expired ? "Expired" : achieved ? "Reached" : item.gap === null ? "Needs baseline" : `${item.gap.toFixed(goal.kind === "atar" ? 2 : 1)} to go`}</Badge></div></CardHeader>
          <CardContent className="grid gap-4"><div><div className="mb-2 flex justify-between text-sm"><span>{item.label}</span><strong className="tabular-nums">{item.current === null ? "—" : item.current.toFixed(goal.kind === "atar" ? 2 : 1)} / {goal.target}</strong></div><Progress value={item.progress} /></div><p className="text-sm text-muted-foreground">{item.evidence}</p><p className="text-sm">{item.gap === null ? "Log compatible evidence to calculate a pathway." : achieved ? "Maintain this result with spaced review and full-paper practice." : `Next milestone: close roughly ${Math.max(1, item.gap / 3).toFixed(1)} points in each of three review cycles.`}</p><div className="flex flex-wrap justify-end gap-2"><Button size="sm" variant="outline" onClick={() => onPlanGoal(goal)}><CalendarPlus />Plan work</Button><Button size="sm" variant="ghost" onClick={() => setEditingGoal(goal)}><Pencil />Edit</Button><Button size="sm" variant="ghost" onClick={() => removeGoal(goal.id)}><Archive />Archive</Button></div></CardContent>
        </Card>
      })}</div> : <Empty className="min-h-56 border"><EmptyHeader><EmptyMedia variant="icon"><Flag /></EmptyMedia><EmptyTitle>No score goals yet</EmptyTitle><EmptyDescription>Add a target above to see your current baseline and the gap to close.</EmptyDescription></EmptyHeader></Empty>}
      {archivedGoals.length ? <Card><CardHeader><CardTitle>Archived goals</CardTitle><CardDescription>Restore a goal to continue tracking its pathway.</CardDescription></CardHeader><CardContent className="grid gap-2 sm:grid-cols-2">{archivedGoals.map((goal) => <div key={goal.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{goal.subject ? `${goal.subject} · ` : ""}{kindLabel(goal.kind)}</p><p className="text-xs text-muted-foreground">Target {goal.target}</p></div><Button size="sm" variant="outline" onClick={() => restoreGoal(goal.id)}>Restore</Button></div>)}</CardContent></Card> : null}
      {editingGoal ? <GoalEditSheet key={editingGoal.id} goal={editingGoal} data={data} subjects={subjects} onClose={() => setEditingGoal(null)} onSave={saveEditedGoal} /> : null}
    </WorkspacePage>
  )
}
