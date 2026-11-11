import { Plus, Trash2 } from "lucide-react"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { Input } from "../ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { SubjectCombobox } from "../subject-combobox"
import type { AtarEstimatorRow } from "../../lib/exam-data"
import type { AtarModel, AtarModelRow } from "../../lib/atar-model"
import type { ScalingReference } from "../../lib/scaling"

const COLUMNS = "md:grid-cols-[minmax(0,1fr)_11rem_3.5rem_6.5rem_1.75rem]"

function roleLabel(item: AtarModelRow) {
  return item.role === "Increment" ? "10% increment" : item.role
}

export function AtarStudiesCard({ model, studies, subjects, unscaledSubjects, sourceDetails, onSourceDetails, onUpdate, onAdd, onRemove, onLogPractice }: {
  model: AtarModel
  studies: ScalingReference[]
  subjects: string[]
  unscaledSubjects: string[]
  sourceDetails: string | null
  onSourceDetails: (id: string | null) => void
  onUpdate: (id: string, patch: Partial<AtarEstimatorRow>) => void
  onAdd: () => void
  onRemove: (id: string) => void
  onLogPractice: () => void
}) {
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>Studies</CardTitle><CardDescription>The best combination is chosen for you under VTAC rules.</CardDescription></CardHeader>
      <CardContent className="grid gap-4">
        {unscaledSubjects.map((subject) => <p key={subject} className="text-xs text-destructive">{subject}: no published scaling data in any year. Choose a matching study with Add study to include it.</p>)}
        <div role="table" aria-label="Studies" className="grid">
          <div role="row" className={`grid gap-3 border-b pb-2 text-xs font-medium text-muted-foreground max-md:hidden ${COLUMNS}`}>
            <span role="columnheader">Subject</span><span role="columnheader">Raw score</span><span role="columnheader" className="text-right">Scaled</span><span role="columnheader">Counts as</span><span role="columnheader" className="sr-only">Remove</span>
          </div>
          {model.rows.map((item) => (
            <StudyRow
              key={item.row.id}
              item={item}
              options={studies.filter((study) => study.code === item.row.code || !model.rows.some((other) => other.row.code === study.code)).map((study) => study.studyName)}
              subjects={subjects}
              detailsOpen={sourceDetails === item.row.id}
              onDetails={(open) => onSourceDetails(open ? item.row.id : null)}
              onUpdate={(patch) => onUpdate(item.row.id, patch)}
              onStudy={(name) => onUpdate(item.row.id, { code: studies.find((study) => study.studyName === name)?.code ?? "" })}
              onRemove={model.rows.length > 1 ? () => onRemove(item.row.id) : undefined}
              onLogPractice={onLogPractice}
            />
          ))}
        </div>
        <Button variant="outline" className="justify-self-start" onClick={onAdd}><Plus />Add study</Button>
      </CardContent>
    </Card>
  )
}

function StudyRow({ item, options, subjects, detailsOpen, onDetails, onUpdate, onStudy, onRemove, onLogPractice }: {
  item: AtarModelRow
  options: string[]
  subjects: string[]
  detailsOpen: boolean
  onDetails: (open: boolean) => void
  onUpdate: (patch: Partial<AtarEstimatorRow>) => void
  onStudy: (name: string) => void
  onRemove?: () => void
  onLogPractice: () => void
}) {
  const { row, study, scaling, prediction, completedYear } = item
  const usePrediction = row.usePrediction
  const invalidScore = item.issue === "invalid-manual"
  const role = roleLabel(item)
  const name = study?.studyName ?? "subject"
  return (
    <div role="row" className={`grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-x-3 gap-y-2 border-b py-3 last:border-b-0 ${COLUMNS}`}>
      <div role="cell" className="max-md:col-span-3">
        {completedYear !== undefined ? <p className="text-xs text-muted-foreground">Completed {completedYear} · {scaling ? `${scaling.year} scaling${scaling.year !== completedYear ? " (fallback)" : ""}` : "No published scaling data for this study"}</p> : null}
        {!study && row.code ? <p className="text-xs text-destructive">No published scaling data for study {row.code}; choose a matching study to include it.</p> : null}
        <SubjectCombobox subjects={options} preferredSubjects={subjects} value={study?.studyName ?? ""} onValueChange={onStudy} className="w-full" />
      </div>
      <div role="cell" className="grid gap-2">
        <div className="flex gap-1" role="group" aria-label={`Score source for ${name}`}>
          <Button size="sm" variant={usePrediction ? "secondary" : "ghost"} aria-pressed={usePrediction} onClick={() => { onUpdate({ usePrediction: true }); onDetails(true) }}>Focal estimate</Button>
          <Button size="sm" variant={!usePrediction ? "secondary" : "ghost"} aria-pressed={!usePrediction} onClick={() => onUpdate({ usePrediction: false })}>Manual</Button>
        </div>
        <Input aria-label={`Raw score for ${name}`} aria-invalid={invalidScore || undefined} aria-describedby={invalidScore ? `score-error-${row.id}` : undefined} className="w-full tabular-nums" type="number" inputMode="numeric" min="20" max="50" step="1" value={usePrediction ? prediction?.studyScore ?? "" : row.raw} disabled={usePrediction} placeholder={usePrediction ? "No estimate" : "Enter score"} onChange={(event) => onUpdate({ raw: event.target.value })} />
        {usePrediction && prediction ? <p className="text-xs text-muted-foreground tabular-nums">Likely {prediction.low}–{prediction.high} · {prediction.confidence.toLowerCase()} confidence</p> : null}
        <Popover open={detailsOpen} onOpenChange={onDetails}>
          <PopoverTrigger className="text-left text-xs text-muted-foreground underline underline-offset-4" aria-label={`About Focal estimate for ${name}`}>How Focal estimates</PopoverTrigger>
          <PopoverContent>
            {prediction ? <>
              <p>{prediction.evidence.length} usable practice result(s). Most recent used: {prediction.evidence.map((evidence) => evidence.attempt.completedAt).toSorted().at(-1)}.</p>
              <ul className="max-h-48 overflow-auto">{prediction.evidence.map((evidence) => <li key={evidence.attempt.id}>{evidence.attempt.title} · {evidence.attempt.completedAt} · {evidence.referenceYear} distribution</li>)}</ul>
              <p>{prediction.excludedAttemptCount} result(s) excluded. SAC performance and missing maths papers are projected from practice.</p>
            </> : <p>No usable practice results yet. Log a paper with valid marks and a matching grade distribution to get a Focal estimate.</p>}
            <p>One usable result is enough. More recent results carry more weight. Assessment/SAC records are not used here.</p>
            <Button variant="outline" size="sm" onClick={onLogPractice}>Log practice</Button>
          </PopoverContent>
        </Popover>
      </div>
      <div role="cell" className="text-right text-sm tabular-nums max-md:hidden">{item.scaledScore !== null ? item.scaledScore.toFixed(1) : "—"}</div>
      <div role="cell" className="flex items-center gap-2 max-md:justify-end">
        <span className="text-sm tabular-nums text-muted-foreground md:hidden">{item.scaledScore !== null ? `${item.scaledScore.toFixed(1)} scaled` : null}</span>
        {role ? <Badge variant={role === "Not counted" ? "outline" : role === "10% increment" ? "secondary" : "default"}>{role}</Badge> : <span className="text-sm text-muted-foreground max-md:hidden">—</span>}
      </div>
      <div role="cell">
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${name}`} disabled={!onRemove} onClick={onRemove}><Trash2 /></Button>
      </div>
      {usePrediction && !prediction ? <p className="col-span-full text-xs text-muted-foreground">No usable practice results yet. <button className="underline underline-offset-4" onClick={onLogPractice}>Log a paper in Practice</button> with valid marks and a matching grade distribution, or choose Manual.</p> : null}
      {invalidScore ? <p id={`score-error-${row.id}`} className="col-span-full text-xs text-destructive">Enter a whole score from 20 to 50.</p> : null}
    </div>
  )
}
