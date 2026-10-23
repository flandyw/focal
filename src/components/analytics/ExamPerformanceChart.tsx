import { useMemo } from "react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { analyseAttempt, validateAttempt, type ExamAttempt } from "../../lib/exam-data"
import type { AnalyticsRange } from "../../lib/progress-analytics"
import { getSubjectColor } from "../../lib/progress-chart-theme"
import { getSubjectById } from "../../lib/progress-utils"
import { studySubjectId } from "../../lib/studySubjects"
import { Button } from "../ui/button"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "../ui/chart"

function average(attempts: ExamAttempt[]) {
  return attempts.length ? attempts.reduce((sum, attempt) => sum + analyseAttempt(attempt).percentage, 0) / attempts.length : null
}

function formatChange(change: number | null) {
  if (change === null) return "—"
  const rounded = Math.round(change * 10) / 10
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(1)} pp`
}

export function ExamPerformanceChart({ attempts, range, periodEnd, onLogExam }: {
  attempts: ExamAttempt[]
  range: AnalyticsRange
  periodEnd: number
  onLogExam: () => void
}) {
  const { chartData, config, rows, current, mean, best, change } = useMemo(() => {
    const start = new Date(periodEnd)
    start.setHours(0, 0, 0, 0)
    start.setDate(start.getDate() - (range - 1))
    const previousStart = new Date(start)
    previousStart.setDate(previousStart.getDate() - range)
    const valid = attempts.filter((attempt) => validateAttempt(attempt) === null && Number.isFinite(Date.parse(`${attempt.completedAt}T00:00:00`)))
    const current = valid.filter((attempt) => {
      const time = Date.parse(`${attempt.completedAt}T00:00:00`)
      return (range === 0 || time >= +start) && time <= periodEnd
    })
    const previous = range === 0 ? [] : valid.filter((attempt) => {
      const time = Date.parse(`${attempt.completedAt}T00:00:00`)
      return time >= +previousStart && time < +start
    })
    const mean = average(current)
    const previousMean = average(previous)
    const ids = [...new Set([...current, ...previous].map((attempt) => studySubjectId(attempt.subject)))]
    const rows = ids.map((id, index) => {
      const papers = current.filter((attempt) => studySubjectId(attempt.subject) === id)
      const earlier = previous.filter((attempt) => studySubjectId(attempt.subject) === id)
      const mean = average(papers)
      const previousMean = average(earlier)
      return { id, key: `subject${index}`, count: papers.length, mean, previousMean, change: mean !== null && previousMean !== null ? mean - previousMean : null }
    }).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    const config = Object.fromEntries(rows.map((row) => [row.key, { label: getSubjectById(row.id)?.name ?? row.id, color: getSubjectColor(row.id) }]))
    const keys = new Map(rows.map((row) => [row.id, row.key]))
    const byDate = new Map<string, Map<string, ExamAttempt[]>>()
    for (const attempt of current) {
      const subjects = byDate.get(attempt.completedAt) ?? new Map<string, ExamAttempt[]>()
      const key = keys.get(studySubjectId(attempt.subject))!
      const papers = subjects.get(key) ?? []
      papers.push(attempt)
      subjects.set(key, papers)
      byDate.set(attempt.completedAt, subjects)
    }
    const chartData = [...byDate].sort(([a], [b]) => a.localeCompare(b)).map(([date, subjects]) => ({
      timestamp: Date.parse(`${date}T00:00:00`),
      ...Object.fromEntries([...subjects].map(([key, papers]) => [key, average(papers)])),
    }))
    return {
      chartData, config, rows, current, mean,
      best: current.length ? Math.max(...current.map((attempt) => analyseAttempt(attempt).percentage)) : null,
      change: mean !== null && previousMean !== null ? mean - previousMean : null,
    }
  }, [attempts, range, periodEnd])

  return (
    <section className="min-w-0 border-t border-border/70 pt-5" aria-label="Exam performance">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-xl font-normal tracking-tight">Exam performance</h2>
          <p className="mt-1 text-xs text-muted-foreground">Raw marks as percentages. Each line tracks one subject; multiple papers on a day are averaged.</p>
        </div>
        <Button size="sm" variant="outline" onClick={onLogExam}>Log an exam</Button>
      </div>
      <dl className="mb-5 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
        {[
          ["Papers logged", String(current.length)],
          ["Average mark", mean === null ? "—" : `${mean.toFixed(1)}%`],
          ["Best mark", best === null ? "—" : `${best.toFixed(1)}%`],
          [range === 0 ? "Period comparison" : `vs previous ${range} days`, range === 0 ? "All time" : formatChange(change)],
        ].map(([label, value]) => <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-xl font-medium tabular-nums">{value}</dd>
        </div>)}
      </dl>
      <div className="grid min-w-0 gap-6 min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="min-w-0">
          {current.length ? <ChartContainer config={config} className="h-60 w-full min-w-0 aspect-auto" aria-label="Average daily exam percentages by subject">
            <LineChart data={chartData} accessibilityLayer margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="timestamp" type="number" scale="time" domain={([min, max]: readonly [number, number]) => min === max ? [min - 43_200_000, max + 43_200_000] : [min, max]} ticks={chartData.length === 1 ? [chartData[0].timestamp] : undefined} tickFormatter={(time) => new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric" })} minTickGap={32} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tickFormatter={(score) => `${score}%`} axisLine={false} tickLine={false} width={52} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => new Date(payload[0]?.payload.timestamp).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })} formatter={(value, name) => <div className="flex flex-1 items-center justify-between gap-4"><span className="text-muted-foreground">{config[String(name)]?.label}</span><span className="font-medium tabular-nums">{Number(value).toFixed(1)}%</span></div>} />} />
              {rows.filter((row) => row.count > 0).map((row) => <Line key={row.key} dataKey={row.key} stroke={`var(--color-${row.key})`} strokeWidth={2} connectNulls dot={{ r: 3, strokeWidth: 1.5, fill: "var(--background)" }} activeDot={{ r: 5 }} isAnimationActive={false} />)}
            </LineChart>
          </ChartContainer> : <div className="flex h-60 items-center justify-center bg-muted/30 px-5 text-center text-sm text-muted-foreground">No exam results in this period. Log a marked paper or choose a wider date range.</div>}
        </div>
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">Exam results by subject. Change is the difference in average raw percentage points from the previous period.</caption>
            <thead className="border-b text-muted-foreground"><tr><th scope="col" className="pb-2 pr-3 font-normal">Subject</th><th scope="col" className="pb-2 pr-3 text-right font-normal">Papers</th><th scope="col" className="pb-2 pr-3 text-right font-normal">Average</th>{range !== 0 && <th scope="col" className="pb-2 text-right font-normal">Change</th>}</tr></thead>
            <tbody className="divide-y divide-border/50">{rows.map((row) => <tr key={row.id}>
              <th scope="row" className="py-3 pr-3 font-medium"><span className="flex items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: getSubjectColor(row.id) }} />{getSubjectById(row.id)?.name ?? row.id}</span></th>
              <td className="py-3 pr-3 text-right tabular-nums">{row.count}</td>
              <td className="py-3 pr-3 text-right tabular-nums">{row.mean === null ? "—" : `${row.mean.toFixed(1)}%`}</td>
              {range !== 0 && <td className="whitespace-nowrap py-3 text-right tabular-nums" title={row.previousMean === null ? "No results in the previous period" : `Previous average: ${row.previousMean.toFixed(1)}%`}>{formatChange(row.change)}</td>}
            </tr>)}</tbody>
          </table>
          {rows.length === 0 && <p className="py-4 text-xs text-muted-foreground">Subject results will appear here after you log an exam.</p>}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{range !== 0 && "pp = percentage points; — means there is no comparison. "}Paper difficulty and subject mix can vary.</p>
        </div>
      </div>
    </section>
  )
}
