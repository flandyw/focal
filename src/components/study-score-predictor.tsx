import { useMemo, useState } from "react"
import { Calculator, CircleCheck, Info, Link2, Minus, Plus, Target, TrendingUp, TriangleAlert } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Badge } from "./ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Button } from "./ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Slider } from "./ui/slider"
import { PageHeader } from "./page-header"
import { SubjectCombobox } from "./subject-combobox"
import { StudyScoreTrendChart } from "./study-score-trend-chart"
import { Meter } from "./workspace-layout"
import { formatOrdinal, formatReferenceName, type AppData, type AssessmentReference } from "../lib/exam-data"
import { buildStudyScoreTrend, defaultExamWeight, isTwoPaperMathematics, predictStudyScore, requiredExamPercentile, sacPercentileFromRank, targetExamMarks } from "../lib/study-score"
import { prioritiseSubjects } from "../lib/subjects"
import { normaliseScalingStudyName, predictScaledStudyScore, type ScalingReference } from "../lib/scaling"

function sacInputs(subject: string) {
  try {
    const saved = JSON.parse(localStorage.getItem(`focal:study-score-sac:${subject}`) ?? "null")
    return {
      sacMode: saved?.sacMode === "percentile" ? "percentile" : "rank",
      sacRank: typeof saved?.sacRank === "string" ? saved.sacRank : "",
      sacCohort: typeof saved?.sacCohort === "string" ? saved.sacCohort : "",
      schoolMedian: typeof saved?.schoolMedian === "string" ? saved.schoolMedian : "",
      sacPercentile: typeof saved?.sacPercentile === "string" ? saved.sacPercentile : "",
    }
  } catch {
    return { sacMode: "rank", sacRank: "", sacCohort: "", schoolMedian: "", sacPercentile: "" }
  }
}

function targetInput(subject: string) {
  try { return localStorage.getItem(`focal:study-score-target:${subject}`) } catch { return null }
}

export function StudyScorePredictor({
  data,
  references,
  scalingReferences,
  onLogExam,
  onOpenAtar,
}: {
  data: AppData
  references: AssessmentReference[]
  scalingReferences: ScalingReference[]
  onLogExam: () => void
  onOpenAtar: () => void
}) {
  const subjects = useMemo(
    () => prioritiseSubjects(data.attempts.map((attempt) => attempt.subject), data.subjects),
    [data.attempts, data.subjects],
  )
  const [selectedSubject, setSubject] = useState(subjects[0] ?? "")
  const subject = subjects.includes(selectedSubject) ? selectedSubject : subjects[0] ?? ""
  const [savedInputs, setSavedInputs] = useState(() => ({
    subject,
    ...sacInputs(subject),
    examWeight: defaultExamWeight(subject),
    distributionYear: "automatic",
    scalingYear: "combined",
  }))
  const inputs = savedInputs.subject === subject ? savedInputs : {
    subject,
    ...sacInputs(subject),
    examWeight: defaultExamWeight(subject),
    distributionYear: "automatic",
    scalingYear: "combined",
  }
  const [savedTarget, setSavedTarget] = useState(() => ({ subject, value: targetInput(subject) }))
  if (savedTarget.subject !== subject) setSavedTarget({ subject, value: targetInput(subject) })
  if (selectedSubject !== subject) setSubject(subject)
  if (savedInputs.subject !== subject) setSavedInputs(inputs)
  const { sacMode, sacRank, sacCohort, schoolMedian, sacPercentile, examWeight, distributionYear, scalingYear } = inputs
  function saveSac(patch: Partial<ReturnType<typeof sacInputs>>) {
    const next = { sacMode, sacRank, sacCohort, schoolMedian, sacPercentile, ...patch }
    setSavedInputs({ ...inputs, ...next })
    try { localStorage.setItem(`focal:study-score-sac:${subject}`, JSON.stringify(next)) } catch { /* Inputs still work for this session. */ }
  }

  const distributionYears = useMemo(
    () => [...new Set(references
      .filter((reference) => normaliseScalingStudyName(reference.studyName) === normaliseScalingStudyName(subject))
      .map((reference) => reference.year))].toSorted((first, second) => second - first),
    [references, subject],
  )
  const selectedDistributionYear = distributionYear === "automatic" ? null : Number(distributionYear)

  const schoolMedianInvalid = schoolMedian.trim() !== "" && !(Number(schoolMedian) >= 20 && Number(schoolMedian) <= 45)
  const sacRankInvalid = sacMode === "rank" && sacRank.trim() !== "" && sacCohort.trim() !== "" && (!Number.isInteger(Number(sacRank)) || !Number.isInteger(Number(sacCohort)) || !(Number(sacRank) >= 1 && Number(sacRank) <= Number(sacCohort)))
  const parsedSac = sacMode === "rank"
    ? schoolMedianInvalid || sacRank.trim() === "" || sacCohort.trim() === "" || sacRankInvalid ? null : sacPercentileFromRank(
      Number(sacRank),
      Number(sacCohort),
      schoolMedian.trim() === "" ? undefined : Number(schoolMedian),
    )
    : sacPercentile.trim() === "" || !(Number(sacPercentile) > 0 && Number(sacPercentile) < 100) ? null : Number(sacPercentile)
  const sacPercentileInvalid = sacMode === "percentile" && sacPercentile.trim() !== "" && parsedSac === null
  const prediction = useMemo(
    () => predictStudyScore({
      subject,
      attempts: data.attempts,
      references,
      sacPercentile: parsedSac !== null && Number.isFinite(parsedSac) ? parsedSac : null,
      examWeightPercent: examWeight,
      distributionYear: selectedDistributionYear,
    }),
    [data.attempts, examWeight, parsedSac, references, selectedDistributionYear, subject],
  )
  const studyScoreTrend = useMemo(
    () => buildStudyScoreTrend({
      subject,
      attempts: data.attempts,
      references,
      sacPercentile: parsedSac !== null && Number.isFinite(parsedSac) ? parsedSac : null,
      examWeightPercent: examWeight,
      distributionYear: selectedDistributionYear,
    }),
    [data.attempts, examWeight, parsedSac, references, selectedDistributionYear, subject],
  )
  const targetValue = (savedTarget.subject === subject ? savedTarget.value : targetInput(subject)) ?? String(Math.min(50, (prediction?.studyScore ?? 30) + 3))
  const target = Number(targetValue)
  const targetInvalid = !targetValue.trim() || !Number.isInteger(target) || target < 20 || target > 50
  const requiredExam = prediction && !targetInvalid
    ? requiredExamPercentile(target, parsedSac, prediction.examWeightPercent) : null
  const targetMarks = requiredExam && !requiredExam.outOfReach && !requiredExam.alreadySecured
    ? targetExamMarks(subject, references, requiredExam.percentile) : []
  function setTarget(value: string) {
    setSavedTarget({ subject, value })
    try { localStorage.setItem(`focal:study-score-target:${subject}`, value) } catch { /* Inputs still work for this session. */ }
  }
  // The stepper and slider start from the prediction when the typed target is unusable.
  const targetBase = targetInvalid ? Math.min(50, Math.max(20, prediction?.studyScore ?? 30)) : target
  const scalePosition = (score: number) => `${Math.min(100, Math.max(0, (score - 20) / 30 * 100))}%`
  const targetGap = prediction ? target - prediction.studyScore : 0
  const targetStatus = !prediction || targetInvalid ? null
    : !requiredExam ? { variant: "secondary" as const, icon: Info, label: "Depends on SACs" }
    : requiredExam.outOfReach ? { variant: "destructive" as const, icon: TriangleAlert, label: "Out of reach" }
    : requiredExam.alreadySecured ? { variant: "success" as const, icon: CircleCheck, label: "Secured by SACs" }
    : targetGap <= 0 ? { variant: "success" as const, icon: CircleCheck, label: "On track" }
    : targetGap <= prediction.high - prediction.studyScore ? { variant: "default" as const, icon: TrendingUp, label: `${targetGap} above prediction` }
    : { variant: "warning" as const, icon: TrendingUp, label: `Stretch: ${targetGap} above prediction` }
  const scalingYears = useMemo(
    () => [...new Set(scalingReferences
      .filter((reference) => normaliseScalingStudyName(reference.studyName) === normaliseScalingStudyName(subject))
      .map((reference) => reference.year))].toSorted((first, second) => second - first),
    [scalingReferences, subject],
  )
  const scaledPrediction = useMemo(
    () => prediction ? predictScaledStudyScore(
      prediction.studyScore,
      subject,
      scalingReferences,
      scalingYear === "combined" ? null : Number(scalingYear),
    ) : null,
    [prediction, scalingReferences, scalingYear, subject],
  )
  const recordedAttemptCount = prediction
    ? prediction.evidence.length + prediction.excludedAttemptCount
    : 0

  return (
    <div className="grid gap-8">
      <PageHeader icon={TrendingUp} title="Study score" description="An estimated raw and scaled score based on your practice papers and SACs." />

      {subjects.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Calculator /></EmptyMedia>
            <EmptyTitle>Log a practice exam first</EmptyTitle>
            <EmptyDescription>The predictor needs at least one logged result to work with. You can still type raw study scores straight into the ATAR page.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex flex-wrap justify-center gap-2"><Button onClick={onLogExam}>Log exam</Button><Button variant="outline" onClick={onOpenAtar}>Open ATAR</Button></EmptyContent>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Assumptions</CardTitle>
              
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="predictor-subject">Subject</FieldLabel>
                  <SubjectCombobox subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={setSubject} id="predictor-subject" className="w-full" />
                </Field>

                <Field>
                  <FieldLabel htmlFor="sac-mode">SAC results</FieldLabel>
                  <Select value={sacMode} onValueChange={(value) => saveSac({ sacMode: value ?? "rank" })}>
                    <SelectTrigger id="sac-mode" className="w-full">
                      <SelectValue>{sacMode === "rank" ? "School rank" : "Moderated percentile"}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="rank">School rank</SelectItem>
                      <SelectItem value="percentile">Moderated percentile</SelectItem>
                    </SelectContent>
                  </Select>
                  {sacMode === "rank" ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        <Input
                          aria-label="SAC rank"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          placeholder="Rank"
                          value={sacRank}
                          aria-invalid={sacRankInvalid || undefined}
                          aria-describedby="sac-rank-description"
                          onChange={(event) => saveSac({ sacRank: event.target.value })}
                        />
                        <Input
                          aria-label="Students in subject at your school"
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          placeholder="Out of"
                          value={sacCohort}
                          aria-invalid={sacRankInvalid || undefined}
                          aria-describedby="sac-rank-description"
                          onChange={(event) => saveSac({ sacCohort: event.target.value })}
                        />
                      </div>
                      <Input
                        aria-label="School median study score"
                        type="number"
                        min="20"
                        max="45"
                        step="1"
                        inputMode="numeric"
                        placeholder="School median study score (optional, 30 is average)"
                        value={schoolMedian}
                        aria-invalid={schoolMedianInvalid || undefined}
                        aria-describedby="sac-rank-description"
                        onChange={(event) => saveSac({ schoolMedian: event.target.value })}
                      />
                      <FieldDescription id="sac-rank-description" className={schoolMedianInvalid || sacRankInvalid ? "text-destructive" : undefined}>
                        {schoolMedianInvalid ? "School median must be between 20 and 45. Leave blank to assume 30."
                          : parsedSac !== null
                          ? `About the ${formatOrdinal(parsedSac)} percentile statewide after moderation.`
                          : sacRankInvalid ? "Enter whole numbers with rank between 1 and the number of students."
                          : "Your SAC rank in this subject at your school, e.g. 3 out of 40. Schools usually publish their median study score. Leave blank to assume SACs match your exam percentile."}
                      </FieldDescription>
                    </>
                  ) : (
                    <>
                      <Input
                        id="sac-percentile"
                        aria-label="Moderated SAC percentile"
                        type="number"
                        min="0.1"
                        max="99.9"
                        step="0.1"
                        inputMode="decimal"
                        placeholder="Optional"
                        value={sacPercentile}
                        aria-invalid={sacPercentileInvalid || undefined}
                        aria-describedby="sac-percentile-description"
                        onChange={(event) => saveSac({ sacPercentile: event.target.value })}
                      />
                      <FieldDescription id="sac-percentile-description" className={sacPercentileInvalid ? "text-destructive" : undefined}>
                        {sacPercentileInvalid ? "Enter a percentile between 0 and 100." : "Your estimated statewide percentile after moderation. Leave blank to assume it matches your predicted exam percentile."}
                      </FieldDescription>
                    </>
                  )}
                </Field>

                <Field>
                  <FieldLabel htmlFor="distribution-year">Grade distribution</FieldLabel>
                  <Select value={distributionYear} onValueChange={(value) => setSavedInputs({ ...inputs, distributionYear: value ?? "automatic" })}>
                    <SelectTrigger id="distribution-year" className="w-full">
                      <SelectValue>{distributionYear === "automatic" ? "Automatic (match exam year)" : distributionYear}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="automatic">Automatic (match exam year)</SelectItem>
                      {distributionYears.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Choose a specific official year, or use the closest available distribution for each attempt.</FieldDescription>
                </Field>

                {isTwoPaperMathematics(subject) ? (
                  <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Exam 1</p><p className="font-semibold tabular-nums">{normaliseScalingStudyName(subject) === "general mathematics" ? 30 : 20}%</p></div>
                    <div><p className="text-xs text-muted-foreground">Exam 2</p><p className="font-semibold tabular-nums">{normaliseScalingStudyName(subject) === "general mathematics" ? 30 : 40}%</p></div>
                    <div><p className="text-xs text-muted-foreground">SACs</p><p className="font-semibold tabular-nums">40%</p></div>
                  </div>
                ) : (
                  <Field>
                    <FieldLabel htmlFor="exam-weight">Final examination weighting</FieldLabel>
                    <div className="relative">
                      <Input
                        id="exam-weight"
                        className="pr-8"
                        type="number"
                        min="0"
                        max="100"
                        step="1"
                        inputMode="numeric"
                        value={examWeight}
                        onChange={(event) => setSavedInputs({ ...inputs, examWeight: Math.min(100, Math.max(0, Number(event.target.value))) })}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                    <FieldDescription>The remaining percentage is assigned to SACs.</FieldDescription>
                  </Field>
                )}
              </FieldGroup>
            </CardContent>
          </Card>

          <div className="grid gap-5">
            {prediction ? (
              <>
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <CardTitle>Predicted raw study score</CardTitle>
                        <CardDescription>Based on {prediction.evidence.length} of {recordedAttemptCount} recorded attempt{recordedAttemptCount === 1 ? "" : "s"}.</CardDescription>
                      </div>
                      <Badge variant="outline">{prediction.confidence} confidence</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-5">
                    <div className="grid gap-5 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Raw</p>
                        <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
                          <span className="text-6xl font-semibold tracking-tight tabular-nums">{prediction.studyScore}</span>
                          <span className="pb-1.5 text-base text-muted-foreground tabular-nums">estimated range {prediction.low}–{prediction.high}</span>
                        </div>
                      </div>
                      {scaledPrediction ? (
                        <div className="border-t pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scaled estimate</p>
                            <Select value={scalingYear} onValueChange={(value) => setSavedInputs({ ...inputs, scalingYear: value ?? "combined" })}>
                              <SelectTrigger aria-label="Scaling report year" size="sm" className="w-auto min-w-32">
                                <SelectValue>{scalingYear === "combined" ? `Combined (${Math.min(...scalingYears)}–${Math.max(...scalingYears)})` : scalingYear}</SelectValue>
                              </SelectTrigger>
                              <SelectContent align="end">
                                <SelectItem value="combined">Combined ({Math.min(...scalingYears)}–{Math.max(...scalingYears)})</SelectItem>
                                {scalingYears.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
                              </SelectContent>
                            </Select>
                          </div>
                          <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
                            <span className="text-6xl font-semibold tracking-tight tabular-nums">{scaledPrediction.scaledScore.toFixed(1)}</span>
                            {scaledPrediction.yearEstimates.length > 1 ? <span className="pb-1.5 text-sm text-muted-foreground tabular-nums">historical range {scaledPrediction.minimum.toFixed(1)}–{scaledPrediction.maximum.toFixed(1)}</span> : null}
                          </div>
                          <p className="mt-2 text-xs text-muted-foreground">
                            {scaledPrediction.yearEstimates.length > 1
                              ? `Average of ${scaledPrediction.yearEstimates.length} VTAC scaling reports (${scaledPrediction.yearEstimates[0]?.year}–${scaledPrediction.yearEstimates.at(-1)?.year}).`
                              : `Based on the ${scaledPrediction.yearEstimates[0]?.year} VTAC scaling report.`}{" "}
                            <a className="underline underline-offset-4 hover:text-foreground" href={scaledPrediction.yearEstimates.at(-1)?.sourceUrl} target="_blank" rel="noreferrer">View report</a>
                          </p>
                        </div>
                      ) : null}
                    </div>
                    <div className="grid gap-4 rounded-lg border bg-muted/30 p-4 sm:grid-cols-2 lg:grid-cols-4">
                      {prediction.components.map((component) => (
                        <div key={component.label}>
                          <p className="text-xs text-muted-foreground">{component.label} · {component.weightPercent}%</p>
                          <p className="mt-1 text-xl font-semibold tabular-nums">{formatOrdinal(component.percentile)}</p>
                          {component.projected ? <p className="text-xs text-muted-foreground">Projected from available exams</p> : null}
                        </div>
                      ))}
                      <div><p className="text-xs text-muted-foreground">SAC percentile used</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatOrdinal(prediction.sacPercentile)}</p></div>
                      <div><p className="text-xs text-muted-foreground">Combined percentile</p><p className="mt-1 text-xl font-semibold tabular-nums">{formatOrdinal(prediction.combinedPercentile)}</p></div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 basis-64 items-start gap-3">
                        <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Target className="size-4.5" strokeWidth={1.75} /></span>
                        <div>
                          <CardTitle><label id="study-score-target-label" htmlFor="study-score-target">Target study score</label></CardTitle>
                          <CardDescription id="study-score-target-description" className={targetInvalid ? "text-destructive" : undefined}>
                            {targetInvalid ? "Enter a whole study score between 20 and 50." : "What the exam needs to deliver, under the same assumptions as your prediction."}
                          </CardDescription>
                        </div>
                      </div>
                      {targetStatus ? <Badge variant={targetStatus.variant}><targetStatus.icon />{targetStatus.label}</Badge> : null}
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-5">
                    <div className="grid gap-x-8 gap-y-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
                      <div className="flex items-center gap-1.5">
                        <Button variant="outline" size="icon" aria-label="Lower target" disabled={targetBase <= 20} onClick={() => setTarget(String(targetBase - 1))}><Minus /></Button>
                        <Input
                          id="study-score-target"
                          className="h-12 w-20 [appearance:textfield] px-1 text-center text-3xl! font-semibold tabular-nums [&::-webkit-inner-spin-button]:appearance-none"
                          type="number"
                          min="20"
                          max="50"
                          step="1"
                          inputMode="numeric"
                          value={targetValue}
                          aria-invalid={targetInvalid || undefined}
                          aria-describedby="study-score-target-description"
                          onChange={(event) => setTarget(event.target.value)}
                        />
                        <Button variant="outline" size="icon" aria-label="Raise target" disabled={targetBase >= 50} onClick={() => setTarget(String(targetBase + 1))}><Plus /></Button>
                      </div>
                      <div className="grid gap-2">
                        <div className="relative py-2">
                          {/* Inset by half the thumb so marks line up with the edge-aligned slider. */}
                          <div aria-hidden className="pointer-events-none absolute inset-x-1.5 inset-y-0">
                            <span className="absolute inset-y-1 rounded-sm bg-primary/15" style={{ left: scalePosition(prediction.low), right: `calc(100% - ${scalePosition(prediction.high)})` }} />
                            <span className="absolute inset-y-0 w-0.5 -translate-x-1/2 rounded-full bg-foreground" style={{ left: scalePosition(prediction.studyScore) }} />
                          </div>
                          <Slider aria-labelledby="study-score-target-label" min={20} max={50} step={1} value={targetBase} onValueChange={(value) => setTarget(String(value))} />
                        </div>
                        <div aria-hidden className="flex justify-between px-1.5 text-xs text-muted-foreground tabular-nums"><span>20</span><span>30</span><span>40</span><span>50</span></div>
                        <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground tabular-nums">
                          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-3 w-0.5 rounded-full bg-foreground" />Predicted {prediction.studyScore}</span>
                          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="h-2.5 w-4 rounded-sm bg-primary/15" />Likely range {prediction.low}–{prediction.high}</span>
                          <span className="inline-flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full border border-ring bg-white" />Target{targetInvalid ? "" : ` ${target}`}</span>
                        </p>
                      </div>
                    </div>
                    {!targetInvalid ? (
                      <div className="grid gap-3 text-sm tabular-nums" aria-live="polite">
                        {!requiredExam ? <p className="rounded-lg border bg-muted/30 px-3 py-2">The exam has no weighting, so this target depends entirely on SACs.</p>
                          : requiredExam.outOfReach ? <p className="rounded-lg border bg-muted/30 px-3 py-2">This target is out of reach under these assumptions: it needs above the 99.9th exam percentile. Revisit your SAC estimate or target.</p>
                          : requiredExam.alreadySecured ? <p className="rounded-lg border bg-muted/30 px-3 py-2">This target is already secured by SACs in this model (below the 0.1st exam percentile needed), not a guaranteed result.</p>
                          : (
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(11rem,1fr))] gap-3">
                              <div className="grid content-start gap-2 rounded-lg border bg-muted/30 p-3">
                                <p className="text-xs text-muted-foreground">Percentile needed on {isTwoPaperMathematics(subject) ? "both exams" : "the exam"}</p>
                                <p className="text-2xl font-semibold">{formatOrdinal(Math.min(99, requiredExam.percentile))}</p>
                                <span aria-hidden className="relative block h-1.5 rounded-full bg-muted">
                                  <span className={`block h-full rounded-full transition-[width] duration-200 ${targetGap <= 0 ? "bg-success" : "bg-primary"}`} style={{ width: `${prediction.examPercentile}%` }} />
                                  <span className="absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-foreground transition-[left] duration-200" style={{ left: `${requiredExam.percentile}%` }} />
                                </span>
                                <p className="text-xs text-muted-foreground">
                                  Your exams now: {formatOrdinal(prediction.examPercentile)}
                                  {targetGap > 0 && Math.round(requiredExam.percentile) > Math.round(prediction.examPercentile) ? ` · ${Math.round(requiredExam.percentile) - Math.round(prediction.examPercentile)} to go` : ""}
                                </p>
                              </div>
                              {targetMarks.map(({ reference, percentage }) => (
                                <div key={reference.id} className="grid content-start gap-2 rounded-lg border bg-muted/30 p-3">
                                  <p className="truncate text-xs text-muted-foreground" title={`${reference.year} ${formatReferenceName(reference.name)}`}>{reference.year} {formatReferenceName(reference.name)}</p>
                                  <p className="text-2xl font-semibold">≈ {Math.round(percentage)}%</p>
                                  <Meter value={percentage} barClassName="transition-[width] duration-200" />
                                  <p className="text-xs text-muted-foreground">Mark needed, based on this paper</p>
                                </div>
                              ))}
                            </div>
                          )}
                        <p className="text-xs text-muted-foreground">
                          {targetGap <= 0 ? "Your current prediction already meets this target; it is not a guaranteed result. " : ""}
                          {parsedSac === null && requiredExam ? "No SAC result entered, so SACs are assumed to match your exam percentile." : ""}
                        </p>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <StudyScoreTrendChart points={studyScoreTrend} target={targetInvalid ? undefined : target} />

                <Card>
                  <CardHeader>
                    <CardTitle>Evidence used</CardTitle>
                    <CardDescription>Recent attempts carry more weight. When an exact-year distribution is unavailable, the nearest compatible VCAA distribution is used.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {prediction.approximatedEvidenceCount > 0 || prediction.excludedAttemptCount > 0 ? (
                      <div className="mb-3 grid gap-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        {prediction.approximatedEvidenceCount > 0 ? (
                          <p>{prediction.approximatedEvidenceCount} attempt{prediction.approximatedEvidenceCount === 1 ? " uses" : "s use"} another year&apos;s distribution. This widens the estimated range.</p>
                        ) : null}
                        {prediction.excludedAttemptCount > 0 ? (
                          <p>{prediction.excludedAttemptCount} attempt{prediction.excludedAttemptCount === 1 ? " lacks a valid mark or compatible distribution and is" : "s lack valid marks or compatible distributions and are"} excluded. Combined mathematics papers need separate results for each exam.</p>
                        ) : null}
                      </div>
                    ) : null}
                    <ul className="divide-y rounded-lg border">
                      {[...prediction.evidence].reverse().map(({ attempt, percentile, weight, referenceYear, exactReferenceYear }) => (
                        <li key={attempt.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1 basis-48">
                            <p className="truncate text-sm font-medium" title={`${attempt.title} · ${attempt.paper}`}>{attempt.title} · {attempt.paper}</p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(`${attempt.completedAt}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} · {(attempt.rawScore / attempt.rawMax * 100).toFixed(1)}%
                              {!exactReferenceYear ? ` · using ${referenceYear} distribution` : ""}
                            </p>
                          </div>
                          <span className="text-sm font-medium tabular-nums">{formatOrdinal(percentile)} percentile</span>
                          <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">{(weight * 100).toFixed(0)}% weight</span>
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Empty className="min-h-80 border">
                <EmptyHeader>
                  <EmptyMedia variant="icon"><Link2 /></EmptyMedia>
                  <EmptyTitle>No official comparison available</EmptyTitle>
                  <EmptyDescription>Log a paper that matches a VCAA exam in the reference data to get an estimate for this subject.</EmptyDescription>
                </EmptyHeader>
                <EmptyContent><Button onClick={onLogExam}>Log exam</Button></EmptyContent>
              </Empty>
            )}
          </div>
        </div>
      )}

      <Alert>
        <Info />
        <AlertTitle>Estimate only</AlertTitle>
        <AlertDescription>
          Practice percentiles are converted to normal scores before weighting to approximate VCAA standardisation, though your final cohort ranking and moderation can’t be known in advance. Ranges are indicative, with wider uncertainty for projected SACs, missing papers, and other-year distributions. The scaled estimate interpolates between VTAC&apos;s published raw scores of 20–50, while the official process uses unrounded values and shifts slightly each year.
        </AlertDescription>
      </Alert>

      <div className="flex items-start gap-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <TrendingUp className="mt-0.5 size-4 shrink-0" />
        The algorithm models study scores with a statewide mean of 30 and standard deviation of 7, after combining the recency-weighted exam and SAC normal-score estimates.
      </div>
    </div>
  )
}
