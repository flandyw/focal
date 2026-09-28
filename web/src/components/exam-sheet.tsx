import { useMemo, useRef, useState, type FormEvent } from "react"
import { ExamProgressionPanel, type ExamProgressionProps } from "@/components/exam-progression"
import { Button } from "@/components/ui/button"
import { SubjectCombobox } from "@/components/subject-combobox"
import { DiscardChangesDialog } from "@/components/discard-changes-dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { QuestionResultsEditor } from "@/components/question-results-editor"
import { PerformanceContextFields } from "@/components/performance-context-fields"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { analyseAttempt, findAttemptReferenceForYear, formatExamTitle, formatReferenceName, validateAttempt, validateQuestionResults, type AssessmentReference, type ExamAttempt, type QuestionResult } from "@/lib/exam-data"
import { buildCompanyExamSuggestions, buildExamSuggestions, findLatestAttempt, type ExamSuggestion } from "@/lib/exam-suggestions"
import type { ExamDifficultySettings } from "@/lib/exam-difficulty"
import { firstPreferredSubject, prioritiseSubjects } from "@/lib/subjects"
import { hasPerformanceContext, type PerformanceContext } from "@/lib/performance-context"
import type { VcaaStudyResources } from "@/lib/vcaa-resources"

type ExamSheetProps = ExamProgressionProps & {
  open: boolean
  references: AssessmentReference[]
  attempts: ExamAttempt[]
  studies: VcaaStudyResources[]
  preferredSubjects: string[]
  comparisonYear: number
  difficultySettings?: ExamDifficultySettings
  initialAttempt?: ExamAttempt | null
  onOpenChange: (open: boolean) => void
  onSave: (attempt: ExamAttempt, logMistake: boolean) => void
}

const today = new Date().toISOString().slice(0, 10)

function SuggestionButton({ suggestion, selected, onClick, showProvider = false }: {
  suggestion: ExamSuggestion
  selected: boolean
  onClick: (suggestion: ExamSuggestion) => void
  showProvider?: boolean
}) {
  return (
    <Button
      type="button"
      variant={selected ? "secondary" : "outline"}
      className="h-auto justify-start whitespace-normal px-3 py-2.5 text-left"
      aria-pressed={selected}
      onClick={() => onClick(suggestion)}
    >
      <span className="grid gap-0.5">
        <span className="font-medium">{showProvider ? `${suggestion.provider} · ${suggestion.paper}` : `${suggestion.examYear} · ${suggestion.paper}`}</span>
        <span className="text-xs font-normal text-muted-foreground">
          {showProvider ? `${suggestion.examYear} · ${suggestion.subject}` : suggestion.subject} · {suggestion.marks} marks
        </span>
      </span>
    </Button>
  )
}

export function ExamSheet({ progression, onProgressionChange, open, references, attempts, studies, preferredSubjects, comparisonYear, difficultySettings, initialAttempt, onOpenChange, onSave }: ExamSheetProps) {
  const subjects = useMemo(
    () => prioritiseSubjects(references.map((item) => item.studyName), preferredSubjects),
    [references, preferredSubjects],
  )
  const defaultSubject = firstPreferredSubject(subjects, preferredSubjects)
  const [subject, setSubject] = useState(initialAttempt?.subject ?? defaultSubject)
  const [provider, setProvider] = useState(initialAttempt?.provider ?? "VCAA")
  const [examYear, setExamYear] = useState(initialAttempt?.examYear ?? new Date().getFullYear())
  const [paper, setPaper] = useState(initialAttempt?.paper ?? "")
  const [completedAt, setCompletedAt] = useState(initialAttempt?.completedAt ?? today)
  const [rawScore, setRawScore] = useState(initialAttempt?.rawScore ?? 0)
  const [rawMax, setRawMax] = useState(initialAttempt?.rawMax ?? 100)
  const [comment, setComment] = useState(initialAttempt?.comment ?? "")
  const [performanceContext, setPerformanceContext] = useState<PerformanceContext>(initialAttempt?.performanceContext ?? {})
  const [questionResults, setQuestionResults] = useState<QuestionResult[]>(initialAttempt?.questionResults ?? [])
  const [error, setError] = useState<string | null>(null)
  const initialSnapshot = useRef(JSON.stringify({
    subject, provider, examYear, paper, completedAt, rawScore, rawMax,
    comment, performanceContext, questionResults,
  }))
  const dirty = JSON.stringify({
    subject, provider, examYear, paper, completedAt, rawScore, rawMax,
    comment, performanceContext, questionResults,
  }) !== initialSnapshot.current
  const [confirmingClose, setConfirmingClose] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next && dirty) {
      setConfirmingClose(true)
      return
    }
    onOpenChange(next)
  }
  const suggestions = useMemo(
    () => initialAttempt ? [] : buildExamSuggestions(attempts, references, preferredSubjects, 4, studies),
    [attempts, initialAttempt, preferredSubjects, references, studies],
  )
  const companySuggestions = useMemo(
    () => initialAttempt ? [] : buildCompanyExamSuggestions(attempts, references, preferredSubjects, difficultySettings, 4),
    [attempts, difficultySettings, initialAttempt, preferredSubjects, references],
  )
  const latestAttempt = useMemo(() => findLatestAttempt(attempts), [attempts])

  const paperOptions = useMemo(
    () => [...new Set(references
      .filter((item) => item.studyName.toLowerCase() === subject.trim().toLowerCase())
      .map((item) => formatReferenceName(item.name)))].toSorted(),
    [references, subject],
  )
  const reference = findAttemptReferenceForYear({ subject, paper }, references, comparisonYear)
  const scaled = reference && rawMax > 0 ? analyseAttempt({ rawScore, rawMax }, reference) : null
  function applySuggestion(suggestion: ExamSuggestion) {
    setSubject(suggestion.subject)
    setProvider(suggestion.provider)
    setExamYear(suggestion.examYear)
    setPaper(suggestion.paper)
    setRawMax(suggestion.marks)
    setError(null)
  }

  function isSelected(suggestion: ExamSuggestion) {
    return subject === suggestion.subject && provider === suggestion.provider && examYear === suggestion.examYear && paper === suggestion.paper
  }

  function reset() {
    setSubject(defaultSubject)
    setProvider("VCAA")
    setExamYear(new Date().getFullYear())
    setPaper("")
    setCompletedAt(today)
    setRawScore(0)
    setRawMax(100)
    setComment("")
    setPerformanceContext({})
    setQuestionResults([])
    setError(null)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const logMistake = new FormData(event.currentTarget).get("next") === "mistake"
    const scoreError = validateAttempt({ rawScore, rawMax })
    if (!subject.trim() || !paper.trim()) {
      setError("Subject and paper are required.")
      return
    }
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

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent resizable className="w-full">
        <SheetHeader>
          <SheetTitle>{initialAttempt ? "Edit practice exam" : "Log practice exam"}</SheetTitle>
          <SheetDescription>
            Record a completed practice exam and its raw mark.
          </SheetDescription>
        </SheetHeader>
        <form id="exam-form" className="px-4 pb-4" onSubmit={submit}>
          <FieldGroup>
            {!initialAttempt ? (
              <section className="grid gap-4 rounded-lg border bg-muted/20 p-4" aria-labelledby="log-exam-suggestions-title">
                <div>
                  <h3 id="log-exam-suggestions-title" className="text-sm font-medium">Suggested next exams</h3>
                  <p className="text-xs text-muted-foreground">
                    {latestAttempt
                      ? `Based on your latest logged paper: ${latestAttempt.examYear} ${latestAttempt.subject} · ${latestAttempt.paper}.`
                      : "Based on your preferred subjects and available VCAA papers."}
                    {" "}Choose one to fill the details below.
                  </p>
                </div>
                <ExamProgressionPanel progression={progression} onProgressionChange={onProgressionChange} attempts={attempts} subjects={preferredSubjects} onSelect={applySuggestion} />
                {suggestions.length ? <div className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">Official VCAA papers</p><div className="grid gap-2 sm:grid-cols-2">{suggestions.map((suggestion) => <SuggestionButton key={`${suggestion.subject}-${suggestion.provider}-${suggestion.examYear}-${suggestion.paper}`} suggestion={suggestion} selected={isSelected(suggestion)} onClick={applySuggestion} />)}</div></div> : null}
                {companySuggestions.length ? <div className="grid gap-2"><p className="text-xs font-medium text-muted-foreground">Company exam progression</p><div className="grid gap-2 sm:grid-cols-2">{companySuggestions.map((suggestion) => <SuggestionButton key={`${suggestion.subject}-${suggestion.provider}-${suggestion.examYear}-${suggestion.paper}`} suggestion={suggestion} selected={isSelected(suggestion)} onClick={applySuggestion} showProvider />)}</div></div> : null}
              </section>
            ) : null}
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="subject">Subject</FieldLabel>
                <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={setSubject} id="subject" allowCustom placeholder="Search or enter a subject" />
              </Field>
              <Field>
                <FieldLabel htmlFor="provider">Provider</FieldLabel>
                <Input id="provider" value={provider} onChange={(event) => setProvider(event.target.value)} />
              </Field>
            </div>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="exam-year">Exam year</FieldLabel>
                <Input id="exam-year" type="number" min="1990" max="2100" value={examYear} onChange={(event) => setExamYear(event.target.valueAsNumber)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="paper">Paper</FieldLabel>
                <Input id="paper" list="exam-paper-options" value={paper} onChange={(event) => setPaper(event.target.value)} placeholder="Exam, paper, or assessment name" />
                <datalist id="exam-paper-options">{paperOptions.map((item) => <option key={item} value={item} />)}</datalist>
              </Field>
            </div>

            <Field>
              <FieldLabel htmlFor="completed-at">Completed</FieldLabel>
              <Input id="completed-at" type="date" value={completedAt} onChange={(event) => setCompletedAt(event.target.value)} />
            </Field>

            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="raw-score">Mark</FieldLabel>
                <Input id="raw-score" type="number" min="0" step="0.5" value={rawScore} onChange={(event) => setRawScore(event.target.valueAsNumber)} />
              </Field>
              <Field data-invalid={error ? true : undefined}>
                <FieldLabel htmlFor="raw-max">Out of</FieldLabel>
                <Input id="raw-max" type="number" min="0.5" step="0.5" value={rawMax} onChange={(event) => setRawMax(event.target.valueAsNumber)} />
              </Field>
            </div>
            {scaled && reference ? (
              <FieldDescription>
                VCAA {comparisonYear} scaled mark: {scaled.scaledScore.toFixed(1)}/{reference.maxScore} ({formatReferenceName(reference.name)}).
              </FieldDescription>
            ) : null}
            <Field>
              <FieldLabel htmlFor="exam-comment">Overall comment <span className="text-muted-foreground">(optional)</span></FieldLabel>
              <Textarea id="exam-comment" value={comment} onChange={(event) => setComment(event.target.value)} placeholder="What went well or what to improve next time?" />
            </Field>
            <PerformanceContextFields value={performanceContext} onChange={setPerformanceContext} idPrefix="exam-context" />
            <QuestionResultsEditor value={questionResults} onChange={setQuestionResults} />
            <FieldError>{error}</FieldError>
          </FieldGroup>
        </form>
        <SheetFooter>
          <Button type="submit" name="next" value="mistake" form="exam-form" variant="outline">Save & log mistake</Button>
          <Button type="submit" form="exam-form">{initialAttempt ? "Save changes" : "Save exam"}</Button>
        </SheetFooter>
      </SheetContent>
      <DiscardChangesDialog
        open={confirmingClose}
        onKeep={() => setConfirmingClose(false)}
        onDiscard={() => { setConfirmingClose(false); onOpenChange(false) }}
      />
    </Sheet>
  )
}
