import { useMemo, useState } from "react"
import { Check, FileDown, FileUp } from "lucide-react"

import type { Mistake } from "../lib/exam-data"
import { parseMistakeRoundTrip } from "../lib/mistake-json"
import { getMistakeEditChanges, type MistakeEdit } from "../lib/mistake-autofill"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "./ui/field"
import { Textarea } from "./ui/textarea"

/** Second half of Export → JSON: paste (or load) the chatbot's edited file and replace fields by mistake id. */
export function MistakeRoundTripDialog({ mistakes, onExport, onOpenChange, onApply }: {
  mistakes: Mistake[]
  onExport: () => void
  onOpenChange: (open: boolean) => void
  onApply: (edits: MistakeEdit[]) => void
}) {
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [result, setResult] = useState<ReturnType<typeof parseMistakeRoundTrip> | null>(null)
  const changes = useMemo(() => {
    const byId = new Map(mistakes.map((mistake) => [mistake.id, mistake]))
    return (result?.edits ?? []).flatMap((edit) => {
      const mistake = byId.get(edit.id)
      const list = mistake ? getMistakeEditChanges(mistake, edit) : []
      return mistake && list.length ? [{ mistake, list }] : []
    })
  }, [result, mistakes])
  const accepted = changes.filter(({ mistake }) => !skipped.has(mistake.id))

  function review() {
    try {
      setResult(parseMistakeRoundTrip(text, mistakes))
      setSkipped(new Set())
      setError(null)
    } catch (reviewError) {
      setResult(null)
      setError(reviewError instanceof Error ? reviewError.message : "Could not read this JSON.")
    }
  }

  function apply() {
    onApply(accepted.map(({ mistake, list }) => ({ id: mistake.id, ...Object.fromEntries(list.map(({ field, after }) => [field, after])) })))
    onOpenChange(false)
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Re-import edited mistakes</DialogTitle>
          <DialogDescription>Export mistakes as JSON, ask a chatbot to fix them, then load its reply here. Mistakes are matched by id and you review every change before it's saved.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field data-invalid={error ? true : undefined}>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor="mistake-roundtrip-json">Edited JSON</FieldLabel>
              <Button type="button" size="sm" variant="outline" render={<label />}>
                <FileUp />Load file
                <input type="file" accept=".json,application/json,.txt" className="sr-only" onChange={(event) => {
                  void event.target.files?.[0]?.text().then((content) => { setText(content); setResult(null); setError(null) })
                  event.target.value = ""
                }} />
              </Button>
            </div>
            <Textarea id="mistake-roundtrip-json" rows={6} className="font-mono text-xs" spellCheck={false} placeholder='{"mistakes":[{"id":"…","correction":"…"}]}'
              value={text} onChange={(event) => { setText(event.target.value); setResult(null); setError(null) }} aria-invalid={error ? true : undefined} />
            {error ? <FieldError>{error}</FieldError> : <FieldDescription>Only question label, question text, what went wrong, improved response and topic are replaced. Blank fields are ignored.</FieldDescription>}
          </Field>
          {result ? (
            <div className="grid gap-3" aria-live="polite">
              <p className="text-sm text-muted-foreground tabular-nums">
                {changes.length} of {result.edits.length} records would change something.{result.unmatched ? ` ${result.unmatched} had no matching id and were ignored.` : ""} Untick any you want to keep as they are.
              </p>
              {changes.length ? (
                <div className="max-h-96 overflow-y-auto rounded-lg border">
                  {changes.map(({ mistake, list }) => (
                    <div key={mistake.id} className="grid gap-2 border-b p-3 text-sm last:border-b-0">
                      <label className="flex items-center gap-2 font-medium"><input type="checkbox" className="size-4 accent-primary" checked={!skipped.has(mistake.id)} onChange={() => setSkipped((value) => { const next = new Set(value); if (!next.delete(mistake.id)) next.add(mistake.id); return next })} />{mistake.question}</label>
                      {list.map(({ field, before, after }) => (
                        <div key={field} className="grid gap-2 sm:grid-cols-2">
                          <div className="min-w-0"><p className="mb-1 text-xs text-muted-foreground">{field} · before</p><pre className="max-h-40 overflow-auto rounded bg-muted/40 p-2 text-xs break-words whitespace-pre-wrap">{before || "(empty)"}</pre></div>
                          <div className="min-w-0"><p className="mb-1 text-xs text-muted-foreground">after</p><pre className="max-h-40 overflow-auto rounded bg-primary/5 p-2 text-xs break-words whitespace-pre-wrap">{after}</pre></div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </FieldGroup>
        <DialogFooter>
          <Button type="button" variant="outline" className="sm:mr-auto" onClick={onExport}><FileDown />Export JSON…</Button>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          {result
            ? <Button type="button" disabled={!accepted.length} onClick={apply}><Check />Apply {accepted.length} {accepted.length === 1 ? "edit" : "edits"}</Button>
            : <Button type="button" disabled={!text.trim()} onClick={review}>Review changes</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
