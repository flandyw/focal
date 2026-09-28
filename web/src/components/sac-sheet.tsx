import { useMemo, useRef, useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { DiscardChangesDialog } from "@/components/discard-changes-dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { SubjectCombobox } from "@/components/subject-combobox"
import { PerformanceContextFields } from "@/components/performance-context-fields"
import { prioritiseSubjects } from "@/lib/subjects"
import { hasPerformanceContext, type PerformanceContext } from "@/lib/performance-context"
import { SAC_UNITS, validateSac, type SacRecord, type SacUnit } from "@/lib/sac"

type SacSheetProps = {
  open: boolean
  subjects: string[]
  preferredSubjects: string[]
  initialRecord?: SacRecord | null
  onOpenChange: (open: boolean) => void
  onSave: (record: SacRecord) => void
}

const today = () => new Date().toISOString().slice(0, 10)

export function SacSheet({ open, subjects, preferredSubjects, initialRecord, onOpenChange, onSave }: SacSheetProps) {
  const options = useMemo(() => prioritiseSubjects(subjects, preferredSubjects), [preferredSubjects, subjects])
  const [subject, setSubject] = useState(initialRecord?.subject ?? preferredSubjects[0] ?? options[0] ?? "")
  const [provider, setProvider] = useState(initialRecord?.provider ?? "")
  const [title, setTitle] = useState(initialRecord?.title ?? "")
  const [sacNumber, setSacNumber] = useState(initialRecord?.sacNumber ?? "")
  const [unit, setUnit] = useState<SacUnit | null>(initialRecord?.unit ?? null)
  const [areaOfStudy, setAreaOfStudy] = useState(initialRecord?.areaOfStudy ?? "")
  const [scheduledAt, setScheduledAt] = useState(initialRecord?.scheduledAt ?? today())
  const [durationMinutes, setDurationMinutes] = useState(initialRecord?.durationMinutes ?? 50)
  const [score, setScore] = useState(initialRecord?.score?.toString() ?? "")
  const [maxScore, setMaxScore] = useState(initialRecord?.maxScore?.toString() ?? "")
  const [weighting, setWeighting] = useState(initialRecord?.weighting?.toString() ?? "")
  const [notes, setNotes] = useState(initialRecord?.notes ?? "")
  const [performanceContext, setPerformanceContext] = useState<PerformanceContext>(initialRecord?.performanceContext ?? {})
  const [error, setError] = useState<string | null>(null)
  const initialSnapshot = useRef(JSON.stringify({
    subject, provider, title, sacNumber, unit, areaOfStudy, scheduledAt, durationMinutes,
    score, maxScore, weighting, notes, performanceContext,
  }))
  const dirty = JSON.stringify({
    subject, provider, title, sacNumber, unit, areaOfStudy, scheduledAt, durationMinutes,
    score, maxScore, weighting, notes, performanceContext,
  }) !== initialSnapshot.current
  const [confirmingClose, setConfirmingClose] = useState(false)

  function handleOpenChange(next: boolean) {
    if (!next && dirty) {
      setConfirmingClose(true)
      return
    }
    onOpenChange(next)
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (unit === null) {
      setError("Choose the unit for this assessment.")
      return
    }
    const parsedScore = score.trim() === "" ? undefined : Number(score)
    const parsedMaximum = maxScore.trim() === "" ? undefined : Number(maxScore)
    const parsedWeighting = weighting.trim() === "" ? undefined : Number(weighting)
    const candidate = {
      subject: subject.trim(),
      provider: provider.trim(),
      title: title.trim(),
      unit,
      scheduledAt,
      durationMinutes,
      score: parsedScore,
      maxScore: parsedMaximum,
      weighting: parsedWeighting,
    }
    const validationError = validateSac(candidate)
    if (validationError) {
      setError(validationError)
      return
    }
    const timestamp = new Date().toISOString()
    onSave({
      id: initialRecord?.id ?? crypto.randomUUID(),
      ...candidate,
      sacNumber: sacNumber.trim() || undefined,
      areaOfStudy: areaOfStudy.trim() || undefined,
      completedAt: parsedScore !== undefined ? (initialRecord?.completedAt ?? scheduledAt) : undefined,
      notes: notes.trim() || undefined,
      performanceContext: hasPerformanceContext(performanceContext) ? performanceContext : undefined,
      timing: initialRecord?.timing,
      createdAt: initialRecord?.createdAt ?? timestamp,
      updatedAt: timestamp,
    })
    onOpenChange(false)
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent resizable className="w-full">
        <SheetHeader>
          <SheetTitle>{initialRecord ? "Edit SAC" : "Plan or log SAC"}</SheetTitle>
          <SheetDescription>Add an upcoming SAC now, then enter the result when it is marked.</SheetDescription>
        </SheetHeader>
        <form id="sac-form" className="px-4 pb-4" onSubmit={submit}>
          <FieldGroup>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="sac-subject">Subject</FieldLabel>
                <SubjectCombobox id="sac-subject" subjects={options} preferredSubjects={preferredSubjects} value={subject} onValueChange={setSubject} allowCustom required placeholder="Search or enter a subject" />
              </Field>
              <Field>
                <FieldLabel htmlFor="sac-provider">School / provider</FieldLabel>
                <Input id="sac-provider" value={provider} onChange={(event) => setProvider(event.target.value)} placeholder="School or practice provider" required />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-[1fr_10rem]">
              <Field>
                <FieldLabel htmlFor="sac-title">SAC title</FieldLabel>
                <Input id="sac-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Outcome assessment" required />
              </Field>
              <Field>
                <FieldLabel htmlFor="sac-number">SAC number <span className="text-muted-foreground">(optional)</span></FieldLabel>
                <Input id="sac-number" value={sacNumber} onChange={(event) => setSacNumber(event.target.value)} placeholder="e.g. 2 or 3A" />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="sac-unit">Unit</FieldLabel>
                <Select value={unit === null ? null : String(unit)} onValueChange={(value) => setUnit(value === null ? null : Number(value) as SacUnit)}>
                  <SelectTrigger id="sac-unit" className="w-full"><SelectValue placeholder="Select unit" /></SelectTrigger>
                  <SelectContent>{SAC_UNITS.map((option) => <SelectItem key={option} value={String(option)}>Unit {option}</SelectItem>)}</SelectContent>
                </Select>
                <FieldDescription>Set this per subject so accelerated students can mix Units 1/2 and 3/4.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel htmlFor="sac-aos">Area of Study <span className="text-muted-foreground">(optional)</span></FieldLabel>
                <Input id="sac-aos" value={areaOfStudy} onChange={(event) => setAreaOfStudy(event.target.value)} placeholder="Area of Study 1" />
              </Field>
            </div>
            <div className="grid gap-5 sm:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="sac-date">Date</FieldLabel>
                <Input id="sac-date" type="date" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} required />
              </Field>
              <Field>
                <FieldLabel htmlFor="sac-duration">Time allowed (min)</FieldLabel>
                <Input id="sac-duration" type="number" min="1" max="360" value={durationMinutes} onChange={(event) => setDurationMinutes(event.target.valueAsNumber)} required />
              </Field>
            </div>
            <div className="border-t pt-5">
              <p className="mb-4 text-sm font-medium">Result</p>
              <div className="grid gap-5 sm:grid-cols-3">
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor="sac-score">Mark</FieldLabel>
                  <Input id="sac-score" type="number" min="0" step="0.5" value={score} onChange={(event) => setScore(event.target.value)} placeholder="—" />
                </Field>
                <Field data-invalid={error ? true : undefined}>
                  <FieldLabel htmlFor="sac-maximum">Out of</FieldLabel>
                  <Input id="sac-maximum" type="number" min="0.5" step="0.5" value={maxScore} onChange={(event) => setMaxScore(event.target.value)} placeholder="—" />
                </Field>
                <Field>
                  <FieldLabel htmlFor="sac-weighting">Weighting (%)</FieldLabel>
                  <Input id="sac-weighting" type="number" min="0.1" max="100" step="0.1" value={weighting} onChange={(event) => setWeighting(event.target.value)} placeholder="Optional" />
                </Field>
              </div>
              <FieldDescription className="mt-2">Leave mark and maximum blank to track this as an upcoming SAC.</FieldDescription>
            </div>
            {score.trim() !== "" || maxScore.trim() !== "" ? <PerformanceContextFields value={performanceContext} onChange={setPerformanceContext} idPrefix="sac-context" /> : null}
            <Field>
              <FieldLabel htmlFor="sac-notes">Notes <span className="text-muted-foreground">(optional)</span></FieldLabel>
              <Textarea id="sac-notes" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Topics to revise or feedback from your teacher" />
            </Field>
            <FieldError>{error}</FieldError>
          </FieldGroup>
        </form>
        <SheetFooter><Button type="submit" form="sac-form">{initialRecord ? "Save changes" : "Save SAC"}</Button></SheetFooter>
      </SheetContent>
      <DiscardChangesDialog
        open={confirmingClose}
        onKeep={() => setConfirmingClose(false)}
        onDiscard={() => { setConfirmingClose(false); onOpenChange(false) }}
      />
    </Sheet>
  )
}
