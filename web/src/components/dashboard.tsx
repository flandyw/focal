import { lazy, Suspense, useMemo, useState } from "react"
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  BookOpenCheck,
  CalendarCheck2,
  FileDown,
  FilePlus2,
  NotebookPen,
  Plus,
  Target,
  type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  analyseAttempt,
  buildCoverage,
  findAttemptReferenceById,
  findAttemptReferenceForYear,
  getDueMistakes,
  type AppData,
  type AssessmentReference,
  type ExamAttempt,
} from "@/lib/exam-data"
import { getMistakeProgress } from "@/lib/mistake-review"
import { buildFocusPriorities, buildSubjectOutlooks } from "@/lib/performance-insights"
import type { Timetable } from "@/lib/timetable"
import { PageHeader } from "@/components/page-header"
import { WorkspacePage } from "@/components/workspace-layout"
import { UpcomingExamsCard } from "@/components/upcoming-exams-card"
import { PerformanceContextInsights } from "@/components/performance-context-insights"
import { ExamTable } from "@/components/exam-table"
import { getExamTarget } from "@/lib/exam-target"
import { getAttemptPerformance, weightedPerformanceAverage, type ExamDifficultySettings } from "@/lib/exam-difficulty"
import { openProgressReport } from "@/lib/progress-report"
import { localDate } from "@/lib/learning-workspace"

const PerformanceTrendChart = lazy(() =>
  import("@/components/performance-trend-chart").then((module) => ({ default: module.PerformanceTrendChart })),
)
const RevisionPriorityChart = lazy(() =>
  import("@/components/revision-priority-chart").then((module) => ({ default: module.RevisionPriorityChart })),
)
const SubjectBenchmarkChart = lazy(() =>
  import("@/components/subject-benchmark-chart").then((module) => ({ default: module.SubjectBenchmarkChart })),
)
const VcaaPercentileTrendChart = lazy(() =>
  import("@/components/vcaa-percentile-trend-chart").then((module) => ({ default: module.VcaaPercentileTrendChart })),
)
const ImprovementOutlookChart = lazy(() =>
  import("@/components/improvement-outlook-chart").then((module) => ({ default: module.ImprovementOutlookChart })),
)
const FocusPriorityChart = lazy(() =>
  import("@/components/focus-priority-chart").then((module) => ({ default: module.FocusPriorityChart })),
)
const PaperPerformanceAnalytics = lazy(() =>
  import("@/components/paper-performance-analytics").then((module) => ({ default: module.PaperPerformanceAnalytics })),
)
const ReviewForecastChart = lazy(() =>
  import("@/components/review-forecast-chart").then((module) => ({ default: module.ReviewForecastChart })),
)

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })
}

type NextAction = {
  icon: LucideIcon
  title: string
  description: string
  cta: string
  onClick: () => void
}

function pickNextAction(
  data: AppData,
  handlers: {
    onLogExam: () => void
    onLogMistakeForLatest: () => void
    onOpenMistakes: () => void
    onOpenLibrary: () => void
    onOpenPlanner: () => void
  },
): NextAction | null {
  const nextTask = data.learning.tasks
    .filter((task) => !task.archivedAt && task.status === "planned" && task.plannedFor <= localDate(new Date()))
    .toSorted((first, second) => first.plannedFor.localeCompare(second.plannedFor) || first.createdAt.localeCompare(second.createdAt))[0]
  if (nextTask) {
    return {
      icon: CalendarCheck2,
      title: nextTask.title,
      description: `${nextTask.durationMinutes} minute planned session${nextTask.subject ? ` · ${nextTask.subject}` : ""}${nextTask.plannedFor < localDate(new Date()) ? " · overdue" : ""}.`,
      cta: "Open planner",
      onClick: handlers.onOpenPlanner,
    }
  }
  if (data.attempts.length === 0) {
    return {
      icon: FilePlus2,
      title: "Log your first practice exam",
      description:
        "Recording a completed paper unlocks trend tracking, official comparisons, and the mistake workflow.",
      cta: "Log first exam",
      onClick: handlers.onLogExam,
    }
  }

  const due = getDueMistakes(data.mistakes)
  if (due.length > 0) {
    const counts = new Map<string, number>()
    for (const mistake of due) counts.set(mistake.category, (counts.get(mistake.category) ?? 0) + 1)
    let topCategory: string | null = null
    let topCount = 0
    for (const [category, count] of counts) {
      if (count > topCount) {
        topCategory = category
        topCount = count
      }
    }
    const noun = topCount === 1 ? "mistake" : "mistakes"
    return {
      icon: Target,
      title: `Review ${topCount} due ${topCategory?.toLowerCase()} ${noun}`,
      description: "These cards are due in your spaced-repetition queue now.",
      cta: "Open Mistakes",
      onClick: handlers.onOpenMistakes,
    }
  }

  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const recent = data.attempts.some(
    (attempt) => new Date(`${attempt.completedAt}T00:00:00`).getTime() >= cutoff,
  )
  if (!recent) {
    return {
      icon: BookOpenCheck,
      title: "It's been a while since your last paper",
      description: "A fresh result keeps your trend curve honest and surfaces what you actually remember today.",
      cta: "Log exam",
      onClick: handlers.onLogExam,
    }
  }

  if (data.mistakes.length === 0) {
    return {
      icon: NotebookPen,
      title: "Capture a mistake from your latest exam",
      description: "Even one well-described error becomes a revision anchor you can return to before the next paper.",
      cta: "Log mistake",
      onClick: handlers.onLogMistakeForLatest,
    }
  }
  const weakestArea = buildCoverage(data.attempts)[0]
  const scheduledCards = data.mistakes.filter((mistake) => !mistake.suspended).length
  return {
    icon: BookOpenCheck,
    title: "Sit another official-style paper",
    description: weakestArea ? `Choose a paper that tests ${weakestArea.areaOfStudy}, currently your weakest marked area at ${weakestArea.percentage.toFixed(0)}%.` : scheduledCards ? `${scheduledCards} mistake card${scheduledCards === 1 ? " is" : "s are"} scheduled for later. Build fresh evidence while you wait.` : "Use the exam library to choose your next paper and preserve timed conditions.",
    cta: "Open exam library",
    onClick: handlers.onOpenLibrary,
  }
}

function CoverageSummary({ data }: { data: AppData }) {
  const coverage = useMemo(() => buildCoverage(data.attempts), [data.attempts])
  if (!coverage.length) return null
  return (
    <section aria-labelledby="coverage-title" className="grid gap-3 rounded-lg border p-5">
      <div><h2 id="coverage-title" className="font-semibold">Outcome coverage</h2><p className="text-sm text-muted-foreground">Weakest marked topics and skills first. Label sections, questions, essays, or tasks while marking to improve this view.</p></div>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {coverage.slice(0, 6).map((area) => <div key={`${area.subject}-${area.areaOfStudy}`} className="grid gap-1 rounded-md bg-muted/50 p-3"><div className="flex justify-between gap-3 text-sm"><span className="min-w-0 truncate font-medium">{area.areaOfStudy}</span><span className="tabular-nums">{area.percentage.toFixed(0)}%</span></div><p className="truncate text-xs text-muted-foreground">{area.subject} · {area.questions} marked item{area.questions === 1 ? "" : "s"}</p><Progress value={area.percentage} /></div>)}
      </div>
    </section>
  )
}

function computeStats(attempts: ExamAttempt[], settings?: ExamDifficultySettings) {
  if (attempts.length === 0) {
    return { count: 0, subjects: 0, average: 0, best: 0, trendDiff: 0, trend: "flat" as const, lastDate: null }
  }
  const subjects = new Set(attempts.map((attempt) => attempt.subject))
  const sorted = [...attempts].toSorted((first, second) =>
    first.completedAt.localeCompare(second.completedAt),
  )
  const pcts = sorted.map((attempt) => getAttemptPerformance(attempt, settings).alignedPercentage)
  const average = weightedPerformanceAverage(sorted, settings)
  const best = Math.max(...sorted.map((attempt) => (attempt.rawScore / attempt.rawMax) * 100))
  let trend: "up" | "down" | "flat" = "flat"
  let trendDiff = 0
  if (pcts.length >= 2) {
    const split = Math.max(1, Math.floor(pcts.length / 2))
    const prior = weightedPerformanceAverage(sorted.slice(0, split), settings)
    const recent = weightedPerformanceAverage(sorted.slice(split), settings)
    trendDiff = recent - prior
    if (trendDiff > 0.5) trend = "up"
    else if (trendDiff < -0.5) trend = "down"
  }
  return {
    count: attempts.length,
    subjects: subjects.size,
    average,
    best,
    trendDiff,
    trend,
    lastDate: sorted[sorted.length - 1].completedAt,
  }
}

function computeSubjectBreakdown(data: AppData, references: AssessmentReference[]) {
  const buckets = new Map<
    string,
    { attempts: ExamAttempt[]; count: number; lastDate: string; linkedCount: number }
  >()
  for (const attempt of data.attempts) {
    const bucket = buckets.get(attempt.subject) ?? {
      count: 0,
      attempts: [],
      lastDate: "",
      linkedCount: 0,
    }
    bucket.count += 1
    bucket.attempts.push(attempt)
    if (attempt.completedAt > bucket.lastDate) bucket.lastDate = attempt.completedAt
    const direct = findAttemptReferenceForYear(attempt, references, attempt.examYear)
    const linked = direct ?? findAttemptReferenceById(references, attempt.referenceId)
    if (linked) bucket.linkedCount += 1
    buckets.set(attempt.subject, bucket)
  }
  return [...buckets.entries()]
    .map(([subject, bucket]) => ({
      subject,
      count: bucket.count,
      average: weightedPerformanceAverage(bucket.attempts, data.examDifficulty),
      lastDate: bucket.lastDate,
      linkedCount: bucket.linkedCount,
    }))
    .toSorted((first, second) => second.average - first.average)
}

function NextActionNotice({ action }: { action: NextAction | null }) {
  if (!action) return null
  const Icon = action.icon
  return (
    <section
      aria-label="Next study action"
      className="flex flex-wrap items-start gap-4 rounded-lg border border-dashed bg-accent/40 px-5 py-4 sm:flex-nowrap sm:items-center"
    >
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-background ring-1 ring-foreground/10">
        <Icon className="size-4 text-foreground" aria-hidden />
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="text-sm font-medium leading-snug text-balance">{action.title}</p>
        <p className="text-sm text-muted-foreground leading-snug text-pretty">{action.description}</p>
      </div>
      <Button onClick={action.onClick} className="shrink-0 sm:ml-auto">
        {action.cta}
        <ArrowRight aria-hidden />
      </Button>
    </section>
  )
}

function StatRow({ data }: { data: AppData }) {
  const stats = useMemo(() => computeStats(data.attempts, data.examDifficulty), [data.attempts, data.examDifficulty])
  const mature = data.mistakes.filter((mistake) => mistake.resolved).length
  const total = data.mistakes.length
  const due = getDueMistakes(data.mistakes).length
  const completion = total ? (mature / total) * 100 : 0

  return (
    <div className="grid gap-5 rounded-lg border bg-card px-5 py-5 sm:grid-cols-2 sm:gap-y-6 lg:grid-cols-4 lg:gap-y-0 lg:divide-x lg:divide-border">
      <div className="flex min-w-0 flex-col gap-1.5 sm:pr-6">
        <p className="text-sm text-muted-foreground">Practice exams</p>
        <p className="text-3xl font-semibold tabular-nums leading-none">{stats.count}</p>
        <p className="text-xs text-muted-foreground">
          {stats.count === 0
            ? "Log your first paper to begin"
            : `${stats.subjects} subject${stats.subjects === 1 ? "" : "s"}`}
          {stats.lastDate ? ` · last ${formatDate(stats.lastDate)}` : null}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 sm:pl-6 lg:px-6">
        <p className="text-sm text-muted-foreground">VCAA-aligned average</p>
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-semibold tabular-nums leading-none">
            {stats.count === 0 ? "—" : `${stats.average.toFixed(1)}%`}
          </p>
          {stats.count >= 2 && stats.trend !== "flat" ? (
            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-foreground tabular-nums">
              {stats.trend === "up" ? (
                <ArrowUpRight className="size-3.5" aria-hidden />
              ) : (
                <ArrowDownRight className="size-3.5" aria-hidden />
              )}
              {stats.trend === "up" ? "+" : ""}
              {stats.trendDiff.toFixed(1)}%
            </span>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {stats.count < 2
            ? "Difficulty-adjusted planning estimate"
            : stats.trend === "flat"
              ? "Stable across your recent attempts"
              : stats.trend === "up"
                ? "Improving vs your earlier half"
                : "Dropping vs your earlier half"}
        </p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 lg:px-6">
        <p className="text-sm text-muted-foreground">Best mark</p>
        <p className="text-3xl font-semibold tabular-nums leading-none">{stats.best.toFixed(1)}%</p>
        <p className="text-xs text-muted-foreground">Your strongest recorded practice result</p>
      </div>
      <div className="flex min-w-0 flex-col gap-1.5 sm:pl-6">
        <p className="text-sm text-muted-foreground">Mistake cards</p>
        <div className="flex items-baseline gap-2">
          <p className="text-3xl font-semibold tabular-nums leading-none">{total === 0 ? "—" : due}</p>
          <p className="text-xs text-muted-foreground">
            {total === 0 ? "none logged" : `due of ${total}`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Progress value={completion} className="w-24" />
          <span className="text-xs text-muted-foreground tabular-nums">
            {total === 0 ? "0/0" : `${mature}/${total} mature`}
          </span>
        </div>
      </div>
    </div>
  )
}

function ImprovementSignals({ data }: { data: AppData }) {
  const outlooks = useMemo(() => buildSubjectOutlooks(data.attempts, data.examDifficulty), [data.attempts, data.examDifficulty])
  const priorities = useMemo(() => buildFocusPriorities(data.attempts, data.mistakes), [data.attempts, data.mistakes])
  const review = useMemo(() => getMistakeProgress(data.mistakes), [data.mistakes])
  const primary = [...outlooks].toSorted((first, second) => second.attempts - first.attempts)[0]
  const topPriority = priorities[0]

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Performance signals</CardTitle>
        <CardDescription>Leading indicators that show whether your study process is turning into stronger exam performance.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-4 xl:divide-x xl:divide-border">
          <div className="min-w-0 space-y-1 xl:pr-5">
            <p className="text-sm text-muted-foreground">Recent momentum</p>
            <p className="text-2xl font-semibold tabular-nums">
              {primary ? `${primary.momentum >= 0 ? "+" : ""}${primary.momentum.toFixed(1)} pts` : "—"}
            </p>
            <p className="text-xs text-muted-foreground">
              {primary ? `${primary.subject} · recent average vs prior evidence` : "Needs at least one logged attempt"}
            </p>
          </div>
          <div className="min-w-0 space-y-1 xl:px-5">
            <p className="text-sm text-muted-foreground">Score consistency</p>
            <p className="text-2xl font-semibold tabular-nums">{primary ? `±${primary.spread.toFixed(1)} pts` : "—"}</p>
            <p className="text-xs text-muted-foreground">
              {primary ? `${primary.spread <= 5 ? "Stable" : primary.spread <= 10 ? "Some variation" : "High variation"} across the latest five ${primary.subject} papers` : "More attempts improve this signal"}
            </p>
          </div>
          <div className="min-w-0 space-y-1 xl:px-5">
            <p className="text-sm text-muted-foreground">Review recall</p>
            <p className="text-2xl font-semibold tabular-nums">{review.recallRate === null ? "—" : `${review.recallRate.toFixed(0)}%`}</p>
            <p className="text-xs text-muted-foreground">
              {review.reviewsCompleted ? `${review.reviewsCompleted} reviews in 30 days${review.recallDelta === null ? "" : ` · ${review.recallDelta >= 0 ? "+" : ""}${review.recallDelta.toFixed(0)} pts`}` : "Complete mistake reviews to measure retention"}
            </p>
          </div>
          <div className="min-w-0 space-y-1 xl:pl-5">
            <p className="text-sm text-muted-foreground">Highest leverage</p>
            <p className="truncate text-2xl font-semibold">{topPriority?.areaOfStudy ?? "—"}</p>
            <p className="text-xs text-muted-foreground">
              {topPriority ? `${topPriority.priorityScore.toFixed(0)}/100 priority · ${topPriority.missedMarks} marked opportunity marks` : "Label topics or skills to calculate a focus score"}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function SubjectBreakdown({ data, references }: { data: AppData; references: AssessmentReference[] }) {
  const breakdown = useMemo(() => computeSubjectBreakdown(data, references), [data, references])
  if (breakdown.length === 0) return null
  return (
    <Card className="h-full min-w-0">
      <CardHeader>
        <CardTitle>Subjects</CardTitle>
        <CardDescription>
          VCAA-aligned, relevance-weighted average per subject. Est. marks results linked to an official distribution.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y rounded-lg border" role="list">
          {breakdown.map((entry) => (
            <li key={entry.subject} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-0.5">
                <p className="truncate text-sm font-medium">{entry.subject}</p>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {entry.count} attempt{entry.count === 1 ? "" : "s"}
                  {entry.lastDate ? ` · last ${formatDate(entry.lastDate)}` : ""}
                  {entry.linkedCount > 0 ? <> · {entry.linkedCount} linked</> : null}
                </p>
              </div>
              <div className="flex flex-col items-end gap-1">
                <span className="text-sm font-semibold tabular-nums">{entry.average.toFixed(1)}%</span>
                {entry.linkedCount > 0 ? (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                    Est.
                  </Badge>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function RecentExams({
  data,
  references,
  comparisonYear,
  onLogExam,
}: {
  data: AppData
  references: AssessmentReference[]
  comparisonYear: number
  onLogExam: () => void
}) {
  const recent = useMemo(
    () =>
      [...data.attempts]
        .toSorted((first, second) => second.completedAt.localeCompare(first.completedAt))
        .slice(0, 5),
    [data.attempts],
  )
  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle>Recent exams</CardTitle>
            <CardDescription>Your latest five recorded attempts.</CardDescription>
          </div>
          <Button variant="outline" size="sm" render={<a href="#all-exams" />}>
            View all
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {recent.length ? (
          <ul className="flex flex-col divide-y rounded-lg border" role="list">
            {recent.map((attempt) => {
              const reference = findAttemptReferenceForYear(attempt, references, comparisonYear)
              const analysis = analyseAttempt(attempt, reference)
              return (
                <li key={attempt.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <p className="truncate text-sm font-medium">{attempt.title} · {attempt.paper}</p>
                    <p className="text-xs text-muted-foreground">{formatDate(attempt.completedAt)}</p>
                  </div>
                  {reference && analysis.grade ? (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge variant="secondary">{analysis.grade}</Badge>
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        Est.
                      </Badge>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {analysis.percentile?.toFixed(0)}th pctile
                      </span>
                    </div>
                  ) : null}
                  <Button variant="ghost" size="sm" className="shrink-0" render={<a href={`#${getExamTarget(attempt.id)}`} />}>
                    Go to exam
                    <ArrowDownRight aria-hidden />
                  </Button>
                  <span className="whitespace-nowrap text-sm font-medium tabular-nums">
                    {reference ? `${analysis.scaledScore.toFixed(1)}/${reference.maxScore}` : `${attempt.rawScore}/${attempt.rawMax}`}
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {reference ? "scaled" : `${analysis.percentage.toFixed(1)}%`}
                    </span>
                  </span>
                </li>
              )
            })}
          </ul>
        ) : (
          <Empty className="border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FilePlus2 />
              </EmptyMedia>
              <EmptyTitle>No exams yet</EmptyTitle>
              <EmptyDescription>Log a completed paper to start tracking performance.</EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button onClick={onLogExam}>
                <Plus />
                Log first exam
              </Button>
            </EmptyContent>
          </Empty>
        )}
      </CardContent>
    </Card>
  )
}

export type DashboardProps = {
  data: AppData
  references: AssessmentReference[]
  comparisonYear: number
  onComparisonYearChange: (year: number) => void
  timetable: Timetable | null
  onLogExam: () => void
  onLogMistakeForLatest: () => void
  onOpenMistakes: () => void
  onOpenLibrary: () => void
  onOpenPlanner: () => void
  onOpenTracker: () => void
  onEditExam: (attempt: ExamAttempt) => void
  onAddMistake: (attemptId: string) => void
  onDeleteExam: (attempt: ExamAttempt) => void
}

export function Dashboard(props: DashboardProps) {
  const {
    data,
    references,
    comparisonYear,
    onComparisonYearChange,
    timetable,
    onLogExam,
    onLogMistakeForLatest,
    onOpenMistakes,
    onOpenLibrary,
    onOpenPlanner,
    onOpenTracker,
    onEditExam,
    onAddMistake,
    onDeleteExam,
  } = props
  const [section, setSection] = useState<"overview" | "insights">("overview")
  const nextAction = useMemo(
    () => pickNextAction(data, { onLogExam, onLogMistakeForLatest, onOpenMistakes, onOpenLibrary, onOpenPlanner }),
    [data, onLogExam, onLogMistakeForLatest, onOpenMistakes, onOpenLibrary, onOpenPlanner],
  )

  function exportReport() {
    try {
      openProgressReport(data, references, data.examDifficulty)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not open the progress report.")
    }
  }

  const deadlineSection = timetable ? (
    <UpcomingExamsCard
      entries={timetable.exams}
      trackedIds={data.trackedExamIds}
      onOpenPicker={onOpenTracker}
      sourceUrl={timetable.sourceUrl}
    />
  ) : null

  if (data.attempts.length === 0) {
    return (
      <WorkspacePage>
        <PageHeader
          title="Dashboard"
          description="Your practice exam results and the mistakes worth revisiting."
        >
          <Button onClick={onLogExam}>
            <Plus />
            Log exam
          </Button>
        </PageHeader>
        <NextActionNotice action={nextAction} />
        {deadlineSection}
        <Empty className="min-h-64 border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BookOpenCheck />
            </EmptyMedia>
            <EmptyTitle>Log a practice exam to begin</EmptyTitle>
            <EmptyDescription>
              Record a raw mark, link an official grade distribution when one exists, and capture mistakes
              worth revisiting before your next paper.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button size="lg" onClick={onLogExam}>
              <Plus />
              Log first exam
            </Button>
          </EmptyContent>
        </Empty>
      </WorkspacePage>
    )
  }

  return (
    <WorkspacePage>
      <PageHeader
        title="Dashboard"
        description="Your practice exam results and the mistakes worth revisiting."
      >
        <Button variant="outline" onClick={exportReport}>
          <FileDown />
          Export report
        </Button>
        <Button onClick={onLogExam}>
          <Plus />
          Log exam
        </Button>
      </PageHeader>

      <Tabs value={section} onValueChange={(value) => setSection(value as "overview" | "insights")}>
        <TabsList aria-label="Dashboard sections">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="insights">Insights</TabsTrigger>
        </TabsList>
        <TabsContent value="overview" className="mt-4">
          {section === "overview" ? (
            <div className="grid gap-6">
              <NextActionNotice action={nextAction} />
              {deadlineSection}
              <StatRow data={data} />
              <div className="grid gap-6 lg:grid-cols-3">
                <div className="min-w-0 lg:col-span-2">
                  <RecentExams data={data} references={references} comparisonYear={comparisonYear} onLogExam={onLogExam} />
                </div>
                <div className="min-w-0">
                  <SubjectBreakdown data={data} references={references} />
                </div>
              </div>
              <CoverageSummary data={data} />
              <ExamTable attempts={data.attempts} references={references} comparisonYear={comparisonYear} onComparisonYearChange={onComparisonYearChange} onEdit={onEditExam} onAddMistake={onAddMistake} onDelete={onDeleteExam} />
            </div>
          ) : null}
        </TabsContent>
        <TabsContent value="insights" className="mt-4">
          {section === "insights" ? (
            <div className="grid gap-6">
              <ImprovementSignals data={data} />
              <PerformanceContextInsights attempts={data.attempts} sacRecords={data.sacRecords} />
              <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                <PaperPerformanceAnalytics attempts={data.attempts} mistakes={data.mistakes} />
              </Suspense>
              <Suspense fallback={<Skeleton className="h-96 w-full" />}>
                <PerformanceTrendChart attempts={data.attempts} references={references} preferredSubjects={data.subjects} difficultySettings={data.examDifficulty} />
              </Suspense>
              <div className="grid gap-6 xl:grid-cols-2">
                <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                  <SubjectBenchmarkChart attempts={data.attempts} references={references} mistakes={data.mistakes} />
                </Suspense>
                <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                  <VcaaPercentileTrendChart attempts={data.attempts} references={references} preferredSubjects={data.subjects} />
                </Suspense>
              </div>
              <div className="grid gap-6 xl:grid-cols-2">
                <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                  <ImprovementOutlookChart attempts={data.attempts} difficultySettings={data.examDifficulty} />
                </Suspense>
                <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                  <ReviewForecastChart mistakes={data.mistakes} />
                </Suspense>
              </div>
              <div className="grid gap-6 xl:grid-cols-2">
                <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                  <FocusPriorityChart attempts={data.attempts} mistakes={data.mistakes} />
                </Suspense>
                <Suspense fallback={<Skeleton className="h-80 w-full" />}>
                  <RevisionPriorityChart mistakes={data.mistakes} />
                </Suspense>
              </div>
            </div>
          ) : null}
        </TabsContent>
      </Tabs>
    </WorkspacePage>
  )
}
