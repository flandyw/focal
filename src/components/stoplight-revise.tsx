import { useState } from "react"
import { Check, ClipboardCheck, ClipboardCopy } from "lucide-react"
import { toast } from "sonner"

import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Textarea } from "./ui/textarea"
import type { CurriculumArea, StoplightRating } from "../lib/learning-workspace"
import { buildRevisionPrompt, groupBy, itemGroup, parseRatingsResponse, type ItemEvidence } from "../lib/stoplight"

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
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const groups = groupBy(items, itemGroup)
  const selected = items.filter((item) => !skipped.has(itemGroup(item)))

  function toggle(group: string) {
    setSkipped((current) => { const next = new Set(current); if (!next.delete(group)) next.add(group); return next })
    setCopied(false)
  }

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(buildRevisionPrompt(subject, selected, evidence))
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy the prompt. Check clipboard permission and try again.")
    }
  }

  function apply() {
    let ratings = new Map<string, StoplightRating>()
    try { ratings = parseRatingsResponse(text, selected) } catch { /* reported below */ }
    if (!ratings.size) return setError("Couldn't find any ratings. Paste the chatbot's JSON reply after telling it you're done.")
    onApply(ratings)
    setText("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Revise {subject} with a chatbot</DialogTitle>
          <DialogDescription>The chatbot quizzes you on your checklist, starting with your weakest items, then suggests a red, amber or green rating for each item it tested.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel>1. Choose what to revise</FieldLabel>
            <ul className="divide-y rounded-lg border" aria-label="Groups to include">
              {[...groups].map(([group, groupItems]) => (
                <li key={group}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <input type="checkbox" checked={!skipped.has(group)} onChange={() => toggle(group)} />
                    <span className="min-w-0 flex-1 truncate font-medium">{group}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{groupItems.length} item{groupItems.length === 1 ? "" : "s"}</span>
                  </label>
                </li>
              ))}
            </ul>
          </Field>
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>2. Copy the prompt, paste it into any chatbot, and revise</FieldLabel>
              <Button type="button" size="sm" variant="outline" disabled={!selected.length} onClick={() => void copyPrompt()}>
                {copied ? <ClipboardCheck /> : <ClipboardCopy />}{copied ? "Copied" : "Copy prompt"}
              </Button>
            </div>
            <FieldDescription>Includes {selected.length} items with your current ratings, open mistakes and marks.</FieldDescription>
          </Field>
          <Field data-invalid={error ? true : undefined}>
            <FieldLabel htmlFor="stoplight-revise-json">3. Say "done", then paste the chatbot's reply</FieldLabel>
            <Textarea id="stoplight-revise-json" rows={4} className="font-mono text-xs" placeholder='{"ratings":[{"n":1,"rating":"amber"}]}'
              value={text} onChange={(event) => { setText(event.target.value); setError(null) }} aria-invalid={error ? true : undefined} />
            {error ? <FieldError>{error}</FieldError> : <FieldDescription>Only the items it rated change.</FieldDescription>}
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" disabled={!text.trim()} onClick={apply}><Check />Apply ratings</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
