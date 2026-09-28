import { useMemo, useState } from "react"
import { ExternalLink, FileCheck2, Play } from "lucide-react"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { PageHeader } from "@/components/page-header"
import { SubjectCombobox } from "@/components/subject-combobox"
import {
  buildVcaaYearInsights,
  formatOrdinal,
  formatReferenceName,
  normaliseComparisonName,
  type AssessmentReference,
  type ExamAttempt,
} from "@/lib/exam-data"
import { firstPreferredSubject, prioritiseSubjects } from "@/lib/subjects"
import type { ExamTimerPreset } from "@/components/exam-timer"
import { getKnownExamConditions } from "@/lib/exam-conditions"
import { getCachedVcaaExams, getVcaaExamCompanions, getVcaaExamPaper, getVcaaExamProvider, type VcaaStudyResources } from "@/lib/vcaa-resources"

const chartConfig = {
  aPlusCutoffPercentage: { label: "A+ cutoff", color: "#dc2626" },
  meanPercentage: { label: "Estimated mean", color: "#2563eb" },
  medianPercentage: { label: "Estimated median", color: "#ca8a04" },
} satisfies ChartConfig

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`
}

export type VcaaExplorerPreset = {
  subject: string
  paper: string
  score: number
}

export function VcaaExplorer({ references, attempts, preferredSubjects, studies = [], initialSelection, onOpenLibrary, onStart }: { references: AssessmentReference[]; attempts: ExamAttempt[]; preferredSubjects: string[]; studies?: VcaaStudyResources[]; initialSelection?: VcaaExplorerPreset | null; onOpenLibrary?: () => void; onStart?: (preset: ExamTimerPreset) => void }) {
  const latestAttempt = attempts.toSorted((a, b) => b.completedAt.localeCompare(a.completedAt))[0]
  const subjects = useMemo(
    () => prioritiseSubjects(references.map((reference) => reference.studyName), preferredSubjects),
    [preferredSubjects, references],
  )
  const resourceSubjects = useMemo(() => new Set(getCachedVcaaExams(studies).map((exam) => normaliseComparisonName(exam.studyName))), [studies])
  const presetSubject = subjects.find((item) => normaliseComparisonName(item) === normaliseComparisonName(initialSelection?.subject ?? ""))
  const initialSubject = presetSubject || firstPreferredSubject(subjects, preferredSubjects) || (subjects.includes(latestAttempt?.subject) ? latestAttempt.subject : "") || subjects.find((item) => resourceSubjects.has(normaliseComparisonName(item))) || (subjects[0] ?? "")
  const [subjectValue, setSubject] = useState(initialSubject)
  const subject = subjects.includes(subjectValue) ? subjectValue : initialSubject
  const subjectReferences = useMemo(() => references.filter((reference) => reference.studyName === subject), [references, subject])
  const papers = useMemo(() => [...new Map(subjectReferences.map((reference) => [
    normaliseComparisonName(reference.name),
    formatReferenceName(reference.name),
  ])).entries()], [subjectReferences])
  const latestPaperKey = initialSelection && normaliseComparisonName(initialSelection.subject) === normaliseComparisonName(subject)
    ? normaliseComparisonName(initialSelection.paper)
    : latestAttempt?.subject === subject ? normaliseComparisonName(latestAttempt.paper) : ""
  const [paper, setPaper] = useState(papers.some(([key]) => key === latestPaperKey) ? latestPaperKey : (papers[0]?.[0] ?? ""))
  const selectedPaper = papers.some(([key]) => key === paper) ? paper : (papers[0]?.[0] ?? "")
  const initialScore = initialSelection && normaliseComparisonName(initialSelection.subject) === normaliseComparisonName(initialSubject)
    ? initialSelection.score
    : latestAttempt && latestAttempt.subject === initialSubject
    ? (latestAttempt.rawScore / latestAttempt.rawMax) * 100
    : 75
  const [score, setScore] = useState(initialScore)
  const matchingReferences = useMemo(() => subjectReferences.filter(
    (reference) => normaliseComparisonName(reference.name) === selectedPaper,
  ), [subjectReferences, selectedPaper])
  const insights = useMemo(() => buildVcaaYearInsights(matchingReferences, score), [matchingReferences, score])
  const latest = insights.at(-1)
  const cohortTotal = insights.reduce((total, insight) => total + (insight.cohortSize ?? 0), 0)
  const selectedStudy = useMemo(() => studies.find((study) => normaliseComparisonName(study.studyName) === normaliseComparisonName(subject)), [studies, subject])
  const selectedExams = useMemo(() => getCachedVcaaExams(selectedStudy ? [selectedStudy] : []), [selectedStudy])
  const selectedExam = useMemo(() => selectedExams.filter((exam) =>
    normaliseComparisonName(getVcaaExamPaper(exam)) === selectedPaper && exam.year !== null,
  ).toSorted((first, second) => (second.year ?? 0) - (first.year ?? 0))[0], [selectedExams, selectedPaper])
  const selectedCompanions = selectedExam ? getVcaaExamCompanions(selectedExam, selectedStudy) : null
  const selectedReference = selectedExam ? matchingReferences.find((reference) => reference.year === selectedExam.year) : undefined
  const selectedConditions = selectedExam ? getKnownExamConditions(selectedExam.studyName, getVcaaExamPaper(selectedExam)) : null
  const selectedTimerPreset: ExamTimerPreset | null = selectedExam?.year === null || !selectedExam ? null : {
    subject: selectedExam.studyName,
    provider: getVcaaExamProvider(selectedExam),
    examYear: selectedExam.year,
    paper: getVcaaExamPaper(selectedExam),
    marks: selectedConditions?.marks ?? selectedReference?.maxScore ?? 100,
    readingMinutes: selectedConditions?.readingMinutes,
    writingMinutes: selectedConditions?.writingMinutes,
  }
  const summary = insights.length
    ? `${subject} ${papers.find(([key]) => key === selectedPaper)?.[1] ?? "exam"}: ${insights.length} years of official grade bands. A ${score.toFixed(1)}% score is estimated as ${latest?.grade ?? "ungraded"} and the ${latest?.percentile === null || latest?.percentile === undefined ? "unknown" : formatOrdinal(latest.percentile)} percentile in ${latest?.year}.`
    : `No VCAA grade distributions are available for ${subject}.`

  if (!references.length) {
    return (
      <div className="grid gap-6">
        <PageHeader title="VCAA data" description="Explore official grade distributions and compare the same mark across years." />
        <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">VCAA reference data is unavailable. Reload the app to try again.</CardContent></Card>
      </div>
    )
  }

  return (
    <div className="grid gap-6">
      <PageHeader title="VCAA data" description="Explore official grade distributions, then move directly into the matching paper and marking material.">
        {onOpenLibrary ? <Button variant="outline" onClick={onOpenLibrary}>Open VCAA library</Button> : null}
      </PageHeader>

      <Card>
        <CardHeader>
          <CardTitle>Distribution explorer</CardTitle>
          <CardDescription>Official grade bands and cohort counts. Means, medians, and percentiles are estimates from grouped bands.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="vcaa-subject">Subject</Label>
            <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={(value) => { setSubject(value); setPaper("") }} id="vcaa-subject" className="w-full" placeholder="Search VCAA subjects" />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vcaa-paper">Exam</Label>
            <Select value={selectedPaper} onValueChange={(value) => setPaper(value ?? "")} disabled={papers.length < 2}>
              <SelectTrigger id="vcaa-paper" className="w-full"><SelectValue>{papers.find(([key]) => key === selectedPaper)?.[1] ?? "Choose an exam"}</SelectValue></SelectTrigger>
              <SelectContent>{papers.map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="vcaa-score">Score to compare (%)</Label>
            <Input id="vcaa-score" type="number" min={0} max={100} step={0.1} value={score} onChange={(event) => setScore(Math.min(100, Math.max(0, event.currentTarget.valueAsNumber || 0)))} />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <Card className="min-w-0">
          <CardHeader>
            <CardTitle>Grade boundaries over time</CardTitle>
            <CardDescription>{summary}</CardDescription>
          </CardHeader>
          <CardContent className="min-w-0">
            <ChartContainer config={chartConfig} className="h-80 w-full min-w-0 aspect-auto" role="img" aria-label={summary}>
              <LineChart data={insights} margin={{ left: 4, right: 12, top: 12 }} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="year" tickLine={false} axisLine={false} allowDecimals={false} />
                <YAxis domain={[0, 100]} width={42} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
                <ChartTooltip content={<ChartTooltipContent formatter={(value) => `${Number(value).toFixed(1)}%`} />} />
                <ChartLegend content={<ChartLegendContent />} />
                <ReferenceLine y={score} stroke="var(--foreground)" strokeDasharray="4 4" label={{ value: `You ${score.toFixed(1)}%`, position: "insideTopRight", fontSize: 11, fill: "var(--foreground)" }} />
                <Line type="monotone" dataKey="aPlusCutoffPercentage" stroke="var(--color-aPlusCutoffPercentage)" strokeWidth={2} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="meanPercentage" stroke="var(--color-meanPercentage)" strokeWidth={2} isAnimationActive={false} />
                <Line type="monotone" dataKey="medianPercentage" stroke="var(--color-medianPercentage)" strokeWidth={2} strokeDasharray="5 3" isAnimationActive={false} />
              </LineChart>
            </ChartContainer>
            <p className="mt-3 text-xs text-muted-foreground">A+ cutoffs are official. Mean, median, and percentile values are estimates because VCAA publishes grouped grade bands rather than individual marks.</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Coverage</CardTitle>
            <CardDescription>Distribution coverage and the latest matching official material.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-5">
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-3 text-sm">
              <dt className="text-muted-foreground">Years</dt><dd className="font-medium tabular-nums">{insights.length}</dd>
              <dt className="text-muted-foreground">Range</dt><dd className="font-medium tabular-nums">{insights.length ? `${insights[0].year}–${latest?.year}` : "—"}</dd>
              <dt className="text-muted-foreground">Students represented</dt><dd className="font-medium tabular-nums">{cohortTotal ? cohortTotal.toLocaleString("en-AU") : "—"}</dd>
              <dt className="text-muted-foreground">Latest A+ cutoff</dt><dd className="font-medium tabular-nums">{formatPercent(latest?.aPlusCutoffPercentage ?? null)}</dd>
              <dt className="text-muted-foreground">Your latest estimate</dt><dd>{latest?.grade ? <Badge variant="secondary">{latest.grade} · {latest.percentile === null || latest.percentile === undefined ? "—" : formatOrdinal(latest.percentile)}</Badge> : "—"}</dd>
            </dl>
            {selectedExam ? (
              <div className="grid gap-2 border-t pt-4">
                <p className="text-sm font-medium">Latest paper · {selectedExam.year}</p>
                {selectedTimerPreset && onStart ? <Button onClick={() => onStart(selectedTimerPreset)}><Play />Start timed attempt</Button> : null}
                <Button nativeButton={false} variant="outline" render={<a href={selectedExam.url} target="_blank" rel="noreferrer" />}><ExternalLink />Open exam paper</Button>
                {selectedCompanions?.reports.map((report) => <Button nativeButton={false} key={report.url} variant="outline" render={<a href={report.url} target="_blank" rel="noreferrer" />}><FileCheck2 />{/assessment guide/i.test(report.label) ? "Assessment guide" : "Examiner report"}</Button>)}
              </div>
            ) : selectedStudy ? <Button nativeButton={false} variant="outline" render={<a href={selectedStudy.pageUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Open official study page</Button> : null}
          </CardContent>
        </Card>
      </div>

      <Card className="min-w-0">
        <CardHeader><CardTitle>Year-by-year detail</CardTitle><CardDescription>Compare cohort size, thresholds, and your estimated result.</CardDescription></CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader><TableRow><TableHead>Year</TableHead><TableHead>Cohort</TableHead><TableHead>A+ cutoff</TableHead><TableHead>Est. mean</TableHead><TableHead>Est. median</TableHead><TableHead>Your result</TableHead><TableHead className="text-right">Source</TableHead></TableRow></TableHeader>
            <TableBody>{insights.toReversed().map((insight) => (
              <TableRow key={insight.year}>
                <TableCell className="font-medium tabular-nums">{insight.year}</TableCell>
                <TableCell className="tabular-nums">{insight.cohortSize?.toLocaleString("en-AU") ?? "—"}</TableCell>
                <TableCell className="tabular-nums">{formatPercent(insight.aPlusCutoffPercentage)}</TableCell>
                <TableCell className="tabular-nums">{formatPercent(insight.meanPercentage)}</TableCell>
                <TableCell className="tabular-nums">{formatPercent(insight.medianPercentage)}</TableCell>
                <TableCell><span className="font-medium">{insight.grade ?? "—"}</span>{insight.percentile !== null ? <span className="ml-2 text-xs text-muted-foreground tabular-nums">{formatOrdinal(insight.percentile)} percentile</span> : null}</TableCell>
                <TableCell className="text-right"><Button nativeButton={false} variant="ghost" size="sm" render={<a href={insight.sourceUrl} target="_blank" rel="noreferrer" />}><ExternalLink />PDF<span className="sr-only"> for {insight.year}</span></Button></TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
