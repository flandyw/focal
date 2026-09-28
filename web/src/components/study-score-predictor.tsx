import { useEffect, useMemo, useState } from "react"
import { Calculator, Info, Link2, TrendingUp } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { AtarEstimator } from "@/components/atar-estimator"
import { PageHeader } from "@/components/page-header"
import { SubjectCombobox } from "@/components/subject-combobox"
import { StudyScoreTrendChart } from "@/components/study-score-trend-chart"
import type { AppData, AssessmentReference, SavedAtarEstimate } from "@/lib/exam-data"
import { buildStudyScoreTrend, defaultExamWeight, predictStudyScore } from "@/lib/study-score"
import { prioritiseSubjects } from "@/lib/subjects"
import { normaliseScalingStudyName, predictScaledStudyScore, type ScalingReference } from "@/lib/scaling"

function usesMethodsWeighting(subject: string) {
  return /mathematical methods|specialist mathematics/i.test(subject)
}

export function StudyScorePredictor({
  data,
  references,
  scalingReferences,
  onSaveAtarEstimate,
  onDeleteAtarEstimate,
}: {
  data: AppData
  references: AssessmentReference[]
  scalingReferences: ScalingReference[]
  onSaveAtarEstimate: (estimate: SavedAtarEstimate) => void
  onDeleteAtarEstimate: (id: string) => void
}) {
  const subjects = useMemo(
    () => prioritiseSubjects(data.attempts.map((attempt) => attempt.subject), data.subjects),
    [data.attempts, data.subjects],
  )
  const [subject, setSubject] = useState(subjects[0] ?? "")
  const [sacPercentile, setSacPercentile] = useState("")
  const [examWeight, setExamWeight] = useState(() => defaultExamWeight(subjects[0] ?? ""))
  const [distributionYear, setDistributionYear] = useState("automatic")
  const [scalingYear, setScalingYear] = useState("combined")

  useEffect(() => {
    if (!subjects.includes(subject)) setSubject(subjects[0] ?? "")
  }, [subject, subjects])

  useEffect(() => {
    setExamWeight(defaultExamWeight(subject))
    setSacPercentile("")
    setDistributionYear("automatic")
    setScalingYear("combined")
  }, [subject])

  const distributionYears = useMemo(
    () => [...new Set(references
      .filter((reference) => normaliseScalingStudyName(reference.studyName) === normaliseScalingStudyName(subject))
      .map((reference) => reference.year))].toSorted((first, second) => second - first),
    [references, subject],
  )
  const selectedDistributionYear = distributionYear === "automatic" ? null : Number(distributionYear)

  const parsedSac = sacPercentile.trim() === "" ? null : Number(sacPercentile)
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
      <PageHeader
        title="Study score and ATAR"
        description="Estimate raw and scaled study scores, then combine subjects into a historical ATAR estimate."
      />

      {subjects.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Calculator /></EmptyMedia>
            <EmptyTitle>Log a practice exam first</EmptyTitle>
            <EmptyDescription>The study-score predictor needs at least one recorded result. You can still enter raw study scores manually in the ATAR estimator below.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Assumptions</CardTitle>
              <CardDescription>Adjust what ExamTrack cannot infer from practice exams.</CardDescription>
            </CardHeader>
            <CardContent>
              <FieldGroup>
                <Field>
                  <FieldLabel htmlFor="predictor-subject">Subject</FieldLabel>
                  <SubjectCombobox subjects={subjects} preferredSubjects={data.subjects} value={subject} onValueChange={setSubject} id="predictor-subject" className="w-full" />
                </Field>

                <Field>
                  <FieldLabel htmlFor="sac-percentile">Estimated moderated SAC percentile</FieldLabel>
                  <Input
                    id="sac-percentile"
                    type="number"
                    min="0.1"
                    max="99.9"
                    step="0.1"
                    inputMode="decimal"
                    placeholder="Optional"
                    value={sacPercentile}
                    onChange={(event) => setSacPercentile(event.target.value)}
                  />
                  <FieldDescription>
                    Enter your estimated statewide percentile after moderation. Leave blank to assume it matches your predicted exam percentile.
                  </FieldDescription>
                </Field>

                <Field>
                  <FieldLabel htmlFor="distribution-year">Grade distribution</FieldLabel>
                  <Select value={distributionYear} onValueChange={(value) => setDistributionYear(value ?? "automatic")}>
                    <SelectTrigger id="distribution-year" className="w-full">
                      <SelectValue>{distributionYear === "automatic" ? "Automatic" : distributionYear}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="automatic">Automatic (match exam year)</SelectItem>
                      {distributionYears.map((year) => <SelectItem key={year} value={String(year)}>{year}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FieldDescription>Choose a specific official year, or use the closest available distribution for each attempt.</FieldDescription>
                </Field>

                {usesMethodsWeighting(subject) ? (
                  <div className="grid grid-cols-3 gap-2 rounded-lg border bg-muted/30 p-3 text-center">
                    <div><p className="text-xs text-muted-foreground">Exam 1</p><p className="font-semibold tabular-nums">20%</p></div>
                    <div><p className="text-xs text-muted-foreground">Exam 2</p><p className="font-semibold tabular-nums">40%</p></div>
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
                        value={examWeight}
                        onChange={(event) => setExamWeight(Number(event.target.value))}
                      />
                      <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">%</span>
                    </div>
                    <FieldDescription>The remaining percentage is assigned to SACs.</FieldDescription>
                  </Field>
                )}
              </FieldGroup>
            </CardContent>
          </Card>

          <div className="grid gap-6">
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
                  <CardContent className="grid gap-6">
                    <div className="grid gap-6 sm:grid-cols-2">
                      <div>
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Raw</p>
                        <div className="mt-1 flex flex-wrap items-end gap-x-4 gap-y-1">
                          <span className="text-6xl font-semibold tracking-tight tabular-nums">{prediction.studyScore}</span>
                          <span className="pb-1.5 text-base text-muted-foreground tabular-nums">likely range {prediction.low}–{prediction.high}</span>
                        </div>
                      </div>
                      {scaledPrediction ? (
                        <div className="border-t pt-4 sm:border-l sm:border-t-0 sm:pl-6 sm:pt-0">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Scaled estimate</p>
                            <Select value={scalingYear} onValueChange={(value) => setScalingYear(value ?? "combined")}>
                              <SelectTrigger aria-label="Scaling report year" size="sm" className="w-auto min-w-32">
                                <SelectValue>{scalingYear === "combined" ? "Combined" : scalingYear}</SelectValue>
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
                          <p className="mt-1 text-xl font-semibold tabular-nums">{component.percentile.toFixed(0)}th</p>
                          {component.projected ? <p className="text-xs text-muted-foreground">Projected from available exams</p> : null}
                        </div>
                      ))}
                      <div><p className="text-xs text-muted-foreground">SAC percentile used</p><p className="mt-1 text-xl font-semibold tabular-nums">{prediction.sacPercentile.toFixed(0)}th</p></div>
                      <div><p className="text-xs text-muted-foreground">Combined percentile</p><p className="mt-1 text-xl font-semibold tabular-nums">{prediction.combinedPercentile.toFixed(0)}th</p></div>
                    </div>
                  </CardContent>
                </Card>

                <StudyScoreTrendChart points={studyScoreTrend} />

                <Card>
                  <CardHeader>
                    <CardTitle>Evidence used</CardTitle>
                    <CardDescription>Recent attempts carry more weight. When an exact-year distribution is unavailable, the nearest compatible VCAA distribution is used.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {prediction.approximatedEvidenceCount > 0 || prediction.excludedAttemptCount > 0 ? (
                      <div className="mb-3 grid gap-1 rounded-lg border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                        {prediction.approximatedEvidenceCount > 0 ? (
                          <p>{prediction.approximatedEvidenceCount} attempt{prediction.approximatedEvidenceCount === 1 ? " uses" : "s use"} another year&apos;s distribution because its exact exam-year distribution is unavailable.</p>
                        ) : null}
                        {prediction.excludedAttemptCount > 0 ? (
                          <p>{prediction.excludedAttemptCount} attempt{prediction.excludedAttemptCount === 1 ? " could" : "s could"} not be matched to any compatible distribution and {prediction.excludedAttemptCount === 1 ? "is" : "are"} excluded.</p>
                        ) : null}
                      </div>
                    ) : null}
                    <ul className="divide-y rounded-lg border">
                      {[...prediction.evidence].reverse().map(({ attempt, percentile, weight, referenceYear, exactReferenceYear }) => (
                        <li key={attempt.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{attempt.title} · {attempt.paper} · {attempt.examYear}</p>
                            <p className="text-xs text-muted-foreground">
                              {attempt.completedAt} · {(attempt.rawScore / attempt.rawMax * 100).toFixed(1)}%
                              {!exactReferenceYear ? ` · using ${referenceYear} distribution` : ""}
                            </p>
                          </div>
                          <span className="text-sm font-medium tabular-nums">{percentile.toFixed(0)}th percentile</span>
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
                  <EmptyDescription>Log a paper that matches a VCAA examination in the reference data to predict this subject.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
          </div>
        </div>
      )}

      <Alert>
        <Info />
        <AlertTitle>Estimate only</AlertTitle>
        <AlertDescription>
          Raw scores remain uncertain because VCAA moderation, exam difficulty, cohort strength and the final statewide distribution can move the result. The scaled estimate interpolates between VTAC&apos;s published 20, 25, 30, 35, 40, 45 and 50 rows; the official process uses unrounded values and changes each year.
        </AlertDescription>
      </Alert>

      <div className="flex items-start gap-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <TrendingUp className="mt-0.5 size-4 shrink-0" />
        The algorithm models study scores with a statewide mean of 30 and standard deviation of 7, after combining the recency-weighted exam and SAC percentile estimates.
      </div>

      <AtarEstimator
        data={data}
        references={references}
        scalingReferences={scalingReferences}
        savedEstimates={data.atarEstimates}
        onSaveEstimate={onSaveAtarEstimate}
        onDeleteEstimate={onDeleteAtarEstimate}
      />
    </div>
  )
}
