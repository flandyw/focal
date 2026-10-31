import { useRef, useState } from "react"
import { Check, ClipboardCheck, ClipboardCopy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Checkbox } from "./ui/checkbox"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Label } from "./ui/label"
import { Textarea } from "./ui/textarea"
import { DiscardChangesDialog } from "./discard-changes-dialog"
import { buildChatbotImportPrompt, parseTextEventResponse, type TextEventDraft } from "../lib/calendarImport"

/** Events become calendar events; study sessions become dated study tasks. */
export function CalendarChatbotImportDialog({ open, subjects, onOpenChange, onImport }: {
  open: boolean
  subjects: string[]
  onOpenChange: (open: boolean) => void
  onImport: (drafts: TextEventDraft[]) => Promise<void>
}) {
  const [text, setText] = useState("")
  const [drafts, setDrafts] = useState<TextEventDraft[] | null>(null)
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [showPrompt, setShowPrompt] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const [imported, setImported] = useState<Set<number>>(new Set())
  const importSubjects = subjects.map((name) => ({ id: name, name, shortCode: name }))
  const prompt = buildChatbotImportPrompt(importSubjects, [])
  const chosen = drafts?.map((draft, index) => ({ draft, index })).filter(({ index }) => !skipped.has(index) && !imported.has(index)) ?? []

  function close() {
    if (saving) return
    if (text.trim()) setConfirmingClose(true)
    else onOpenChange(false)
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setShowPrompt(true)
      toast.error("Could not copy. Select the prompt below and copy it manually.")
    }
  }

  function review() {
    try {
      const parsed = parseTextEventResponse(text, importSubjects, [])
      if (!parsed.length) throw new Error("none")
      setDrafts(parsed)
      setSkipped(new Set())
      setImported(new Set())
      setError(null)
    } catch {
      setDrafts(null)
      setError("Couldn't find any valid items. Paste the chatbot's full JSON reply; each item needs a title, a YYYY-MM-DD date and an HH:mm start time.")
    }
  }

  async function add() {
    if (savingRef.current || !chosen.length) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      for (const { draft, index } of chosen) {
        await onImport([draft])
        setImported((current) => new Set(current).add(index))
      }
      toast(`${chosen.length} item${chosen.length === 1 ? "" : "s"} added to your calendar`)
      setText("")
      setDrafts(null)
      setImported(new Set())
      onOpenChange(false)
    } catch (error) {
      setError(`${error instanceof Error ? error.message : "Could not save an item."} Items marked Added won't be added again.`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import from chatbot</DialogTitle>
          <DialogDescription>Send the prompt to any chatbot with your timetable or notice, then paste its reply to add the items to your calendar.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>1. Copy the prompt</FieldLabel>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyPrompt()}>
                {copied ? <ClipboardCheck /> : <ClipboardCopy />}{copied ? "Copied" : "Copy prompt"}
              </Button>
            </div>
          </Field>
          {showPrompt ? <pre tabIndex={0} aria-label="Prompt to copy manually" className="max-h-64 overflow-auto rounded-lg border p-3 text-xs whitespace-pre-wrap select-all">{prompt}</pre> : null}
          <Field data-invalid={error && !drafts ? true : undefined}>
            <FieldLabel htmlFor="calendar-import-json">2. Paste the chatbot's reply</FieldLabel>
            <Textarea
              id="calendar-import-json"
              rows={5}
              disabled={saving || imported.size > 0}
              className="font-mono text-xs"
              placeholder='{"events":[{"title":"Maths SAC", ...}]}'
              value={text}
              onChange={(event) => { setText(event.target.value); setDrafts(null); setError(null) }}
              aria-invalid={error && !drafts ? true : undefined}
            />
            {error ? <FieldError>{error}</FieldError> : <FieldDescription>Nothing is added until you confirm the list below.</FieldDescription>}
          </Field>
          {drafts ? (
            <ul className="divide-y rounded-lg border" aria-label="Items to import">
              {drafts.map((draft, index) => (
                <li key={index}>
                  <Label className="flex flex-wrap cursor-pointer gap-3 px-3 py-2 font-normal">
                    <Checkbox
                      checked={imported.has(index) || !skipped.has(index)}
                      disabled={saving || imported.has(index)}
                      onCheckedChange={() => setSkipped((current) => { const next = new Set(current); if (!next.delete(index)) next.add(index); return next })}
                    />
                    <span className="min-w-0 flex-1 basis-32 break-words font-medium">{draft.title}{draft.subjectId ? <span className="block text-xs font-normal text-muted-foreground">{draft.subjectId}</span> : null}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{imported.has(index) ? "Added" : `${draft.date} · ${draft.startTime} · ${draft.durationMinutes}m`}</span>
                  </Label>
                </li>
              ))}
            </ul>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={close}>Cancel</Button>
          {drafts
            ? <Button type="button" disabled={saving || !chosen.length} onClick={() => void add()}><Check />{saving ? "Adding…" : `Add ${chosen.length} item${chosen.length === 1 ? "" : "s"}`}</Button>
            : <Button type="button" disabled={!text.trim()} onClick={review}>Review items</Button>}
        </DialogFooter>
      </DialogContent>
      <DiscardChangesDialog open={confirmingClose} onKeep={() => setConfirmingClose(false)} onDiscard={() => { setConfirmingClose(false); setText(""); setDrafts(null); setImported(new Set()); onOpenChange(false) }} />
    </Dialog>
  )
}
