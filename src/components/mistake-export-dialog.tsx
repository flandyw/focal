import { useEffect, useMemo, useState } from "react"
import { FileDown } from "lucide-react"
import { toast } from "sonner"

import { exportMistakes, type ExportFormat } from "../lib/mistake-export"
import { count } from "../lib/utils"
import { getMistakeSchedule, type ExamAttempt, type Mistake } from "../lib/exam-data"
import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"
import { Field, FieldGroup, FieldLabel } from "./ui/field"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"

const FORMATS: Record<ExportFormat, string> = { pdf: "PDF worksheet", markdown: "Markdown", csv: "CSV", json: "JSON" }
const STATUSES = { all: "All statuses", unresolved: "Unresolved only", resolved: "Resolved only" }

export function MistakeExportDialog({ initialFormat = "pdf", mistakes, current, attempts, onOpenChange }: { initialFormat?: ExportFormat; mistakes: Mistake[]; current: Mistake[]; attempts: ExamAttempt[]; onOpenChange: (open: boolean) => void }) {
  const [format, setFormat] = useState<ExportFormat>(initialFormat)
  const [scope, setScope] = useState<"current" | "all">(current.length ? "current" : "all")
  const [category, setCategory] = useState("all")
  const [status, setStatus] = useState<keyof typeof STATUSES>("all")
  const [busy, setBusy] = useState(false)
  const source = scope === "current" ? current : mistakes
  const categories = useMemo(() => [...new Set(source.map((mistake) => mistake.category))].sort(), [source])
  const result = source.filter((mistake) => (category === "all" || mistake.category === category) && (status === "all" || getMistakeSchedule(mistake).resolved === (status === "resolved")))
  const message = result.length ? `${count(result.length, "mistake")} will be exported.` : source.length ? "No mistakes match this category and status. Try a different filter." : "There are no mistakes here to export yet."
  const [announcement, setAnnouncement] = useState("")
  useEffect(() => {
    // Populate the empty live region in a later task so its first message can be announced.
    const timer = window.setTimeout(() => setAnnouncement(message), 0)
    return () => window.clearTimeout(timer)
  }, [message])

  async function run() {
    setBusy(true)
    try {
      if (await exportMistakes(format, result, attempts)) { toast.success("Export downloaded"); onOpenChange(false) }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not export mistakes.")
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!busy) onOpenChange(open) }}>
      <DialogContent>
        <DialogHeader><DialogTitle>Export mistakes</DialogTitle><DialogDescription>Choose a format and which mistakes to include.</DialogDescription></DialogHeader>
        <FieldGroup>
          <Field><FieldLabel htmlFor="export-format">Format</FieldLabel><Select disabled={busy} value={format} onValueChange={(value) => setFormat((value ?? "pdf") as ExportFormat)}><SelectTrigger id="export-format" className="w-full"><SelectValue>{FORMATS[format]}</SelectValue></SelectTrigger><SelectContent>{Object.entries(FORMATS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="export-scope">Mistakes</FieldLabel><Select disabled={busy} value={scope} onValueChange={(value) => { setScope(value === "all" ? "all" : "current"); setCategory("all") }}><SelectTrigger id="export-scope" className="w-full"><SelectValue>{scope === "current" ? `Current view / selection (${current.length})` : `Everything (${mistakes.length})`}</SelectValue></SelectTrigger><SelectContent><SelectItem value="current">Current view / selection ({current.length})</SelectItem><SelectItem value="all">Everything ({mistakes.length})</SelectItem></SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="export-category">Category</FieldLabel><Select disabled={busy} value={category} onValueChange={(value) => setCategory(value ?? "all")}><SelectTrigger id="export-category" className="w-full"><SelectValue>{category === "all" ? "All categories" : category}</SelectValue></SelectTrigger><SelectContent><SelectItem value="all">All categories</SelectItem>{categories.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select></Field>
          <Field><FieldLabel htmlFor="export-status">Status</FieldLabel><Select disabled={busy} value={status} onValueChange={(value) => setStatus((value ?? "all") as keyof typeof STATUSES)}><SelectTrigger id="export-status" className="w-full"><SelectValue>{STATUSES[status]}</SelectValue></SelectTrigger><SelectContent>{Object.entries(STATUSES).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></Field>
        </FieldGroup>
        <p role="status" className="min-h-5 text-sm text-muted-foreground tabular-nums">{announcement}</p>
        <DialogFooter><Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!result.length || busy} onClick={() => void run()}><FileDown />{busy ? "Exporting…" : `Export ${count(result.length, "mistake")}`}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
