import { useId, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"
import { localStudyTime, pastStudyBlocks, type PastStudyLog } from "../../lib/pastStudy"
import { Button } from "../ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "../ui/collapsible"
import { Field, FieldGroup, FieldLabel } from "../ui/field"
import { Input } from "../ui/input"
import { NativeSelect, NativeSelectOption } from "../ui/native-select"
import { Textarea } from "../ui/textarea"

// Native fields keep the same small, keyboard-accessible flow on desktop and web.
export function PastStudyForm({ subjects, onSave, onCancel }: {
  subjects: { id: string; name: string }[]
  onSave: (log: PastStudyLog) => Promise<void>
  onCancel: () => void
}) {
  const id = useId()
  const [subjectId, setSubjectId] = useState(subjects.length === 1 ? subjects[0].id : "")
  const [rows, setRows] = useState(() => [{ start: localStudyTime(new Date(Date.now() - 60 * 60000)), minutes: "60" }])
  const [title, setTitle] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const saving = useRef(false)
  let preview = ""
  try {
    const blocks = pastStudyBlocks(rows)
    const minutes = blocks.reduce((sum, block) => sum + (Date.parse(block.end) - Date.parse(block.start)) / 60000, 0)
    preview = `${minutes} minutes of study · Finished ${new Date(blocks[blocks.length - 1].end).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
  } catch { /* Validation is shown on submit, not while typing. */ }

  return <form className="grid gap-5" onChange={() => setError("")} onSubmit={async (event) => {
    event.preventDefault()
    if (saving.current) return
    setError("")
    try {
      const subject = subjects.find((item) => item.id === subjectId)
      if (!subject) throw new Error("Choose a subject.")
      const blocks = pastStudyBlocks(rows)
      saving.current = true
      setBusy(true)
      await onSave({ subjectId, title: title.trim() || `${subject.name} study`, notes: notes.trim() || undefined, blocks })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save. Your entries are still here; try again.")
    } finally {
      saving.current = false
      setBusy(false)
    }
  }}>
    <fieldset disabled={busy} className="grid min-w-0 gap-5">
      {!subjects.length ? <p role="status" className="text-sm text-muted-foreground">Add a subject in Settings before logging study.</p> : null}
      <Field>
        <FieldLabel htmlFor={`${id}-subject`}>Subject</FieldLabel>
        <NativeSelect autoFocus id={`${id}-subject`} className="w-full" value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required>
          <NativeSelectOption value="" disabled>Choose a subject</NativeSelectOption>
          {subjects.map((subject) => <NativeSelectOption key={subject.id} value={subject.id}>{subject.name}</NativeSelectOption>)}
        </NativeSelect>
      </Field>
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">Enter actual study time, not breaks. Studied across midnight? The finish date is calculated for you.</p>
        {rows.map((row, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_8rem]">
          <Field>
            <FieldLabel htmlFor={`${id}-start-${index}`}>{rows.length > 1 ? `Block ${index + 1} started` : "Started"}</FieldLabel>
            <Input id={`${id}-start-${index}`} type="datetime-local" required value={row.start} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, start: event.target.value } : item))} />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${id}-minutes-${index}`}>Minutes studied</FieldLabel>
            <Input id={`${id}-minutes-${index}`} type="number" min="1" max="1440" step="1" required value={row.minutes} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, minutes: event.target.value } : item))} />
          </Field>
          {rows.length > 1 && <Button type="button" variant="link" className="h-auto justify-self-start p-0" onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove block {index + 1}</Button>}
        </div>)}
        <Button type="button" variant="link" className="h-auto justify-self-start p-0" disabled={rows.length >= 100} onClick={() => setRows([...rows, { start: "", minutes: "30" }])}>Took a break? Add another study block</Button>
      </div>
      <Collapsible className="rounded-lg border p-3">
        <CollapsibleTrigger className="group/trigger flex w-full items-center justify-between text-left text-sm font-medium">Title and notes (optional)<ChevronDown className="size-4 transition-transform group-data-[panel-open]/trigger:rotate-180" /></CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          <FieldGroup className="mt-3">
            <Field>
              <FieldLabel htmlFor={`${id}-title`}>Title</FieldLabel>
              <Input id={`${id}-title`} maxLength={512} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Practice questions" />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-notes`}>Notes</FieldLabel>
              <Textarea id={`${id}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} />
            </Field>
          </FieldGroup>
        </CollapsibleContent>
      </Collapsible>
    </fieldset>
    {preview && <p className="rounded-lg bg-muted p-3 text-sm tabular-nums" role="status">{preview}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
      <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={busy || !subjects.length}>{busy ? "Saving…" : "Log study"}</Button>
    </div>
  </form>
}
