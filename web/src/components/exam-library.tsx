import { useDeferredValue, useMemo, useState } from "react"
import { BarChart3, Check, ExternalLink, FileCheck2, Play, Search } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SubjectCombobox } from "@/components/subject-combobox"
import { PageHeader } from "@/components/page-header"
import { analyseAttempt, formatOrdinal, normaliseComparisonName, type AssessmentReference, type ExamAttempt } from "@/lib/exam-data"
import type { ExamTimerPreset } from "@/components/exam-timer"
import { firstPreferredSubject, prioritiseSubjects } from "@/lib/subjects"
import { getKnownExamConditions } from "@/lib/exam-conditions"
import {
  findVcaaExamAttempt,
  findVcaaExamReference,
  formatReferenceFreshness,
  getCachedVcaaExams,
  getVcaaExamCompanions,
  getVcaaExamPaper,
  getVcaaExamProvider,
  getVcaaExamResourcesUrl,
  isVcaaExamLogged,
  type VcaaExamResource,
  type VcaaResource,
  type VcaaStudyResources,
} from "@/lib/vcaa-resources"

type CompletionFilter = "all" | "todo" | "completed"

function paperOrder(exam: VcaaExamResource) {
  return Number(getVcaaExamPaper(exam).match(/\d+/)?.[0] ?? Number.MAX_SAFE_INTEGER)
}

function resourceLabel(resource: VcaaResource) {
  if (/assessment guide/i.test(resource.label)) return "Assessment guide"
  if (resource.kind === "report") return "Examiner report"
  if (resource.kind === "specification") return "Specifications"
  return resource.label
}

function timerPreset(exam: VcaaExamResource, reference?: AssessmentReference): ExamTimerPreset | null {
  if (exam.year === null) return null
  const paper = getVcaaExamPaper(exam)
  const conditions = getKnownExamConditions(exam.studyName, paper)
  return {
    subject: exam.studyName,
    provider: getVcaaExamProvider(exam),
    examYear: exam.year,
    paper,
    marks: conditions?.marks ?? reference?.maxScore ?? 100,
    readingMinutes: conditions?.readingMinutes,
    writingMinutes: conditions?.writingMinutes,
  }
}

export function ExamLibrary({
  references,
  studies,
  attempts,
  completedExamIds,
  generatedAt,
  preferredSubjects,
  onToggleCompleted,
  onStart,
  onCompare,
}: {
  references: AssessmentReference[]
  studies: VcaaStudyResources[]
  attempts: ExamAttempt[]
  completedExamIds: string[]
  generatedAt: string | null
  preferredSubjects: string[]
  onToggleCompleted: (id: string) => void
  onStart: (preset: ExamTimerPreset) => void
  onCompare: (attempt: ExamAttempt) => void
}) {
  const exams = useMemo(() => getCachedVcaaExams(studies), [studies])
  const subjects = useMemo(() => prioritiseSubjects(exams.map((exam) => exam.studyName), preferredSubjects), [exams, preferredSubjects])
  const [subject, setSubject] = useState(() => firstPreferredSubject(subjects, preferredSubjects) || subjects[0] || "all")
  const [query, setQuery] = useState("")
  const deferredQuery = useDeferredValue(query)
  const [completion, setCompletion] = useState<CompletionFilter>("all")
  const resourcesByStudy = useMemo(() => new Map(studies.map((study) => [normaliseComparisonName(study.studyName), study])), [studies])
  const isCompleted = (exam: VcaaExamResource) => isVcaaExamLogged(exam, attempts) || completedExamIds.includes(exam.url)
  const filtered = useMemo(() => {
    const priorities = new Map(preferredSubjects.map((item, index) => [normaliseComparisonName(item), index]))
    const needle = deferredQuery.trim().toLowerCase()
    return exams.filter((exam) => {
      const done = isVcaaExamLogged(exam, attempts) || completedExamIds.includes(exam.url)
      return (subject === "all" || exam.studyName === subject) &&
        (completion === "all" || (completion === "completed" ? done : !done)) &&
        (!needle || `${exam.studyName} ${exam.year} ${exam.label}`.toLowerCase().includes(needle))
    }).toSorted((first, second) =>
      (priorities.get(normaliseComparisonName(first.studyName)) ?? Infinity) - (priorities.get(normaliseComparisonName(second.studyName)) ?? Infinity) ||
      (second.year ?? 0) - (first.year ?? 0) || paperOrder(first) - paperOrder(second) || first.label.localeCompare(second.label))
  }, [attempts, completedExamIds, completion, exams, preferredSubjects, deferredQuery, subject])

  const focusSubject = subject === "all" ? firstPreferredSubject(subjects, preferredSubjects) || subjects[0] : subject
  const focusStudy = resourcesByStudy.get(normaliseComparisonName(focusSubject))
  const focusExams = exams.filter((exam) => normaliseComparisonName(exam.studyName) === normaliseComparisonName(focusSubject) && exam.year !== null)
  const latestYear = Math.max(...focusExams.map((exam) => exam.year ?? 0), 0)
  const recentExams = focusExams.filter((exam) => (exam.year ?? 0) >= latestYear - 4)
  const recentCompleted = recentExams.filter(isCompleted).length
  const nextExam = recentExams.filter((exam) => !isCompleted(exam))
    .toSorted((first, second) => (second.year ?? 0) - (first.year ?? 0) || paperOrder(first) - paperOrder(second))[0]
  const nextReference = nextExam ? findVcaaExamReference(nextExam, references) : undefined
  const nextPreset = nextExam ? timerPreset(nextExam, nextReference) : null
  const latestSpecification = focusStudy?.resources.filter((resource) => resource.kind === "specification")
    .toSorted((first, second) => (second.year ?? 0) - (first.year ?? 0))[0]
  const samples = focusStudy?.resources.filter((resource) => resource.kind === "sample")
    .toSorted((first, second) => (second.year ?? 0) - (first.year ?? 0)).slice(0, 2) ?? []

  return (
    <div className="grid gap-6">
      <PageHeader title="VCAA exam library" description="Move from official specifications to timed papers, marking guidance, and your cohort comparison in one workflow." />
      <Alert>
        <Search />
        <AlertTitle>Confirm the current study design before using an older paper</AlertTitle>
        <AlertDescription>VCAA publishes examination specifications, sample papers, assessment guides and external assessment reports on each study page. <a className="font-medium underline underline-offset-4" href={getVcaaExamResourcesUrl()} target="_blank" rel="noreferrer">Browse official study resources</a>.</AlertDescription>
      </Alert>

      {focusStudy && recentExams.length ? (
        <Card className="bg-muted/20">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div><CardTitle>{focusSubject} official pathway</CardTitle><CardDescription>{recentCompleted} of {recentExams.length} papers completed across the latest five available years.</CardDescription></div>
              <Badge variant="outline">VCAA source pack</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
            <div className="grid gap-3">
              <Progress value={recentExams.length ? recentCompleted / recentExams.length * 100 : 0} aria-label={`${recentCompleted} of ${recentExams.length} recent official papers completed`} />
              {nextExam && nextPreset ? (
                <div className="rounded-lg border bg-background p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recommended next paper</p>
                  <p className="mt-1 font-medium">{nextExam.year} · {getVcaaExamPaper(nextExam)}{getVcaaExamProvider(nextExam) === "VCAA NHT" ? " · NHT" : ""}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Uses the official paper title, VCAA-aligned marks, and known reading and writing times.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => onStart(nextPreset)}><Play />Start timed</Button>
                    <Button nativeButton={false} size="sm" variant="outline" render={<a href={nextExam.url} target="_blank" rel="noreferrer" />}><ExternalLink />Open paper</Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-background p-4"><p className="font-medium">Recent official set complete</p><p className="mt-1 text-sm text-muted-foreground">Use the archive below for more papers, or revisit examiner reports and logged comparisons.</p></div>
              )}
            </div>
            <div className="grid content-start gap-2">
              <p className="text-sm font-medium">Prepare with official materials</p>
              {latestSpecification ? <Button nativeButton={false} className="justify-start" variant="outline" render={<a href={latestSpecification.url} target="_blank" rel="noreferrer" />}><ExternalLink />Current specifications</Button> : null}
              {samples.map((sample) => <Button nativeButton={false} key={sample.url} className="justify-start" variant="outline" render={<a href={sample.url} target="_blank" rel="noreferrer" />}><ExternalLink /><span className="truncate">{sample.label}</span></Button>)}
              <Button nativeButton={false} className="justify-start" variant="ghost" render={<a href={focusStudy.pageUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Open {focusSubject} on VCAA</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={setSubject} includeAll className="w-full sm:w-72" placeholder="Search subjects" />
        <Input className="w-full sm:max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subject, year or paper" aria-label="Search exam library" />
        <Select value={completion} onValueChange={(value) => setCompletion(value as CompletionFilter)}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by completion"><SelectValue>{completion === "todo" ? "Not completed" : completion === "completed" ? "Completed" : "All papers"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="all">All papers</SelectItem><SelectItem value="todo">Not completed</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent>
        </Select>
        <span className="self-center text-sm text-muted-foreground">{filtered.length} exams · {formatReferenceFreshness(generatedAt)}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.slice(0, 40).map((exam) => {
          const study = studies.find((item) => item.pageUrl === exam.pageUrl) ?? resourcesByStudy.get(normaliseComparisonName(exam.studyName))
          const reference = findVcaaExamReference(exam, references)
          const companion = getVcaaExamCompanions(exam, study)
          const loggedAttempt = findVcaaExamAttempt(exam, attempts)
          const manuallyCompleted = completedExamIds.includes(exam.url)
          const completed = Boolean(loggedAttempt) || manuallyCompleted
          const preset = timerPreset(exam, reference)
          const analysis = loggedAttempt ? analyseAttempt(loggedAttempt, reference) : null
          const provider = getVcaaExamProvider(exam)
          return (
          <Card key={exam.url} className="min-w-0">
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0"><CardTitle>{exam.studyName}</CardTitle><CardDescription>{exam.year ?? "Unknown year"} · {getVcaaExamPaper(exam)}{provider === "VCAA NHT" ? " · Northern Hemisphere" : ""}</CardDescription></div>
                <div className="flex flex-wrap gap-2">{completed ? <Badge><Check />{loggedAttempt ? "Logged" : "Done"}</Badge> : null}{reference ? <Badge variant="outline">Official distribution</Badge> : <Badge variant="secondary">Archive · no distribution</Badge>}</div>
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {analysis && loggedAttempt ? (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-muted/60 p-3">
                  <div><p className="text-sm font-medium tabular-nums">Your result · {analysis.percentage.toFixed(1)}%</p><p className="text-xs text-muted-foreground">{analysis.grade ? `Estimated VCAA ${analysis.grade}${analysis.percentile !== null ? ` · ${formatOrdinal(analysis.percentile)} percentile` : ""}` : "No grade-band comparison for this paper"}</p></div>
                  {reference ? <Button size="sm" variant="outline" onClick={() => onCompare(loggedAttempt)}><BarChart3 />Compare years</Button> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                {preset ? <Button onClick={() => onStart(preset)}><Play />{loggedAttempt ? "Sit again" : "Start timed attempt"}</Button> : null}
                <Button nativeButton={false} variant="outline" render={<a href={exam.url} target="_blank" rel="noreferrer" />}><ExternalLink />Exam paper</Button>
                {companion.reports.map((report) => <Button nativeButton={false} key={report.url} variant="outline" render={<a href={report.url} target="_blank" rel="noreferrer" />}><FileCheck2 />{resourceLabel(report)}</Button>)}
                {companion.specification ? <Button nativeButton={false} variant="ghost" render={<a href={companion.specification.url} target="_blank" rel="noreferrer" />}><ExternalLink />Specifications</Button> : null}
                {reference ? <Button nativeButton={false} variant="ghost" render={<a href={reference.sourceUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Distribution</Button> : null}
                {!loggedAttempt ? <Button variant="ghost" onClick={() => onToggleCompleted(exam.url)}><Check />{manuallyCompleted ? "Mark not done" : "Mark done"}</Button> : null}
              </div>
            </CardContent>
          </Card>
        )})}
      </div>
      {filtered.length > 40 ? <p className="text-center text-xs text-muted-foreground">Showing 40 of {filtered.length} exams — refine the subject or search to narrow the list.</p> : null}
      {!filtered.length ? <p className="rounded-lg border p-8 text-center text-sm text-muted-foreground">No matching VCAA exams.</p> : null}
    </div>
  )
}
