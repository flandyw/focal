import { useMemo, useState } from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"
import type { AppData } from "../lib/exam-data"
import type { CanonicalStudySession } from "../lib/sync/sessionContract"
import { localDate, type TaskDraft } from "../lib/learning-workspace"
import { buildWeeklyReview, weekStart } from "../lib/weekly-review"
import { useTickingNow } from "../hooks/use-ticking-now"
import { Button } from "./ui/button"
import { Checkbox } from "./ui/checkbox"
import { Field, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"

const duration = (minutes: number) => `${Math.floor(minutes / 60)}h ${minutes % 60}m`

export function WeeklyReview({ data, sessions, onPlan }: { data: AppData; sessions: CanonicalStudySession[]; onPlan: (tasks: TaskDraft[]) => void }) {
  const now = useTickingNow()
  const [offset, setOffset] = useState(-1)
  const start = weekStart(now, offset)
  const first = localDate(start)
  const review = useMemo(() => buildWeeklyReview(data, sessions, new Date(`${first}T00:00:00`)), [data, sessions, first])
  return <section className="grid gap-5 border-b pb-6" aria-labelledby="weekly-review-title">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 id="weekly-review-title" className="focal-section-title">Weekly review</h2><p className="mt-1 text-sm text-muted-foreground">{new Date(`${review.first}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}–{new Date(`${review.last}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}{offset === 0 ? " · this week so far" : ""}</p></div>
      <div className="flex gap-1"><Button variant="ghost" size="icon" aria-label="Previous review week" onClick={() => setOffset(offset - 1)}><ChevronLeft /></Button><Button variant="ghost" size="sm" onClick={() => setOffset(-1)}>Last week</Button><Button variant="ghost" size="icon" aria-label="Next review week" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}><ChevronRight /></Button></div>
    </div>
    <p className="max-w-[75ch] text-sm leading-relaxed">You recorded <strong>{duration(review.completed)}</strong> of completed work out of {duration(review.planned)} currently recorded for this week, finished <strong>{review.done}/{review.taskCount} tasks</strong>, and logged <strong>{review.papers} paper{review.papers === 1 ? "" : "s"}</strong>. {review.reviews ? `${review.recalled}/${review.reviews} reviews were recalled without help.` : "No mistake reviews were recorded."}</p>
    <p className="text-xs text-muted-foreground">Based on current records. Moved or deleted plans are excluded; this is not a snapshot of your original schedule.</p>
    <div className="grid gap-5 md:grid-cols-3">
      <div><h3 className="text-sm font-medium">Recurring mistakes</h3>{review.repeated.length ? <ul className="mt-2 grid gap-2 text-sm text-muted-foreground">{review.repeated.slice(0, 3).map((row) => <li key={`${row.subject}:${row.category}`}>{row.subject}: {row.category.toLowerCase()} · {row.cards} different cards</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">No repeated categories in new or difficult cards this week.</p>}</div>
      <div><h3 className="text-sm font-medium">Topics that improved</h3>{review.improved.length ? <ul className="mt-2 grid gap-2 text-sm text-muted-foreground">{review.improved.map((row) => <li key={`${row.subject}:${row.topic}`}>{row.subject}: {row.topic} · +{row.delta.toFixed(0)} percentage points ({row.beforeCount} → {row.count} marked items)</li>)}</ul> : <p className="mt-2 text-sm text-muted-foreground">Needs at least two marked items per topic in both this week and the week before.</p>}</div>
      <div><h3 className="text-sm font-medium">Subjects to revisit</h3><p className="mt-2 text-sm text-muted-foreground">{review.neglected.length ? `${review.neglected.join(", ")}: no completed study or assessment recorded this week.` : "No selected subjects without recorded work."}</p></div>
    </div>
    <WeeklyPlan key={`${first}:${review.suggestions.map((task) => task.sourceId).join()}`} suggestions={review.suggestions} onPlan={onPlan} />
  </section>
}

function WeeklyPlan({ suggestions, onPlan }: { suggestions: TaskDraft[]; onPlan: (tasks: TaskDraft[]) => void }) {
  const [editing, setEditing] = useState(false)
  const [tasks, setTasks] = useState(() => suggestions.map((task) => ({ ...task, selected: true })))
  const selected = tasks.filter((task) => task.selected)
  if (!suggestions.length) return <p className="text-sm text-muted-foreground">No new follow-up tasks suggested. Tasks already added to Calendar are excluded.</p>
  return <div className="grid gap-3">
    <Button className="w-fit" variant="outline" onClick={() => setEditing(!editing)} aria-expanded={editing}>Plan from this review</Button>
    {editing ? <form className="grid gap-4" onSubmit={(event) => { event.preventDefault(); onPlan(selected.map(({ selected: _selected, ...task }) => task)); setEditing(false) }}>
      <p className="text-sm text-muted-foreground">Edit the suggested tasks before adding them to Calendar.</p>
      {tasks.map((task, index) => <div key={task.sourceId} className="grid gap-3 border-t pt-3 sm:grid-cols-[auto_minmax(0,1fr)_10rem_6rem] sm:items-end">
        <label className="flex items-center gap-2 pb-2 text-sm"><Checkbox checked={task.selected} onCheckedChange={(selected) => setTasks((current) => current.map((item, i) => i === index ? { ...item, selected: selected === true } : item))} /><span className="sm:sr-only">Include {task.title}</span></label>
        <Field><FieldLabel htmlFor={`weekly-title-${index}`}>Task{task.subject ? ` · ${task.subject}` : ""}</FieldLabel><Input id={`weekly-title-${index}`} value={task.title} required={task.selected} maxLength={500} disabled={!task.selected} onChange={(event) => setTasks((current) => current.map((item, i) => i === index ? { ...item, title: event.target.value } : item))} /></Field>
        <Field><FieldLabel htmlFor={`weekly-date-${index}`}>Date</FieldLabel><Input id={`weekly-date-${index}`} type="date" required={task.selected} disabled={!task.selected} value={task.plannedFor} onChange={(event) => setTasks((current) => current.map((item, i) => i === index ? { ...item, plannedFor: event.target.value } : item))} /></Field>
        <Field><FieldLabel htmlFor={`weekly-minutes-${index}`}>Minutes</FieldLabel><Input id={`weekly-minutes-${index}`} type="number" min={1} max={1440} required={task.selected} disabled={!task.selected} value={Number.isFinite(task.durationMinutes) ? task.durationMinutes : ""} onChange={(event) => setTasks((current) => current.map((item, i) => i === index ? { ...item, durationMinutes: event.target.valueAsNumber } : item))} /></Field>
      </div>)}
      <Button className="w-fit" type="submit" disabled={!selected.length || selected.some((task) => !task.title.trim())}>Add {selected.length} task{selected.length === 1 ? "" : "s"} to Calendar</Button>
    </form> : null}
  </div>
}
