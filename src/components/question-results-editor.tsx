import { Plus, Trash2 } from "lucide-react"
import { Button } from "./ui/button"
import { Label } from "./ui/label"
import { Field, FieldDescription, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Textarea } from "./ui/textarea"
import type { QuestionConfidence, QuestionResult } from "../lib/exam-data"

export function QuestionResultsEditor({ value, onChange }: { value: QuestionResult[]; onChange: (value: QuestionResult[]) => void }) {
  function update(id: string, patch: Partial<QuestionResult>) {
    onChange(value.map((result) => result.id === id ? { ...result, ...patch } : result))
  }

  function add() {
    onChange([...value, { id: crypto.randomUUID(), label: `Item ${value.length + 1}`, marksAwarded: 0, maxMarks: 1, confidence: "medium" }])
  }

  return (
    <Field>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <FieldLabel>Section and question breakdown</FieldLabel>
          <FieldDescription>Optional. Break the assessment into questions, sections, essays, or practical tasks to reveal coverage gaps.</FieldDescription>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={add}><Plus />Add item</Button>
      </div>
      {value.length ? (
        <div className="divide-y rounded-lg border">
          {value.map((result) => (
            <div key={result.id} className="grid gap-3 p-4">
              <div className="grid gap-3 sm:grid-cols-[minmax(8rem,1fr)_6rem_6rem_9rem_auto]">
                <Label className="grid gap-1 text-xs text-muted-foreground"><span>Item</span><Input aria-label="Assessment item label" required value={result.label} onChange={(event) => update(result.id, { label: event.target.value })} placeholder="Section B, Question 4" /></Label>
                <Label className="grid gap-1 text-xs text-muted-foreground"><span>Earned</span><Input aria-label={`${result.label} marks awarded`} type="number" required min="0" max={Number.isFinite(result.maxMarks) ? result.maxMarks : undefined} step="0.5" value={Number.isFinite(result.marksAwarded) ? result.marksAwarded : ""} onChange={(event) => update(result.id, { marksAwarded: event.target.valueAsNumber })} /></Label>
                <Label className="grid gap-1 text-xs text-muted-foreground"><span>Out of</span><Input aria-label={`${result.label} maximum marks`} type="number" required min="0.5" step="0.5" value={Number.isFinite(result.maxMarks) ? result.maxMarks : ""} onChange={(event) => update(result.id, { maxMarks: event.target.valueAsNumber })} /></Label>
                <Label className="grid gap-1 text-xs text-muted-foreground"><span>Confidence</span><Select value={result.confidence} onValueChange={(confidence) => update(result.id, { confidence: confidence as QuestionConfidence })}>
                  <SelectTrigger aria-label={`${result.label} confidence`} className="w-full"><SelectValue>{result.confidence[0].toUpperCase() + result.confidence.slice(1)}</SelectValue></SelectTrigger>
                  <SelectContent>{(["low", "medium", "high"] as const).map((confidence) => <SelectItem key={confidence} value={confidence}>{confidence[0].toUpperCase() + confidence.slice(1)}</SelectItem>)}</SelectContent>
                </Select></Label>
                <Button className="self-end" type="button" size="icon" variant="ghost" aria-label={`Remove ${result.label}`} onClick={() => onChange(value.filter((item) => item.id !== result.id))}><Trash2 /></Button>
              </div>
              <Input aria-label={`${result.label} topic or skill`} value={result.areaOfStudy ?? ""} onChange={(event) => update(result.id, { areaOfStudy: event.target.value || undefined })} placeholder="Topic, skill, or Area of Study" />
              <Textarea aria-label={`${result.label} marker feedback`} rows={2} value={result.examinerNote ?? ""} onChange={(event) => update(result.id, { examinerNote: event.target.value || undefined })} placeholder="Marker feedback, expected qualities, or examiner advice" />
            </div>
          ))}
        </div>
      ) : null}
    </Field>
  )
}
