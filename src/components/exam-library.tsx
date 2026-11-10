import { useDeferredValue, useMemo, useState } from "react"
import { count } from "../lib/utils"
import { BarChart3, Check, ExternalLink, FileCheck2, Play, Search } from "lucide-react"
import { Alert, AlertDescription, AlertTitle } from "./ui/alert"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Input } from "./ui/input"
import { Progress } from "./ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { SubjectCombobox } from "./subject-combobox"
import { PageHeader } from "./page-header"
import { analyseAttempt, formatOrdinal, normaliseComparisonName, type AssessmentReference, type ExamAttempt } from "../lib/exam-data"
import type { ExamTimerPreset } from "./exam-timer-mode"
import { firstPreferredSubject, prioritiseSubjects } from "../lib/subjects"
import { getKnownExamConditions } from "../lib/exam-conditions"
import {
  findVcaaExamAttempt,
  findVcaaExamReference,
  formatReferenceFreshness,
  getCachedVcaaExams,
  getVcaaExamCompanions,
  getVcaaExamPaper,
  getVcaaExamProvider,
  getVcaaExamResourcesUrl,
  isExamDone,
  type VcaaExamResource,
  type VcaaResource,
  type VcaaStudyResources,
} from "../lib/vcaa-resources"

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
  selectedPaperId,
  onSelectPaper,
  onClosePaper,
}: {
  selectedPaperId?: string
  onSelectPaper: (id: string) => void
  onClosePaper: () => void
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
  const [visibleCount, setVisibleCount] = useState(40)
  const resourcesByStudy = useMemo(() => new Map(studies.map((study) => [normaliseComparisonName(study.studyName), study])), [studies])
  const completedUrls = useMemo(() => new Set(exams.filter((exam) => isExamDone(exam.url, { completedExamIds, attempts, exam })).map((exam) => exam.url)), [completedExamIds, exams, attempts])
  const isCompleted = (exam: VcaaExamResource) => completedUrls.has(exam.url)
  const filtered = useMemo(() => {
    const priorities = new Map(preferredSubjects.map((item, index) => [normaliseComparisonName(item), index]))
    const terms = deferredQuery.trim().toLowerCase().split(/\s+/).filter(Boolean)
    return exams.filter((exam) => {
      if (selectedPaperId) return exam.url === selectedPaperId
      const done = completedUrls.has(exam.url)
      return (subject === "all" || exam.studyName === subject) &&
        (completion === "all" || (completion === "completed" ? done : !done)) &&
        terms.every((term) => `${exam.studyName} ${exam.year ?? ""} ${exam.label} ${getVcaaExamPaper(exam)} ${getVcaaExamProvider(exam)}`.toLowerCase().includes(term))
    }).toSorted((first, second) =>
      (priorities.get(normaliseComparisonName(first.studyName)) ?? Infinity) - (priorities.get(normaliseComparisonName(second.studyName)) ?? Infinity) ||
      (second.year ?? 0) - (first.year ?? 0) || paperOrder(first) - paperOrder(second) || first.label.localeCompare(second.label))
  }, [selectedPaperId, completedUrls, completion, exams, preferredSubjects, deferredQuery, subject])

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
      <PageHeader title="VCAA exam library" />
      {selectedPaperId ? <Button variant="outline" className="justify-self-start" onClick={onClosePaper}>Back to all papers</Button> : null}
      {selectedPaperId && !filtered.length ? <p role="status">Paper not found in the current library.</p> : null}
      <Alert>
        <Search />
        <AlertTitle>Confirm the current study design before using an older paper</AlertTitle>
        <AlertDescription>VCAA publishes examination specifications, sample papers, assessment guides and external assessment reports on each study page. <a className="font-medium underline underline-offset-4" href={getVcaaExamResourcesUrl()} target="_blank" rel="noreferrer">Browse official study resources</a>.</AlertDescription>
      </Alert>

      {!selectedPaperId && focusStudy && recentExams.length ? (
        <Card className="bg-muted/20">
          <CardHeader>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0"><CardTitle className="text-pretty">{focusSubject} official pathway</CardTitle><CardDescription>{recentCompleted} of {count(recentExams.length, "paper")} completed across the latest five available years.</CardDescription></div>
              <Badge variant="outline">VCAA source pack</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(18rem,1fr)]">
            <div className="grid gap-3">
              <Progress value={recentExams.length ? recentCompleted / recentExams.length * 100 : 0} aria-label={`${recentCompleted} of ${recentExams.length} recent official papers completed`} />
              {nextExam && nextPreset ? (
                <div className="rounded-lg border bg-card p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recommended next paper</p>
                  <p className="mt-1 font-medium">{nextExam.year} · {getVcaaExamPaper(nextExam)}{getVcaaExamProvider(nextExam) === "VCAA NHT" ? " · NHT" : ""}</p>
                  <p className="mt-1 text-sm text-muted-foreground">Uses the official paper title, VCAA-aligned marks, and known reading and writing times.</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => onStart(nextPreset)}><Play />Start timed</Button>
                    <Button nativeButton={false} size="sm" variant="outline" render={<a href={nextExam.url} target="_blank" rel="noreferrer" />}><ExternalLink />Open paper</Button>
                  </div>
                </div>
              ) : (
                <div className="rounded-lg border bg-card p-4"><p className="font-medium">Recent official set complete</p><p className="mt-1 text-sm text-muted-foreground">Use the archive below for more papers, or revisit examiner reports and logged comparisons.</p></div>
              )}
            </div>
            <div className="grid content-start gap-2">
              <p className="text-sm font-medium">Prepare with official materials</p>
              {latestSpecification ? <Button nativeButton={false} className="justify-start" variant="outline" render={<a href={latestSpecification.url} target="_blank" rel="noreferrer" />}><ExternalLink />Current specifications</Button> : null}
              {samples.map((sample) => <Button nativeButton={false} key={sample.url} className="justify-start" variant="outline" render={<a href={sample.url} target="_blank" rel="noreferrer" />}><ExternalLink /><span className="truncate">{sample.label}</span></Button>)}
              <Button nativeButton={false} className="h-auto min-h-9 justify-start whitespace-normal text-left" variant="ghost" render={<a href={focusStudy.pageUrl} target="_blank" rel="noreferrer" />}><ExternalLink />Open {focusSubject} on VCAA</Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subject} onValueChange={(value) => { setSubject(value || "all"); setVisibleCount(40) }} includeAll className="w-full sm:w-72" placeholder="Search subjects" />
        <Input type="search" className="w-full sm:max-w-sm" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(40) }} placeholder="Search subject, year or paper" aria-label="Search exam library" />
        <Select value={completion} onValueChange={(value) => { setCompletion((value ?? "all") as CompletionFilter); setVisibleCount(40) }}>
          <SelectTrigger className="w-full sm:w-44" aria-label="Filter by completion"><SelectValue>{completion === "todo" ? "Not completed" : completion === "completed" ? "Completed" : "All papers"}</SelectValue></SelectTrigger>
          <SelectContent><SelectItem value="all">All papers</SelectItem><SelectItem value="todo">Not completed</SelectItem><SelectItem value="completed">Completed</SelectItem></SelectContent>
        </Select>
        {query || completion !== "all" ? <Button variant="ghost" onClick={() => { setQuery(""); setCompletion("all"); setVisibleCount(40) }}>Clear filters</Button> : null}
        <span role="status" className="self-center text-sm tabular-nums text-muted-foreground">{count(filtered.length, "exam")} · {formatReferenceFreshness(generatedAt)}</span>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {filtered.slice(0, visibleCount).map((exam) => {
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
          <Card key={exam.url} className={`${selectedPaperId === exam.url ? "ring-2 ring-primary" : ""} min-w-0 gap-4 [contain-intrinsic-size:auto_14rem] [content-visibility:auto] ${completed ? "bg-muted/20" : ""}`}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground tabular-nums">{exam.year ?? "Unknown year"}{provider === "VCAA NHT" ? " · Northern Hemisphere" : ""}</p>
                  <CardTitle className="mt-0.5 text-pretty"><Button variant="link" className="h-auto p-0 text-base text-inherit" onClick={() => onSelectPaper(exam.url)}>{getVcaaExamPaper(exam)}</Button></CardTitle>
                  <CardDescription className="truncate">{exam.studyName}</CardDescription>
                </div>
                {completed ? <Badge className="shrink-0" variant={loggedAttempt ? "success" : "secondary"}><Check />{loggedAttempt ? "Logged" : "Done"}</Badge> : null}
              </div>
            </CardHeader>
            <CardContent className="grid gap-4">
              {analysis && loggedAttempt ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-card px-3 py-2.5">
                  <div className="flex min-w-0 items-baseline gap-3">
                    <span className="focal-stat-value tabular-nums">{analysis.percentage.toFixed(1)}%</span>
                    <span className="min-w-0 truncate text-xs text-muted-foreground">{analysis.grade ? `Est. ${analysis.grade}${analysis.percentile !== null ? ` · ${formatOrdinal(analysis.percentile)} percentile` : ""}` : "No grade-band comparison"}</span>
                  </div>
                  {reference ? <Button size="sm" variant="ghost" className="shrink-0" onClick={() => onCompare(loggedAttempt)}><BarChart3 />Compare</Button> : null}
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-2 max-sm:[&>*]:flex-1">
                {preset ? <Button variant={completed ? "outline" : "default"} onClick={() => onStart(preset)}><Play />{loggedAttempt ? "Sit again" : "Start timed"}</Button> : null}
                <Button nativeButton={false} variant="outline" render={<a href={exam.url} target="_blank" rel="noreferrer" />}><ExternalLink />Open paper</Button>
                {!loggedAttempt ? <Button variant="ghost" className="sm:ml-auto" aria-pressed={manuallyCompleted} aria-label={`${manuallyCompleted ? "Mark not done" : "Mark done"}: ${exam.studyName} ${exam.year ?? ""} ${getVcaaExamPaper(exam)}`} onClick={() => onToggleCompleted(exam.url)}><Check />{manuallyCompleted ? "Undo done" : "Mark done"}</Button> : null}
              </div>
              {/* Supporting documents are secondary: quiet links, so the paper and the timer stay the obvious next step. */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-3 text-xs">
                {companion.reports.map((report) => <a key={report.url} className="inline-flex items-center gap-1 font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={report.url} target="_blank" rel="noreferrer"><FileCheck2 aria-hidden className="size-3.5" />{resourceLabel(report)}</a>)}
                {companion.specification ? <a className="inline-flex items-center gap-1 font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={companion.specification.url} target="_blank" rel="noreferrer"><ExternalLink aria-hidden className="size-3.5" />Specifications</a> : null}
                {reference ? <a className="inline-flex items-center gap-1 font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline" href={reference.sourceUrl} target="_blank" rel="noreferrer"><BarChart3 aria-hidden className="size-3.5" />Grade distribution</a> : <span className="text-muted-foreground">No official distribution</span>}
              </div>
            </CardContent>
          </Card>
        )})}
      </div>
      {filtered.length > visibleCount ? <div className="flex flex-wrap items-center justify-center gap-3"><p role="status" className="text-xs tabular-nums text-muted-foreground">Showing {visibleCount} of {count(filtered.length, "exam")}</p><Button variant="outline" onClick={() => setVisibleCount(visibleCount + 40)}>Show more papers</Button></div> : null}
      {!filtered.length ? <Empty className="min-h-48 border"><EmptyHeader><EmptyMedia variant="icon"><Search /></EmptyMedia><EmptyTitle>No matching VCAA exams</EmptyTitle><EmptyDescription>{deferredQuery.trim() ? `Nothing matches “${deferredQuery.trim()}”${subject === "all" ? "" : ` in ${subject}`}.` : "Try another subject or completion filter."}</EmptyDescription></EmptyHeader><Button variant="outline" onClick={() => { setQuery(""); setSubject("all"); setCompletion("all"); setVisibleCount(40) }}>Clear filters</Button></Empty> : null}
    </div>
  )
}
