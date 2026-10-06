import { useState } from "react"
import { Check, ClipboardCheck, ClipboardCopy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Textarea } from "./ui/textarea"
import { SubjectCombobox } from "./subject-combobox"
import { buildStoplightPrompt, groupBy, parseStoplightResponse, type ImportedItem } from "../lib/stoplight"

/** Chatbot round trip: copy a prompt, attach the study design, paste the JSON reply back. Re-import to add the rest of a long reply. */
export function StoplightImportDialog({ open, subjects, preferredSubjects, defaultSubject, onOpenChange, onImport }: {
  open: boolean
  subjects: string[]
  preferredSubjects: string[]
  defaultSubject: string
  onOpenChange: (open: boolean) => void
  onImport: (subject: string, items: ImportedItem[]) => void
}) {
  const [subject, setSubject] = useState(defaultSubject)
  const [text, setText] = useState("")
  const [items, setItems] = useState<ImportedItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const groups = items ? groupBy(items, (item) => item.group) : null

  async function copyPrompt() {
    if (!subject.trim()) return setError("Choose a subject first.")
    try {
      await navigator.clipboard.writeText(buildStoplightPrompt(subject.trim()))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy the prompt. Check clipboard permission and try again.")
    }
  }

  function review() {
    try {
      const parsed = parseStoplightResponse(text)
      if (!parsed.length) throw new Error("none")
      setItems(parsed)
      setError(null)
    } catch {
      setItems(null)
      setError("Couldn't find any items. Paste the chatbot's full JSON reply; each item needs a name.")
    }
  }

  function add() {
    if (!items || !subject.trim()) return
    onImport(subject.trim(), items)
    setText("")
    setItems(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a checklist</DialogTitle>
          <DialogDescription>Give any chatbot your study design or course outline with this prompt, then paste its reply to build a red, amber and green checklist.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="stoplight-import-subject">1. Subject</FieldLabel>
            <SubjectCombobox id="stoplight-import-subject" subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={(value) => { setSubject(value); setError(null) }} allowCustom required />
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>2. Copy the prompt, attach your study design, send</FieldLabel>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyPrompt()}>
                {copied ? <ClipboardCheck /> : <ClipboardCopy />}{copied ? "Copied" : "Copy prompt"}
              </Button>
            </div>
          </Field>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="stoplight-import-json">3. Paste the chatbot's reply</FieldLabel>
            <Textarea
              id="stoplight-import-json"
              rows={5}
              className="font-mono text-xs"
              placeholder='{"groups":[{"group":"Unit 3 AOS 1","items":[{"name":"...","check":"..."}]}]}'
              value={text}
              onChange={(event) => { setText(event.target.value); setItems(null); setError(null) }}
              aria-invalid={error ? true : undefined}
            />
            {error ? <FieldError>{error}</FieldError> : <FieldDescription>Existing items keep their ratings and links. Nothing is added until you confirm.</FieldDescription>}
          </Field>
          {groups ? (
            <ul className="divide-y rounded-lg border" aria-label="Groups to import">
              {[...groups].map(([group, groupItems]) => (
                <li key={group} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 truncate font-medium">{group}</span>
                  <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{groupItems.length} item{groupItems.length === 1 ? "" : "s"}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {items
            ? <Button type="button" disabled={!subject.trim()} onClick={add}><Check />Add {items.length} item{items.length === 1 ? "" : "s"}</Button>
            : <Button type="button" disabled={!text.trim()} onClick={review}>Review items</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
