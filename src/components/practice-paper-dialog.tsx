import { useState } from "react"
import { toast } from "sonner"
import { SubjectCombobox } from "./subject-combobox"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { DiscardChangesDialog } from "./discard-changes-dialog"
import { buildPracticePaperPrompt } from "../lib/practice-paper"
import { createMistakesFromImport, parseMistakeImport } from "../lib/mistake-json"
import type { AppData, ExamAttempt, Mistake } from "../lib/exam-data"
import type { VcaaStudyResources } from "../lib/vcaa-resources"
import template from "../lib/worksheet-template.tex?raw"
import { sameStudySubject } from "../lib/studySubjects"

export function PracticePaperDialog({ data, studies, initialSubject, onOpenChange, onSave }: {
  data: AppData
  studies: VcaaStudyResources[]
  initialSubject?: string
  onOpenChange: (open: boolean) => void
  onSave: (mistakes: Mistake[], attempt?: ExamAttempt) => void
}) {
  const subjects = [...new Set([...data.subjects, ...studies.map((study) => study.studyName)])]
  const [subject, setSubject] = useState(initialSubject ?? subjects[0] ?? "")
  const [kind, setKind] = useState<"exam" | "sac">("exam")
  const [paper, setPaper] = useState("Exam 1")
  const [minutes, setMinutes] = useState("60")
  const [area, setArea] = useState("")
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [manualPrompt, setManualPrompt] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const valid = !!subject.trim() && !!paper.trim() && Number.isInteger(Number(minutes)) && Number(minutes) > 0 && (kind !== "sac" || !!area.trim())
  function close() {
    if (text.trim()) setConfirmingClose(true)
    else onOpenChange(false)
  }
  async function copyPrompt() {
    const weakAreas = [
      ...data.mistakes.filter((mistake) => !mistake.resolved && mistake.areaOfStudy && sameStudySubject(mistake.subject ?? data.attempts.find((attempt) => attempt.id === mistake.attemptId)?.subject, subject)).map((mistake) => mistake.areaOfStudy ?? ""),
      ...data.learning.curriculumAreas.filter((item) => sameStudySubject(item.subject, subject) && !item.archivedAt && (item.rating === "red" || item.rating === "amber")).map((item) => `${item.group ? `${item.group}: ` : ""}${item.name} (${item.rating})`),
    ]
    const prompt = buildPracticePaperPrompt(subject, kind, paper, Number(minutes), weakAreas, studies, template, area)
    try { await navigator.clipboard.writeText(prompt); setCopied(true); setManualPrompt(null) }
    catch { setManualPrompt(prompt); toast.error("Could not copy. Select the prompt below and copy it manually.") }
  }
  function save() {
    try {
      const parsed = parseMistakeImport(text)
      if (!parsed.exam) throw new Error("Include the exam object with your total mark and question results.")
      onSave(createMistakesFromImport(parsed.drafts, parsed.exam.id), parsed.exam)
      onOpenChange(false)
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save. Your JSON is still here; try again.") }
  }
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
        <DialogHeader><DialogTitle>Generate practice paper</DialogTitle><DialogDescription>Make a VCAA-style paper with any chatbot that can compile XeLaTeX, then upload your completed work there for rubric-based marking. AI marking can be wrong; check it against the reports.</DialogDescription></DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="practice-subject">1. Choose your assessment</FieldLabel><SubjectCombobox id="practice-subject" subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={(value) => { setSubject(value); setCopied(false) }} /></Field>
          <Field><FieldLabel htmlFor="practice-kind">Assessment type</FieldLabel><select id="practice-kind" className="h-9 rounded-md border bg-background px-3 text-sm" value={kind} onChange={(event) => { const next = event.target.value as "exam" | "sac"; setKind(next); setPaper(next === "sac" ? "SAC" : "Exam 1"); setCopied(false) }}><option value="exam">Exam</option><option value="sac">SAC</option></select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field><FieldLabel htmlFor="practice-label">Paper label</FieldLabel><Input id="practice-label" value={paper} onChange={(event) => { setPaper(event.target.value); setCopied(false) }} /></Field>
            <Field><FieldLabel htmlFor="practice-minutes">Writing minutes</FieldLabel><Input id="practice-minutes" type="number" min="1" step="1" value={minutes} onChange={(event) => { setMinutes(event.target.value); setCopied(false) }} /></Field>
          </div>
          <Field><FieldLabel htmlFor="practice-area">Area of study {kind === "sac" ? "(required)" : "(optional)"}</FieldLabel><Input id="practice-area" value={area} onChange={(event) => { setArea(event.target.value); setCopied(false) }} /></Field>
          <Field><FieldLabel>2. Generate, complete, then upload your paper</FieldLabel><Button variant="outline" disabled={!valid} onClick={() => void copyPrompt()}>{copied ? "Copied — copy again" : "Copy prompt"}</Button><FieldDescription>Includes official VCAA links, your open mistake topics, red/amber checklist items and the typesetting template. Keep the same chat for marking.</FieldDescription>{manualPrompt ? <Textarea readOnly aria-label="Prompt to copy manually" className="max-h-64 font-mono text-xs" value={manualPrompt} /> : null}</Field>
          <Field><FieldLabel htmlFor="practice-json">3. Paste the marking JSON</FieldLabel><Textarea id="practice-json" rows={5} className="font-mono text-xs" value={text} onChange={(event) => { setText(event.target.value); setError(null) }} aria-invalid={!!error} placeholder='{"exam":{...},"mistakes":[]}' /><FieldError>{error}</FieldError></Field>
        </FieldGroup>
        <DialogFooter><Button variant="outline" onClick={close}>Cancel</Button><Button disabled={!text.trim()} onClick={save}>Save exam and mistakes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <DiscardChangesDialog open={confirmingClose} onKeep={() => setConfirmingClose(false)} onDiscard={() => onOpenChange(false)} />
  </>
}
