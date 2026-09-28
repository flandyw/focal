import { useId, useMemo } from "react"
import {
  Area,
  CartesianGrid,
  ComposedChart,
  ReferenceLine,
  Scatter,
  XAxis,
  YAxis,
} from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import {
  analyseAttempt,
  analyseScore,
  computeDistributionStats,
  formatReferenceName,
  findAttemptReferenceForYear,
  type AssessmentReference,
  type ExamAttempt,
} from "@/lib/exam-data"

const chartConfig = {
  density: { label: "Cohort density", color: "#2563eb" },
  attempt: { label: "Your attempt", color: "#16a34a" },
}

type DistributionPoint = {
  score: number
  density: number
  attemptDensity?: number
  grade: string | null
  percentile: number | null
  percentage: number
  zScore: number
}

type AttemptPoint = {
  score: number
  density: number
  grade: string
  percentile: number
}

function normalDensity(x: number, mean: number, stdDev: number): number {
  if (stdDev <= 0) return 0
  const z = (x - mean) / stdDev
  return (1 / (stdDev * Math.sqrt(2 * Math.PI))) * Math.exp(-0.5 * z * z) * 100
}

function getDistributionPoint(
  score: number,
  reference: AssessmentReference,
  stats: { mean: number; stdDev: number },
): DistributionPoint {
  const analysis = analyseScore(score, reference)
  return {
    score,
    density: normalDensity(score, stats.mean, stats.stdDev),
    grade: analysis.grade,
    percentile: analysis.percentile,
    percentage: (score / reference.maxScore) * 100,
    zScore: (score - stats.mean) / stats.stdDev,
  }
}

function getDistributionData(
  reference: AssessmentReference,
  stats: { mean: number; stdDev: number },
  attemptPoint: AttemptPoint | null,
): DistributionPoint[] {
  const points: DistributionPoint[] = []
  const steps = 200
  for (let i = 0; i <= steps; i++) {
    const score = (reference.maxScore * i) / steps
    points.push(getDistributionPoint(score, reference, stats))
  }
  if (attemptPoint) {
    const existingPoint = points.find((point) => point.score === attemptPoint.score)
    if (existingPoint) {
      existingPoint.attemptDensity = attemptPoint.density
    } else {
      points.push({
        ...getDistributionPoint(attemptPoint.score, reference, stats),
        attemptDensity: attemptPoint.density,
      })
      points.sort((a, b) => a.score - b.score)
    }
  }
  return points
}

function getAttemptPoint(
  attempt: ExamAttempt,
  reference: AssessmentReference,
  stats: { mean: number; stdDev: number },
): AttemptPoint | null {
  const analysis = analyseAttempt(attempt, reference)
  if (analysis.percentile === null) return null
  const score = analysis.scaledScore
  const density = normalDensity(score, stats.mean, stats.stdDev)
  return {
    score,
    density,
    grade: analysis.grade ?? "—",
    percentile: analysis.percentile,
  }
}

function getGradeTicks(reference: AssessmentReference) {
  const bands = reference.gradeBands.toSorted(
    (first, second) => (first.minScore ?? 0) - (second.minScore ?? 0),
  )
  const ticks: number[] = []
  const labels = new Map<number, string>()
  for (const band of bands) {
    const min = band.minScore ?? 0
    const max = band.maxScore ?? reference.maxScore
    const midpoint = (min + max) / 2
    ticks.push(midpoint)
    labels.set(midpoint, band.grade)
  }
  return { ticks, labels }
}

export function AttemptDistributionChart({
  attempt,
  references,
  comparisonYear,
}: {
  attempt: ExamAttempt
  references: AssessmentReference[]
  comparisonYear: number
}) {
  const gradientId = useId()
  const reference = useMemo(
    () => findAttemptReferenceForYear(attempt, references, comparisonYear),
    [attempt, comparisonYear, references],
  )

  const stats = reference ? computeDistributionStats(reference) : null
  const attemptPoint = reference && stats ? getAttemptPoint(attempt, reference, stats) : null
  const chartData = reference && stats ? getDistributionData(reference, stats, attemptPoint) : []
  const gradeTicks = reference ? getGradeTicks(reference) : null
  const maxDensity = chartData.length ? Math.max(...chartData.map((point) => point.density)) : 0

  if (!reference || !stats || !gradeTicks) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
        No {comparisonYear} VCAA grade distribution is available for {attempt.subject} · {attempt.paper}.
      </div>
    )
  }

  if (stats.stdDev <= 0) {
    return (
      <div className="rounded-md border bg-muted/40 p-4 text-sm text-muted-foreground">
        Cannot draw a distribution for {reference.year} {reference.studyName} because the standard deviation is zero.
      </div>
    )
  }

  const distributionLines = [
    { key: "mean", score: stats.mean, stroke: "#2563eb", dash: undefined },
    { key: "median", score: stats.median, stroke: "#ca8a04", dash: "5 3" },
    ...[1, 2, 3].flatMap((deviation) => [-1, 1].map((direction) => ({
      key: `${direction * deviation}sd`,
      score: stats.mean + direction * deviation * stats.stdDev,
      stroke: "#ea580c",
      dash: "2 4",
    }))),
  ].filter((line) => line.score >= 0 && line.score <= reference.maxScore)

  return (
    <Card className="min-w-0">
      <CardHeader className="gap-4">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle className="text-base">Normal distribution</CardTitle>
            <CardDescription>
              {reference.year} {reference.studyName} · {formatReferenceName(reference.name)}
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        <ChartContainer
          config={chartConfig}
          className="h-[28rem] w-full min-w-0 aspect-auto"
          role="img"
          aria-label={`${reference.year} ${reference.studyName} ${reference.name} normal distribution`}
        >
          <ComposedChart data={chartData} margin={{ left: 4, right: 4, top: 24, bottom: 4 }} accessibilityLayer>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--color-density)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--color-density)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="score"
              type="number"
              domain={[0, reference.maxScore]}
              ticks={gradeTicks.ticks}
              tickFormatter={(value) => gradeTicks.labels.get(value) ?? ""}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              yAxisId="density"
              tickLine={false}
              axisLine={false}
              width={60}
              domain={[0, Math.ceil(maxDensity * 1.15)]}
              label={{ value: "Density", angle: -90, position: "insideLeft" }}
            />
            <ChartTooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const item = payload.find(
                  (entry) => entry.type !== "none" && entry.payload && "zScore" in entry.payload,
                )
                if (!item) return null
                const point = item.payload as DistributionPoint
                const distance = Math.abs(point.zScore)
                const meanDistance = distance < 0.005
                  ? "At the mean"
                  : `${distance.toFixed(2)}σ ${point.zScore > 0 ? "above" : "below"} mean`
                return (
                  <div className="min-w-56 rounded-lg border bg-background p-3 text-xs shadow-md">
                    <div className="mb-2 flex items-baseline justify-between gap-4">
                      <p className="font-medium">Score {point.score.toFixed(1)} / {reference.maxScore}</p>
                      <p className="font-semibold">Grade {point.grade ?? "—"}</p>
                    </div>
                    <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1">
                      <dt className="text-muted-foreground">Score percentage</dt>
                      <dd className="text-right tabular-nums">{point.percentage.toFixed(1)}%</dd>
                      <dt className="text-muted-foreground">Estimated percentile</dt>
                      <dd className="text-right tabular-nums">
                        {point.percentile === null ? "—" : `${point.percentile.toFixed(1)}th`}
                      </dd>
                      <dt className="text-muted-foreground">Z-score</dt>
                      <dd className="text-right tabular-nums">
                        {point.zScore >= 0 ? "+" : ""}{point.zScore.toFixed(2)}
                      </dd>
                      <dt className="text-muted-foreground">From mean</dt>
                      <dd className="text-right tabular-nums">{meanDistance}</dd>
                      <dt className="text-muted-foreground">Cohort density</dt>
                      <dd className="text-right tabular-nums">{point.density.toFixed(2)}% / point</dd>
                    </dl>
                  </div>
                )
              }}
            />
            <Area
              yAxisId="density"
              type="monotone"
              dataKey="density"
              stroke="var(--color-density)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={false}
              isAnimationActive={false}
            />
            {distributionLines.map((line) => (
              <ReferenceLine
                key={line.key}
                yAxisId="density"
                x={line.score}
                stroke={line.stroke}
                strokeDasharray={line.dash}
                strokeOpacity={0.9}
              />
            ))}
            {attemptPoint ? (
              <>
                <ReferenceLine
                  yAxisId="density"
                  x={attemptPoint.score}
                  stroke="var(--color-attempt)"
                  strokeDasharray="4 4"
                />
                <Scatter
                  yAxisId="density"
                  dataKey="attemptDensity"
                  tooltipType="none"
                  fill="var(--color-attempt)"
                  isAnimationActive={false}
                />
              </>
            ) : null}
          </ComposedChart>
        </ChartContainer>

        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
          {attemptPoint ? (
            <span className="flex items-center gap-2">
              <span className="inline-block w-6 border-t border-dashed border-[var(--chart-2)]" />
              Your score
            </span>
          ) : null}
          <span className="flex items-center gap-2">
            <span className="inline-block w-6 border-t border-[var(--chart-mean)]" />
            Mean {stats.mean.toFixed(1)}
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-6 border-t border-dashed border-[var(--chart-median)]" />
            Median {stats.median.toFixed(1)}
          </span>
          <span className="flex items-center gap-2">
            <span className="inline-block w-6 border-t border-dotted border-[var(--chart-deviation)]" />
            Standard deviations ±1σ, ±2σ, ±3σ
          </span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Mean</p>
            <p className="text-lg font-semibold tabular-nums">
              {stats.mean.toFixed(1)} <span className="text-sm font-normal text-muted-foreground">/ {reference.maxScore}</span>
            </p>
            <p className="text-xs text-muted-foreground">{stats.meanPercentage.toFixed(1)}%</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Std. dev.</p>
            <p className="text-lg font-semibold tabular-nums">{stats.stdDev.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">scaled points</p>
          </div>
          <div className="rounded-md border p-3">
            <p className="text-xs text-muted-foreground">Variance</p>
            <p className="text-lg font-semibold tabular-nums">{stats.variance.toFixed(2)}</p>
            <p className="text-xs text-muted-foreground">scaled points²</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
