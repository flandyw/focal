import { useId, useRef, useState } from "react"
import { localStudyTime, pastStudyBlocks, type PastStudyLog } from "../../lib/pastStudy"

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
  const input = "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  let preview = ""
  try {
    const blocks = pastStudyBlocks(rows)
    const minutes = blocks.reduce((sum, block) => sum + (Date.parse(block.end) - Date.parse(block.start)) / 60000, 0)
    preview = `${minutes} minutes of study · Finished ${new Date(blocks[blocks.length - 1].end).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`
  } catch { /* Validation is shown on submit, not while typing. */ }

  return <form className="grid gap-5" onSubmit={async (event) => {
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
      <label htmlFor={`${id}-subject`} className="text-sm font-medium">Subject
        <select autoFocus id={`${id}-subject`} className={input} value={subjectId} onChange={(event) => setSubjectId(event.target.value)} required>
          <option value="" disabled>Choose a subject</option>
          {subjects.map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}
        </select>
      </label>
      <div className="grid gap-3">
        <p className="text-sm text-muted-foreground">Enter actual study time, not breaks. Studied across midnight? The finish date is calculated for you.</p>
        {rows.map((row, index) => <div key={index} className="grid gap-3 rounded-lg border p-3 sm:grid-cols-[1fr_8rem]">
          <label htmlFor={`${id}-start-${index}`} className="text-sm font-medium">{rows.length > 1 ? `Block ${index + 1} started` : "Started"}
            <input id={`${id}-start-${index}`} className={input} type="datetime-local" required value={row.start} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, start: event.target.value } : item))} />
          </label>
          <label htmlFor={`${id}-minutes-${index}`} className="text-sm font-medium">Minutes studied
            <input id={`${id}-minutes-${index}`} className={input} type="number" min="1" max="1440" step="1" required value={row.minutes} onChange={(event) => setRows(rows.map((item, i) => i === index ? { ...item, minutes: event.target.value } : item))} />
          </label>
          {rows.length > 1 && <button type="button" className="text-left text-sm underline" onClick={() => setRows(rows.filter((_, i) => i !== index))}>Remove block {index + 1}</button>}
        </div>)}
        <button type="button" className="justify-self-start text-sm font-medium underline underline-offset-4" disabled={rows.length >= 100} onClick={() => setRows([...rows, { start: "", minutes: "30" }])}>Took a break? Add another study block</button>
      </div>
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">Title and notes (optional)</summary>
        <label className="mt-3 block text-sm" htmlFor={`${id}-title`}>Title<input id={`${id}-title`} className={input} maxLength={512} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Practice questions" /></label>
        <label className="mt-3 block text-sm" htmlFor={`${id}-notes`}>Notes<textarea id={`${id}-notes`} className={input} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
      </details>
    </fieldset>
    {preview && <p className="rounded-lg bg-muted p-3 text-sm tabular-nums" role="status">{preview}</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex justify-end gap-2">
      <button type="button" disabled={busy} onClick={onCancel} className="rounded-md border px-4 py-2 text-sm">Cancel</button>
      <button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">{busy ? "Saving…" : "Log study"}</button>
    </div>
  </form>
}
