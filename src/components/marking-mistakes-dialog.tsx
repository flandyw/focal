import { useState } from "react"
import { MISTAKE_CATEGORIES, type ExamAttempt, type Mistake, type MistakeCategory, type QuestionResult } from "../lib/exam-data"
import { Button } from "./ui/button"
import { Checkbox } from "./ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldLabel } from "./ui/field"
import { NativeSelect, NativeSelectOption } from "./ui/native-select"
import { Textarea } from "./ui/textarea"

export function MarkingMistakesDialog({ attempt, results, onClose, onSave }: { attempt: ExamAttempt; results: QuestionResult[]; onClose: () => void; onSave: (mistakes: Mistake[]) => void }) {
  const [cards, setCards] = useState(() => results.map((result) => ({ result, selected: true, category: "Other" as MistakeCategory, explanation: result.examinerNote ?? "", correction: "" })))
  const selected = cards.filter((card) => card.selected)
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
      <DialogHeader><DialogTitle>Turn lost marks into revision</DialogTitle><DialogDescription>Your exam is saved. Choose questions and add what went wrong and how to fix it. Existing mistake cards are excluded.</DialogDescription></DialogHeader>
      <form id="marked-mistakes" className="grid gap-5" onSubmit={(event) => {
        event.preventDefault()
        const timestamp = new Date().toISOString()
        onSave(selected.map(({ result, category, explanation, correction }) => ({
          id: crypto.randomUUID(), attemptId: attempt.id, question: result.label, category,
          explanation: explanation.trim(), correction: correction.trim(),
          totalMarks: result.maxMarks, marksLost: result.maxMarks - result.marksAwarded,
          areaOfStudy: result.areaOfStudy, topic: result.topic, itemIds: result.itemIds, itemsBy: result.itemsBy,
          resolved: false, createdAt: timestamp, updatedAt: timestamp,
        })))
      }}>
        {cards.map((card, index) => <div key={card.result.id} className="grid gap-3 border-b pb-5 last:border-0">
          <label className="flex items-center gap-2 text-sm font-medium"><Checkbox checked={card.selected} onCheckedChange={(selected) => setCards((current) => current.map((item, i) => i === index ? { ...item, selected: selected === true } : item))} />{card.result.label}<span className="ml-auto text-muted-foreground tabular-nums">{card.result.maxMarks - card.result.marksAwarded} mark{card.result.maxMarks - card.result.marksAwarded === 1 ? "" : "s"} lost</span></label>
          {card.selected ? <>
            <Field><FieldLabel htmlFor={`mark-category-${index}`}>Category</FieldLabel><NativeSelect id={`mark-category-${index}`} value={card.category} onChange={(event) => setCards((current) => current.map((item, i) => i === index ? { ...item, category: event.target.value as MistakeCategory } : item))}>{MISTAKE_CATEGORIES.map((category) => <NativeSelectOption key={category} value={category}>{category}</NativeSelectOption>)}</NativeSelect></Field>
            <Field><FieldLabel htmlFor={`mark-explanation-${index}`}>What went wrong?</FieldLabel><Textarea id={`mark-explanation-${index}`} required value={card.explanation} onChange={(event) => setCards((current) => current.map((item, i) => i === index ? { ...item, explanation: event.target.value } : item))} /></Field>
            <Field><FieldLabel htmlFor={`mark-correction-${index}`}>How will you fix it?</FieldLabel><Textarea id={`mark-correction-${index}`} required value={card.correction} onChange={(event) => setCards((current) => current.map((item, i) => i === index ? { ...item, correction: event.target.value } : item))} /></Field>
          </> : null}
        </div>)}
      </form>
      <DialogFooter><Button variant="ghost" onClick={onClose}>Skip for now</Button><Button type="submit" form="marked-mistakes" disabled={!selected.length || selected.some((card) => !card.explanation.trim() || !card.correction.trim())}>Save {selected.length} mistake{selected.length === 1 ? "" : "s"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
