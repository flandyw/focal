import { Plus, Trash2 } from "lucide-react"
import { Button } from "../ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { Input } from "../ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { SubjectCombobox } from "../subject-combobox"
import type { AtarEstimatorRow } from "../../lib/exam-data"
import type { AtarModel, AtarModelRow } from "../../lib/atar-model"
import type { ScalingReference } from "../../lib/scaling"

// Container, not viewport: the sidebar and content-width setting change how much room the table really has.
const COLUMNS = "@4xl:grid-cols-[minmax(0,1fr)_13rem_3.5rem_9.5rem_4rem_1.75rem]"
const sum = (items: AtarModelRow[]) => items.reduce((total, item) => total + item.contribution, 0)

/** One table for inputs and outcome: score in, scaled score, what it adds, and what one more point is worth. */
export function AtarStudiesCard({ model, studies, subjects, unscaledSubjects, onUpdate, onAdd, onRemove, onLogPractice }: {
  model: AtarModel
  studies: ScalingReference[]
  subjects: string[]
  unscaledSubjects: string[]
  onUpdate: (id: string, patch: Partial<AtarEstimatorRow>) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onLogPractice: () => void
}) {
  const { estimate, rows } = model
  const bestGain = Math.max(0, ...rows.map((item) => item.sensitivity?.aggregate ?? 0))
  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Studies</CardTitle>
        <CardDescription>Focal estimates come from your practice results; switch a study to Manual to enter a score yourself. +1 point is how far one more study score point moves your aggregate.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        {unscaledSubjects.map((subject) => <p key={subject} className="text-xs text-destructive">{subject}: no published scaling data in any year. Choose a matching study with Add study to include it.</p>)}
        <div role="table" aria-label="Studies" className="@container grid">
          <div role="row" className={`grid gap-x-4 border-b pb-2 text-xs font-medium text-muted-foreground @max-4xl:hidden ${COLUMNS}`}>
            <span role="columnheader">Subject</span><span role="columnheader">Study score</span><span role="columnheader" className="text-right">Scaled</span><span role="columnheader">Adds to aggregate</span><span role="columnheader" className="text-right">+1 point</span><span role="columnheader" className="sr-only">Remove</span>
          </div>
          {rows.map((item) => (
            <StudyRow
              key={item.row.id}
              item={item}
              best={bestGain > 0 && item.sensitivity?.aggregate === bestGain}
              options={studies.filter((study) => study.code === item.row.code || !rows.some((other) => other.row.code === study.code)).map((study) => study.studyName)}
              subjects={subjects}
              onUpdate={(patch) => onUpdate(item.row.id, patch)}
              onStudy={(name) => onUpdate(item.row.id, { code: studies.find((study) => study.studyName === name)?.code ?? "" })}
              onRemove={rows.length > 1 ? () => onRemove(item.row.id) : undefined}
              onLogPractice={onLogPractice}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <Button variant="outline" onClick={onAdd}><Plus />Add study</Button>
          {estimate ? (
            <p className="text-sm text-muted-foreground tabular-nums">
              Primary four {sum(rows.filter((item) => item.role !== "Increment")).toFixed(2)} + increments {sum(rows.filter((item) => item.role === "Increment")).toFixed(2)} = <span className="font-medium text-foreground">aggregate {estimate.aggregate.toFixed(2)}</span>
            </p>
          ) : null}
        </div>
        {estimate?.excluded.length ? <p className="text-xs text-muted-foreground">Not counted under VTAC combination limits: {estimate.excluded.map((item) => item.studyName).join(", ")}.</p> : null}
      </CardContent>
    </Card>
  )
}

function StudyRow({ item, best, options, subjects, onUpdate, onStudy, onRemove, onLogPractice }: {
  item: AtarModelRow
  best: boolean
  options: string[]
  subjects: string[]
  onUpdate: (patch: Partial<AtarEstimatorRow>) => void
  onStudy: (name: string) => void
  onRemove?: () => void
  onLogPractice: () => void
}) {
  const { row, study, scaling, prediction, completedYear, role, sensitivity } = item
  const usePrediction = row.usePrediction
  const invalidScore = item.issue === "invalid-manual"
  const name = study?.studyName ?? "subject"
  return (
    <div role="row" className={`grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-2 border-b py-3 last:border-b-0 ${COLUMNS}`}>
      <div role="cell" className="grid gap-1.5 @max-4xl:order-1">
        <SubjectCombobox subjects={options} preferredSubjects={subjects} value={study?.studyName ?? ""} onValueChange={onStudy} className="w-full" />
        {completedYear !== undefined ? <p className="text-xs text-muted-foreground">Completed {completedYear} · {scaling ? `${scaling.year} scaling${scaling.year !== completedYear ? " (fallback)" : ""}` : "No published scaling data for this study"}</p> : null}
        {!study && row.code ? <p className="text-xs text-destructive">No published scaling data for study {row.code}; choose a matching study to include it.</p> : null}
      </div>
      <div role="cell" className="grid gap-1.5 @max-4xl:order-3 @max-4xl:col-span-2">
        <div className="flex items-center gap-2">
          <Input aria-label={`Study score for ${name}`} aria-invalid={invalidScore || undefined} aria-describedby={invalidScore ? `score-error-${row.id}` : undefined} className="w-16 tabular-nums" type="number" inputMode="numeric" min="20" max="50" step="1" value={usePrediction ? prediction?.studyScore ?? "" : row.raw} disabled={usePrediction} placeholder={usePrediction ? "—" : "20–50"} onChange={(event) => onUpdate({ raw: event.target.value })} />
          <div className="flex items-center gap-0.5 rounded-lg border p-0.5" role="group" aria-label={`Score source for ${name}`}>
            <Button size="sm" variant={usePrediction ? "secondary" : "ghost"} className={usePrediction ? "" : "text-muted-foreground"} aria-pressed={usePrediction} aria-label="Focal estimate" onClick={() => onUpdate({ usePrediction: true })}>Focal</Button>
            <Button size="sm" variant={usePrediction ? "ghost" : "secondary"} className={usePrediction ? "text-muted-foreground" : ""} aria-pressed={!usePrediction} onClick={() => onUpdate({ usePrediction: false })}>Manual</Button>
          </div>
        </div>
        {usePrediction ? (
          <p className="text-xs text-muted-foreground tabular-nums">
            {prediction ? `Likely ${prediction.low}–${prediction.high} · ${prediction.confidence.toLowerCase()} confidence` : "No practice results yet"}{" · "}
            <Popover>
              <PopoverTrigger className="underline underline-offset-4 hover:text-foreground" aria-label={`About the Focal estimate for ${name}`}>Details</PopoverTrigger>
              <PopoverContent>
                {prediction ? <>
                  <p>{prediction.evidence.length} usable practice result(s). Most recent used: {prediction.evidence.map((evidence) => evidence.attempt.completedAt).toSorted().at(-1)}.</p>
                  <ul className="max-h-48 overflow-auto">{prediction.evidence.map((evidence) => <li key={evidence.attempt.id}>{evidence.attempt.title} · {evidence.attempt.completedAt} · {evidence.referenceYear} distribution</li>)}</ul>
                  <p>{prediction.excludedAttemptCount} result(s) excluded. SAC performance and missing maths papers are projected from practice.</p>
                </> : <p>No usable practice results yet. Log a paper with valid marks and a matching grade distribution to get a Focal estimate, or choose Manual.</p>}
                <p>One usable result is enough. More recent results carry more weight. Assessment/SAC records are not used here.</p>
                <Button variant="outline" size="sm" onClick={onLogPractice}>Log practice</Button>
              </PopoverContent>
            </Popover>
          </p>
        ) : null}
        {invalidScore ? <p id={`score-error-${row.id}`} className="text-xs text-destructive">Enter a whole score from 20 to 50.</p> : null}
      </div>
      <div role="cell" className="text-right text-sm leading-9 tabular-nums @max-4xl:hidden">{item.scaledScore !== null ? item.scaledScore.toFixed(1) : "—"}</div>
      <div role="cell" className="grid gap-1.5 @4xl:pt-2 @max-4xl:order-4 @max-4xl:col-span-2">
        <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
          <span className={item.contribution ? "font-medium" : "text-muted-foreground"}>{item.contribution ? item.contribution.toFixed(2) : "—"}</span>
          <span className="text-xs text-muted-foreground">{role === "Increment" ? "10% increment" : role}</span>
        </div>
        {/* 55 is about the highest scaled score VTAC publishes. */}
        <div className="h-1 overflow-hidden rounded-full bg-muted" aria-hidden><div className={`h-full rounded-full ${role === "Increment" ? "bg-primary/45" : "bg-primary"}`} style={{ width: `${Math.min(100, (item.contribution / 55) * 100)}%` }} /></div>
      </div>
      <div role="cell" className={`text-right text-sm leading-9 tabular-nums @max-4xl:hidden ${best ? "font-medium" : "text-muted-foreground"}`} title={sensitivity ? `One more point in ${name}: aggregate +${sensitivity.aggregate.toFixed(2)}${sensitivity.atar !== null ? `, ATAR +${sensitivity.atar.toFixed(2)}` : ""}` : undefined}>
        {sensitivity ? `+${sensitivity.aggregate.toFixed(2)}` : "—"}
      </div>
      <div role="cell" className="pt-1 @max-4xl:order-2">
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} disabled={!onRemove} onClick={onRemove}><Trash2 /></Button>
      </div>
    </div>
  )
}
