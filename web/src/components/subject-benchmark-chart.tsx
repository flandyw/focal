import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart"
import {
  buildSubjectBenchmarks,
  type AssessmentReference,
  type ExamAttempt,
  type Mistake,
  type SubjectBenchmark,
} from "@/lib/exam-data"

const chartConfig = {
  averageMark: { label: "Your average", color: "#16a34a" },
  vcaaMeanPercentage: { label: "Est. VCAA mean", color: "#2563eb" },
  aPlusCutoffPercentage: { label: "Official A+ cutoff", color: "#dc2626" },
}

function formatSubject(value: string) {
  return value.length > 22 ? `${value.slice(0, 20)}…` : value
}

function formatPercent(value: number | null) {
  return value === null ? "—" : `${value.toFixed(1)}%`
}

export function SubjectBenchmarkChart({
  attempts,
  references,
  mistakes,
}: {
  attempts: ExamAttempt[]
  references: AssessmentReference[]
  mistakes: Mistake[]
}) {
  const rows = useMemo(() => buildSubjectBenchmarks(attempts, references), [attempts, references])
  const unresolvedByAttempt = useMemo(() => {
    const counts = new Map<string, number>()
    for (const mistake of mistakes) {
      if (!mistake.resolved) counts.set(mistake.attemptId, (counts.get(mistake.attemptId) ?? 0) + 1)
    }
    return counts
  }, [mistakes])
  const unresolvedBySubject = useMemo(() => {
    const counts = new Map<string, number>()
    for (const attempt of attempts) {
      counts.set(attempt.subject, (counts.get(attempt.subject) ?? 0) + (unresolvedByAttempt.get(attempt.id) ?? 0))
    }
    return counts
  }, [attempts, unresolvedByAttempt])
  const linkedCount = rows.reduce((total, row) => total + row.linkedCount, 0)
  const summary = linkedCount
    ? `${linkedCount} of ${attempts.length} attempts benchmarked against VCAA grade distributions across ${rows.length} subject${rows.length === 1 ? "" : "s"}.`
    : "No attempts currently match an official VCAA grade distribution."

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Subject benchmark</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        {rows.length ? (
          <>
            <ChartContainer
              config={chartConfig}
              className="w-full min-w-0 aspect-auto"
              style={{ height: Math.max(280, rows.length * 62) }}
              role="img"
              aria-label={`${summary} Bars compare your average mark with estimated VCAA cohort means and official A+ cutoffs.`}
            >
              <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 12, top: 8, bottom: 4 }} accessibilityLayer>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
                <YAxis type="category" dataKey="subject" width={132} tickLine={false} axisLine={false} tickFormatter={formatSubject} />
                <ChartTooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const row = payload[0].payload as SubjectBenchmark
                    return (
                      <div className="min-w-64 rounded-lg border bg-background p-3 text-xs shadow-md">
                        <p className="font-medium">{row.subject}</p>
                        <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
                          <dt className="text-muted-foreground">Your average / best</dt><dd>{row.averageMark.toFixed(1)}% / {row.bestMark.toFixed(1)}%</dd>
                          <dt className="text-muted-foreground">Latest mark</dt><dd>{row.latestMark.toFixed(1)}%</dd>
                          <dt className="text-muted-foreground">Est. VCAA mean</dt><dd>{formatPercent(row.vcaaMeanPercentage)}</dd>
                          <dt className="text-muted-foreground">Official A+ cutoff</dt><dd>{formatPercent(row.aPlusCutoffPercentage)}</dd>
                          <dt className="text-muted-foreground">Est. average percentile</dt><dd>{row.averagePercentile?.toFixed(0) ?? "—"}</dd>
                          <dt className="text-muted-foreground">Unresolved mistakes</dt><dd>{unresolvedBySubject.get(row.subject) ?? 0}</dd>
                        </dl>
                      </div>
                    )
                  }}
                />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="averageMark" fill="var(--color-averageMark)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                <Bar dataKey="vcaaMeanPercentage" fill="var(--color-vcaaMeanPercentage)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                <Bar dataKey="aPlusCutoffPercentage" fill="var(--color-aPlusCutoffPercentage)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
            <p className="mt-3 text-xs text-muted-foreground">
              A+ cutoffs are official. Cohort means and percentiles are estimates from VCAA grouped grade bands; subject rows average the distributions linked to your attempts.
            </p>
          </>
        ) : (
          <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            Log a practice exam to compare subject performance.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
