import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Calculator, Save } from "lucide-react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { PageHeader } from "./page-header"
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { AtarStudiesCard } from "./atar/atar-studies-card"
import { AtarSummary } from "./atar/atar-summary"
import { AtarScenariosCard } from "./atar/atar-scenarios-card"
import { AtarWidgetCard } from "./atar/atar-widget-card"
import { macDesktop } from "../lib/widgets"
import { AtarTrendCard } from "./atar/atar-charts"
import { atarYears, buildAtarHistory, buildAtarModel, subjectAtarRows } from "../lib/atar-model"
import type { AppData, AssessmentReference, AtarEstimatorRow, SavedAtarEstimate } from "../lib/exam-data"
import { atarScalingReference, normaliseScalingStudyName, type ScalingReference } from "../lib/scaling"
import { firstPreferredSubject, prioritiseSubjects } from "../lib/subjects"

type Row = AtarEstimatorRow

function newRow(code = ""): Row {
  return { id: crypto.randomUUID(), code, raw: "", usePrediction: true }
}

export function AtarEstimator({
  data,
  references,
  scalingReferences,
  savedEstimates,
  onSaveEstimate,
  onDeleteEstimate,
  onLogPractice,
  onTargetChange,
}: {
  data: AppData
  references: AssessmentReference[]
  scalingReferences: ScalingReference[]
  savedEstimates: SavedAtarEstimate[]
  onSaveEstimate: (estimate: SavedAtarEstimate) => void
  onDeleteEstimate: (id: string) => void
  onLogPractice: () => void
  onTargetChange: (target: number | null) => void
}) {
  const years = useMemo(() => atarYears(scalingReferences), [scalingReferences])
  // Reopen on the newest saved scenario, the same one the widget shows by default.
  const [latest] = useState(() => savedEstimates.toSorted((first, second) => second.savedAt.localeCompare(first.savedAt))[0])
  const [year, setYear] = useState(latest?.year ?? years[0] ?? 2025)
  const studies = useMemo(() => {
    const available = [...new Set(scalingReferences.map((reference) => reference.code))].flatMap((code) => atarScalingReference(scalingReferences, code, year) ?? [])
    const order = new Map(prioritiseSubjects(available.map((study) => study.studyName), data.subjects).map((subject, index) => [subject, index]))
    return available.toSorted((first, second) => (order.get(first.studyName) ?? 0) - (order.get(second.studyName) ?? 0))
  }, [data.subjects, scalingReferences, year])
  const matches = (subject: string) => studies.find((study) => normaliseScalingStudyName(study.studyName) === normaliseScalingStudyName(subject))
  // Start from the student's own subjects, not a single blank row to fill in six times.
  const [rows, setRows] = useState<Row[]>(() => {
    if (latest) return latest.rows.map((row) => ({ ...row }))
    const own = subjectAtarRows(data.subjects, scalingReferences)
    const firstName = firstPreferredSubject(studies.map((study) => study.studyName), data.subjects)
    return own.length ? own.map((row) => newRow(row.code)) : [newRow(studies.find((study) => study.studyName === firstName)?.code ?? "")]
  })

  const model = useMemo(() => buildAtarModel({ data, references, scaling: scalingReferences, rows, year }), [data, references, scalingReferences, rows, year])
  const history = useMemo(() => buildAtarHistory({ data, references, scaling: scalingReferences, rows, year }), [data, references, scalingReferences, rows, year])
  const estimate = model.estimate

  const [saveOpen, setSaveOpen] = useState(false)
  const [scenarioName, setScenarioName] = useState("")

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  function saveEstimate() {
    if (!estimate) return
    onSaveEstimate({
      id: crypto.randomUUID(),
      name: scenarioName.trim() || undefined,
      year,
      rows: rows.map((row) => ({ ...row })),
      atarLabel: estimate.atarLabel,
      aggregate: estimate.aggregate,
      savedAt: new Date().toISOString(),
    })
    setSaveOpen(false)
    setScenarioName("")
  }

  function renameEstimate(saved: SavedAtarEstimate, name: string) {
    onSaveEstimate({ ...saved, name: name.trim() || undefined })
  }

  function deleteEstimate(saved: SavedAtarEstimate) {
    onDeleteEstimate(saved.id)
    toast("Scenario deleted", { duration: 8000, action: { label: "Undo", onClick: () => onSaveEstimate(saved) } })
  }

  function loadEstimate(saved: SavedAtarEstimate) {
    setYear(saved.year)
    setRows(saved.rows.map((row) => ({ ...row })))
  }

  return (
    <div className="grid gap-5">
      <PageHeader icon={Calculator} title="ATAR" description="Combine your Unit 3/4 study scores into an estimated ATAR using VTAC rules.">
        <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
          <SelectTrigger className="w-32" aria-label="VTAC report year"><SelectValue>{year} VTAC</SelectValue></SelectTrigger>
          <SelectContent>{years.map((item) => <SelectItem key={item} value={String(item)}>{item} VTAC</SelectItem>)}</SelectContent>
        </Select>
        <Popover open={saveOpen} onOpenChange={(open) => { setSaveOpen(open); if (!open) setScenarioName("") }}>
          <PopoverTrigger render={<Button disabled={!estimate} />}><Save />Save scenario</PopoverTrigger>
          <PopoverContent align="end" className="w-72">
            <form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); saveEstimate() }}>
              <div className="grid gap-1.5">
                <Label htmlFor="atar-scenario-name">Scenario name <span className="font-normal text-muted-foreground">(optional)</span></Label>
                <Input id="atar-scenario-name" autoFocus maxLength={60} placeholder="e.g. Conservative, Target scores" value={scenarioName} onChange={(event) => setScenarioName(event.target.value)} />
              </div>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => { setSaveOpen(false); setScenarioName("") }}>Cancel</Button>
                <Button type="submit" size="sm" disabled={!estimate}><Save />Save</Button>
              </div>
            </form>
          </PopoverContent>
        </Popover>
      </PageHeader>

      <AtarSummary model={model} onTargetChange={onTargetChange} />
      <AtarStudiesCard
        model={model}
        studies={studies}
        subjects={data.subjects}
        unscaledSubjects={data.subjects.filter((subject) => !matches(subject))}
        onUpdate={updateRow}
        onAdd={() => setRows((current) => [...current, newRow()])}
        onRemove={(id) => setRows((current) => current.filter((row) => row.id !== id))}
        onLogPractice={onLogPractice}
      />
      <div className="grid min-w-0 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <AtarTrendCard history={history} target={model.target} />
        <AtarScenariosCard saved={savedEstimates} currentEstimate={estimate} onLoad={loadEstimate} onRename={renameEstimate} onDelete={deleteEstimate} />
      </div>
      {macDesktop() ? <AtarWidgetCard saved={savedEstimates} onLoad={loadEstimate} /> : null}

      <p className="max-w-[80ch] text-xs leading-relaxed text-muted-foreground">
        Historical estimate only. Uses VTAC&apos;s published aggregate bands for {year}; scaling is interpolated from published raw scores of 20–50, so lower scores have no reference here. VTAC recalculates both each year, and course eligibility depends on prerequisites and selection requirements.{" "}
        {estimate ? <a className="underline underline-offset-4 hover:text-foreground" href={estimate.reference.fullTableUrl} target="_blank" rel="noreferrer">View the {year} table</a> : null}
      </p>
    </div>
  )
}
