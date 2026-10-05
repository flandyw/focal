import { useState } from "react"
import { Check, ClipboardCheck, ClipboardCopy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Textarea } from "./ui/textarea"
import { buildChatbotImportPrompt, parseTextEventResponse, type TextEventDraft } from "../../../src/lib/calendarImport"

export type ImportedTask = { title: string; date: string; minutes: number; subject?: string; detail: string }

/** The web calendar holds dated study tasks, so every imported item lands as one. */
export function CalendarChatbotImportDialog({ open, subjects, onOpenChange, onImport }: {
  open: boolean
  subjects: string[]
  onOpenChange: (open: boolean) => void
  onImport: (tasks: ImportedTask[]) => void
}) {
  const [text, setText] = useState("")
  const [drafts, setDrafts] = useState<TextEventDraft[] | null>(null)
  const [skipped, setSkipped] = useState<Set<number>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const importSubjects = subjects.map((name) => ({ id: name, name, shortCode: name }))
  const chosen = drafts?.filter((_, index) => !skipped.has(index)) ?? []

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildChatbotImportPrompt(importSubjects, []))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy the prompt. Check clipboard permission and try again.")
    }
  }

  function review() {
    try {
      const parsed = parseTextEventResponse(text, importSubjects, [])
      if (!parsed.length) throw new Error("none")
      setDrafts(parsed)
      setSkipped(new Set())
      setError(null)
    } catch {
      setDrafts(null)
      setError("Couldn't find any valid items. Paste the chatbot's full JSON reply; each item needs a title, a YYYY-MM-DD date and an HH:mm start time.")
    }
  }

  function add() {
    onImport(chosen.map((draft) => ({
      title: draft.title,
      date: draft.date,
      minutes: draft.durationMinutes,
      subject: draft.subjectIds[0],
      detail: [draft.startTime, draft.endDate && `until ${draft.endDate}`, draft.location].filter(Boolean).join(" · "),
    })))
    setText("")
    setDrafts(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="calendar-import-json">2. Paste the chatbot's reply</FieldLabel>
            <Textarea
              id="calendar-import-json"
              rows={5}
              className="font-mono text-xs"
              placeholder='{"events":[{"title":"Maths SAC", ...}]}'
              value={text}
              onChange={(event) => { setText(event.target.value); setDrafts(null); setError(null) }}
              aria-invalid={error ? true : undefined}
            />
            {error ? <FieldError>{error}</FieldError> : <FieldDescription>Nothing is added until you confirm the list below.</FieldDescription>}
          </Field>
          {drafts ? (
            <ul className="divide-y rounded-lg border" aria-label="Items to import">
              {drafts.map((draft, index) => (
                <li key={index}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-primary"
                      checked={!skipped.has(index)}
                      onChange={() => setSkipped((current) => { const next = new Set(current); if (!next.delete(index)) next.add(index); return next })}
                    />
                    <span className="min-w-0 flex-1 truncate font-medium">{draft.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{draft.date} · {draft.startTime} · {draft.durationMinutes}m</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {drafts
            ? <Button type="button" disabled={!chosen.length} onClick={add}><Check />Add {chosen.length} item{chosen.length === 1 ? "" : "s"}</Button>
            : <Button type="button" disabled={!text.trim()} onClick={review}>Review items</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
