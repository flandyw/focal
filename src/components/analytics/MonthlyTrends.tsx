import { useMemo, type ReactNode } from "react"
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ComposedChart, Line, XAxis, YAxis } from "recharts"
import { analyseAttempt, validateAttempt, type ExamAttempt } from "../../lib/exam-data"
import type { StudyTimePoint } from "../../lib/progress-analytics"
import { getSubjectColor } from "../../lib/progress-chart-theme"
import { getSubjectById } from "../../lib/progress-utils"
import { type ChartConfig, ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "../ui/chart"

const UNASSIGNED = "_unassigned"
const MONTHS = 12
const hours = (minutes: number) => Math.round(minutes / 6) / 10
const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`
const monthLabel = (key: string, year = false) => new Date(`${key}-01T00:00:00`).toLocaleDateString(undefined, year ? { month: "long", year: "numeric" } : { month: "short" })

function formatHours(minutes: number) {
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

function signed(value: number | null, unit: string, digits = 1) {
  if (value === null || !Number.isFinite(value)) return "—"
  const rounded = Number(value.toFixed(digits))
  return `${rounded > 0 ? "+" : ""}${rounded.toFixed(digits)}${unit}`
}

/** Calendar-month rollups of all-time study and exam history, ending at the selected period's month. */
export function MonthlyTrends({ points, attempts, periodEnd }: {
  points: StudyTimePoint[]
  attempts: ExamAttempt[]
  periodEnd: number
}) {
  const { months, subjects, config } = useMemo(() => {
    const end = new Date(periodEnd)
    const keys = Array.from({ length: MONTHS }, (_, i) => monthKey(new Date(end.getFullYear(), end.getMonth() - MONTHS + 1 + i, 1)))
    const inWindow = (date: string) => date.slice(0, 7) >= keys[0] && date.slice(0, 7) <= keys[MONTHS - 1]

    const subjectTotals = new Map<string, number>()
    let before = 0
    for (const point of points) {
      if (point.date.slice(0, 7) < keys[0]) before += point.minutes
      else if (inWindow(point.date)) subjectTotals.set(point.subjectId ?? UNASSIGNED, (subjectTotals.get(point.subjectId ?? UNASSIGNED) ?? 0) + point.minutes)
    }
    const subjects = [...subjectTotals].sort((a, b) => b[1] - a[1]).map(([id], index) => ({ id, key: `s${index}` }))
    const subjectKey = new Map(subjects.map((subject) => [subject.id, subject.key]))
    const config: ChartConfig = {
      ...Object.fromEntries(subjects.map(({ id, key }) => [key, { label: getSubjectById(id)?.name ?? "Unassigned", color: getSubjectColor(id) }])),
      consistency: { label: "Days studied", color: "var(--chart-2)" },
      perDay: { label: "Per study day", color: "var(--foreground)" },
      papers: { label: "Papers", color: "var(--chart-2)" },
      mark: { label: "Average mark", color: "var(--primary)" },
      cumulative: { label: "Total hours", color: "var(--primary)" },
    }

    const endDate = `${monthKey(end)}-${String(end.getDate()).padStart(2, "0")}`
    const valid = attempts.filter((attempt) => validateAttempt(attempt) === null && inWindow(attempt.completedAt) && attempt.completedAt <= endDate)
    let cumulative = before
    const rows = keys.map((key) => {
      const [year, month] = key.split("-").map(Number)
      // The last month only counts days up to the period end.
      const days = key === keys[MONTHS - 1] ? end.getDate() : new Date(year, month, 0).getDate()
      const monthPoints = points.filter((point) => point.date.startsWith(key))
      const bySubject: Record<string, number> = {}
      for (const point of monthPoints) {
        const k = subjectKey.get(point.subjectId ?? UNASSIGNED)!
        bySubject[k] = (bySubject[k] ?? 0) + point.minutes
      }
      const minutes = monthPoints.reduce((sum, point) => sum + point.minutes, 0)
      const studyDays = new Set(monthPoints.filter((point) => point.minutes > 0).map((point) => point.date)).size
      const marks = valid.filter((attempt) => attempt.completedAt.startsWith(key)).map((attempt) => analyseAttempt(attempt).percentage)
      cumulative += minutes
      const top = Object.entries(bySubject).sort((a, b) => b[1] - a[1])[0]?.[0]
      return {
        key, label: monthLabel(key), minutes, days, studyDays,
        ...Object.fromEntries(Object.entries(bySubject).map(([k, m]) => [k, hours(m)])),
        consistency: Math.round(studyDays / days * 100),
        perDay: studyDays ? hours(minutes / studyDays) : 0,
        papers: marks.length,
        mark: marks.length ? Number((marks.reduce((sum, mark) => sum + mark, 0) / marks.length).toFixed(1)) : null,
        best: marks.length ? Math.max(...marks) : null,
        cumulative: hours(cumulative),
        top: top ? subjects.find((subject) => subject.key === top)!.id : null,
      }
    })
    // Hide empty months before any activity, but keep at least half a year for context.
    const first = rows.findIndex((row) => row.minutes > 0 || row.papers > 0)
    return { months: rows.slice(first < 0 ? MONTHS : Math.min(first, MONTHS - 6)), subjects, config }
  }, [points, attempts, periodEnd])

  if (!months.length) return null
  const active = months.filter((month) => month.minutes > 0)
  const best = active.reduce<(typeof months)[number] | null>((top, month) => month.minutes > (top?.minutes ?? 0) ? month : top, null)
  const current = months[months.length - 1]
  const previous = months[months.length - 2]
  const averageMinutes = active.length ? Math.round(active.reduce((sum, month) => sum + month.minutes, 0) / active.length) : 0
  const marked = months.filter((month) => month.mark !== null)
  const markTrend = marked.length >= 2 ? marked[marked.length - 1].mark! - marked[0].mark! : null
  const lowestMark = Math.min(...marked.map((month) => month.mark!))
  const axis = { tickLine: false, axisLine: false } as const

  return (
    <section className="min-w-0 border-t border-border/70 pt-5" aria-label="Month to month">
      <h2 className="font-heading text-xl font-normal tracking-tight">Month to month</h2>
      <p className="mt-1 text-xs text-muted-foreground">Calendar months up to {monthLabel(current.key, true)}, from all of your history. Follows the subject filter.</p>

      <dl className="mt-4 mb-6 grid grid-cols-2 gap-x-5 gap-y-3 sm:grid-cols-4">
        {[
          [`${monthLabel(current.key)} so far`, formatHours(current.minutes), previous ? `${signed(previous.minutes ? (current.minutes - previous.minutes) / previous.minutes * 100 : null, "%", 0)} vs ${monthLabel(previous.key)}` : undefined],
          ["Monthly average", formatHours(averageMinutes), `across ${active.length} active ${active.length === 1 ? "month" : "months"}`],
          ["Biggest month", best ? monthLabel(best.key, true) : "—", best ? formatHours(best.minutes) : undefined],
          ["Exam average trend", signed(markTrend, " pp"), marked.length >= 2 ? `${monthLabel(marked[0].key)} → ${monthLabel(marked[marked.length - 1].key)}` : "needs two marked months"],
        ].map(([label, value, detail]) => <div key={label}>
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-1 text-xl font-medium tabular-nums">{value}</dd>
          {detail ? <dd className="text-xs tabular-nums text-muted-foreground">{detail}</dd> : null}
        </div>)}
      </dl>

      <div className="grid min-w-0 gap-x-7 gap-y-8 min-[900px]:grid-cols-2 [&>*]:min-w-0">
        <Panel title="Study hours by month" note="Stacked by subject.">
          <ChartContainer config={config} className="h-56 w-full aspect-auto" aria-label="Study hours per month by subject">
            <BarChart data={months} accessibilityLayer margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} interval={0} />
              <YAxis tickFormatter={(h) => `${h}h`} {...axis} />
              <ChartTooltip content={<ChartTooltipContent labelKey="key" labelFormatter={(_, payload) => monthLabel(payload[0]?.payload.key, true)} formatter={(value, name) => <Row label={config[name as string]?.label} value={`${value}h`} />} />} />
              {subjects.map(({ key }, index) => <Bar key={key} dataKey={key} stackId="hours" fill={`var(--color-${key})`} radius={index === subjects.length - 1 ? [3, 3, 0, 0] : 0} maxBarSize={36} isAnimationActive={false} />)}
              {subjects.length > 1 && <ChartLegend content={<ChartLegendContent />} />}
            </BarChart>
          </ChartContainer>
        </Panel>

        <Panel title="Consistency" note="Share of days you studied, and average time on the days you did.">
          <ChartContainer config={config} className="h-56 w-full aspect-auto" aria-label="Percentage of days studied and hours per study day by month">
            <ComposedChart data={months} accessibilityLayer margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} interval={0} />
              <YAxis yAxisId="pct" domain={[0, 100]} tickFormatter={(v) => `${v}%`} {...axis} />
              <YAxis yAxisId="hours" orientation="right" tickFormatter={(h) => `${h}h`} {...axis} width={36} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => monthLabel(payload[0]?.payload.key, true)} formatter={(value, name, item) => name === "consistency"
                ? <Row label="Days studied" value={`${item.payload.studyDays} of ${item.payload.days} · ${value}%`} />
                : <Row label="Per study day" value={formatHours(Math.round(Number(value) * 60))} />} />} />
              <Bar yAxisId="pct" dataKey="consistency" fill="var(--color-consistency)" fillOpacity={0.55} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              <Line yAxisId="hours" dataKey="perDay" stroke="var(--color-perDay)" strokeWidth={1.5} dot={{ r: 2.5, fill: "var(--background)" }} isAnimationActive={false} />
              <ChartLegend content={<ChartLegendContent />} />
            </ComposedChart>
          </ChartContainer>
        </Panel>

        <Panel title="Exam results by month" note="Average raw mark, with the number of papers logged.">
          {marked.length ? <ChartContainer config={config} className="h-56 w-full aspect-auto" aria-label="Average exam mark and papers logged per month">
            <ComposedChart data={months} accessibilityLayer margin={{ top: 4, right: 0, left: -20, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} interval={0} />
              <YAxis yAxisId="mark" domain={[Math.max(0, Math.floor((lowestMark - 5) / 10) * 10), 100]} tickFormatter={(v) => `${v}%`} {...axis} />
              <YAxis yAxisId="papers" orientation="right" allowDecimals={false} {...axis} width={28} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => monthLabel(payload[0]?.payload.key, true)} formatter={(value, name, item) => name === "mark"
                ? <Row label="Average" value={`${Number(value).toFixed(1)}% · best ${item.payload.best?.toFixed(1)}%`} />
                : <Row label="Papers" value={String(value)} />} />} />
              <Bar yAxisId="papers" dataKey="papers" fill="var(--color-papers)" fillOpacity={0.35} radius={[3, 3, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              <Line yAxisId="mark" dataKey="mark" stroke="var(--color-mark)" strokeWidth={2} connectNulls dot={{ r: 3, fill: "var(--background)" }} isAnimationActive={false} />
              <ChartLegend content={<ChartLegendContent />} />
            </ComposedChart>
          </ChartContainer> : <Empty>No marked papers in these months.</Empty>}
        </Panel>

        <Panel title="Total study time" note="Running total of every completed session.">
          <ChartContainer config={config} className="h-56 w-full aspect-auto" aria-label="Cumulative study hours by month">
            <AreaChart data={months} accessibilityLayer margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} interval={0} />
              <YAxis tickFormatter={(h) => `${h}h`} {...axis} />
              <ChartTooltip content={<ChartTooltipContent labelFormatter={(_, payload) => `End of ${monthLabel(payload[0]?.payload.key, true)}`} formatter={(value, _, item) => <Row label="Total" value={`${value}h (+${hours(item.payload.minutes)}h)`} />} />} />
              <Area dataKey="cumulative" stroke="var(--color-cumulative)" fill="var(--color-cumulative)" fillOpacity={0.12} strokeWidth={2} isAnimationActive={false} />
            </AreaChart>
          </ChartContainer>
        </Panel>
      </div>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-left text-xs tabular-nums">
          <caption className="sr-only">Monthly study and exam summary. Change compares study time with the previous month.</caption>
          <thead className="border-b text-muted-foreground">
            <tr>{["Month", "Study time", "Change", "Days studied", "Per study day", "Top subject", "Papers", "Average mark"].map((label, i) => <th key={label} scope="col" className={`pb-2 pr-3 font-normal ${i > 0 && i !== 5 ? "text-right" : ""}`}>{label}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {months.toReversed().map((month) => {
              const prior = months[months.indexOf(month) - 1]
              const change = prior?.minutes ? (month.minutes - prior.minutes) / prior.minutes * 100 : null
              return <tr key={month.key}>
                <th scope="row" className="py-2.5 pr-3 font-medium whitespace-nowrap">{monthLabel(month.key, true)}</th>
                <td className="py-2.5 pr-3 text-right">{formatHours(month.minutes)}</td>
                <td className={`py-2.5 pr-3 text-right ${change === null ? "text-muted-foreground" : change < 0 ? "text-destructive" : "text-success"}`}>{signed(change, "%", 0)}</td>
                <td className="py-2.5 pr-3 text-right">{month.studyDays} / {month.days}</td>
                <td className="py-2.5 pr-3 text-right">{month.studyDays ? formatHours(Math.round(month.minutes / month.studyDays)) : "—"}</td>
                <td className="py-2.5 pr-3">{month.top ? <span className="flex items-center gap-2 whitespace-nowrap"><span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: getSubjectColor(month.top) }} />{getSubjectById(month.top)?.name ?? "Unassigned"}</span> : <span className="text-muted-foreground">—</span>}</td>
                <td className="py-2.5 pr-3 text-right">{month.papers || "—"}</td>
                <td className="py-2.5 text-right">{month.mark === null ? "—" : `${month.mark.toFixed(1)}%`}</td>
              </tr>
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Panel({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return <div>
    <h3 className="text-sm font-medium">{title}</h3>
    <p className="mb-3 text-xs text-muted-foreground">{note}</p>
    {children}
  </div>
}

function Row({ label, value }: { label?: ReactNode; value: string }) {
  return <div className="flex flex-1 items-center justify-between gap-4"><span className="text-muted-foreground">{label}</span><span className="font-medium tabular-nums">{value}</span></div>
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-56 items-center justify-center bg-muted/30 px-5 text-center text-sm text-muted-foreground">{children}</div>
}
