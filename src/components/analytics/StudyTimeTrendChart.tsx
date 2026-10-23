import { useMemo } from "react"
import { useReducedMotion } from "framer-motion"
import {
  ResponsiveContainer,
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts"
import { getSubjectColor } from "../../lib/progress-chart-theme"
import { getSubjectById } from "../../lib/progress-utils"
import type { ConsistencyDay, StudyTimePoint } from "../../lib/progress-analytics"

interface StudyTimeTrendChartProps {
  data: StudyTimePoint[]
  days: ConsistencyDay[]
}

interface DailyPoint {
  date: string
  average: number
  subjects: Record<string, number>
}

const UNASSIGNED_ID = "_unassigned"

function formatMinutes(value: number) {
  if (value === 0) return "0m"
  if (value < 60) return `${value}m`
  const h = Math.floor(value / 60)
  const m = value % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatTotalMinutes(m: number) {
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem > 0 ? `${h}h ${rem}m` : `${h}h`
}

export function StudyTimeTrendChart({ data, days }: StudyTimeTrendChartProps) {
  const reduceMotion = useReducedMotion() === true
  const { chartData, subjectIds, totalMinutes, summaries } =
    useMemo(() => {
      const dayMap = new Map<string, Map<string, number>>()
      data.forEach((point) => {
        const existing = dayMap.get(point.date) ?? new Map<string, number>()
        const sid = point.subjectId ?? UNASSIGNED_ID
        existing.set(sid, (existing.get(sid) ?? 0) + point.minutes)
        dayMap.set(point.date, existing)
      })

      const subjectTotals = new Map<string, number>()
      dayMap.forEach((subjectMap) => {
        subjectMap.forEach((minutes, sid) => {
          subjectTotals.set(sid, (subjectTotals.get(sid) ?? 0) + minutes)
        })
      })

      const sorted = Array.from(subjectTotals.entries())
        .filter(([, m]) => m > 0)
        .sort((a, b) => b[1] - a[1])

      const points: DailyPoint[] = days.map(({ date }, index) => {
        const subjectMap = dayMap.get(date) ?? new Map<string, number>()
        const window = days.slice(Math.max(0, index - 6), index + 1)
        const average = window.reduce((sum, day) => sum + day.minutes, 0) / window.length
        return { date, average: Math.round(average), subjects: Object.fromEntries(subjectMap) }
      })

      const total = sorted.reduce((sum, [, m]) => sum + m, 0)

      const nameFor = (sid: string) =>
        getSubjectById(sid)?.name ?? "Unassigned"

      const summaries = sorted.map(([sid, minutes]) => ({
        name: nameFor(sid),
        minutes,
      }))

      return {
        chartData: points,
        subjectIds: sorted.map(([sid]) => sid),
        totalMinutes: total,
        summaries,
      }
    }, [data, days])

  if (totalMinutes === 0) {
    return (
      <section className="border-t border-border/70 pt-5">
        <h3 className="font-heading text-xl font-normal tracking-tight mb-1">Study Time Trends</h3>
        <p className="text-xs text-muted-foreground">No study data for this period.</p>
      </section>
    )
  }

  return (
    <section className="border-t border-border/70 pt-5">
      <h3 className="font-heading text-xl font-normal tracking-tight mb-1">Study Time Trends</h3>
      <p className="mb-4 text-xs text-muted-foreground">Daily study time and a rolling average of up to 7 days, including days off.</p>
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart accessibilityLayer data={chartData} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(value) => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
            minTickGap={32}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatMinutes}
          />
          <Tooltip
            contentStyle={{
              fontSize: 12,
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              color: "var(--popover-foreground)",
            }}
            labelStyle={{ color: "var(--muted-foreground)", fontSize: 11 }}
            labelFormatter={(date) => new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" })}
            formatter={(value: unknown, name: unknown) => {
              const sid = String(name)
              if (sid === "average") return [formatMinutes(Number(value)), "7-day average"]
              const displayName = getSubjectById(sid)?.name ?? "Unassigned"
              return [formatMinutes(Number(value)), displayName]
            }}
          />
          {subjectIds.map((subjectId) => {
            const color = getSubjectColor(subjectId)
            return (
              <Bar
                key={subjectId}
                dataKey={(point: DailyPoint) => point.subjects[subjectId] ?? 0}
                name={subjectId}
                stackId="1"
                stroke={color}
                fill={color}
                fillOpacity={0.65}
                maxBarSize={28}
                isAnimationActive={!reduceMotion}
                animationDuration={200}
              />
            )
          })}
          <Line type="linear" dataKey="average" stroke="var(--foreground)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className="flex items-center gap-1.5 text-caption text-muted-foreground"><span className="w-4 border-t-2 border-foreground" />7-day average</span>
        {subjectIds.map((sid) => {
          const color = getSubjectColor(sid)
          const name = getSubjectById(sid)?.name ?? "Unassigned"
          return (
            <div key={sid} className="flex items-center gap-1.5">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="text-caption text-muted-foreground">{name}</span>
            </div>
          )
        })}
      </div>
      <p className="sr-only">
        Study time trend over {chartData.length} day{chartData.length === 1 ? "" : "s"}:
        total {formatTotalMinutes(totalMinutes)}
        {summaries.length > 0
          ? `. Subjects: ${summaries
              .map((s) => `${s.name} ${formatTotalMinutes(s.minutes)}`)
              .join(", ")}`
          : ""}
        .
      </p>
    </section>
  )
}
