import { useMemo, useState } from "react"
import { Calculator, Info, Link2, TrendingUp } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Badge } from "./ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Button } from "./ui/button"
import { Field, FieldDescription, FieldGroup, FieldLabel } from "./ui/field"
import { Input } from "./ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { PageHeader } from "./page-header"
import { SubjectCombobox } from "./subject-combobox"
import { StudyScoreTrendChart } from "./study-score-trend-chart"
import type { AppData, AssessmentReference } from "../lib/exam-data"
import { buildStudyScoreTrend, defaultExamWeight, isTwoPaperMathematics, predictStudyScore, sacPercentileFromRank } from "../lib/study-score"
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

  const parsedSac = sacMode === "rank"
    ? sacRank.trim() === "" || sacCohort.trim() === "" ? null : sacPercentileFromRank(
      Number(sacRank),
      Number(sacCohort),
      schoolMedian.trim() === "" || !Number.isFinite(Number(schoolMedian)) ? undefined : Number(schoolMedian),
    )
    : sacPercentile.trim() === "" ? null : Number(sacPercentile)
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
      <PageHeader title="Study score" />

      {subjects.length === 0 ? (
        <Empty className="min-h-80 border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Calculator /></EmptyMedia>
            <EmptyTitle>Log a practice exam first</EmptyTitle>
            <EmptyDescription>The study-score predictor needs at least one recorded result. You can still enter raw study scores manually on the ATAR page.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent className="flex flex-wrap justify-center gap-2"><Button onClick={onLogExam}>Log exam</Button><Button variant="outline" onClick={onOpenAtar}>Open ATAR</Button></EmptyContent>
        </Empty>
      ) : (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Assumptions</CardTitle>
              <CardDescription>Adjust what Focal cannot infer from practice exams.</CardDescription>
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
                        onChange={(event) => saveSac({ schoolMedian: event.target.value })}
                      />
                      <FieldDescription>
                        {parsedSac !== null
                          ? `About the ${parsedSac.toFixed(0)}th percentile statewide after moderation.`
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
                        onChange={(event) => saveSac({ sacPercentile: event.target.value })}
                      />
                      <FieldDescription>
                        Your estimated statewide percentile after moderation. Leave blank to assume it matches your predicted exam percentile.
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
                        value={examWeight}
                        onChange={(event) => setSavedInputs({ ...inputs, examWeight: Number(event.target.value) })}
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
          Practice percentiles are converted to normal scores before weighting. This approximates VCAA standardisation; the final cohort ranking and moderation are unknown. Ranges are indicative, with extra uncertainty for projected SACs, missing papers and other-year distributions. The scaled estimate interpolates between VTAC&apos;s published raw scores of 20–50; the official process uses unrounded values and changes each year.
        </AlertDescription>
      </Alert>

      <div className="flex items-start gap-3 rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        <TrendingUp className="mt-0.5 size-4 shrink-0" />
        The algorithm models study scores with a statewide mean of 30 and standard deviation of 7, after combining the recency-weighted exam and SAC normal-score estimates.
      </div>
    </div>
  )
}
