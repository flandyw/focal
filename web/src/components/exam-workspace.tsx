import { useMemo, useState } from "react"
import { ExternalLink, Flag, ListChecks, Plus, Sparkles, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ExamWorkspaceItem, ExamWorkspaceStatus } from "@/lib/ongoing-timers"

const nextStatus: Record<ExamWorkspaceStatus, ExamWorkspaceStatus> = {
  "not-started": "in-progress",
  "in-progress": "done",
  "done": "not-started",
  "flagged": "done",
}

export function ExamWorkspace({ items, expectedMarks, totalMarks, paperUrl, reportUrl, onChange }: {
  items: ExamWorkspaceItem[]
  expectedMarks: number
  totalMarks: number
  paperUrl?: string
  reportUrl?: string
  onChange: (items: ExamWorkspaceItem[]) => void
}) {
  const [label, setLabel] = useState("")
  const [marks, setMarks] = useState(1)
  const [checkpointCount, setCheckpointCount] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const doneMarks = useMemo(() => items.filter((item) => item.status === "done").reduce((total, item) => total + item.marks, 0), [items])
  const mappedMarks = items.reduce((total, item) => total + item.marks, 0)
  const flagged = items.filter((item) => item.status === "flagged").length
  const remainingMarks = Math.max(0, totalMarks - mappedMarks)
  const paceDelta = doneMarks - expectedMarks

  function add() {
    if (!label.trim()) return setError("Enter a question or section label.")
    if (items.some((item) => item.label.trim().toLowerCase() === label.trim().toLowerCase())) return setError("That question or section is already mapped.")
    if (!Number.isFinite(marks) || marks <= 0) return setError("Marks must be greater than zero.")
    if (marks > remainingMarks) return setError(`Only ${remainingMarks} exam marks remain unmapped.`)
    onChange([...items, { id: crypto.randomUUID(), label: label.trim(), marks, status: "not-started", confidence: "medium" }])
    setLabel("")
    setMarks(Math.min(1, Math.max(0.5, remainingMarks - marks)))
    setError(null)
  }

  function createCheckpoints() {
    const count = Math.max(1, Math.min(30, Math.round(checkpointCount)))
    const halfMarkUnits = Math.round(totalMarks * 2)
    const baseUnits = Math.floor(halfMarkUnits / count)
    if (baseUnits < 1) return setError("Use fewer checkpoints for this mark total.")
    let remainingUnits = halfMarkUnits
    const generated = Array.from({ length: count }, (_, index): ExamWorkspaceItem => {
      const slotsLeft = count - index
      const units = Math.floor(remainingUnits / slotsLeft)
      remainingUnits -= units
      return { id: crypto.randomUUID(), label: `Checkpoint ${index + 1}`, marks: units / 2, status: "not-started", confidence: "medium" }
    })
    onChange(generated)
    setError(null)
  }

  function update(id: string, patch: Partial<ExamWorkspaceItem>) {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  return (
    <Card className="gap-5">
      <CardHeader>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <CardTitle>Exam workspace</CardTitle>
            <CardDescription className="mt-1">Track question progress, confidence, and flags without leaving the timed session.</CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {paperUrl ? <Button nativeButton={false} variant="outline" size="sm" render={<a href={paperUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Exam paper</Button> : null}
            {reportUrl ? <Button nativeButton={false} variant="outline" size="sm" render={<a href={reportUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Assessment report</Button> : null}
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-6">
        {!items.length ? (
          <div className="grid gap-4 rounded-xl border bg-muted/30 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
            <Field><FieldLabel htmlFor="workspace-checkpoints">Number of equal checkpoints</FieldLabel><Input id="workspace-checkpoints" type="number" min="1" max="30" value={checkpointCount} onChange={(event) => setCheckpointCount(event.target.valueAsNumber)} /></Field>
            <Button className="w-full md:w-auto" variant="outline" onClick={createCheckpoints}><Sparkles />Create checkpoints</Button>
          </div>
        ) : null}

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_8rem_auto] md:items-end">
          <Field data-invalid={error ? true : undefined}><FieldLabel htmlFor="workspace-label">Question or section</FieldLabel><Input id="workspace-label" value={label} onChange={(event) => { setLabel(event.target.value); setError(null) }} placeholder="e.g. Question 4" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }} /></Field>
          <Field><FieldLabel htmlFor="workspace-marks">Marks</FieldLabel><Input id="workspace-marks" type="number" min="0.5" step="0.5" value={marks} onChange={(event) => setMarks(event.target.valueAsNumber)} /></Field>
          <Button className="w-full md:w-auto" onClick={add} disabled={remainingMarks <= 0}><Plus />Add item</Button>
          <FieldError className="md:col-span-full">{error}</FieldError>
        </div>

        {items.length ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Complete</p><p className="mt-1 text-2xl font-semibold tabular-nums">{doneMarks}/{mappedMarks}</p></div>
              <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Flagged</p><p className="mt-1 text-2xl font-semibold tabular-nums">{flagged}</p></div>
              <div className="rounded-xl border bg-muted/20 p-4"><p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Unmapped</p><p className="mt-1 text-2xl font-semibold tabular-nums">{remainingMarks}</p></div>
            </div>
            <div className="grid gap-2">
              <div className="flex flex-col gap-1 text-sm sm:flex-row sm:justify-between">
                <span>{doneMarks}/{mappedMarks || totalMarks} mapped marks complete</span>
                <span className={paceDelta < -5 ? "text-destructive" : "text-muted-foreground"}>{paceDelta < -5 ? `${Math.abs(Math.round(paceDelta))} marks behind expected pace` : paceDelta > 5 ? `${Math.round(paceDelta)} marks ahead` : "On expected pace"}</span>
              </div>
              <Progress value={mappedMarks ? doneMarks / mappedMarks * 100 : 0} />
            </div>
            <div className="grid gap-3">
              {items.map((item) => (
                <div key={item.id} className="grid gap-4 rounded-xl border bg-card p-4 md:grid-cols-[minmax(0,1fr)_8rem_10rem_auto] md:items-center">
                  <button type="button" className="min-w-0 text-left" onClick={() => update(item.id, { status: nextStatus[item.status] })}>
                    <span className={item.status === "done" ? "font-medium line-through text-muted-foreground" : "font-medium"}>{item.label}</span>
                    <Badge className="ml-2" variant="outline">{item.marks} marks</Badge>
                    <span className="mt-1 block text-xs text-muted-foreground">Click to advance status</span>
                  </button>
                  <Select value={item.status} onValueChange={(value) => update(item.id, { status: (value ?? "not-started") as ExamWorkspaceStatus })}><SelectTrigger className="w-full" size="sm"><SelectValue>{item.status}</SelectValue></SelectTrigger><SelectContent><SelectItem value="not-started">Not started</SelectItem><SelectItem value="in-progress">In progress</SelectItem><SelectItem value="flagged">Flagged</SelectItem><SelectItem value="done">Done</SelectItem></SelectContent></Select>
                  <Select value={item.confidence} onValueChange={(value) => update(item.id, { confidence: (value ?? "medium") as ExamWorkspaceItem["confidence"] })}><SelectTrigger className="w-full" size="sm"><SelectValue>{item.confidence} confidence</SelectValue></SelectTrigger><SelectContent><SelectItem value="low">Low confidence</SelectItem><SelectItem value="medium">Medium confidence</SelectItem><SelectItem value="high">High confidence</SelectItem></SelectContent></Select>
                  <div className="flex items-center justify-end gap-1"><Button variant={item.status === "flagged" ? "secondary" : "ghost"} size="icon-sm" onClick={() => update(item.id, { status: item.status === "flagged" ? "in-progress" : "flagged" })}><Flag /><span className="sr-only">Toggle flag</span></Button><Button variant="ghost" size="icon-sm" onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}><Trash2 /><span className="sr-only">Remove</span></Button></div>
                  <Input className="md:col-span-full" aria-label={`Note for ${item.label}`} value={item.note ?? ""} onChange={(event) => update(item.id, { note: event.target.value || undefined })} placeholder="Optional note or reminder for marking" />
                </div>
              ))}
            </div>
            {mappedMarks !== totalMarks ? <p className="text-xs text-muted-foreground">Workspace covers {mappedMarks} of {totalMarks} exam marks. Add broad sections or individual questions—the final marking form will use whatever you map.</p> : null}
          </>
        ) : (
          <div className="flex min-h-28 items-center gap-3 rounded-xl border border-dashed p-5 text-sm text-muted-foreground"><ListChecks className="size-5 shrink-0" /><span>Add questions or sections to enable checkpoint pacing and prefill question-level marking.</span></div>
        )}
      </CardContent>
    </Card>
  )
}
