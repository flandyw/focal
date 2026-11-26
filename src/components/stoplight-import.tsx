import { useEffect, useRef, useState } from "react"
import { Check, ClipboardCheck, ClipboardCopy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Textarea } from "./ui/textarea"
import { SubjectCombobox } from "./subject-combobox"
import { DiscardChangesDialog } from "./discard-changes-dialog"
import { buildStoplightPrompt, groupBy, parseStoplightResponse, type ImportedItem } from "../lib/stoplight"

/** Chatbot round trip: copy a prompt, attach the study design, paste the JSON reply back. Re-import to add the rest of a long reply. */
export function StoplightImportDialog({ open, subjects, preferredSubjects, defaultSubject, scopedSubject, onOpenChange, onImport }: {
  open: boolean
  subjects: string[]
  preferredSubjects: string[]
  defaultSubject: string
  scopedSubject?: string
  onOpenChange: (open: boolean) => void
  onImport: (subject: string, items: ImportedItem[]) => void
}) {
  const [subject, setSubject] = useState(scopedSubject ?? defaultSubject)
  const [text, setText] = useState("")
  const [items, setItems] = useState<ImportedItem[] | null>(null)
  const [error, setError] = useState<{ message: string; target?: "subject" | "json" } | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [confirmingClose, setConfirmingClose] = useState(false)
  const copyingRef = useRef(false)
  const [copying, setCopying] = useState(false)
  const groups = items ? groupBy(items, (item) => item.group) : null
  useEffect(() => () => { if (copiedTimer.current) window.clearTimeout(copiedTimer.current) }, [])

  function close() {
    if (copyingRef.current) return
    if (text.trim()) setConfirmingClose(true)
    else onOpenChange(false)
  }

  async function copyPrompt() {
    if (copyingRef.current) return
    if (!subject.trim()) return setError({ message: "Choose a subject first.", target: "subject" })
    // Clipboard writes can't be cancelled; serialize them and hold the subject until this one settles.
    copyingRef.current = true
    setCopying(true)
    try {
      await navigator.clipboard.writeText(buildStoplightPrompt(subject.trim()))
      setCopied(true)
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setShowPrompt(true)
      toast.error("Could not copy. Select the prompt below and copy it manually.")
    } finally {
      copyingRef.current = false
      setCopying(false)
    }
  }

  function review() {
    if (copyingRef.current) return
    if (!subject.trim()) return setError({ message: "Choose a subject first.", target: "subject" })
    try {
      const parsed = parseStoplightResponse(text)
      if (!parsed.length) throw new Error("none")
      setItems(parsed)
      setError(null)
    } catch {
      setItems(null)
      setError({ message: "Couldn't find any items. Paste the chatbot's full JSON reply; each item needs a name.", target: "json" })
    }
  }

  function add() {
    if (copyingRef.current || !items || !subject.trim()) return
    try { onImport(subject.trim(), items) } catch (failure) {
      setError({ message: failure instanceof Error ? failure.message : "Could not save the checklist. Your reply is still here; try again." })
      return
    }
    setText("")
    setItems(null)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true) }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import a checklist</DialogTitle>
          <DialogDescription>Drop your study design or course outline into any chatbot with this prompt, then paste its reply here to build your red, amber, and green checklist.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="stoplight-import-subject">1. Subject</FieldLabel>
            {scopedSubject ? <Input id="stoplight-import-subject" value={scopedSubject} readOnly /> : <SubjectCombobox id="stoplight-import-subject" subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={(value) => { setSubject(value); setCopied(false); setShowPrompt(false); setItems(null); setError(null) }} allowCustom required disabled={copying} aria-invalid={error?.target === "subject" || undefined} aria-describedby={error?.target === "subject" ? "stoplight-import-subject-error" : undefined} />}
            {error?.target === "subject" ? <FieldError id="stoplight-import-subject-error">{error.message}</FieldError> : null}
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>2. Copy the prompt, attach your study design, send</FieldLabel>
              <Button type="button" size="sm" variant="outline" disabled={copying || !subject.trim()} onClick={() => void copyPrompt()}>
                {copied ? <ClipboardCheck /> : <ClipboardCopy />}{copying ? "Copying…" : copied ? "Copied" : "Copy prompt"}
              </Button>
            </div>
            {showPrompt && subject.trim() ? <Textarea readOnly aria-label="Prompt to copy manually" className="max-h-64 overflow-y-auto font-mono text-xs" value={buildStoplightPrompt(subject.trim())} /> : null}
          </Field>
          <Field data-invalid={error?.target === "json" || undefined}>
            <FieldLabel htmlFor="stoplight-import-json">3. Paste the chatbot's reply or a shared checklist</FieldLabel>
            <Textarea
              id="stoplight-import-json"
              rows={5}
              className="font-mono text-xs"
              placeholder='{"groups":[{"group":"Unit 3 AOS 1","items":[{"name":"...","check":"..."}]}]}'
              value={text}
              onChange={(event) => { setText(event.target.value); setItems(null); setError(null) }}
              aria-invalid={error?.target === "json" || undefined}
              aria-describedby={error?.target === "json" ? "stoplight-import-json-error" : undefined}
            />
            {error && error.target !== "subject" ? <FieldError id="stoplight-import-json-error">{error.message}</FieldError> : <FieldDescription>Any existing items keep their ratings and links. Nothing gets added until you confirm.</FieldDescription>}
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
          <Button type="button" variant="outline" disabled={copying} onClick={close}>Cancel</Button>
          {items
            ? <Button type="button" disabled={copying || !subject.trim()} onClick={add}><Check />Add {items.length} item{items.length === 1 ? "" : "s"}</Button>
            : <Button type="button" disabled={copying || !text.trim() || !subject.trim()} onClick={review}>Review items</Button>}
        </DialogFooter>
      </DialogContent>
      <DiscardChangesDialog open={confirmingClose} onKeep={() => setConfirmingClose(false)} onDiscard={() => { setConfirmingClose(false); setText(""); setItems(null); setError(null); onOpenChange(false) }} />
    </Dialog>
  )
}
