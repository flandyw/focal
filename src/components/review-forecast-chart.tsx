import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart"
import type { Mistake } from "../lib/exam-data"
import { buildReviewForecast } from "../lib/performance-insights"
import { localDate } from "../lib/learning-workspace"
import { useTickingNow } from "../hooks/use-ticking-now"

const chartConfig = {
  due: { label: "Cards due", color: "var(--chart-4)" },
}

export function ReviewForecastChart({ mistakes }: { mistakes: Mistake[] }) {
  // Recompute only when the local calendar day changes, not on every minute tick.
  const today = localDate(useTickingNow())
  const forecast = useMemo(() => buildReviewForecast(mistakes, new Date(`${today}T00:00:00`)), [mistakes, today])
  const total = forecast.reduce((sum, day) => sum + day.due, 0)
  const busiest = forecast.reduce((current, day) => day.due > current.due ? day : current, forecast[0])
  const summary = total
    ? `${total} card${total === 1 ? "" : "s"} due over 14 days; the largest load is ${busiest.due} on ${busiest.label.toLowerCase()}.`
    : "No active mistake cards are due in the next 14 days."

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Review workload</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        <ChartContainer config={chartConfig} className="h-72 w-full min-w-0 aspect-auto" role="img" aria-label={summary}>
          <BarChart data={forecast} margin={{ left: 0, right: 8, top: 8, bottom: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="due" fill="var(--color-due)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
        <p className="mt-3 text-xs text-muted-foreground">
          Overdue cards are included in today. Use quieter days for a timed paper; clear heavier review days before adding new cards.
        </p>
      </CardContent>
    </Card>
  )
}
