import { useMemo } from "react"
import { useReducedMotion } from "framer-motion"
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import type { TimeOfDayBucket } from "@/lib/analytics"

interface TimeOfDayChartProps {
  data: TimeOfDayBucket[]
}

export function TimeOfDayChart({ data }: TimeOfDayChartProps) {
  const reduceMotion = useReducedMotion() === true
  const hasData = data.some((d) => d.minutes > 0)

  const chartData = useMemo(() => {
    return data.map((d) => ({
      hour: d.hour,
      label: d.hour === 0 ? "12a" : d.hour < 12 ? `${d.hour}a` : d.hour === 12 ? "12p" : `${d.hour - 12}p`,
      minutes: d.minutes,
    }))
  }, [data])

  const peakHour = useMemo(() => {
    let max = 0
    let maxIdx = 0
    data.forEach((d, i) => {
      if (d.minutes > max) {
        max = d.minutes
        maxIdx = i
      }
    })
    return max > 0 ? maxIdx : -1
  }, [data])

  const formatMinutes = (value: number) => {
    if (value === 0) return "0m"
    if (value < 60) return `${value}m`
    const h = Math.floor(value / 60)
    const m = value % 60
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }

  return (
    <section className="border-t border-border/70 pt-5">
      <h3 className="text-sm font-semibold mb-4">Study Time of Day</h3>
      {hasData ? (
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              interval={2}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={formatMinutes}
            />
            <Tooltip
              cursor={{ fill: "var(--muted)", opacity: 0.3 }}
              contentStyle={{
                fontSize: 12,
                background: "var(--popover)",
                border: "1px solid var(--border)",
                borderRadius: 12,
                color: "var(--popover-foreground)",
              }}
              formatter={(value: unknown) => [formatMinutes(Number(value)), "Study time"]}
              labelFormatter={(label) =>
                typeof label === "string" ? `Hour: ${label}` : "Hour"
              }
            />
            <Bar
              dataKey="minutes"
              fill="var(--chart-2)"
              radius={[4, 4, 0, 0]}
              isAnimationActive={!reduceMotion}
              animationDuration={200}
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <p className="text-xs text-muted-foreground">No study data for this period.</p>
      )}
      {peakHour >= 0 && (
        <p className="mt-2 text-micro text-muted-foreground">
          Peak hour: <span className="font-medium text-foreground">
            {peakHour === 0 ? "12:00 AM" : peakHour < 12 ? `${peakHour}:00 AM` : peakHour === 12 ? "12:00 PM" : `${peakHour - 12}:00 PM`}
          </span>
        </p>
      )}
      <p className="sr-only">
        Study time of day across 24 hours.{" "}
        {peakHour >= 0
          ? `Peak hour ${peakHour === 0 ? "12 AM" : peakHour < 12 ? `${peakHour} AM` : peakHour === 12 ? "12 PM" : `${peakHour - 12} PM`}.`
          : "No study time recorded."}
      </p>
    </section>
  )
}
