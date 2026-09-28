import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { formatTimer, getExamTimerState } from "@/lib/exam-timer"
import { updateExamSessionConditions, type ExamTimerSession } from "@/lib/ongoing-timers"

export function ExamConditionsDialog({ session, now, onSave, onClose }: {
  session: ExamTimerSession
  now: number
  onSave: (session: ExamTimerSession) => void
  onClose: () => void
}) {
  const [original] = useState(() => [session.readingMinutes, session.writingMinutes, session.marks].join("/"))
  const [reading, setReading] = useState(String(session.readingMinutes))
  const [writing, setWriting] = useState(String(session.writingMinutes))
  const [marks, setMarks] = useState(String(session.marks))
  const [submitted, setSubmitted] = useState(false)
  let preview: ExamTimerSession | undefined
  let error: string | undefined
  try {
    if (original !== [session.readingMinutes, session.writingMinutes, session.marks].join("/")) throw new Error("Exam conditions changed on another device. Close and reopen this editor to use the latest settings.")
    preview = updateExamSessionConditions(session, {
      readingMinutes: reading.trim() ? Number(reading) : NaN,
      writingMinutes: writing.trim() ? Number(writing) : NaN,
      marks: marks.trim() ? Number(marks) : NaN,
    }, now)
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Check the exam conditions."
  }
  const timer = preview ? getExamTimerState(preview.pausedAt ?? now, preview.startedAt, preview.readingMinutes, preview.writingMinutes, preview.marks) : undefined

  function save(event: FormEvent) {
    event.preventDefault()
    setSubmitted(true)
    if (!preview) return
    onSave(updateExamSessionConditions(session, preview, Date.now()))
    onClose()
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader>
        <DialogTitle>Edit exam conditions</DialogTitle>
        <DialogDescription>{session.pausedAt !== undefined ? "Your exam stays paused while you edit." : "Your timer keeps running while you edit."} Writing time already used and question progress are preserved.</DialogDescription>
      </DialogHeader>
      <form id="exam-conditions-form" onSubmit={save} noValidate className="grid gap-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field><FieldLabel htmlFor="edit-reading">Reading (min)</FieldLabel><Input id="edit-reading" type="number" min="0" max="180" step="0.5" value={reading} onChange={(event) => setReading(event.target.value)} autoFocus required /></Field>
          <Field><FieldLabel htmlFor="edit-writing">Writing (min)</FieldLabel><Input id="edit-writing" type="number" min="1" max="360" step="0.5" value={writing} onChange={(event) => setWriting(event.target.value)} required /></Field>
          <Field><FieldLabel htmlFor="edit-marks">Total marks</FieldLabel><Input id="edit-marks" type="number" min="0.5" max="500" step="0.5" value={marks} onChange={(event) => setMarks(event.target.value)} required /></Field>
        </div>
        {timer && preview ? <div className="rounded-lg border bg-muted/30 p-4 text-sm">
          <p className="font-medium">After saving: {timer.phase === "overtime" ? `${formatTimer(timer.overtimeSeconds)} overtime` : `${formatTimer(timer.remainingSeconds)} ${timer.phase} remaining`}</p>
          <p className="mt-1 text-muted-foreground">{(preview.writingMinutes / preview.marks).toFixed(2)} minutes per mark · {preview.marks} marks</p>
          {timer.phase === "overtime" ? <p className="mt-2">The new duration is shorter than the time already used. Your exam will record overtime.</p> : null}
        </div> : null}
        <p className="text-sm text-muted-foreground">Changes save with this session across devices. Focal’s planned duration updates while keeping your recorded study intervals.</p>
        {error ? <FieldError role={submitted ? "alert" : undefined}>{error}</FieldError> : null}
      </form>
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="exam-conditions-form">Save conditions</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
