import { useId, useMemo, useState } from "react"
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { SubjectCombobox } from "@/components/subject-combobox"
import { buildProgressionPrompt, parseExamProgression, previewProgressionImport, progressionBySubject, type ProgressionImportMode, type ExamProgression, type ProgressionExam } from "@/lib/exam-progression"
import type { ExamAttempt } from "@/lib/exam-data"
import type { ExamSuggestion } from "@/lib/exam-suggestions"

export type ExamProgressionProps = {
  progression?: ExamProgression
  onProgressionChange: (plan: ExamProgression) => void
}

export function ExamProgressionPanel({ progression, onProgressionChange, attempts, subjects, onSelect }: ExamProgressionProps & {
  attempts: ExamAttempt[]
  subjects: string[]
  onSelect: (exam: ExamSuggestion) => void
}) {
  const [editor, setEditor] = useState<{ adding: boolean; subject: string } | null>(null)
  const groups = progressionBySubject(progression ?? { exams: [] }, attempts)
  return <section className="grid gap-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 className="text-sm font-medium">{progression?.exams.length ? progression.name : "Your exam progression"}</h3>
        <p className="text-xs text-muted-foreground">Choose your next paper in any subject. Each subject advances independently as you log exams.</p></div>
      <div className="flex flex-wrap gap-2"><Button type="button" size="sm" variant="outline" onClick={() => setEditor({ adding: false, subject: "" })}>{progression?.exams.length ? "Edit progression" : "Create progression"}</Button>{progression?.exams.length ? <Button type="button" size="sm" onClick={() => setEditor({ adding: true, subject: "" })}>Add progression</Button> : null}</div>
    </div>
    {groups.length ? <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{groups.map((group) => <div key={group.subject} className="grid content-start gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-sm font-medium">{group.subject}</div><Button type="button" variant="ghost" size="sm" aria-label={`Add papers for ${group.subject}`} onClick={() => setEditor({ adding: true, subject: group.subject })}>Add papers</Button></div>
      <p className="text-xs text-muted-foreground">{group.completed} / {group.total} completed</p>
      {group.next ? <Button type="button" variant="outline" className="h-auto justify-start whitespace-normal py-3 text-left" onClick={() => onSelect(group.next!)}>
        <span className="grid gap-1"><span>{group.next.provider} {group.next.examYear} · {group.next.paper}</span><span className="text-xs font-normal text-muted-foreground">{group.next.phase ? `${group.next.phase} · ` : ""}{group.next.marks} marks</span></span>
      </Button> : <p className="text-sm text-muted-foreground">Progression complete</p>}
    </div>)}</div> : <p className="text-sm text-muted-foreground">Build an ordered plan across all your subjects, or copy a prompt to your LLM and import its JSON.</p>}
    {editor ? <ProgressionEditor progression={progression} subjects={subjects} adding={editor.adding} initialSubject={editor.subject} onClose={() => setEditor(null)} onSave={(plan) => { onProgressionChange(plan); setEditor(null); toast.success("Exam progression saved") }} /> : null}
  </section>
}

function ProgressionEditor({ progression, subjects, adding, initialSubject, onClose, onSave }: {
  progression?: ExamProgression
  subjects: string[]
  adding: boolean
  initialSubject: string
  onClose: () => void
  onSave: (plan: ExamProgression) => void
}) {
  const id = useId()
  const [name, setName] = useState(progression?.name ?? "My exam progression")
  const [exams, setExams] = useState<ProgressionExam[]>(progression?.exams ?? [])
  const [instructions, setInstructions] = useState("New company exams first, then older VCAA papers, then recent VCAA papers closer to my final exams. Balance practice across all my subjects.")
  const [json, setJson] = useState("")
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")
  const [showPrompt, setShowPrompt] = useState(false)
  const [filter, setFilter] = useState(initialSubject)
  const [targetSubject, setTargetSubject] = useState(initialSubject)
  const [importMode, setImportMode] = useState<ProgressionImportMode>("append")
  const planSubjects = [...new Set([...subjects, ...exams.map((exam) => exam.subject).filter(Boolean)])]
  const prompt = buildProgressionPrompt(targetSubject.trim() ? [targetSubject.trim()] : planSubjects, instructions, { version: 1, name, exams, updatedAt: "" }, importMode)
  const importPreview = useMemo(() => {
    if (!json.trim()) return null
    try { return { result: previewProgressionImport({ name, exams }, parseExamProgression(json), importMode), error: "" } }
    catch (cause) { return { result: null, error: cause instanceof Error ? cause.message : "Unable to import plan." } }
  }, [json, name, exams, importMode])
  function update(index: number, change: Partial<ProgressionExam>) {
    setExams((items) => items.map((item, i) => i === index ? { ...item, ...change } : item))
    setError("")
  }
  function move(index: number, direction: number) {
    const visible = exams.map((exam, i) => ({ exam, i })).filter(({ exam }) => !filter || exam.subject === filter)
    const target = visible[visible.findIndex(({ i }) => i === index) + direction]?.i
    if (target === undefined) return
    setExams((items) => { const next = [...items]; [next[index], next[target]] = [next[target], next[index]]; return next })
  }
  function previewImport() {
    const result = importPreview?.result
    if (!result) return
    setName(result.name); setExams(result.exams)
    setFilter(result.subjects.length === 1 ? result.subjects[0] : "")
    setError(""); setJson("")
    setNotice(`Draft updated: ${result.added} papers added, ${result.removed} replaced, ${result.skipped} duplicates skipped. Review the papers below and save when ready.`)
  }
  function save() {
    try { onSave({ ...parseExamProgression(JSON.stringify({ version: 1, name, exams })), updatedAt: new Date().toISOString() }) }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Unable to save plan.") }
  }
  function addPaper(subject: string) {
    setExams([...exams, { subject, provider: "VCAA", examYear: new Date().getFullYear(), paper: "Exam", marks: 100, phase: "" }])
    setFilter(subject)
    setNotice("Paper added to the draft. Fill in its details below, then save.")
  }
  const visible = exams.map((exam, index) => ({ exam, index })).filter(({ exam }) => !filter || exam.subject === filter)
  return <Dialog open onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-4xl">
      <DialogHeader><DialogTitle>{adding ? "Add to your exam progression" : progression?.exams.length ? "Edit your exam progression" : "Create your exam progression"}</DialogTitle><DialogDescription>Order papers within each subject. Phase labels can mark company practice, older papers and final preparation. Logging a matching subject, provider, year and paper completes it automatically.</DialogDescription></DialogHeader>
      <label className="grid gap-2 text-sm font-medium">Plan name<Input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>
      <details open={adding || undefined} className="grid rounded-lg border p-4">
        <summary className="cursor-pointer text-sm font-medium">Plan with an LLM · copy prompt and import JSON</summary>
        <div className="mt-4 grid gap-3">
          <div className="grid gap-2 text-sm"><label htmlFor={`${id}-target`}>Subject to plan (optional)</label><SubjectCombobox id={`${id}-target`} subjects={planSubjects} preferredSubjects={subjects} value={targetSubject} onValueChange={setTargetSubject} allowCustom placeholder="Choose or enter a new subject" /></div>
          <p className="text-xs text-muted-foreground">Choose a subject for the prompt, or leave it blank and describe the subjects you want below. Imported papers keep the subjects specified in the JSON.</p>
          <Button type="button" variant="outline" disabled={!targetSubject.trim() || exams.length >= 1000} onClick={() => addPaper(targetSubject.trim())}>Add a paper for this subject manually</Button>
          <label className="grid gap-2 text-sm">Import action<select className="h-9 rounded-md border bg-background px-3" value={importMode} onChange={(event) => setImportMode(event.target.value as ProgressionImportMode)}><option value="append">Add papers to existing progressions</option><option value="replace-subjects">Replace only subjects included in JSON</option></select></label>
          <p className="text-xs text-muted-foreground">{importMode === "append" ? "New subjects get their own progression. Existing subjects keep their paper order; new papers are added at the end. Duplicate papers are skipped and keep their existing marks and phase." : "The imported sequence replaces the papers for each subject included in the JSON. Subjects absent from the import are preserved. Your logged exams are kept."}</p>
          <label className="grid gap-2 text-sm">Planning preferences<Textarea value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
          <p className="text-xs text-muted-foreground">The prompt includes your subjects and draft papers. Add any other subjects, available papers and target dates to your preferences. Confirm paper details with your LLM.</p>
          <div className="flex flex-wrap gap-2"><Button type="button" variant="outline" onClick={async () => { try { await navigator.clipboard.writeText(prompt); toast.success("Prompt copied") } catch { setShowPrompt(true); toast.error("Could not copy. Select and copy the prompt below.") } }}>Copy LLM prompt</Button><Button type="button" variant="ghost" onClick={() => setShowPrompt(!showPrompt)}>View prompt</Button></div>
          {showPrompt ? <Textarea aria-label="LLM prompt" readOnly value={prompt} className="min-h-40" /> : null}
          <label className="grid gap-2 text-sm">Paste returned JSON<Textarea value={json} onChange={(event) => setJson(event.target.value)} className="min-h-36 font-mono text-xs" placeholder={'{"version":1,"name":"My plan","exams":[...]}'} /></label>
          {importPreview?.error ? <p role="alert" className="text-sm text-destructive">{importPreview.error}</p> : null}
          {importPreview?.result ? <div role="status" className="grid gap-1 rounded-md border p-3 text-sm"><p className="font-medium">Import preview · {importPreview.result.subjects.join(", ")}</p><p>{importPreview.result.added} papers to add · {importPreview.result.removed} existing papers to replace · {importPreview.result.skipped} duplicates to skip</p>{importPreview.result.preservedSubjects.length ? <p className="text-muted-foreground">Other subjects preserved: {importPreview.result.preservedSubjects.join(", ")}.</p> : null}<p className="text-muted-foreground">{importPreview.result.exams.length} papers in the combined plan. Changes are saved only when you select Save progression.</p></div> : null}
          <Button type="button" variant="outline" disabled={!importPreview?.result || (!importPreview.result.added && !importPreview.result.removed)} onClick={previewImport}>{importMode === "append" ? "Add imported papers to draft" : "Replace imported subjects in draft"}</Button>
        </div>
      </details>
      {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <label className="grid gap-1 text-sm">Show subject<select className="h-9 rounded-md border bg-background px-3" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="">All subjects</option>{planSubjects.map((subject) => <option key={subject}>{subject}</option>)}</select></label>
        <Button type="button" variant="outline" disabled={exams.length >= 1000} onClick={() => addPaper(filter || subjects[0] || "")}>Add paper</Button>
      </div>
      <p className="text-xs text-muted-foreground">{exams.length} papers. Use the arrows to reorder. Remove all papers and save to clear the progression. Check marks for each paper before saving.</p>
      <div className="grid gap-3">{visible.map(({ exam, index }, position) => <fieldset key={index} className="grid gap-3 rounded-lg border p-3">
        <legend className="px-1 text-xs font-medium">Paper {position + 1}{filter ? ` · ${filter}` : ""}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1 text-sm"><label htmlFor={`${id}-${index}`}>Subject</label><SubjectCombobox id={`${id}-${index}`} subjects={planSubjects} preferredSubjects={subjects} value={exam.subject} onValueChange={(subject) => update(index, { subject })} allowCustom /></div>
          <label className="grid gap-1 text-sm">Provider<Input value={exam.provider} onChange={(event) => update(index, { provider: event.target.value })} /></label>
          <label className="grid gap-1 text-sm">Year<Input type="number" min={1990} max={2100} value={Number.isFinite(exam.examYear) ? exam.examYear : ""} onChange={(event) => update(index, { examYear: event.target.valueAsNumber })} /></label>
          <label className="grid gap-1 text-sm">Paper<Input value={exam.paper} onChange={(event) => update(index, { paper: event.target.value })} /></label>
          <label className="grid gap-1 text-sm">Total marks<Input type="number" min={0.5} max={500} step={0.5} value={Number.isFinite(exam.marks) ? exam.marks : ""} onChange={(event) => update(index, { marks: event.target.valueAsNumber })} /></label>
          <label className="grid gap-1 text-sm">Phase (optional)<Input value={exam.phase} placeholder="Older VCAA" onChange={(event) => update(index, { phase: event.target.value })} /></label>
        </div>
        <div className="flex gap-2"><Button type="button" variant="outline" size="sm" aria-label={`Move paper ${position + 1} up`} disabled={position === 0} onClick={() => move(index, -1)}><ArrowUp />Up</Button><Button type="button" variant="outline" size="sm" aria-label={`Move paper ${position + 1} down`} disabled={position === visible.length - 1} onClick={() => move(index, 1)}><ArrowDown />Down</Button><Button type="button" variant="ghost" size="sm" aria-label={`Remove paper ${position + 1}`} onClick={() => setExams(exams.filter((_, i) => i !== index))}><Trash2 />Remove</Button></div>
      </fieldset>)}</div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {json.trim() ? <p className="text-sm text-muted-foreground">Apply the import to your draft above, or <button type="button" className="underline" onClick={() => setJson("")}>discard the pasted JSON</button> before saving.</p> : null}
      <DialogFooter><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={!!json.trim()} onClick={save}>Save progression</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}
