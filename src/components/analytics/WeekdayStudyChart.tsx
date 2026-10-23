import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import type { ConsistencyDay } from "../../lib/progress-analytics"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart"

const config = { average: { label: "Daily average", color: "var(--chart-2)" } }

export function WeekdayStudyChart({ days }: { days: ConsistencyDay[] }) {
  const data = useMemo(() => {
    const weekdays = Array.from({ length: 7 }, (_, index) => ({
      label: new Date(2024, 0, index + 1).toLocaleDateString(undefined, { weekday: "short" }),
      minutes: 0, count: 0, studied: 0, average: 0,
    }))
    for (const day of days) {
      const weekday = weekdays[(new Date(`${day.date}T00:00:00`).getDay() + 6) % 7]
      weekday.minutes += day.minutes
      weekday.count++
      if (day.minutes > 0) weekday.studied++
    }
    return weekdays.map((day) => ({ ...day, average: day.count ? Math.round(day.minutes / day.count) : 0 }))
  }, [days])
  const best = data.reduce((best, day) => day.average > best.average ? day : best, data[0])

  return (
    <section className="min-w-0 border-t border-border/70 pt-5">
      <h3 className="mb-1 font-heading text-xl font-normal tracking-tight">Your weekly rhythm</h3>
      <p className="mb-4 text-xs text-muted-foreground">Average minutes for each weekday, including days without study.</p>
      {best.average > 0 ? <>
        <ChartContainer config={config} className="h-48 w-full min-w-0 aspect-auto" aria-label="Average study minutes by weekday">
          <BarChart data={data} accessibilityLayer margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} interval={0} />
            <YAxis tickFormatter={(minutes) => `${minutes}m`} tickLine={false} axisLine={false} />
            <ChartTooltip content={<ChartTooltipContent labelKey="label" formatter={(value, _, item) => <div className="grid gap-1"><span className="font-medium tabular-nums">{Number(value)}m average</span><span className="text-muted-foreground">Studied on {item.payload.studied} of {item.payload.count} days</span></div>} />} />
            <Bar dataKey="average" fill="var(--color-average)" maxBarSize={36} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ChartContainer>
        <p className="mt-3 text-xs text-muted-foreground">Highest average: <span className="font-medium text-foreground">{best.label} · {best.average}m</span> · studied on {best.studied} of {best.count} days.</p>
        <p className="sr-only">{data.map((day) => `${day.label}: ${day.average} minutes per day, studied on ${day.studied} of ${day.count} days.`).join(" ")}</p>
      </> : <p className="text-xs text-muted-foreground">Complete a study session in this period to see your weekday pattern.</p>}
    </section>
  )
}
