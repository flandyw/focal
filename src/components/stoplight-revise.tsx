import { useState } from "react"
import { Check, ClipboardCheck, ClipboardCopy } from "lucide-react"
import { toast } from "sonner"

import { DiscardChangesDialog } from "./discard-changes-dialog"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Tabs, TabsList, TabsTrigger } from "./ui/tabs"
import { Textarea } from "./ui/textarea"
import template from "../lib/worksheet-template.tex?raw"
import type { CurriculumArea, StoplightRating } from "../lib/learning-workspace"
import { buildRevisionPrompt, groupBy, itemGroup, parseRatingsResponse, type ItemEvidence } from "../lib/stoplight"
import { Checkbox } from "./ui/checkbox"
import { Label } from "./ui/label"

/** Chatbot round trip: copy a tutoring prompt for the subject's checklist, revise, paste the suggested ratings back. */
export function StoplightReviseDialog({ open, subject, items, evidence, onOpenChange, onApply }: {
  open: boolean
  subject: string
  items: CurriculumArea[]
  evidence: Map<string, ItemEvidence>
  onOpenChange: (open: boolean) => void
  onApply: (ratings: Map<string, StoplightRating>) => void
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [worksheet, setWorksheet] = useState(false)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [promptItems, setPromptItems] = useState<CurriculumArea[] | null>(null)
  const [confirmingClose, setConfirmingClose] = useState(false)
  function close() {
    if (text.trim()) setConfirmingClose(true)
    else onOpenChange(false)
  }
  const groups = groupBy(items, itemGroup)
  const selected = items.filter((item) => !skipped.has(itemGroup(item)))

  function toggle(group: string) {
    setSkipped((current) => { const next = new Set(current); if (!next.delete(group)) next.add(group); return next })
    setCopied(false)
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildRevisionPrompt(subject, selected, evidence, worksheet ? template : undefined))
      setPromptItems(selected)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy the prompt. Check clipboard permission and try again.")
    }
  }

  function apply() {
    let ratings = new Map<string, StoplightRating>()
    try { ratings = parseRatingsResponse(text, promptItems ?? selected) } catch { /* reported below */ }
    if (!ratings.size) return setError("Couldn't find any ratings. Paste the chatbot's JSON reply after telling it you're done.")
    try { onApply(ratings) } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save ratings. Your reply is still here; try again.")
      return
    }
    toast.success(`Updated ${ratings.size} item${ratings.size === 1 ? "" : "s"}`)
    setText("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) close(); else onOpenChange(true) }}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revise {subject} with a chatbot</DialogTitle>
          <DialogDescription>Quiz in chat, or get a printable XeLaTeX worksheet and upload it back to be marked. Either way the chatbot suggests a red, amber or green rating for each item it tested.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Tabs value={worksheet ? "worksheet" : "chat"} onValueChange={(value) => { setWorksheet(value === "worksheet"); setCopied(false) }}>
            <TabsList><TabsTrigger value="chat">Quiz in chat</TabsTrigger><TabsTrigger value="worksheet">Worksheet</TabsTrigger></TabsList>
          </Tabs>
          <Field>
            <FieldLabel>1. Choose what to revise</FieldLabel>
            <ul className="divide-y rounded-lg border" aria-label="Groups to include">
              {[...groups].map(([group, groupItems]) => (
                <li key={group}>
                  <Label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <Checkbox disabled={!!text.trim()} checked={!skipped.has(group)} onCheckedChange={() => toggle(group)} />
                    <span className="min-w-0 flex-1 truncate font-medium">{group}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{groupItems.length} item{groupItems.length === 1 ? "" : "s"}</span>
                  </Label>
                </li>
              ))}
            </ul>
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>2. Copy the prompt and paste it into a chatbot that can run code</FieldLabel>
              <Button type="button" size="sm" variant="outline" disabled={!selected.length || !!text.trim()} onClick={() => void copyPrompt()}>
                {copied ? <ClipboardCheck /> : <ClipboardCopy />}{copied ? "Copied" : "Copy prompt"}
              </Button>
            </div>
            {promptItems ? <p role="status" className="text-xs text-muted-foreground">Pasted ratings use the {promptItems.length} items in your last copied prompt.</p> : null}
            <FieldDescription>Includes {selected.length} items with your current ratings, open mistakes and marks{worksheet ? ", plus the worksheet template" : ""}.</FieldDescription>
          </Field>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="stoplight-revise-json">{worksheet ? "3. Upload your completed worksheet, then paste the marking reply" : `3. Say "done", then paste the chatbot's reply`}</FieldLabel>
            <Textarea id="stoplight-revise-json" rows={4} className="font-mono text-xs" placeholder='{"ratings":[{"n":1,"rating":"amber","marks":"2/3"}]}'
              value={text} onChange={(event) => { setText(event.target.value); setError(null) }} aria-invalid={error ? true : undefined} />
            {error ? <FieldError>{error}</FieldError> : <FieldDescription>Only the items it rated change. Clear this reply before choosing new groups or copying another prompt.</FieldDescription>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={close}>Cancel</Button>
          <Button type="button" disabled={!text.trim() || !(promptItems ?? selected).length} onClick={apply}><Check />Apply ratings</Button>
        </DialogFooter>
      </DialogContent>
      <DiscardChangesDialog open={confirmingClose} onKeep={() => setConfirmingClose(false)} onDiscard={() => { setConfirmingClose(false); setText(""); setError(null); onOpenChange(false) }} />
    </Dialog>
  )
}
