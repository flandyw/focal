import { useRef, useState } from "react"
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
  const copyingRef = useRef(false)
  const [copying, setCopying] = useState(false)
  const setup = JSON.stringify({ subject, kind, paper, minutes, area })
  const [initialSetup] = useState(setup)
  const problems = {
    subject: subject.trim() ? null : "Choose a subject.",
    label: paper.trim() ? null : "Enter a paper label.",
    minutes: Number.isInteger(Number(minutes)) && Number(minutes) > 0 ? null : "Enter a whole number of minutes, 1 or more.",
    area: kind !== "sac" || area.trim() ? null : "SACs need an area of study.",
  }
  const valid = !Object.values(problems).some(Boolean)
  const invalid = (field: keyof typeof problems) => problems[field] ? { "aria-invalid": true, "aria-describedby": `practice-${field}-error` } : {}
  function invalidatePrompt() {
    setCopied(false)
    setManualPrompt(null)
  }
  function close() {
    if (copyingRef.current) return
    if (text.trim() || setup !== initialSetup) setConfirmingClose(true)
    else onOpenChange(false)
  }
  async function copyPrompt() {
    if (copyingRef.current) return
    const weakAreas = [
      ...data.mistakes.filter((mistake) => !mistake.resolved && mistake.areaOfStudy && sameStudySubject(mistake.subject ?? data.attempts.find((attempt) => attempt.id === mistake.attemptId)?.subject, subject)).map((mistake) => mistake.areaOfStudy ?? ""),
      ...data.learning.curriculumAreas.filter((item) => sameStudySubject(item.subject, subject) && !item.archivedAt && (item.rating === "red" || item.rating === "amber")).map((item) => `${item.group ? `${item.group}: ` : ""}${item.name} (${item.rating})`),
    ]
    const prompt = buildPracticePaperPrompt(subject, kind, paper, Number(minutes), weakAreas, studies, template, area)
    // Clipboard writes can't be cancelled; serialize them and hold the setup until this one settles.
    copyingRef.current = true
    setCopying(true)
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      setManualPrompt(null)
    } catch {
      setManualPrompt(prompt)
      toast.error("Couldn’t copy automatically. Select the prompt below and copy it manually.")
    } finally {
      copyingRef.current = false
      setCopying(false)
    }
  }
  function save() {
    if (copyingRef.current) return
    try {
      const parsed = parseMistakeImport(text)
      if (!parsed.exam) throw new Error("Include the exam object with your total mark and question results.")
      onSave(createMistakesFromImport(parsed.drafts, parsed.exam.id), parsed.exam)
      onOpenChange(false)
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn’t save just now. Your JSON is still here, so give it another try.") }
  }
  return <>
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
        <DialogHeader><DialogTitle>Generate practice paper</DialogTitle><DialogDescription>Build a VCAA-style paper with any chatbot that can compile XeLaTeX, then upload your completed work there for rubric-based marking. AI marking can make mistakes, so double-check it against the official reports.</DialogDescription></DialogHeader>
        <FieldGroup>
          <fieldset disabled={copying} className="contents">
          <Field><FieldLabel htmlFor="practice-subject">1. Choose your assessment</FieldLabel><SubjectCombobox id="practice-subject" subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={(value) => { setSubject(value); invalidatePrompt() }} {...invalid("subject")} /><FieldError id="practice-subject-error">{problems.subject}</FieldError></Field>
          <Field><FieldLabel htmlFor="practice-kind">Assessment type</FieldLabel><select id="practice-kind" className="h-9 rounded-md border bg-background px-3 text-sm" value={kind} onChange={(event) => { const next = event.target.value as "exam" | "sac"; setKind(next); setPaper(next === "sac" ? "SAC" : "Exam 1"); invalidatePrompt() }}><option value="exam">Exam</option><option value="sac">SAC</option></select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field><FieldLabel htmlFor="practice-label">Paper label</FieldLabel><Input id="practice-label" value={paper} onChange={(event) => { setPaper(event.target.value); invalidatePrompt() }} {...invalid("label")} /><FieldError id="practice-label-error">{problems.label}</FieldError></Field>
            <Field><FieldLabel htmlFor="practice-minutes">Writing minutes</FieldLabel><Input id="practice-minutes" type="number" min="1" step="1" value={minutes} onChange={(event) => { setMinutes(event.target.value); invalidatePrompt() }} {...invalid("minutes")} /><FieldError id="practice-minutes-error">{problems.minutes}</FieldError></Field>
          </div>
          <Field><FieldLabel htmlFor="practice-area">Area of study {kind === "sac" ? "(required)" : "(optional)"}</FieldLabel><Input id="practice-area" value={area} onChange={(event) => { setArea(event.target.value); invalidatePrompt() }} {...invalid("area")} /><FieldError id="practice-area-error">{problems.area}</FieldError></Field>
          </fieldset>
          <Field><FieldLabel>2. Generate, complete, then upload your paper</FieldLabel><Button variant="outline" disabled={!valid || copying} onClick={() => void copyPrompt()}>{copying ? "Copying…" : copied ? "Copied (copy again)" : "Copy prompt"}</Button><FieldDescription>Packs in official VCAA links, your open mistake topics, red/amber checklist items, and the typesetting template. Stay in the same chat when you come back for marking.</FieldDescription>{manualPrompt ? <Textarea readOnly aria-label="Prompt to copy manually" className="max-h-64 font-mono text-xs" value={manualPrompt} /> : null}</Field>
          <Field><FieldLabel htmlFor="practice-json">3. Paste the marking JSON</FieldLabel><Textarea id="practice-json" rows={5} className="font-mono text-xs" value={text} onChange={(event) => { setText(event.target.value); setError(null) }} aria-invalid={!!error} aria-describedby={error ? "practice-json-error" : undefined} placeholder='{"exam":{...},"mistakes":[]}' /><FieldError id="practice-json-error">{error}</FieldError></Field>
        </FieldGroup>
        <DialogFooter><Button variant="outline" disabled={copying} onClick={close}>Cancel</Button><Button disabled={copying || !text.trim()} onClick={save}>Save exam and mistakes</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <DiscardChangesDialog open={confirmingClose} onKeep={() => setConfirmingClose(false)} onDiscard={() => onOpenChange(false)} />
  </>
}
