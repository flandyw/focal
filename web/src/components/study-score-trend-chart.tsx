import { CartesianGrid, Dot, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip } from "@/components/ui/chart"
import type { StudyScoreTrendPoint } from "@/lib/study-score"

const chartConfig = {
  studyScore: { label: "Estimated study score", color: "#2563eb" },
  low: { label: "Lower likely range", color: "#93c5fd" },
  high: { label: "Upper likely range", color: "#93c5fd" },
}

function formatTick(value: number) {
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
}

function buildSummary(points: StudyScoreTrendPoint[]) {
  const latest = points.at(-1)
  if (!latest) return "Link a VCAA comparison to start estimating progress."
  if (points.length === 1) return `Current estimate ${latest.studyScore}, based on one linked attempt.`

  const first = points[0]
  const change = latest.studyScore - first.studyScore
  if (change === 0) return `${points.length} linked attempts; estimate remains around ${latest.studyScore}.`
  return `${points.length} linked attempts; estimate ${change > 0 ? "up" : "down"} ${Math.abs(change)} point${Math.abs(change) === 1 ? "" : "s"} from ${first.studyScore} to ${latest.studyScore}.`
}

export function StudyScoreTrendChart({ points }: { points: StudyScoreTrendPoint[] }) {
  const summary = buildSummary(points)

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Estimated study score over time</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        {points.length ? (
          <>
            <ChartContainer config={chartConfig} className="h-72 w-full min-w-0 aspect-auto" role="img" aria-label={summary}>
              <LineChart data={points} margin={{ left: 4, right: 12, top: 12, bottom: 4 }} accessibilityLayer>
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
                <YAxis domain={[0, 50]} width={34} tickLine={false} axisLine={false} />
                <ReferenceLine y={30} stroke="var(--border)" strokeDasharray="4 4" label={{ value: "State median", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />
                <ChartLegend content={<ChartLegendContent />} />
                <ChartTooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0].payload as StudyScoreTrendPoint
                  return (
                    <div className="max-w-72 min-w-56 rounded-lg border bg-background p-3 text-xs shadow-md">
                      <p className="truncate font-medium">{point.attempt.title}</p>
                      <p className="text-muted-foreground">{point.dateLabel} · {point.attempt.examYear} · {point.attempt.paper}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">Estimate {point.studyScore}</Badge>
                        <span className="font-medium tabular-nums">likely {point.low}–{point.high}</span>
                      </div>
                      <p className="mt-1 text-muted-foreground">
                        Recalculated using {point.evidenceCount} linked attempt{point.evidenceCount === 1 ? "" : "s"} up to this date.
                        {!point.exactReferenceYear ? ` ${point.referenceYear} distribution used for this paper.` : ""}
                      </p>
                    </div>
                  )
                }} />
                <Line type="monotone" dataKey="low" stroke="var(--color-low)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="high" stroke="var(--color-high)" strokeWidth={1.5} strokeDasharray="4 3" dot={false} connectNulls isAnimationActive={false} />
                <Line type="monotone" dataKey="studyScore" stroke="var(--color-studyScore)" strokeWidth={2.5} isAnimationActive={false} dot={(props) => {
                  const { cx, cy } = props as { cx: number; cy: number }
                  return <Dot cx={cx} cy={cy} r={3.5} fill="var(--color-studyScore)" stroke="var(--background)" strokeWidth={1.5} />
                }} activeDot={{ r: 5 }} />
              </LineChart>
            </ChartContainer>
            <p className="mt-3 text-xs text-muted-foreground">Each point is recalculated from the attempts completed by that date. Dashed lines show the likely range, not a guarantee.</p>
          </>
        ) : (
          <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            {summary}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
