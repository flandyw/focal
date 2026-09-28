import { useMemo, useState } from "react"
import { Archive, CalendarCheck2, Check, Clock3, Plus, RotateCcw, SkipForward, WandSparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { PageHeader } from "@/components/page-header"
import { MetricCard, MetricGrid, SectionHeading, WorkspacePage } from "@/components/workspace-layout"
import type { AppData } from "@/lib/exam-data"
import type { AppView } from "@/lib/app-view"
import { buildPlannerSuggestions, localDate, materialiseTask, type LearningWorkspace, type LearningWorkspaceUpdate, type PlannerSuggestion, type StudyTaskStatus } from "@/lib/learning-workspace"
import type { Timetable } from "@/lib/timetable"

const today = () => localDate(new Date())

function formatDate(value: string) {
  const parsed = new Date(`${value}T00:00:00`)
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" }) : value
}

export function PlannerPage({ data, timetable, onChange, onNavigate }: {
  data: AppData
  timetable: Timetable | null
  onChange: (learning: LearningWorkspaceUpdate) => void
  onNavigate: (view: AppView) => void
}) {
  const [customTitle, setCustomTitle] = useState("")
  const [customDate, setCustomDate] = useState(today)
  const [customMinutes, setCustomMinutes] = useState(30)
  const [customError, setCustomError] = useState<string | null>(null)
  const suggestions = useMemo(() => buildPlannerSuggestions(data, timetable), [data, timetable])
  const tasks = data.learning.tasks.filter((task) => !task.archivedAt).toSorted((a, b) => a.plannedFor.localeCompare(b.plannedFor) || a.createdAt.localeCompare(b.createdAt))
  const archivedTasks = data.learning.tasks.filter((task) => task.archivedAt)
  const current = tasks.filter((task) => task.status === "planned")
  const dueToday = current.filter((task) => task.plannedFor <= today())
  const overdue = current.filter((task) => task.plannedFor < today()).length
  const completed = tasks.filter((task) => task.status === "completed").length
  const completion = tasks.length ? completed / tasks.length * 100 : 0

  function commit(update: (current: LearningWorkspace) => LearningWorkspace) {
    onChange((current) => ({ ...update(current), updatedAt: new Date().toISOString() }))
  }

  function addSuggested(suggestion: PlannerSuggestion) {
    commit((current) => ({ ...current, tasks: [...current.tasks, materialiseTask(suggestion)] }))
  }

  function setStatus(id: string, status: StudyTaskStatus) {
    const updatedAt = new Date().toISOString()
    commit((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, status, updatedAt } : task) }))
  }

  function reschedule(id: string, plannedFor: string) {
    if (!plannedFor) return
    const updatedAt = new Date().toISOString()
    commit((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, plannedFor, status: "planned", updatedAt } : task) }))
  }

  function archive(id: string) {
    const updatedAt = new Date().toISOString()
    commit((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, archivedAt: updatedAt, updatedAt } : task) }))
  }

  function restore(id: string) {
    const updatedAt = new Date().toISOString()
    commit((current) => ({ ...current, tasks: current.tasks.map((task) => task.id === id ? { ...task, archivedAt: undefined, updatedAt } : task) }))
  }

  function addCustom() {
    if (!customTitle.trim()) return setCustomError("Enter a task name.")
    if (!customDate) return setCustomError("Choose a valid date.")
    if (!Number.isFinite(customMinutes) || customMinutes < 5 || customMinutes > 360) return setCustomError("Duration must be between 5 and 360 minutes.")
    const now = new Date()
    const timestamp = now.toISOString()
    commit((current) => ({ ...current, tasks: [...current.tasks, {
      id: crypto.randomUUID(), kind: "custom", title: customTitle.trim(), detail: "Personal study task",
      durationMinutes: customMinutes, plannedFor: customDate, status: "planned",
      createdAt: timestamp, updatedAt: timestamp,
    }] }))
    setCustomTitle("")
    setCustomError(null)
  }

  return (
    <WorkspacePage>
      <PageHeader title="Revision planner" description="Turn your exam evidence, due mistakes, SACs, and official dates into a realistic study week.">
        <Button variant="outline" onClick={() => onNavigate("practice")}><RotateCcw />Open practice studio</Button>
      </PageHeader>

      <MetricGrid>
        <MetricCard label="Due now" value={dueToday.length}><span className={overdue ? "text-destructive" : undefined}>{overdue ? `${overdue} overdue` : "Nothing overdue"}</span></MetricCard>
        <MetricCard label="Daily capacity" value={`${data.learning.preferences.dailyMinutes} min`}><span>Available per study day</span></MetricCard>
        <MetricCard label="Plan completion" value={`${Math.round(completion)}%`}><Progress value={completion} /></MetricCard>
      </MetricGrid>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1.7fr)_minmax(18rem,0.8fr)]">
        <div className="grid gap-8">
          <section className="grid gap-4" aria-labelledby="recommendations-title">
            <SectionHeading id="recommendations-title" title="Recommended next actions" description="Capacity-aware recommendations generated from your current records." action={suggestions.length > 1 ? <Button variant="outline" size="sm" onClick={() => commit((current) => ({ ...current, tasks: [...current.tasks, ...suggestions.map((suggestion) => materialiseTask(suggestion))] }))}><WandSparkles />Add all to plan</Button> : null} />
            {suggestions.length ? <div className="grid gap-3 xl:grid-cols-2">{suggestions.map((suggestion) => (
              <Card key={`${suggestion.sourceId}-${suggestion.plannedFor}`} size="sm" className="justify-between">
                <CardHeader><div className="flex items-start justify-between gap-3"><div className="min-w-0"><CardTitle>{suggestion.title}</CardTitle><CardDescription className="mt-1">{suggestion.detail}</CardDescription></div><Badge className="shrink-0" variant="outline">{formatDate(suggestion.plannedFor)}</Badge></div></CardHeader>
                <CardContent className="flex items-center justify-between gap-3"><span className="flex items-center gap-1.5 text-sm text-muted-foreground"><Clock3 className="size-4" />{suggestion.durationMinutes} min</span><Button size="sm" onClick={() => addSuggested(suggestion)}><Plus />Add to plan</Button></CardContent>
              </Card>
            ))}</div> : <Empty className="min-h-48 border"><EmptyHeader><EmptyMedia variant="icon"><CalendarCheck2 /></EmptyMedia><EmptyTitle>Your plan is caught up</EmptyTitle><EmptyDescription>Complete or skip current tasks before generating more recommendations.</EmptyDescription></EmptyHeader></Empty>}
          </section>

          <section className="grid gap-4" aria-labelledby="plan-title">
            <SectionHeading id="plan-title" title="Your plan" description="Upcoming work first. Completed and skipped tasks remain as evidence." />
            {tasks.length ? <div className="grid gap-2">{tasks.map((task) => (
              <div key={task.id} className="flex flex-col gap-4 rounded-xl border bg-card p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className={task.status === "completed" ? "font-medium line-through text-muted-foreground" : "font-medium"}>{task.title}</p><Badge variant={task.status === "planned" && task.plannedFor < today() ? "destructive" : task.status === "planned" ? "outline" : "secondary"}>{task.status === "planned" && task.plannedFor < today() ? "overdue" : task.status}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{formatDate(task.plannedFor)} · {task.durationMinutes} min{task.subject ? ` · ${task.subject}` : ""}</p></div>
                <div className="flex flex-wrap items-center gap-2"><Input aria-label={`Reschedule ${task.title}`} className="w-full sm:w-36" type="date" value={task.plannedFor} onChange={(event) => reschedule(task.id, event.target.value)} />{task.status === "planned" ? <><Button size="sm" variant="outline" onClick={() => setStatus(task.id, "skipped")}><SkipForward />Skip</Button><Button size="sm" onClick={() => setStatus(task.id, "completed")}><Check />Complete</Button></> : <Button size="sm" variant="ghost" onClick={() => setStatus(task.id, "planned")}>Restore</Button>}<Button size="icon-sm" variant="ghost" onClick={() => archive(task.id)}><Archive /><span className="sr-only">Archive task</span></Button></div>
              </div>
            ))}</div> : <Empty className="min-h-56 border"><EmptyHeader><EmptyMedia variant="icon"><CalendarCheck2 /></EmptyMedia><EmptyTitle>No planned study yet</EmptyTitle><EmptyDescription>Add a recommendation or create your own task.</EmptyDescription></EmptyHeader></Empty>}
          </section>
        </div>

        <aside className="grid gap-4 lg:sticky lg:top-20">
          <Card size="sm">
            <CardHeader><CardTitle>Planner settings</CardTitle><CardDescription>Set the daily limit used to spread recommendations.</CardDescription></CardHeader>
            <CardContent>
              <Field><FieldLabel htmlFor="planner-minutes">Minutes per study day</FieldLabel><Input id="planner-minutes" type="number" min="15" max="360" value={data.learning.preferences.dailyMinutes} onChange={(event) => { const dailyMinutes = Math.min(360, Math.max(15, event.target.valueAsNumber || 15)); commit((current) => ({ ...current, preferences: { ...current.preferences, dailyMinutes }, preferencesUpdatedAt: new Date().toISOString() })) }} /></Field>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader><CardTitle>Add your own task</CardTitle><CardDescription>Keep homework and personal commitments beside generated work.</CardDescription></CardHeader>
            <CardContent className="grid gap-4">
              <Field data-invalid={customError ? true : undefined}><FieldLabel htmlFor="custom-task">Task</FieldLabel><Input id="custom-task" value={customTitle} onChange={(event) => { setCustomTitle(event.target.value); setCustomError(null) }} placeholder="Complete chapter review" /></Field>
              <div className="grid grid-cols-2 gap-3"><Field><FieldLabel htmlFor="custom-date">Date</FieldLabel><Input id="custom-date" type="date" value={customDate} onChange={(event) => setCustomDate(event.target.value)} /></Field><Field><FieldLabel htmlFor="custom-duration">Minutes</FieldLabel><Input id="custom-duration" type="number" min="5" value={customMinutes} onChange={(event) => setCustomMinutes(event.target.valueAsNumber)} /></Field></div>
              <FieldError>{customError}</FieldError>
              <Button className="w-full" onClick={addCustom}><Plus />Add task</Button>
            </CardContent>
          </Card>
        </aside>
      </div>
      {archivedTasks.length ? <Card><CardHeader><CardTitle>Archived tasks</CardTitle><CardDescription>Archived work stays in synced history and can be restored.</CardDescription></CardHeader><CardContent className="grid gap-2">{archivedTasks.map((task) => <div key={task.id} className="flex items-center justify-between gap-3 rounded-md border p-3"><div><p className="text-sm font-medium">{task.title}</p><p className="text-xs text-muted-foreground">{formatDate(task.plannedFor)} · {task.durationMinutes} min</p></div><Button size="sm" variant="outline" onClick={() => restore(task.id)}>Restore</Button></div>)}</CardContent></Card> : null}
    </WorkspacePage>
  )
}
