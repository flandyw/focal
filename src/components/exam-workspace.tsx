import { useState } from "react"
import { Circle, CircleCheck, CircleDot, Flag, Plus, Split, Trash2 } from "lucide-react"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { FieldError } from "./ui/field"
import { Input } from "./ui/input"
import { Progress } from "./ui/progress"
import { cn } from "../lib/utils"
import type { ExamWorkspaceItem, ExamWorkspaceStatus } from "../lib/ongoing-timers"

const nextStatus: Record<ExamWorkspaceStatus, ExamWorkspaceStatus> = {
  "not-started": "in-progress",
  "in-progress": "done",
  "done": "not-started",
  "flagged": "done",
}

const statusIcon = { "not-started": Circle, "in-progress": CircleDot, done: CircleCheck, flagged: Flag }
const statusLabel = { "not-started": "Not started", "in-progress": "In progress", done: "Done", flagged: "Flagged" }
const confidences = [["low", "Low"], ["medium", "Med"], ["high", "High"]] as const

/** The paper's questions as a checklist: tick them off, flag ones to return to, and the
 *  map prefills question-level marking when the paper is finished. */
export function ExamWorkspace({ items, totalMarks, onChange }: {
  items: ExamWorkspaceItem[]
  totalMarks: number
  onChange: (items: ExamWorkspaceItem[]) => void
}) {
  const [label, setLabel] = useState("")
  const [marks, setMarks] = useState(1)
  const [checkpointCount, setCheckpointCount] = useState(10)
  const [error, setError] = useState<string | null>(null)
  const doneMarks = items.filter((item) => item.status === "done").reduce((total, item) => total + item.marks, 0)
  const mappedMarks = items.reduce((total, item) => total + item.marks, 0)
  const flagged = items.filter((item) => item.status === "flagged").length
  const remainingMarks = Math.max(0, totalMarks - mappedMarks)

  function add() {
    if (!label.trim()) return setError("Enter a question or section label.")
    if (items.some((item) => item.label.trim().toLowerCase() === label.trim().toLowerCase())) return setError("That question or section is already mapped.")
    if (!Number.isFinite(marks) || marks <= 0) return setError("Marks must be greater than zero.")
    if (marks > remainingMarks) return setError(`Only ${remainingMarks} marks are left to map.`)
    onChange([...items, { id: crypto.randomUUID(), label: label.trim(), marks, status: "not-started", confidence: "medium" }])
    // Suggest the next label when the last one ended in a number: "Question 4" → "Question 5".
    setLabel(label.trim().replace(/\d+$/, (number) => String(Number(number) + 1)).replace(/^[^\d]*$/, ""))
    setError(null)
  }

  function createCheckpoints() {
    const count = Math.max(1, Math.min(30, Math.round(checkpointCount)))
    const halfMarkUnits = Math.round(totalMarks * 2)
    if (halfMarkUnits < count) return setError("Use fewer checkpoints for this mark total.")
    let remainingUnits = halfMarkUnits
    onChange(Array.from({ length: count }, (_, index): ExamWorkspaceItem => {
      const units = Math.floor(remainingUnits / (count - index))
      remainingUnits -= units
      return { id: crypto.randomUUID(), label: `Checkpoint ${index + 1}`, marks: units / 2, status: "not-started", confidence: "medium" }
    }))
    setError(null)
  }

  function update(id: string, patch: Partial<ExamWorkspaceItem>) {
    onChange(items.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  return (
    <Card className="min-w-0 gap-4">
      <CardHeader>
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <CardTitle>Questions</CardTitle>
          {items.length ? <CardDescription className="tabular-nums">
            {doneMarks} of {mappedMarks} marks done{flagged ? ` · ${flagged} flagged` : ""}{remainingMarks ? ` · ${remainingMarks} unmapped` : ""}
          </CardDescription> : null}
        </div>
        {items.length ? <Progress className="mt-2" aria-label="Marks done" value={mappedMarks ? doneMarks / mappedMarks * 100 : 0} /> : (
          <CardDescription>Map questions or equal checkpoints to track pace. The map prefills marking at the end.</CardDescription>
        )}
      </CardHeader>
      <CardContent className="grid gap-4">
        {items.length ? (
          <ul className="divide-y rounded-lg border">
            {items.map((item) => {
              const Icon = statusIcon[item.status]
              return (
                <li key={item.id} className="grid gap-2 px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="flex min-w-0 items-center gap-2">
                    <Button variant="ghost" size="icon-sm" onClick={() => update(item.id, { status: nextStatus[item.status] })} aria-label={`${item.label}: ${statusLabel[item.status]}. Advance status`}>
                      <Icon className={cn(item.status === "done" && "text-primary", item.status === "flagged" && "text-destructive")} />
                    </Button>
                    <span className={cn("truncate text-sm font-medium", item.status === "done" && "text-muted-foreground line-through")}>{item.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{item.marks} {item.marks === 1 ? "mark" : "marks"}</span>
                    <Input className="h-7 min-w-0 flex-1 border-transparent bg-transparent text-xs shadow-none hover:border-input focus-visible:border-input" aria-label={`Note for ${item.label}`} value={item.note ?? ""} onChange={(event) => update(item.id, { note: event.target.value || undefined })} placeholder="Note" />
                  </div>
                  <div className="flex items-center gap-1 justify-self-end">
                    <div className="flex rounded-md border p-0.5" role="group" aria-label={`Confidence for ${item.label}`}>
                      {confidences.map(([value, text]) => (
                        <button key={value} type="button" aria-pressed={item.confidence === value} onClick={() => update(item.id, { confidence: value })}
                          className={cn("rounded px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:text-foreground", item.confidence === value && "bg-muted font-medium text-foreground")}>
                          {text}
                        </button>
                      ))}
                    </div>
                    <Button variant={item.status === "flagged" ? "secondary" : "ghost"} size="icon-sm" aria-pressed={item.status === "flagged"} onClick={() => update(item.id, { status: item.status === "flagged" ? "in-progress" : "flagged" })}><Flag /><span className="sr-only">Flag {item.label}</span></Button>
                    <Button variant="ghost" size="icon-sm" onClick={() => onChange(items.filter((candidate) => candidate.id !== item.id))}><Trash2 /><span className="sr-only">Remove {item.label}</span></Button>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : null}

        <div className="flex flex-wrap items-center gap-2">
          {remainingMarks > 0 ? <>
            <Input className="h-8 w-40 flex-1 sm:flex-none" aria-label="Question or section" value={label} onChange={(event) => { setLabel(event.target.value); setError(null) }} placeholder="e.g. Question 1" onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }} />
            <Input className="h-8 w-20" aria-label="Marks" type="number" min="0.5" step="0.5" value={marks} onChange={(event) => setMarks(event.target.valueAsNumber)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }} />
            <Button size="sm" variant="outline" onClick={add}><Plus />Add</Button>
          </> : null}
          {!items.length ? <>
            <span className="px-1 text-xs text-muted-foreground">or</span>
            <Input className="h-8 w-16" aria-label="Number of equal checkpoints" type="number" min="1" max="30" value={checkpointCount} onChange={(event) => setCheckpointCount(event.target.valueAsNumber)} />
            <Button size="sm" variant="outline" onClick={createCheckpoints}><Split />Split into checkpoints</Button>
          </> : null}
        </div>
        <FieldError>{error}</FieldError>
      </CardContent>
    </Card>
  )
}
