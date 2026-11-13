import { Plus, Trash2 } from "lucide-react"
import { Button } from "./ui/button"
import { Label } from "./ui/label"
import { Field, FieldDescription, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Textarea } from "./ui/textarea"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"
import { useId, useRef, useState } from "react"
import { FieldError } from "./ui/field"
import { count } from "../lib/utils"
import { findMarkingTemplate, parseScoreTable, questionKey } from "../lib/marking"
import type { ExamAttempt } from "../lib/exam-data"
import { validateQuestionResults, type QuestionConfidence, type QuestionResult } from "../lib/exam-data"

export function QuestionResultsEditor({ value, onChange, attempts = [], paper, onUseTotal }: { value: QuestionResult[]; onChange: (value: QuestionResult[]) => void; attempts?: ExamAttempt[]; paper?: Pick<ExamAttempt, "subject" | "provider" | "paper" | "examYear">; onUseTotal?: (earned: number, maximum: number) => void }) {
  const [pasting, setPasting] = useState(false)
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const pasteId = useId()
  const editor = useRef<HTMLDivElement>(null)
  const template = paper && findMarkingTemplate(attempts, paper)
  let preview: QuestionResult[] = []
  let previewError: string | null = null
  if (pasting && text.trim()) {
    try { preview = parseScoreTable(text) }
    catch (error) { previewError = error instanceof Error ? error.message : "Could not read the scores." }
  }
  const earned = value.reduce((sum, result) => sum + (result.marksAwarded || 0), 0)
  const maximum = value.reduce((sum, result) => sum + (result.maxMarks || 0), 0)
  function update(id: string, patch: Partial<QuestionResult>) {
    onChange(value.map((result) => result.id === id ? { ...result, ...patch } : result))
  }

  function add() {
    const used = new Set(value.map((result) => questionKey(result.label)))
    let next = value.length + 1
    while (used.has(questionKey(`Item ${next}`))) next++
    onChange([...value, { id: crypto.randomUUID(), label: `Item ${next}`, marksAwarded: 0, maxMarks: 1, confidence: "medium" }])
  }

  return (
    <Field ref={editor}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <FieldLabel>Section and question breakdown</FieldLabel>
          <FieldDescription>Optional. Break the assessment into questions, sections, essays, or practical tasks to reveal coverage gaps.</FieldDescription>
        </div>
        <div className="flex flex-wrap gap-2">
          {!value.length && template ? <Button type="button" size="sm" variant="outline" onClick={() => onChange(template.questionResults!.map((result) => ({ id: crypto.randomUUID(), label: result.label, maxMarks: result.maxMarks, marksAwarded: Number.NaN, confidence: "medium", areaOfStudy: result.areaOfStudy, topic: result.topic, itemIds: result.itemIds, itemsBy: result.itemsBy })))}>Use previous layout</Button> : null}
          <Button type="button" size="sm" variant="outline" onClick={() => setPasting(!pasting)} aria-expanded={pasting} aria-controls={pasteId}>Paste scores</Button>
          <Button type="button" size="sm" variant="outline" onClick={add}><Plus />Add item</Button>
        </div>
      </div>
      {pasting ? <div id={pasteId} className="grid gap-3 rounded-lg border p-3">
        <Label htmlFor={`${pasteId}-text`}>Scores from a spreadsheet</Label>
        <p className="text-sm text-muted-foreground">Paste tab-separated or CSV rows: item, earned, out of, optional topic and feedback. Two columns (earned, out of) also work. A header is optional.</p>
        <Textarea id={`${pasteId}-text`} value={text} onChange={(event) => { setText(event.target.value); setError(null) }} rows={4} placeholder={'Q1,2,3,Algebra\nQ2,4,4,Functions'} />
        <FieldError>{previewError ?? error}</FieldError>
        {preview.length ? <p role="status" className="text-sm tabular-nums">{count(preview.length, "item")} · {preview.reduce((sum, result) => sum + result.marksAwarded, 0)} / {preview.reduce((sum, result) => sum + result.maxMarks, 0)} marks. These will be added to your breakdown.</p> : null}
        <div className="flex gap-2"><Button type="button" size="sm" disabled={!preview.length || !!previewError} onClick={() => {
          if (value.length + preview.length > 500) return setError("Keep the breakdown to 500 items or fewer.")
          const labels = [...value, ...preview].map((result) => questionKey(result.label))
          if (new Set(labels).size !== labels.length) return setError("Some question labels already exist. Rename them or remove the existing items first.")
          onChange([...value, ...preview]); setText(""); setPasting(false)
        }}>Add scores</Button><Button type="button" size="sm" variant="ghost" onClick={() => setPasting(false)}>Cancel</Button></div>
      </div> : null}
      {value.length ? (
        <div className="divide-y rounded-lg border">
          {value.map((result) => (
            <div key={result.id} className="grid gap-3 p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_4.5rem_4.5rem] gap-3 sm:grid-cols-[minmax(8rem,1fr)_6rem_6rem_9rem_auto]">
                <Label className="grid gap-1 text-xs text-muted-foreground"><span>Item</span><Input aria-label="Assessment item label" autoFocus={!result.label} required value={result.label} onChange={(event) => update(result.id, { label: event.target.value })} placeholder="Section B, Question 4" /></Label>
                <Label className="grid gap-1 text-xs text-muted-foreground"><span>Earned</span><Input data-earned aria-label={`${result.label} marks awarded`} type="number" required min="0" max={Number.isFinite(result.maxMarks) ? result.maxMarks : undefined} step="any" value={Number.isFinite(result.marksAwarded) ? result.marksAwarded : ""} onChange={(event) => update(result.id, { marksAwarded: event.target.valueAsNumber })} onKeyDown={(event) => {
                  if (event.key !== "Enter") return
                  event.preventDefault()
                  const inputs = [...(editor.current?.querySelectorAll<HTMLInputElement>("input[data-earned]") ?? [])]
                  inputs[inputs.indexOf(event.currentTarget) + (event.shiftKey ? -1 : 1)]?.focus()
                }} /></Label>
                <Label className="grid gap-1 text-xs text-muted-foreground"><span>Out of</span><Input aria-label={`${result.label} maximum marks`} type="number" required min="0.5" step="any" value={Number.isFinite(result.maxMarks) ? result.maxMarks : ""} onChange={(event) => update(result.id, { maxMarks: event.target.valueAsNumber })} /></Label>
                <Label className="col-span-2 grid gap-1 text-xs text-muted-foreground sm:col-span-1"><span>Confidence</span><Select value={result.confidence} onValueChange={(confidence) => update(result.id, { confidence: confidence as QuestionConfidence })}>
                  <SelectTrigger aria-label={`${result.label} confidence`} className="w-full"><SelectValue>{result.confidence[0].toUpperCase() + result.confidence.slice(1)}</SelectValue></SelectTrigger>
                  <SelectContent>{(["low", "medium", "high"] as const).map((confidence) => <SelectItem key={confidence} value={confidence}>{confidence[0].toUpperCase() + confidence.slice(1)}</SelectItem>)}</SelectContent>
                </Select></Label>
                <Button className="self-end" type="button" size="icon" variant="ghost" aria-label={`Remove ${result.label}`} onClick={() => onChange(value.filter((item) => item.id !== result.id))}><Trash2 /></Button>
              </div>
              <Collapsible>
                <CollapsibleTrigger className="text-left text-xs text-muted-foreground underline underline-offset-4">Topic and feedback{result.areaOfStudy ? ` · ${result.areaOfStudy}` : result.examinerNote ? " · added" : ""}</CollapsibleTrigger>
                <CollapsibleContent><div className="mt-3 grid gap-3"><Input aria-label={`${result.label} topic or skill`} value={result.areaOfStudy ?? ""} onChange={(event) => update(result.id, { areaOfStudy: event.target.value || undefined })} placeholder="Topic, skill, or Area of Study" /><Textarea aria-label={`${result.label} marker feedback`} rows={2} value={result.examinerNote ?? ""} onChange={(event) => update(result.id, { examinerNote: event.target.value || undefined })} placeholder="Marker feedback, expected qualities, or examiner advice" /></div></CollapsibleContent>
              </Collapsible>
            </div>
          ))}
          <div className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm tabular-nums"><span>Items total {earned} / {maximum}{value.some((result) => !Number.isFinite(result.marksAwarded)) ? ` · ${value.filter((result) => !Number.isFinite(result.marksAwarded)).length} unmarked` : ""}</span>{onUseTotal ? <Button type="button" size="sm" variant="outline" disabled={!!validateQuestionResults(value)} onClick={() => onUseTotal(earned, maximum)}>Use as overall mark</Button> : null}<span className="w-full text-xs text-muted-foreground">Enter moves to the next earned mark. Shift+Enter moves back.</span></div>
        </div>
      ) : null}
    </Field>
  )
}
