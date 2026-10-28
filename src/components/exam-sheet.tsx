import { useMemo, useState, type FormEvent } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { Button } from "./ui/button"
import { SubjectCombobox } from "./subject-combobox"
import { DiscardChangesDialog } from "./discard-changes-dialog"
import { ArrowLeft, ChevronDown } from "lucide-react"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { QuestionResultsEditor } from "./question-results-editor"
import { PerformanceContextFields } from "./performance-context-fields"
import { analyseAttempt, findAttemptReferenceForYear, formatExamTitle, formatReferenceName, validateAttempt, validateQuestionResults, type AssessmentReference, type ExamAttempt, type QuestionResult } from "../lib/exam-data"
import { getKnownExamMarks } from "../lib/exam-conditions"
import { firstPreferredSubject, prioritiseSubjects } from "../lib/subjects"
import { hasPerformanceContext, type PerformanceContext } from "../lib/performance-context"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible"
import { localDate } from "../lib/learning-workspace"

type ExamEntryProps = {
  references: AssessmentReference[]
  preferredSubjects: string[]
  comparisonYear: number
  initialAttempt?: ExamAttempt | null
  onOpenChange: (open: boolean) => void
  onSave: (attempt: ExamAttempt, logMistake: boolean) => void
}

export function ExamSheet({ references, preferredSubjects, comparisonYear, initialAttempt, onOpenChange, onSave }: ExamEntryProps) {
  const subjects = useMemo(
    () => prioritiseSubjects([...preferredSubjects, ...references.map((item) => item.studyName)], preferredSubjects),
    [references, preferredSubjects],
  )
  const defaultSubject = firstPreferredSubject(subjects, preferredSubjects)
  const [subject, setSubject] = useState(initialAttempt?.subject ?? defaultSubject)
  const [provider, setProvider] = useState(initialAttempt?.provider ?? "VCAA")
  const [examYear, setExamYear] = useState(() => initialAttempt?.examYear ?? new Date().getFullYear())
  const [paper, setPaper] = useState(initialAttempt?.paper ?? "")
  const [completedAt, setCompletedAt] = useState(() => initialAttempt?.completedAt ?? localDate(new Date()))
  const [rawScore, setRawScore] = useState(initialAttempt?.rawScore ?? 0)
  const [rawMax, setRawMax] = useState(initialAttempt?.rawMax ?? 100)
  const [comment, setComment] = useState(initialAttempt?.comment ?? "")
  const [performanceContext, setPerformanceContext] = useState<PerformanceContext>(initialAttempt?.performanceContext ?? {})
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>(initialAttempt?.questionResults ?? [])
  const [error, setError] = useState<string | null>(null)
  const [initialSnapshot] = useState(() => JSON.stringify({
    subject, provider, examYear, paper, completedAt, rawScore, rawMax,
    comment, performanceContext, questionResults,
  }))
  const dirty = JSON.stringify({
    subject, provider, examYear, paper, completedAt, rawScore, rawMax,
    comment, performanceContext, questionResults,
  }) !== initialSnapshot
  const [confirmingClose, setConfirmingClose] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next && dirty) {
      setConfirmingClose(true)
      return
    }
    onOpenChange(next)
  }
  const paperOptions = useMemo(
    () => [...new Set(references
      .filter((item) => item.studyName.toLowerCase() === subject.trim().toLowerCase())
      .map((item) => formatReferenceName(item.name)))].toSorted(),
    [references, subject],
  )
  const reference = findAttemptReferenceForYear({ subject, paper }, references, comparisonYear)
  const scaled = reference && rawMax > 0 ? analyseAttempt({ rawScore, rawMax }, reference) : null
  function changePaper(next: string) {
    setPaper(next)
    const marks = getKnownExamMarks(subject, next)
    if (marks) setRawMax(marks)
  }

  function reset() {
    setSubject(defaultSubject)
    setProvider("VCAA")
    setExamYear(new Date().getFullYear())
    setPaper("")
    setCompletedAt(localDate(new Date()))
    setRawScore(0)
    setRawMax(100)
    setComment("")
    setPerformanceContext({})
    setQuestionResults([])
    setError(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const logMistake = (event.nativeEvent as SubmitEvent).submitter?.getAttribute("value") === "mistake"
    const scoreError = validateAttempt({ rawScore, rawMax })
    if (!subject.trim() || !paper.trim()) {
      setError("Subject and paper are required.")
      return
    }
    if (!Number.isInteger(examYear) || examYear < 1990 || examYear > 2100) return setError("Enter a year between 1990 and 2100.")
    if (!completedAt) return setError("Choose the date you completed the exam.")
    if (scoreError) {
      setError(scoreError)
      return
    }
    const questionError = validateQuestionResults(questionResults)
    if (questionError) return setError(questionError)

    const timestamp = new Date().toISOString()
    onSave({
      id: initialAttempt?.id ?? crypto.randomUUID(),
      subject: subject.trim(),
      provider: provider.trim() || "Other",
      title: formatExamTitle(provider, examYear, subject),
      examYear,
      paper: paper.trim(),
      completedAt,
      rawScore,
      rawMax,
      comment: comment.trim() || undefined,
      performanceContext: hasPerformanceContext(performanceContext) ? performanceContext : undefined,
      questionResults: questionResults.length ? questionResults : undefined,
      timing: initialAttempt?.timing,
      referenceId: null,
      createdAt: initialAttempt?.createdAt ?? timestamp,
      updatedAt: timestamp,
    }, logMistake)
    reset()
    onOpenChange(false)
  }

  const percent = rawMax > 0 && Number.isFinite(rawScore) ? Math.round((rawScore / rawMax) * 100) : null

  return (
    <DialogPrimitive.Root open onOpenChange={handleOpenChange}>
      <DialogPrimitive.Portal>
      <DialogPrimitive.Popup aria-labelledby="exam-editor-title" aria-describedby="exam-editor-description" className="fixed inset-0 z-50 overflow-y-auto bg-background outline-none">
      <form id="exam-form" className="mx-auto grid max-w-3xl gap-8 p-4 sm:p-6 lg:py-10" onChange={() => setError(null)} onSubmit={submit}>
        <header className="grid gap-3">
          <Button type="button" variant="ghost" size="sm" className="-ml-2 w-fit" onClick={() => handleOpenChange(false)}><ArrowLeft />Back to exams</Button>
          <div>
            <h1 id="exam-editor-title" className="focal-page-title">{initialAttempt ? "Edit practice exam" : "Log practice exam"}</h1>
            <p id="exam-editor-description" className="mt-1 text-sm text-muted-foreground">Two steps: which paper, then your mark. Everything else is optional.</p>
          </div>
        </header>

        <FieldGroup>
          <section className="grid gap-5" aria-labelledby="exam-step-paper">
            <h2 id="exam-step-paper" className="focal-section-title">1. Paper</h2>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="subject">Subject</FieldLabel>
                <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={(value) => { setSubject(value); setError(null) }} id="subject" allowCustom required placeholder="Search or enter a subject" />
              </Field>
              <Field>
                <FieldLabel htmlFor="paper">Paper</FieldLabel>
                <Input id="paper" list="exam-paper-options" value={paper} onChange={(event) => changePaper(event.target.value)} placeholder="e.g. Exam 1" required />
                <datalist id="exam-paper-options">{paperOptions.map((item) => <option key={item} value={item} />)}</datalist>
              </Field>
              <Field>
                <FieldLabel htmlFor="provider">Provider</FieldLabel>
                <Input id="provider" value={provider} onChange={(event) => setProvider(event.target.value)} />
              </Field>
              <div className="grid grid-cols-2 gap-5">
                <Field>
                  <FieldLabel htmlFor="exam-year">Year</FieldLabel>
                  <Input id="exam-year" type="number" min="1990" max="2100" value={Number.isFinite(examYear) ? examYear : ""} onChange={(event) => setExamYear(event.target.valueAsNumber)} required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="completed-at">Completed</FieldLabel>
                  <Input id="completed-at" type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} required />
                </Field>
              </div>
            </div>
          </section>

          <section className="grid gap-5 border-t pt-8" aria-labelledby="exam-step-result">
            <h2 id="exam-step-result" className="focal-section-title">2. Result</h2>
            <div className="grid items-end gap-5 sm:grid-cols-[1fr_1fr_auto]">
              <Field>
                <FieldLabel htmlFor="raw-score">Mark</FieldLabel>
                <Input id="raw-score" type="number" min="0" step="0.5" value={Number.isFinite(rawScore) ? rawScore : ""} onChange={(event) => setRawScore(event.target.valueAsNumber)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="raw-max">Out of</FieldLabel>
                <Input id="raw-max" type="number" min="0.5" step="0.5" value={Number.isFinite(rawMax) ? rawMax : ""} onChange={(event) => setRawMax(event.target.valueAsNumber)} required />
              </Field>
              <p className="pb-1.5 focal-stat-value tabular-nums" aria-live="polite">{percent === null ? "–" : `${percent}%`}</p>
            </div>
            {scaled && reference ? (
              <FieldDescription>
                VCAA {comparisonYear} scaled mark: {scaled.scaledScore.toFixed(1)}/{reference.maxScore} ({formatReferenceName(reference.name)}).
              </FieldDescription>
            ) : null}
          </section>

          <section className="grid gap-2 border-t pt-8" aria-label="Optional details">
            <h2 className="focal-section-title">Optional details</h2>
            <Collapsible className="rounded-lg border px-4 py-3"><CollapsibleTrigger className="group/trigger flex w-full items-center justify-between gap-2 text-left text-sm font-medium"><span className="min-w-0">Comment{comment ? " ·" : ""} <span className="font-normal text-muted-foreground">{comment ? "added" : "what went well or what to improve"}</span></span><ChevronDown className="size-4 shrink-0 transition-transform group-data-[panel-open]/trigger:rotate-180" /></CollapsibleTrigger><CollapsibleContent keepMounted>
              <Field className="mt-3">
                <FieldLabel htmlFor="exam-comment" className="sr-only">Overall comment</FieldLabel>
                <Textarea id="exam-comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What went well or what to improve next time?" />
              </Field>
            </CollapsibleContent></Collapsible>
            <Collapsible className="rounded-lg border px-4 py-3"><CollapsibleTrigger className="group/trigger flex w-full items-center justify-between gap-2 text-left text-sm font-medium"><span className="min-w-0">Conditions and headspace <span className="font-normal text-muted-foreground">{hasPerformanceContext(performanceContext) ? "· recorded" : "sleep, focus, stress"}</span></span><ChevronDown className="size-4 shrink-0 transition-transform group-data-[panel-open]/trigger:rotate-180" /></CollapsibleTrigger><CollapsibleContent keepMounted>
              <div className="mt-3"><PerformanceContextFields value={performanceContext} onChange={setPerformanceContext} idPrefix="exam-context" /></div>
            </CollapsibleContent></Collapsible>
            <Collapsible className="rounded-lg border px-4 py-3"><CollapsibleTrigger className="group/trigger flex w-full items-center justify-between gap-2 text-left text-sm font-medium"><span className="min-w-0">Question breakdown <span className="font-normal text-muted-foreground">{questionResults.length ? `· ${questionResults.length} items` : "reveal coverage gaps"}</span></span><ChevronDown className="size-4 shrink-0 transition-transform group-data-[panel-open]/trigger:rotate-180" /></CollapsibleTrigger><CollapsibleContent keepMounted>
              <div className="mt-3"><QuestionResultsEditor value={questionResults} onChange={setQuestionResults} /></div>
            </CollapsibleContent></Collapsible>
          </section>
        </FieldGroup>

        <footer className="sticky bottom-0 -mx-4 flex flex-wrap justify-end gap-2 border-t bg-background/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
          {error ? <FieldError className="w-full">{error}</FieldError> : null}
          <Button type="button" variant="ghost" onClick={() => handleOpenChange(false)}>Cancel</Button>
          <Button type="submit" name="next" value="mistake" variant="outline">Save & log mistake</Button>
          <Button type="submit">{initialAttempt ? "Save changes" : "Save exam"}</Button>
        </footer>
      </form>
      </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
      <DiscardChangesDialog
        open={confirmingClose}
        onKeep={() => setConfirmingClose(false)}
        onDiscard={() => { setConfirmingClose(false); onOpenChange(false) }}
      />
    </DialogPrimitive.Root>
  )
}
