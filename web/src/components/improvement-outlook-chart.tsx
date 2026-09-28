import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart"
import type { ExamAttempt } from "@/lib/exam-data"
import { buildSubjectOutlooks, type SubjectOutlook } from "@/lib/performance-insights"
import type { ExamDifficultySettings } from "@/lib/exam-difficulty"

const chartConfig = {
  currentAverage: { label: "Recent average", color: "#2563eb" },
  projectedNext: { label: "Trend projection", color: "#f59e0b" },
}

function formatSubject(value: string) {
  return value.length > 24 ? `${value.slice(0, 22)}…` : value
}

export function ImprovementOutlookChart({ attempts, difficultySettings }: { attempts: ExamAttempt[]; difficultySettings?: ExamDifficultySettings }) {
  const outlooks = useMemo(() => buildSubjectOutlooks(attempts, difficultySettings), [attempts, difficultySettings])
  const improving = outlooks.filter((item) => item.projectedNext > item.currentAverage + 1).length
  const summary = outlooks.length
    ? `${improving} of ${outlooks.length} subject${outlooks.length === 1 ? "" : "s"} currently project upward from their recent average.`
    : "Log attempts to estimate where your current trajectory is heading."

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Improvement outlook</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        {outlooks.length ? (
          <>
            <ChartContainer
              config={chartConfig}
              className="w-full min-w-0 aspect-auto"
              style={{ height: Math.max(270, outlooks.length * 66) }}
              role="img"
              aria-label={`${summary} Recency-weighted projections compare the recent average with the estimated next result.`}
            >
              <BarChart data={outlooks} layout="vertical" margin={{ left: 6, right: 12, top: 8, bottom: 4 }} accessibilityLayer>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}%`} />
                <YAxis type="category" dataKey="subject" width={138} tickLine={false} axisLine={false} tickFormatter={formatSubject} />
                <ChartTooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as SubjectOutlook
                  return (
                    <div className="min-w-64 rounded-lg border bg-background p-3 text-xs shadow-md">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">{row.subject}</p>
                        <Badge variant="outline">{row.confidence} confidence</Badge>
                      </div>
                      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
                        <dt className="text-muted-foreground">Recent average</dt><dd>{row.currentAverage.toFixed(1)}%</dd>
                        <dt className="text-muted-foreground">Projected next</dt><dd>{row.projectedNext.toFixed(1)}%</dd>
                        <dt className="text-muted-foreground">Likely range</dt><dd>{row.predictionLow.toFixed(0)}–{row.predictionHigh.toFixed(0)}%</dd>
                        <dt className="text-muted-foreground">Recent momentum</dt><dd>{row.momentum >= 0 ? "+" : ""}{row.momentum.toFixed(1)} pts</dd>
                        <dt className="text-muted-foreground">Score spread</dt><dd>±{row.spread.toFixed(1)} pts</dd>
                        <dt className="text-muted-foreground">Evidence</dt><dd>{row.attempts} attempt{row.attempts === 1 ? "" : "s"}</dd>
                      </dl>
                    </div>
                  )
                }} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="currentAverage" fill="var(--color-currentAverage)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
                <Bar dataKey="projectedNext" fill="var(--color-projectedNext)" radius={[0, 3, 3, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
            <p className="mt-3 text-xs text-muted-foreground">
              Projection uses recency, provider difficulty and VCAA relevance. Official-style papers contribute more than providers far from the VCAA baseline. It is a study signal, not a guaranteed result.
            </p>
          </>
        ) : null}
      </CardContent>
    </Card>
  )
}
