import { useEffect, useId, useMemo, useState } from "react"
import { CartesianGrid, Dot, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart"
import { SubjectCombobox } from "@/components/subject-combobox"
import {
  analyseAttempt,
  computeDistributionStats,
  findAttemptReference,
  type AssessmentReference,
  type ExamAttempt,
} from "@/lib/exam-data"
import { firstPreferredSubject, prioritiseSubjects } from "@/lib/subjects"
import { getAttemptPerformance, type ExamDifficultySettings } from "@/lib/exam-difficulty"

const chartConfig = {
  percentage: { label: "VCAA-aligned %", color: "#16a34a" },
  average: { label: "Overall average", color: "#ca8a04" },
  vcaaMeanPercentage: { label: "Est. VCAA mean", color: "#2563eb" },
  aPlusCutoffPercentage: { label: "Official A+ cutoff", color: "#dc2626" },
}

type TrendPoint = {
  id: string
  index: number
  timestamp: number
  dateLabel: string
  percentage: number
  rawPercentage: number
  adjustment: number
  providerRelevance: number
  rawScore: number
  rawMax: number
  subject: string
  title: string
  scaledScore: number | null
  grade: string | null
  percentile: number | null
  referenceYear: number | null
  vcaaMeanPercentage: number | null
  aPlusCutoffPercentage: number | null
}

function buildTrend(
  attempts: ExamAttempt[],
  references: AssessmentReference[],
  subjectFilter: string,
  difficultySettings?: ExamDifficultySettings,
): TrendPoint[] {
  const filtered = subjectFilter === "all" ? attempts : attempts.filter((attempt) => attempt.subject === subjectFilter)
  return filtered
    .toSorted((first, second) => first.completedAt.localeCompare(second.completedAt))
    .map((attempt, index) => {
      const reference = findAttemptReference(attempt, references)
      const analysis = analyseAttempt(attempt, reference)
      const performance = getAttemptPerformance(attempt, difficultySettings)
      const aPlus = reference?.gradeBands.find((band) => band.grade.trim().toUpperCase() === "A+")
      const date = new Date(`${attempt.completedAt}T00:00:00`)
      return {
        id: attempt.id,
        index: index + 1,
        timestamp: date.getTime(),
        dateLabel: date.toLocaleDateString("en-AU", {
          day: "numeric",
          month: "short",
          year: "numeric",
        }),
        percentage: performance.alignedPercentage,
        rawPercentage: performance.rawPercentage,
        adjustment: performance.adjustment,
        providerRelevance: performance.relevanceWeight,
        rawScore: attempt.rawScore,
        rawMax: attempt.rawMax,
        subject: attempt.subject,
        title: attempt.title,
        scaledScore: Number.isFinite(analysis.scaledScore) ? analysis.scaledScore : null,
        grade: analysis.grade,
        percentile: analysis.percentile,
        referenceYear: reference?.year ?? null,
        vcaaMeanPercentage: reference ? computeDistributionStats(reference).meanPercentage : null,
        aPlusCutoffPercentage: reference && aPlus?.minScore != null
          ? (aPlus.minScore / reference.maxScore) * 100
          : null,
      }
    })
}

function buildSummary(points: TrendPoint[]): string {
  if (points.length === 0) return "No attempts in this view yet."
  if (points.length === 1) return `1 practice exam at ${points[0].percentage.toFixed(0)}%.`
  const first = points[0].percentage
  const last = points[points.length - 1].percentage
  const diff = last - first
  const rounded = Math.round(diff * 10) / 10
  if (Math.abs(rounded) < 0.5) {
    return `${points.length} attempts logged, mark steady around ${last.toFixed(0)}%.`
  }
  const verb = diff > 0 ? "moved up" : "moved down"
  const sign = diff > 0 ? "+" : ""
  return `Across ${points.length} attempts, your mark ${verb} from ${first.toFixed(0)}% to ${last.toFixed(0)}% (${sign}${rounded.toFixed(1)}%).`
}

function formatTick(value: number) {
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
}

export function PerformanceTrendChart({
  attempts,
  references,
  preferredSubjects,
  difficultySettings,
}: {
  attempts: ExamAttempt[]
  references: AssessmentReference[]
  preferredSubjects: string[]
  difficultySettings?: ExamDifficultySettings
}) {
  const filterId = useId()
  const subjects = useMemo(
    () => prioritiseSubjects(attempts.map((attempt) => attempt.subject), preferredSubjects),
    [attempts, preferredSubjects],
  )
  const [subjectFilter, setSubjectFilter] = useState<string>(() => firstPreferredSubject(subjects, preferredSubjects) || "all")
  useEffect(() => {
    if (subjectFilter !== "all" && !subjects.includes(subjectFilter)) {
      setSubjectFilter("all")
    }
  }, [subjects, subjectFilter])

  const trend = useMemo(
    () => buildTrend(attempts, references, subjectFilter, difficultySettings),
    [attempts, references, subjectFilter, difficultySettings],
  )
  const summary = useMemo(() => buildSummary(trend), [trend])
  const overallAverage = useMemo(() => {
    if (trend.length === 0) return 0
    return trend.reduce((total, point) => total + point.percentage, 0) / trend.length
  }, [trend])
  const linkedCount = trend.filter((point) => point.referenceYear !== null).length

  if (attempts.length === 0) {
    return (
      <Card className="min-w-0">
        <CardHeader>
          <CardTitle>Performance trend</CardTitle>
          <CardDescription>
            Track VCAA-aligned performance over time, with official comparisons where linked.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground text-pretty">
            Log a practice exam to start charting your performance.
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle>Performance trend</CardTitle>
            <CardDescription>{summary}</CardDescription>
          </div>
          {subjects.length > 1 ? (
            <div className="flex items-center gap-2">
              <label htmlFor={`trend-subject-${filterId}`} className="whitespace-nowrap text-sm text-muted-foreground">
                Subject
              </label>
              <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subjectFilter} onValueChange={setSubjectFilter} includeAll id={`trend-subject-${filterId}`} className="h-8 w-44" />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <ChartContainer
          config={chartConfig}
          className="h-72 w-full min-w-0 aspect-auto"
          role="img"
          aria-label={summary}
        >
          <LineChart data={trend} margin={{ left: 4, right: 8, top: 12, bottom: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="timestamp"
              type="number"
              domain={["dataMin", "dataMax"]}
              scale="time"
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tickFormatter={formatTick}
            />
            <YAxis
              domain={[0, 100]}
              tickLine={false}
              axisLine={false}
              width={42}
              tickFormatter={(value) => `${value}%`}
            />
            {trend.length >= 2 ? (
              <ReferenceLine
                y={overallAverage}
                stroke="var(--color-average)"
                strokeDasharray="4 4"
                label={{
                  value: `Avg ${overallAverage.toFixed(0)}%`,
                  position: "insideTopRight",
                  fontSize: 10,
                  fill: "var(--muted-foreground)",
                }}
              />
            ) : null}
            <ChartTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const point = payload[0].payload as TrendPoint
                return (
                  <div className="max-w-72 min-w-56 rounded-lg border bg-background p-3 text-xs shadow-md">
                    <p className="truncate font-medium">{point.title}</p>
                    <p className="text-muted-foreground">
                      {point.subject} · {point.dateLabel}
                    </p>
                    <p className="mt-1.5 font-mono font-medium tabular-nums">
                      {point.rawScore}/{point.rawMax} · {point.rawPercentage.toFixed(1)}% raw
                    </p>
                    {Math.abs(point.adjustment) > 0.01 ? <p className="mt-1 text-muted-foreground tabular-nums">VCAA-aligned {point.percentage.toFixed(1)}% · {point.adjustment > 0 ? "+" : ""}{point.adjustment.toFixed(1)} pts · {Math.round(point.providerRelevance * 100)}% evidence weight</p> : null}
                    {point.grade ? (
                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">{point.grade}</Badge>
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          Est.
                        </Badge>
                        <span className="text-muted-foreground tabular-nums">
                          VCAA {point.referenceYear} · {point.scaledScore?.toFixed(1)} · {point.percentile?.toFixed(0)}th pctile
                        </span>
                      </div>
                    ) : null}
                    {point.vcaaMeanPercentage !== null ? (
                      <p className="mt-1 text-muted-foreground tabular-nums">
                        Est. cohort mean {point.vcaaMeanPercentage.toFixed(1)}%
                        {point.aPlusCutoffPercentage !== null ? ` · official A+ ${point.aPlusCutoffPercentage.toFixed(1)}%` : ""}
                      </p>
                    ) : null}
                  </div>
                )
              }}
            />
            {linkedCount ? <ChartLegend content={<ChartLegendContent />} /> : null}
            <Line
              type="monotone"
              dataKey="vcaaMeanPercentage"
              stroke="var(--color-vcaaMeanPercentage)"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              connectNulls
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="aPlusCutoffPercentage"
              stroke="var(--color-aPlusCutoffPercentage)"
              strokeWidth={1.5}
              connectNulls
              dot={false}
              isAnimationActive={false}
            />
            <Line
              type="monotone"
              dataKey="percentage"
              stroke="var(--color-percentage)"
              strokeWidth={2}
              dot={(props) => {
                const { cx, cy } = props as { cx: number; cy: number }
                return <Dot cx={cx} cy={cy} r={3.5} fill="var(--color-percentage)" stroke="var(--background)" strokeWidth={1.5} />
              }}
              activeDot={{ r: 5 }}
              isAnimationActive={false}
            />
          </LineChart>
        </ChartContainer>
      </CardContent>
    </Card>
  )
}
