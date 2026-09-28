import { useRef, useState } from "react"
import { Check, ClipboardCheck, ClipboardCopy } from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import { Textarea } from "@/components/ui/textarea"
import type { ExamAttempt, Mistake } from "@/lib/exam-data"
import { buildMistakeImportPrompt, createMistakesFromImport, parseMistakeImport, type ParsedMistakeDraft } from "@/lib/mistake-json"

type MistakeJsonImportDialogProps = {
  open: boolean
  attempts: ExamAttempt[]
  initialAttemptId?: string | null
  onOpenChange: (open: boolean) => void
  onSaveMistakes: (mistakes: Mistake[]) => void
}

export function MistakeJsonImportDialog({ open, attempts, initialAttemptId, onOpenChange, onSaveMistakes }: MistakeJsonImportDialogProps) {
  const [jsonText, setJsonText] = useState("")
  const [drafts, setDrafts] = useState<ParsedMistakeDraft[] | null>(null)
  const [attemptId, setAttemptId] = useState(initialAttemptId ?? "")
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const copiedTimer = useRef<number | null>(null)
  const prompt = buildMistakeImportPrompt()
  const attemptOptions = attempts.map((attempt) => ({
    value: attempt.id,
    label: `${attempt.title} · ${attempt.paper}`,
  }))
  const selectedAttemptOption = attemptOptions.find((attempt) => attempt.value === attemptId) ?? null

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
      if (copiedTimer.current) window.clearTimeout(copiedTimer.current)
      copiedTimer.current = window.setTimeout(() => setCopied(false), 2000)
    } catch {
      toast.error("Could not copy the prompt. Select the text and copy it manually.")
    }
  }

  function review() {
    try {
      const parsed = parseMistakeImport(jsonText)
      setDrafts(parsed)
      setError(null)
    } catch (reviewError) {
      setDrafts(null)
      setError(reviewError instanceof Error ? reviewError.message : "Could not read this JSON.")
    }
  }

  function importMistakes() {
    if (!drafts?.length || !attemptId) return
    onSaveMistakes(createMistakesFromImport(drafts, attemptId))
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg lg:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import mistakes from any chatbot</DialogTitle>
          <DialogDescription>
            Copy the prompt below into your favourite AI chatbot together with your marked exam or notes, then paste the returned JSON here to log the mistakes.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel htmlFor="mistake-import-prompt">1. Copy the prompt</FieldLabel>
              <Button type="button" size="sm" variant="outline" onClick={() => void copyPrompt()}>
                {copied ? <ClipboardCheck /> : <ClipboardCopy />}{copied ? "Copied" : "Copy prompt"}
              </Button>
            </div>
            <pre id="mistake-import-prompt" className="max-h-64 overflow-y-auto rounded-lg border bg-muted/30 p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap select-all">{prompt}</pre>
            <FieldDescription>Send it with photos, transcripts, or a description of your marked work. Any chatbot that can return JSON works.</FieldDescription>
          </Field>

          <Field>
            <FieldLabel htmlFor="mistake-import-json">2. Paste the chatbot's JSON response</FieldLabel>
            <Textarea
              id="mistake-import-json"
              rows={6}
              className="font-mono text-xs"
              value={jsonText}
              onChange={(event) => {
                setJsonText(event.target.value)
                setDrafts(null)
                setError(null)
              }}
              placeholder='[{"question": "Section B, Question 4", ...}]'
              spellCheck={false}
            />
          </Field>

          <Field>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div className="min-w-0 flex-1">
                <FieldLabel htmlFor="mistake-import-exam">3. Link these mistakes to an exam</FieldLabel>
                <Combobox items={attemptOptions} value={selectedAttemptOption} onValueChange={(value) => setAttemptId(value?.value ?? "")} autoHighlight>
                  <ComboboxInput id="mistake-import-exam" className="w-full" placeholder="Search practice exams" />
                  <ComboboxContent>
                    <ComboboxEmpty>No matching practice exams.</ComboboxEmpty>
                    <ComboboxList>{(item) => <ComboboxItem key={item.value} value={item}>{item.label}</ComboboxItem>}</ComboboxList>
                  </ComboboxContent>
                </Combobox>
              </div>
              {!drafts ? (
                <Button type="button" variant="secondary" disabled={!jsonText.trim()} onClick={review}>Review JSON</Button>
              ) : (
                <Button type="button" variant="outline" onClick={() => { setDrafts(null); setError(null) }}>Edit JSON</Button>
              )}
            </div>
            <FieldDescription>Every imported mistake joins this logged exam so subject filters and insights keep working.</FieldDescription>
          </Field>

          {drafts ? (
            <Field>
              <p className="text-sm font-medium">{drafts.length} mistake{drafts.length === 1 ? "" : "s"} ready to import</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {drafts.map((draft, index) => (
                  <Card key={`${index}-${draft.question}`} size="sm">
                    <CardHeader className="gap-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="min-w-0">{draft.question}</CardTitle>
                        <Badge variant="outline">{index + 1}</Badge>
                      </div>
                      <CardDescription className="line-clamp-2">{draft.questionText}</CardDescription>
                    </CardHeader>
                    <CardContent className="grid gap-2">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="secondary">{draft.category}</Badge>
                        <Badge variant="outline">{draft.marksLost}/{draft.totalMarks} marks lost</Badge>
                        {draft.areaOfStudy ? <Badge variant="outline">{draft.areaOfStudy}</Badge> : null}
                      </div>
                      <p className="line-clamp-3 text-sm text-muted-foreground">{draft.explanation}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </Field>
          ) : null}
          <FieldError>{error}</FieldError>
        </FieldGroup>
        <DialogFooter>
          <Button
            type="button"
            disabled={!drafts?.length || !attemptId}
            onClick={importMistakes}
          >
            <Check />
            Import {drafts?.length ? `${drafts.length} mistake${drafts.length === 1 ? "" : "s"}` : "mistakes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
