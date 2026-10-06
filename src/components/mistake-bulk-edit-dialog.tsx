import { useMemo, useState } from "react"
import { Sparkles } from "lucide-react"
import { toast } from "sonner"

import type { ExamAttempt, Mistake } from "../lib/exam-data"
import { formatChatGPTProgress, type ChatGPTProgress } from "../lib/mistake-ai-core"
import { getMistakeEditChanges, MISTAKE_EDIT_FIELDS, type MistakeEdit, type MistakeEditField } from "../lib/mistake-autofill"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Textarea } from "./ui/textarea"

const FIELD_LABELS: Record<MistakeEditField, string> = {
  question: "Question label",
  questionText: "Question text",
  explanation: "What went wrong",
  correction: "Improved response",
  areaOfStudy: "Topic",
  criterion: "Criterion",
}

const PRESETS = [
  "Improve the formatting: clear Markdown structure, proper LaTeX for all maths, consistent punctuation.",
  "Fix spelling and grammar without changing the meaning.",
  "Make it more concise.",
]

type Scope = "selected" | "current" | "all"

export function MistakeBulkEditDialog({ mistakes, current, selected, attempts, onOpenChange, onApply }: {
  mistakes: Mistake[]
  current: Mistake[]
  selected: Mistake[]
  attempts: ExamAttempt[]
  onOpenChange: (open: boolean) => void
  onApply: (edits: MistakeEdit[]) => void
}) {
  const [scope, setScope] = useState<Scope>(selected.length ? "selected" : "current")
  const [fields, setFields] = useState<Set<MistakeEditField>>(new Set(["questionText"]))
  const [instruction, setInstruction] = useState("")
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<ChatGPTProgress | null>(null)
  const [edits, setEdits] = useState<MistakeEdit[] | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const targets = scope === "selected" ? selected : scope === "current" ? current : mistakes
  const scopeLabels: Record<Scope, string> = { selected: `Selected (${selected.length})`, current: `Current filtered view (${current.length})`, all: `Everything (${mistakes.length})` }
  const fieldList = MISTAKE_EDIT_FIELDS.filter((field) => fields.has(field))
  const changes = useMemo(() => {
    const byId = new Map(mistakes.map((mistake) => [mistake.id, mistake]))
    return (edits ?? []).flatMap((edit) => {
      const mistake = byId.get(edit.id)
      const list = mistake ? getMistakeEditChanges(mistake, edit).filter(({ field }) => fields.has(field)) : []
      return mistake && list.length ? [{ mistake, edit, list }] : []
    })
  }, [edits, mistakes, fields])
  const accepted = changes.filter(({ mistake }) => !skipped.has(mistake.id))

  function toggleField(field: MistakeEditField) {
    setFields((value) => { const next = new Set(value); if (next.has(field)) next.delete(field); else next.add(field); return next })
  }

  async function run() {
    setRunning(true)
    setEdits([])
    setSkipped(new Set())
    try {
      const { editMistakesWithInstruction } = await import("../lib/mistake-ai")
      await editMistakesWithInstruction(targets, attempts, fieldList, instruction.trim(), setProgress, (batch) => setEdits((value) => [...(value ?? []), ...batch]))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not edit these mistakes.")
    } finally {
      setRunning(false)
    }
  }

  function apply() {
    // Only the reviewed fields are sent, so a field ChatGPT touched but the student never selected can't slip in.
    onApply(accepted.map(({ edit, list }) => ({ id: edit.id, ...Object.fromEntries(list.map(({ field, after }) => [field, after])) })))
    toast.success(`Updated ${accepted.length} ${accepted.length === 1 ? "mistake" : "mistakes"}`)
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!running) onOpenChange(open) }}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Edit mistakes with ChatGPT</DialogTitle>
          <DialogDescription>Describe a change to make across many mistakes. You review every edit before anything is saved.</DialogDescription>
        </DialogHeader>
        {edits === null ? (
          <FieldGroup>
            <Field>
              <FieldLabel>Mistakes to edit</FieldLabel>
              <Select value={scope} onValueChange={(value) => setScope((value ?? "current") as Scope)}>
                <SelectTrigger><SelectValue>{scopeLabels[scope]}</SelectValue></SelectTrigger>
                <SelectContent>{(Object.keys(scopeLabels) as Scope[]).map((key) => <SelectItem key={key} value={key} disabled={key === "selected" && !selected.length}>{scopeLabels[key]}</SelectItem>)}</SelectContent>
              </Select>
              <FieldDescription>Filter or tick rows in the library first to narrow this down.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel>Fields ChatGPT may change</FieldLabel>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {MISTAKE_EDIT_FIELDS.map((field) => <label key={field} className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={fields.has(field)} onChange={() => toggleField(field)} />{FIELD_LABELS[field]}</label>)}
              </div>
            </Field>
            <Field>
              <FieldLabel htmlFor="mistake-bulk-instruction">Instruction</FieldLabel>
              <Textarea id="mistake-bulk-instruction" rows={4} value={instruction} onChange={(event) => setInstruction(event.target.value)} placeholder="e.g. Improve the formatting of every question" />
              <div className="flex flex-wrap gap-1.5">{PRESETS.map((preset) => <Button key={preset} type="button" size="xs" variant="outline" onClick={() => setInstruction(preset)}>{preset.split(/[:.]/)[0]}</Button>)}</div>
            </Field>
          </FieldGroup>
        ) : (
          <div className="grid gap-3" aria-live="polite">
            {running && progress ? <p role="status" className="text-sm text-muted-foreground tabular-nums">{formatChatGPTProgress(progress)}</p> : null}
            <p className="text-sm text-muted-foreground tabular-nums">{changes.length} of {targets.length} mistakes would change{running ? " so far" : ""}. Untick any you want to keep as they are.</p>
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              {changes.map(({ mistake, list }) => (
                <div key={mistake.id} className="grid gap-2 border-b p-3 text-sm last:border-b-0">
                  <label className="flex items-center gap-2 font-medium"><input type="checkbox" className="size-4 accent-primary" checked={!skipped.has(mistake.id)} onChange={() => setSkipped((value) => { const next = new Set(value); if (next.has(mistake.id)) next.delete(mistake.id); else next.add(mistake.id); return next })} />{mistake.question}</label>
                  {list.map(({ field, before, after }) => (
                    <div key={field} className="grid gap-2 sm:grid-cols-2">
                      <div className="min-w-0"><p className="mb-1 text-xs text-muted-foreground">{FIELD_LABELS[field]} · before</p><pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 text-xs break-words whitespace-pre-wrap">{before || "(empty)"}</pre></div>
                      <div className="min-w-0"><p className="mb-1 text-xs text-muted-foreground">after</p><pre className="max-h-40 overflow-auto rounded bg-primary/5 p-2 text-xs break-words whitespace-pre-wrap">{after}</pre></div>
                    </div>
                  ))}
                </div>
              ))}
              {!changes.length && !running ? <p className="p-3 text-sm text-muted-foreground">ChatGPT found nothing to change.</p> : null}
            </div>
          </div>
        )}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={running} onClick={() => onOpenChange(false)}>Cancel</Button>
          {edits === null ? (
            <Button type="button" disabled={!targets.length || !fields.size || !instruction.trim()} onClick={() => void run()}><Sparkles />Preview edits for {targets.length}</Button>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={running} onClick={() => setEdits(null)}>Back</Button>
              <Button type="button" disabled={running || !accepted.length} onClick={apply}>Apply {accepted.length} {accepted.length === 1 ? "edit" : "edits"}</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
