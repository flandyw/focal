import { useMemo, useState } from "react"
import { toast } from "sonner"
import { Save } from "lucide-react"
import { Button } from "./ui/button"
import { PageHeader } from "./page-header"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { AtarStudiesCard } from "./atar/atar-studies-card"
import { AtarEstimateCard } from "./atar/atar-estimate-card"
import { AtarScenariosCard } from "./atar/atar-scenarios-card"
import { AtarBreakdownCard, AtarSensitivityCard, AtarTrendCard } from "./atar/atar-charts"
import { atarYears, buildAtarHistory, buildAtarModel } from "../lib/atar-model"
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
  const [sourceDetails, setSourceDetails] = useState<string | null>(null)
  const [year, setYear] = useState(years[0] ?? 2025)
  const studies = useMemo(() => {
    const available = [...new Set(scalingReferences.map((reference) => reference.code))].flatMap((code) => atarScalingReference(scalingReferences, code, year) ?? [])
    const order = new Map(prioritiseSubjects(available.map((study) => study.studyName), data.subjects).map((subject, index) => [subject, index]))
    return available.toSorted((first, second) => (order.get(first.studyName) ?? 0) - (order.get(second.studyName) ?? 0))
  }, [data.subjects, scalingReferences, year])
  const matches = (subject: string) => studies.find((study) => normaliseScalingStudyName(study.studyName) === normaliseScalingStudyName(subject))
  // Start from the student's own subjects, not a single blank row to fill in six times.
  const [rows, setRows] = useState<Row[]>(() => {
    const codes = data.subjects.flatMap((subject) => matches(subject)?.code ?? [])
    const firstName = firstPreferredSubject(studies.map((study) => study.studyName), data.subjects)
    return codes.length ? codes.map((code) => newRow(code)) : [newRow(studies.find((study) => study.studyName === firstName)?.code ?? "")]
  })

  const model = useMemo(() => buildAtarModel({ data, references, scaling: scalingReferences, rows, year }), [data, references, scalingReferences, rows, year])
  const history = useMemo(() => buildAtarHistory({ data, references, scaling: scalingReferences, rows, year }), [data, references, scalingReferences, rows, year])
  const estimate = model.estimate

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  function saveEstimate() {
    if (!estimate) return
    onSaveEstimate({ id: crypto.randomUUID(), year, rows: rows.map((row) => ({ ...row })), atarLabel: estimate.atarLabel, aggregate: estimate.aggregate, savedAt: new Date().toISOString() })
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
    <div className="grid gap-8">
      <PageHeader title="ATAR" description="Combine your Unit 3/4 study scores into an ATAR. Focal predictions fill in where you have practice results; enter any score yourself.">
        <Select value={String(year)} onValueChange={(value) => setYear(Number(value))}>
          <SelectTrigger className="w-32" aria-label="VTAC report year"><SelectValue>{year} VTAC</SelectValue></SelectTrigger>
          <SelectContent>{years.map((item) => <SelectItem key={item} value={String(item)}>{item} VTAC</SelectItem>)}</SelectContent>
        </Select>
        <Button onClick={saveEstimate} disabled={!estimate}><Save />Save scenario</Button>
      </PageHeader>

      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="grid min-w-0 gap-6">
          <AtarStudiesCard
            model={model}
            studies={studies}
            subjects={data.subjects}
            unscaledSubjects={data.subjects.filter((subject) => !matches(subject))}
            sourceDetails={sourceDetails}
            onSourceDetails={setSourceDetails}
            onUpdate={updateRow}
            onAdd={() => setRows((current) => [...current, newRow()])}
            onRemove={(id) => setRows((current) => current.filter((row) => row.id !== id))}
            onLogPractice={onLogPractice}
          />
          <div className="grid min-w-0 gap-6 xl:grid-cols-2">
            <AtarBreakdownCard model={model} />
            <AtarSensitivityCard model={model} />
          </div>
          <AtarTrendCard history={history} target={model.target} />
        </div>

        <div className="grid gap-6 max-lg:contents lg:sticky lg:top-6">
          <AtarEstimateCard model={model} onTargetChange={onTargetChange} />
          <AtarScenariosCard saved={savedEstimates} onLoad={loadEstimate} onDelete={deleteEstimate} />
        </div>
      </div>

      <p className="max-w-[80ch] text-xs leading-relaxed text-muted-foreground">
        Historical estimate only. Uses VTAC&apos;s published aggregate bands for {year}; scaling is interpolated from published raw scores of 20–50, so lower scores have no reference here. VTAC recalculates both each year, and course eligibility depends on prerequisites and selection requirements.{" "}
        {estimate ? <a className="underline underline-offset-4 hover:text-foreground" href={estimate.reference.fullTableUrl} target="_blank" rel="noreferrer">View the {year} table</a> : null}
      </p>
    </div>
  )
}
