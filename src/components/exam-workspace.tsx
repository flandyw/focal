import { useId, useRef, useState } from "react"
import { Circle, CircleCheck, CircleDot, Flag, Plus, Split, Trash2 } from "lucide-react"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { FieldError } from "./ui/field"
import { Input } from "./ui/input"
import { Progress } from "./ui/progress"
import { ToggleGroup, ToggleGroupItem } from "./ui/toggle-group"
import { cn, count } from "../lib/utils"
import { questionKey } from "../lib/exam-data"
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
// Offer everything left when the draft would overshoot or strand less than half a mark.
const suggestMarks = (remaining: number, draft: number) => remaining > 0 && remaining - draft < 0.5 - 1e-9 ? remaining : draft

/** The paper's questions as a checklist: tick them off, flag ones to return to, and the
 *  map prefills question-level marking when the paper is finished. */
export function ExamWorkspace({ items, totalMarks, onChange }: {
  items: ExamWorkspaceItem[]
  totalMarks: number
  onChange: (items: ExamWorkspaceItem[]) => void
}) {
  const [label, setLabel] = useState("")
  const [checkpointCount, setCheckpointCount] = useState(10)
  const [error, setErrorState] = useState<{ message: string; field: "label" | "marks" | "checkpoints" } | null>(null)
  const errorId = useId()
  const setError = (message: string | null, field: "label" | "marks" | "checkpoints" = "label") => setErrorState(message ? { message, field } : null)
  const errorProps = (field: "label" | "marks" | "checkpoints") => error?.field === field ? { "aria-invalid": true, "aria-describedby": errorId } : {}
  const labelInput = useRef<HTMLInputElement>(null)
  const doneMarks = items.filter((item) => item.status === "done").reduce((total, item) => total + item.marks, 0)
  const mappedMarks = items.reduce((total, item) => total + item.marks, 0)
  const flagged = items.filter((item) => item.status === "flagged").length
  const remainingMarks = Math.max(0, totalMarks - mappedMarks)
  const [marks, setMarks] = useState(() => suggestMarks(remainingMarks, 1))

  function add() {
    if (!label.trim()) return setError("Enter a question or section label.")
    if (items.some((item) => questionKey(item.label) === questionKey(label))) return setError("That question or section is already mapped.")
    if (!Number.isFinite(marks) || marks < 0.5) return setError("Marks must be at least 0.5.", "marks")
    if (marks > remainingMarks) return setError(`Only ${count(remainingMarks, "mark")} left to map.`, "marks")
    const remainder = Math.max(0, totalMarks - (mappedMarks + marks))
    // Ignore floating-point dust at the zero and half-mark boundaries.
    if (remainder > 1e-9 && remainder < 0.5 - 1e-9) return setError("Use all remaining marks, or leave at least 0.5 marks to map.", "marks")
    onChange([...items, { id: crypto.randomUUID(), label: label.trim(), marks, status: "not-started", confidence: "medium" }])
    // Suggest the next label when the last one ended in a number: "Question 4" → "Question 5".
    setLabel(label.trim().replace(/\d+$/, (number) => String(Number(number) + 1)).replace(/^[^\d]*$/, ""))
    setMarks(suggestMarks(remainder, marks))
    setError(null)
    labelInput.current?.focus()
  }

  function createCheckpoints() {
    if (!Number.isInteger(checkpointCount) || checkpointCount < 1 || checkpointCount > 30) return setError("Choose between 1 and 30 checkpoints.", "checkpoints")
    const count = Math.max(1, Math.min(30, Math.round(checkpointCount)))
    const halfMarkUnits = Math.floor(totalMarks * 2)
    if (halfMarkUnits < count) return setError("Use fewer checkpoints for this mark total.", "checkpoints")
    let remainingUnits = halfMarkUnits
    let assigned = 0
    onChange(Array.from({ length: count }, (_, index): ExamWorkspaceItem => {
      const units = Math.floor(remainingUnits / (count - index))
      remainingUnits -= units
      // The last checkpoint takes any off-grid remainder (e.g. a synced 10.25 total) so the split keeps the exact total.
      const itemMarks = index === count - 1 ? totalMarks - assigned : units / 2
      assigned += itemMarks
      return { id: crypto.randomUUID(), label: `Checkpoint ${index + 1}`, marks: itemMarks, status: "not-started", confidence: "medium" }
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
                    <Button variant="ghost" size="icon-sm" onClick={() => update(item.id, { status: nextStatus[item.status] })} title={`${statusLabel[item.status]}. Click to change`} aria-label={`${item.label}: ${statusLabel[item.status]}. Advance status`}>
                      <Icon aria-hidden className={cn(item.status === "done" && "text-primary", item.status === "flagged" && "text-destructive")} />
                    </Button>
                    <span className={cn("truncate text-sm font-medium", item.status === "done" && "text-muted-foreground line-through")}>{item.label}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{count(item.marks, "mark")}</span>
                    <Input className="h-7 min-w-0 flex-1 border-transparent bg-transparent text-xs shadow-none hover:border-input focus-visible:border-input" aria-label={`Note for ${item.label}`} value={item.note ?? ""} onChange={(event) => update(item.id, { note: event.target.value || undefined })} placeholder="Note" />
                  </div>
                  <div className="flex items-center gap-1 justify-self-end">
                    <ToggleGroup size="sm" variant="outline" spacing={0} aria-label={`Confidence for ${item.label}`} value={[item.confidence]} onValueChange={([value]) => { if (value) update(item.id, { confidence: value as typeof item.confidence }) }}>
                      {confidences.map(([value, text]) => <ToggleGroupItem key={value} value={value}>{text}</ToggleGroupItem>)}
                    </ToggleGroup>
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
            <Input ref={labelInput} className="h-8 w-40 flex-1 sm:flex-none" aria-label="Question or section" value={label} onChange={(event) => { setLabel(event.target.value); setError(null) }} placeholder="e.g. Question 1" {...errorProps("label")} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }} />
            <Input className="h-8 w-20" aria-label="Marks" type="number" min="0.5" max={remainingMarks} step="any" value={Number.isFinite(marks) ? marks : ""} onChange={(event) => { setMarks(event.target.valueAsNumber); setError(null) }} {...errorProps("marks")} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); add() } }} />
            <Button size="sm" variant="outline" onClick={add}><Plus />Add</Button>
          </> : null}
          {!items.length ? <>
            <span className="px-1 text-xs text-muted-foreground">or</span>
            <Input className="h-8 w-16" aria-label="Number of equal checkpoints" type="number" min="1" max="30" value={Number.isFinite(checkpointCount) ? checkpointCount : ""} onChange={(event) => { setCheckpointCount(event.target.valueAsNumber); setError(null) }} {...errorProps("checkpoints")} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); createCheckpoints() } }} />
            <Button size="sm" variant="outline" onClick={createCheckpoints}><Split />Split into checkpoints</Button>
          </> : null}
        </div>
        <FieldError id={errorId}>{error?.message}</FieldError>
      </CardContent>
    </Card>
  )
}
