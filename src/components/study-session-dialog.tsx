import { useRef, useState } from "react"
import { CalendarPlus, Copy, Play, Plus, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Textarea } from "./ui/textarea"
import { continuableToday, sessionBlocks } from "../lib/day-plan"
import { studySubjectOptions } from "../lib/studySubjects"
import { isDeleted, isPaused, isRunning, type CanonicalStudySession, type StudySessionEdit } from "../lib/sync/sessionContract"
import { EVENT_TYPES, type CalendarEvent, type EventType } from "../lib/types"

function localTime(iso: string) {
  const date = new Date(iso)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, -1).replace(/:00\.000$/, "").replace(/\.000$/, "")
}

export function StudySessionDialog({ session, subjects, onClose, onEdit, onDuplicate, onRemove, onConvert, onContinue, creating = false, onCreate, allowConvert = true }: {
  session: CanonicalStudySession
  creating?: boolean
  allowConvert?: boolean
  onCreate?: (patch: StudySessionEdit) => Promise<void>
  subjects: string[]
  onClose: () => void
  onEdit: (session: CanonicalStudySession, patch: StudySessionEdit) => Promise<void>
  onDuplicate: (patch: StudySessionEdit) => Promise<void>
  onRemove: (session: CanonicalStudySession) => Promise<void>
  onConvert: (session: CanonicalStudySession, events: CalendarEvent[]) => Promise<void>
  /** Pick finished study back up in the timer, keeping its time. Offered for study finished today. */
  onContinue?: (session: CanonicalStudySession) => void
}) {
  const legacy = session.metadata.legacy_metadata
  const metadata = { ...(legacy && typeof legacy === "object" && !Array.isArray(legacy) ? legacy as Record<string, unknown> : {}), ...session.metadata }
  delete metadata.legacy_metadata
  const [openedRevision] = useState(session.revision)
  const [title, setTitle] = useState(session.title)
  const [subject, setSubject] = useState(session.subject_id ?? "")
  const [notes, setNotes] = useState(typeof metadata.description === "string" ? metadata.description : "")
  const [topics, setTopics] = useState(Array.isArray(metadata.topics) ? metadata.topics.filter((topic) => typeof topic === "string").join("\n") : "")
  const [blocks, setBlocks] = useState(() => sessionBlocks(session).map((block) => ({ id: crypto.randomUUID(), start: localTime(block.start), end: localTime(block.end) })))
  const [converting, setConverting] = useState(false)
  const [eventType, setEventType] = useState<EventType>("event")
  const [location, setLocation] = useState("")
  const busyRef = useRef(false)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const options = studySubjectOptions([...subjects, ...(subject ? [subject] : [])])
  const totalMinutes = blocks.reduce((sum, block) => sum + Math.max(0, (Date.parse(block.end) - Date.parse(block.start)) / 60_000 || 0), 0)

  function updateBlock(id: string, patch: Partial<{ start: string; end: string }>) {
    setBlocks((current) => current.map((block) => block.id === id ? { ...block, ...patch } : block))
    setError(null)
  }

  function movePlan(days: number | null) {
    const first = blocks.map((block) => Date.parse(block.start)).filter(Number.isFinite).sort((a, b) => a - b)[0]
    if (first === undefined) return
    const target = new Date()
    if (days !== null) {
      target.setDate(target.getDate() + days)
      const old = new Date(first)
      target.setHours(old.getHours(), old.getMinutes(), 0, 0)
    } else target.setSeconds(0, 0)
    const delta = target.getTime() - first
    setBlocks((current) => current.map((block) => ({ ...block,
      start: Number.isFinite(Date.parse(block.start)) ? localTime(new Date(Date.parse(block.start) + delta).toISOString()) : block.start,
      end: Number.isFinite(Date.parse(block.end)) ? localTime(new Date(Date.parse(block.end) + delta).toISOString()) : block.end })))
    setError(null)
  }

  function patch(): StudySessionEdit {
    if (!title.trim() || title.trim().length > 512) throw new Error("Enter a title of 1–512 characters.")
    if (!blocks.length || blocks.length > 100) throw new Error("Enter 1–100 time blocks.")
    const sorted = blocks.map((block) => {
      const start = new Date(block.start), end = new Date(block.end)
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start || end.getTime() - start.getTime() > 86_400_000) {
        throw new Error("Each block must have a valid start and end, last up to 24 hours, and end after it starts.")
      }
      return { start: start.toISOString(), end: end.toISOString() }
    }).toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))
    if (sorted.some((block, index) => index > 0 && Date.parse(block.start) < Date.parse(sorted[index - 1].end))) throw new Error("Time blocks must not overlap.")
    const details = { ...metadata, subjectIds: subject ? [subject] : [], description: notes.trim(), topics: [...new Set(topics.split("\n").map((topic) => topic.trim()).filter(Boolean))], schedule: session.started_at === null ? { blocks: sorted } : metadata.schedule ?? { blocks: sorted } }
    return { title: title.trim(), subject_id: subject || null, blocks: sorted, metadata: legacy ? { ...session.metadata, ...details, legacy_metadata: details } : details }
  }

  async function submit(action: "save" | "duplicate" | "delete" | "convert") {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true)
    setError(null)
    try {
      if (!creating && session.revision !== openedRevision) throw new Error("This session changed while you were editing. Close and reopen it before saving.")
      if (isDeleted(session) || isRunning(session) || isPaused(session)) throw new Error("This session has changed. Close the editor and stop its timer before editing.")
      if (action === "convert" && (session.completed || session.started_at !== null)) throw new Error("Only planned study can be converted to an event.")
      if (action === "delete") await onRemove(session)
      else {
        const changes = patch()
        if (action === "save") {
          if (creating) {
            if (!onCreate) throw new Error("Planning is unavailable. Reopen the timer and try again.")
            await onCreate(changes)
          } else await onEdit(session, changes)
        }
        if (action === "duplicate") await onDuplicate(changes)
        if (action === "convert") {
          const now = new Date().toISOString()
          const description = [notes.trim(), topics.trim() ? `Topics:\n${topics.trim()}` : ""].filter(Boolean).join("\n\n")
          const events = await Promise.all(changes.blocks!.map(async (block, index) => {
            // ponytail: stable ids make retries safe even after reopening; one event per block preserves breaks.
            const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`focal:study-event:${session.id}:${index}`)))
            const hex = Array.from(hash.slice(0, 16), (byte) => byte.toString(16).padStart(2, "0")).join("")
            const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
            return {
              id,
              title: changes.title!, description: description || undefined, subjectId: subject || undefined,
              startTime: block.start, endTime: block.end, eventType, location: location.trim() || undefined,
              isFinished: false, created_at: now, updated_at: now,
            }
          }))
          await onConvert(session, events)
        }
      }
      toast({ save: creating ? "Study session planned" : "Study session updated", duplicate: "Study session duplicated", delete: "Study session deleted", convert: "Study session converted to event" }[action])
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save that change.")
    } finally { busyRef.current = false; setBusy(false) }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose() }}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{converting ? "Convert study to event" : creating ? "Plan study session" : "Edit study session"}</DialogTitle>
          <DialogDescription>{converting ? "Save these details as calendar events and remove the planned study session. Each time block becomes a separate event." : creating ? "Schedule one or more study blocks with breaks. You can start the same plan here or in Folio." : "Change the details, reschedule study, or split it into blocks with breaks."}</DialogDescription>
        </DialogHeader>
        <fieldset disabled={busy} className="min-w-0">
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="session-title">Title</FieldLabel>
              <Input autoFocus id="session-title" maxLength={512} value={title} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="session-subject">Subject</FieldLabel>
              <Select items={[{ value: "__none", label: "No subject" }, ...options.map((option) => ({ value: option.id, label: option.name }))]} value={subject || "__none"} onValueChange={(value) => setSubject(!value || value === "__none" ? "" : value)}>
                <SelectTrigger id="session-subject" className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="__none">No subject</SelectItem>{options.map((option) => <SelectItem key={option.id} value={option.id}>{option.name}</SelectItem>)}</SelectContent>
              </Select>
            </Field>
            <div className="grid gap-3" role="group" aria-label="Time blocks">
              <p className="text-sm font-medium">Time blocks · {Math.round(totalMinutes)} min total</p>
              {session.started_at === null ? <div className="flex flex-wrap gap-2">
                <Button size="xs" variant="outline" onClick={() => movePlan(0)}>Move to today</Button>
                <Button size="xs" variant="outline" onClick={() => movePlan(1)}>Move to tomorrow</Button>
                <Button size="xs" variant="outline" onClick={() => movePlan(null)}>Move to now</Button>
              </div> : null}
              {blocks.map((block, index) => (
                <div key={block.id} className="grid gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between"><span className="text-xs font-medium">Block {index + 1}</span><Button aria-label={`Remove block ${index + 1}`} disabled={blocks.length === 1} size="icon-xs" variant="ghost" onClick={() => setBlocks((current) => current.filter((item) => item.id !== block.id))}><Trash2 /></Button></div>
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <Field className="min-w-0"><FieldLabel htmlFor={`session-start-${block.id}`}>Start</FieldLabel><Input className="min-w-0 w-full" id={`session-start-${block.id}`} type="datetime-local" step={session.started_at === null ? 60 : "0.001"} value={block.start} onChange={(e) => updateBlock(block.id, { start: e.target.value })} /></Field>
                    <Field className="min-w-0"><FieldLabel htmlFor={`session-end-${block.id}`}>End</FieldLabel><Input className="min-w-0 w-full" id={`session-end-${block.id}`} type="datetime-local" step={session.started_at === null ? 60 : "0.001"} value={block.end} onChange={(e) => updateBlock(block.id, { end: e.target.value })} /></Field>
                  </div>
                  <div className="flex flex-wrap gap-1" role="group" aria-label={`Block ${index + 1} duration`}>
                    {[15, 25, 30, 45, 60, 90, 120, 180].map((minutes) => <Button key={minutes} size="xs" variant="outline" disabled={!Number.isFinite(Date.parse(block.start))} onClick={() => updateBlock(block.id, { end: localTime(new Date(Date.parse(block.start) + minutes * 60_000).toISOString()) })}>{minutes}m</Button>)}
                  </div>
                </div>
              ))}
              <Button variant="outline" disabled={blocks.length >= 100 || !Number.isFinite(Date.parse(blocks.at(-1)?.end ?? ""))} onClick={() => {
                const start = Date.parse(blocks.at(-1)!.end) + 15 * 60_000
                setBlocks((current) => [...current, { id: crypto.randomUUID(), start: localTime(new Date(start).toISOString()), end: localTime(new Date(start + 30 * 60_000).toISOString()) }])
              }}><Plus />Add time block</Button>
            </div>
            <Field><FieldLabel htmlFor="session-notes">Notes</FieldLabel><Textarea id="session-notes" rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <Field><FieldLabel htmlFor="session-topics">Topics <span className="text-muted-foreground">(one per line)</span></FieldLabel><Textarea id="session-topics" rows={3} value={topics} onChange={(e) => setTopics(e.target.value)} /></Field>
            {converting ? <div className="grid gap-3 sm:grid-cols-2">
              <Field><FieldLabel htmlFor="session-event-type">Event type</FieldLabel><Select items={EVENT_TYPES} value={eventType} onValueChange={(value) => value && setEventType(value as EventType)}><SelectTrigger id="session-event-type" className="w-full"><SelectValue /></SelectTrigger><SelectContent>{EVENT_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent></Select></Field>
              <Field><FieldLabel htmlFor="session-location">Location</FieldLabel><Input id="session-location" value={location} onChange={(e) => setLocation(e.target.value)} /></Field>
            </div> : null}
            {error ? <FieldError>{error}</FieldError> : null}
          </FieldGroup>
        </fieldset>
        <DialogFooter className="flex-wrap sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {creating ? null : converting ? <Button disabled={busy} variant="outline" onClick={() => setConverting(false)}>Back to study</Button> : <>
              <Button disabled={busy} variant={confirmDelete ? "destructive" : "outline"} onClick={() => confirmDelete ? void submit("delete") : setConfirmDelete(true)}><Trash2 />{confirmDelete ? "Delete for good?" : "Delete"}</Button>
              <Button disabled={busy} variant="outline" onClick={() => submit("duplicate")}><Copy />Duplicate</Button>
              {onContinue && continuableToday(session) ? <Button disabled={busy} variant="outline" onClick={() => onContinue(session)}><Play />Continue</Button> : null}
              {allowConvert && !session.completed && session.started_at === null ? <Button disabled={busy} variant="outline" onClick={() => { setConverting(true); setConfirmDelete(false) }}><CalendarPlus />Convert to event</Button> : null}
            </>}
          </div>
          <div className="flex gap-1.5">
            <Button disabled={busy} variant="outline" onClick={onClose}>Cancel</Button>
            <Button disabled={busy} onClick={() => submit(converting ? "convert" : "save")}>{busy ? "Saving…" : converting ? "Convert to event" : creating ? "Plan session" : "Save changes"}</Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
