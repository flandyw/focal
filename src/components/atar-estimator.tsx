import { useMemo, useState } from "react"
import { Check, Circle, Plus, RotateCcw, Save, Trash2 } from "lucide-react"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { PageHeader } from "./page-header"
import { SubjectCombobox } from "./subject-combobox"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Input } from "./ui/input"
import { Toggle } from "./ui/toggle"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { ATAR_AGGREGATE_REFERENCES } from "../lib/atar-data"
import { estimateAtar, isEnglishStudy, type AtarStudyResult } from "../lib/atar"
import { type AppData, type AssessmentReference, type AtarEstimatorRow, type SavedAtarEstimate } from "../lib/exam-data"
import { interpolateScaledScore, normaliseScalingStudyName, type ScalingReference } from "../lib/scaling"
import { predictStudyScore } from "../lib/study-score"
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
}: {
  data: AppData
  references: AssessmentReference[]
  scalingReferences: ScalingReference[]
  savedEstimates: SavedAtarEstimate[]
  onSaveEstimate: (estimate: SavedAtarEstimate) => void
  onDeleteEstimate: (id: string) => void
}) {
  const years = useMemo(
    () => ATAR_AGGREGATE_REFERENCES.map((item) => item.year)
      .filter((year) => scalingReferences.some((reference) => reference.year === year))
      .toSorted((a, b) => b - a),
    [scalingReferences],
  )
  const [year, setYear] = useState(years[0] ?? 2025)
  const studies = useMemo(() => {
    const available = scalingReferences.filter((reference) => reference.year === year)
    const order = new Map(prioritiseSubjects(available.map((study) => study.studyName), data.subjects).map((subject, index) => [subject, index]))
    return available.toSorted((first, second) => (order.get(first.studyName) ?? 0) - (order.get(second.studyName) ?? 0))
  }, [data.subjects, scalingReferences, year])
  const [rows, setRows] = useState<Row[]>(() => [newRow()])
  const firstStudyName = firstPreferredSubject(studies.map((study) => study.studyName), data.subjects)
  const firstStudyCode = studies.find((study) => study.studyName === firstStudyName)?.code ?? ""

  if (firstStudyCode && rows.some((row) => !row.code)) {
    setRows(rows.map((row) => row.code ? row : { ...row, code: firstStudyCode }))
  }

  const predictions = useMemo(() => {
    const map = new Map<string, number>()
    for (const subject of new Set(data.attempts.map((attempt) => attempt.subject))) {
      const prediction = predictStudyScore({ subject, attempts: data.attempts, references })
      if (prediction) map.set(normaliseScalingStudyName(subject), prediction.studyScore)
    }
    return map
  }, [data.attempts, references])

  const results = useMemo<AtarStudyResult[]>(() => rows.flatMap((row) => {
    const reference = studies.find((item) => item.code === row.code)
    if (!reference) return []
    const predicted = predictions.get(normaliseScalingStudyName(reference.studyName))
    const rawScore = row.usePrediction && predicted !== undefined ? predicted : Number(row.raw)
    const scaledScore = interpolateScaledScore(rawScore, reference.points)
    if (scaledScore === null) return []
    return [{ id: row.id, code: reference.code, studyName: reference.studyName, rawScore, scaledScore }]
  }), [predictions, rows, studies])

  const estimate = useMemo(() => estimateAtar(results, year), [results, year])

  function updateRow(id: string, patch: Partial<Row>) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  function saveEstimate() {
    if (!estimate) return
    onSaveEstimate({
      id: crypto.randomUUID(),
      year,
      rows: rows.map((row) => ({ ...row })),
      atarLabel: estimate.atarLabel,
      aggregate: estimate.aggregate,
      savedAt: new Date().toISOString(),
    })
  }

  function loadEstimate(saved: SavedAtarEstimate) {
    setYear(saved.year)
    setRows(saved.rows.map((row) => ({ ...row })))
  }

  const orderedSavedEstimates = useMemo(
    () => savedEstimates.toSorted((first, second) => second.savedAt.localeCompare(first.savedAt)),
    [savedEstimates],
  )

  const roles = new Map<string, string>([
    ...(estimate ? [...estimate.primaryFour, ...estimate.increments].map((item) => [item.id, item.role === "Increment" ? "10% increment" : item.role] as const) : []),
    ...(estimate?.excluded.map((item) => [item.id, "Not counted"] as const) ?? []),
  ])
  const counted = estimate ? [...estimate.primaryFour, ...estimate.increments] : []
  const requirements = [
    { label: "Four or more studies with a score", met: results.length >= 4 },
    { label: "An English-group study", met: results.some((result) => isEnglishStudy(result.code)) },
  ]

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
        <Card>
          <CardHeader><CardTitle>Studies</CardTitle><CardDescription>The best combination is chosen for you under VTAC rules.</CardDescription></CardHeader>
          <CardContent className="grid gap-4">
            <div role="table" aria-label="Studies" className="grid">
              <div role="row" className="grid grid-cols-[minmax(0,1fr)_8.5rem_3.5rem_6.5rem_1.75rem] gap-3 border-b pb-2 text-xs font-medium text-muted-foreground max-md:hidden">
                <span role="columnheader">Subject</span><span role="columnheader">Raw score</span><span role="columnheader" className="text-right">Scaled</span><span role="columnheader">Counts as</span><span role="columnheader" className="sr-only">Remove</span>
              </div>
              {rows.map((row) => {
                const reference = studies.find((item) => item.code === row.code)
                const prediction = reference ? predictions.get(normaliseScalingStudyName(reference.studyName)) : undefined
                const result = results.find((item) => item.id === row.id)
                const usePrediction = row.usePrediction && prediction !== undefined
                const role = roles.get(row.id)
                const name = reference?.studyName ?? "subject"
                return (
                  <div key={row.id} role="row" className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 border-b py-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_8.5rem_3.5rem_6.5rem_1.75rem]">
                    <div role="cell" className="max-md:col-span-2">
                      <SubjectCombobox subjects={studies.map((study) => study.studyName)} preferredSubjects={data.subjects} value={reference?.studyName ?? ""} onValueChange={(value) => updateRow(row.id, { code: studies.find((study) => study.studyName === value)?.code ?? "" })} className="w-full" />
                    </div>
                    <div role="cell" className="flex items-center gap-1.5">
                      <Input aria-label={`Raw score for ${name}`} className="w-16 tabular-nums" type="number" min="20" max="50" step="1" value={usePrediction ? String(prediction) : row.raw} disabled={usePrediction} placeholder="20–50" onChange={(event) => updateRow(row.id, { raw: event.target.value })} />
                      {prediction !== undefined ? <Toggle variant="outline" size="sm" pressed={usePrediction} onPressedChange={(pressed) => updateRow(row.id, { usePrediction: pressed })} aria-label={`Use Focal prediction for ${name}`}>Focal</Toggle> : null}
                    </div>
                    <div role="cell" className="text-right text-sm tabular-nums max-md:hidden">{result ? result.scaledScore.toFixed(1) : "—"}</div>
                    <div role="cell" className="flex items-center gap-2 max-md:justify-end">
                      <span className="text-sm tabular-nums text-muted-foreground md:hidden">{result ? `${result.scaledScore.toFixed(1)} scaled` : null}</span>
                      {role ? <Badge variant={role === "Not counted" ? "outline" : role === "10% increment" ? "secondary" : "default"}>{role}</Badge> : <span className="text-sm text-muted-foreground max-md:hidden">—</span>}
                    </div>
                    <div role="cell" className="max-md:hidden">
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}><Trash2 /></Button>
                    </div>
                    <Button variant="ghost" size="sm" className="justify-self-start text-muted-foreground md:hidden" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))}><Trash2 />Remove</Button>
                  </div>
                )
              })}
            </div>
            <Button variant="outline" className="justify-self-start" onClick={() => setRows((current) => [...current, newRow(firstStudyCode)])}><Plus />Add study</Button>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:sticky lg:top-6">
          <Card>
            <CardHeader><CardDescription>Estimated ATAR</CardDescription></CardHeader>
            <CardContent className="grid gap-5">
              <div>
                <p className="text-6xl font-semibold tracking-tight tabular-nums">{estimate?.atarLabel ?? "—"}</p>
                <p className="mt-2 text-sm text-muted-foreground tabular-nums">{estimate ? `Aggregate ${estimate.aggregate.toFixed(2)} · ${year} conversion` : "Needs four scores including English"}</p>
              </div>
              {estimate ? (
                <>
                  <div className="flex h-2 gap-0.5 overflow-hidden rounded-full" aria-hidden>
                    {counted.map((item) => <span key={item.id} className={item.role === "Increment" ? "bg-primary/35" : "bg-primary"} style={{ width: `${(item.contribution / estimate.aggregate) * 100}%` }} />)}
                  </div>
                  <ul className="grid gap-2 text-sm">
                    {counted.map((item) => (
                      <li key={item.id} className="flex items-baseline gap-3">
                        <span className="min-w-0 flex-1 truncate">{item.studyName}</span>
                        <span className="text-xs text-muted-foreground">{item.role === "Increment" ? "10%" : item.role === "English" ? "English" : ""}</span>
                        <span className="w-10 text-right font-medium tabular-nums">{item.contribution.toFixed(1)}</span>
                      </li>
                    ))}
                  </ul>
                  {estimate.excluded.length > 0 ? <p className="text-xs text-muted-foreground">Not counted under VTAC combination limits: {estimate.excluded.map((item) => item.studyName).join(", ")}.</p> : null}
                </>
              ) : (
                <ul className="grid gap-2 text-sm">
                  {requirements.map((item) => (
                    <li key={item.label} className={`flex items-center gap-2 ${item.met ? "" : "text-muted-foreground"}`}>
                      {item.met ? <Check className="size-4 text-primary" aria-hidden /> : <Circle className="size-4" aria-hidden />}
                      {item.label}<span className="sr-only">{item.met ? " (met)" : " (not yet met)"}</span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Saved scenarios</CardTitle></CardHeader>
            <CardContent>
              {orderedSavedEstimates.length ? (
                <ul className="grid divide-y">
                  {orderedSavedEstimates.map((saved) => (
                    <li key={saved.id} className="flex items-center gap-2 py-2 first:pt-0 last:pb-0">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium tabular-nums">ATAR {saved.atarLabel}</p>
                        <p className="truncate text-xs text-muted-foreground">{saved.year} VTAC · {new Date(saved.savedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })}</p>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => loadEstimate(saved)}><RotateCcw />Load</Button>
                      <Button variant="ghost" size="icon-sm" aria-label={`Delete saved ATAR ${saved.atarLabel}`} onClick={() => onDeleteEstimate(saved.id)}><Trash2 /></Button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-muted-foreground">Save a scenario to compare subject choices or come back to these inputs.</p>}
            </CardContent>
          </Card>
        </div>
      </div>

      <p className="max-w-[80ch] text-xs leading-relaxed text-muted-foreground">
        Historical estimate only. Uses VTAC&apos;s published aggregate bands for {year}; scaling is interpolated from published raw scores of 20–50, so lower scores have no reference here. VTAC recalculates both each year, and course eligibility depends on prerequisites and selection requirements.{" "}
        {estimate ? <a className="underline underline-offset-4 hover:text-foreground" href={estimate.reference.fullTableUrl} target="_blank" rel="noreferrer">View the {year} table</a> : null}
      </p>
    </div>
  )
}
