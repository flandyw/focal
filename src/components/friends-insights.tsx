import { memo, useMemo, type ComponentProps } from "react"
import { BookOpen, CalendarDays, ChartColumn, ChartPie, Clock, GraduationCap, Grid3x3, TrendingUp, Trophy } from "lucide-react"
import { format, subDays } from "date-fns"
import { Bar, BarChart, CartesianGrid, Line, LineChart, Pie, PieChart, Scatter, ScatterChart, XAxis, YAxis, ZAxis } from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Delta, EmptyState, Panel } from "./workspace-layout"
import { getHeatColor, getSubjectColor, heatLevel } from "../lib/progress-chart-theme"
import { formatDuration as duration, subjectLabel as subjectName } from "../lib/progress-utils"
import { cn } from "../lib/utils"

const HOUR = 3_600_000

export type InsightRow = {
  id: string; name: string; color: string; isMe: boolean
  /** Study per day in ms: index 0 is today, 83 is twelve weeks ago. */
  days: number[]
  streak: number; total: number
  blocks: [string, string | null, string?][] | null
  subjects: Record<string, number> | null
  exams: { title: string; percent: number; at: number }[] | null
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0)
const axis = { tickLine: false, axisLine: false } as const
const margin = { top: 8, right: 8, left: 0, bottom: 0 }
const chartClass = "aspect-auto h-56 w-full min-w-0"
const hours = (value: number) => `${Math.round(value * 10) / 10}h`
const hourLabel = (hour: number) => hour === 0 ? "12a" : hour < 12 ? `${hour}a` : hour === 12 ? "12p" : `${hour - 12}p`
const Empty = ({ children = "No study in this period." }: { children?: string }) => <p className="text-sm text-muted-foreground">{children}</p>

/** One tooltip row: swatch, series name, and the value as a duration (`unit` is the ms one chart unit stands for). */
const tip = (unit: number) => (value: unknown, name: unknown, item: { color?: string; payload?: { fill?: string } }) => <>
  <span className="size-2.5 shrink-0 rounded-[2px]" style={{ background: item.payload?.fill ?? item.color }} />
  <span className="flex-1 text-muted-foreground">{String(name)}</span>
  <span className="font-medium tabular-nums text-foreground">{duration(Number(value) * unit)}</span>
</>
/** Tooltip for one-series-per-person charts: largest first, without the people who have nothing at that point. */
function PeopleTip({ unit, ...props }: ComponentProps<typeof ChartTooltipContent> & { unit: number }) {
  return <ChartTooltipContent {...props} formatter={tip(unit)} payload={props.payload?.filter((item) => Number(item.value) > 0).sort((a, b) => Number(b.value) - Number(a.value))} />
}

/** Group statistics for the people on the leaderboard. `at` moves once a minute so live timers don't redraw every chart each second. */
export const FriendsInsights = memo(function FriendsInsights({ rows: unsorted, days, at, scope }: { rows: InsightRow[]; days: number; at: number; scope: string }) {
  // A single day has no trend to draw, so Today's day-by-day charts show the week.
  const span = Math.max(days, 7)
  // Today against a finished yesterday would mislead, and twelve weeks has no earlier history to set it against.
  const comparable = days > 1 && days * 2 <= 84
  const data = useMemo(() => {
    const now = new Date(at)
    const total = (row: InsightRow) => sum(row.days.slice(0, days))
    const rows = [...unsorted].sort((a, b) => total(b) - total(a) || a.name.localeCompare(b.name))
    const running = rows.map(() => 0)
    const cumulative = Array.from({ length: span }, (_, index) => {
      const offset = span - 1 - index
      const point: Record<string, number | string> = { label: format(subDays(now, offset), "d MMM") }
      rows.forEach((row, r) => { running[r] += row.days[offset]; point[row.id] = running[r] / HOUR })
      return point
    })
    const weekly = Array.from({ length: 12 }, (_, index) => {
      const week = 11 - index
      const point: Record<string, number | string> = { label: format(subDays(now, week * 7), "d MMM") }
      for (const row of rows) point[row.id] = sum(row.days.slice(week * 7, week * 7 + 7)) / HOUR
      return point
    })
    const today = (now.getDay() + 6) % 7
    // 84 days hold each weekday exactly 12 times.
    const weekdayAverage = (row: InsightRow, weekday: number) => sum(row.days.filter((_, offset) => ((today - offset) % 7 + 7) % 7 === weekday)) / 12 / HOUR
    const me = rows.find((row) => row.isMe)
    const friends = rows.filter((row) => !row.isMe)
    const weekdays = WEEKDAYS.map((label, weekday) => ({
      label, you: me ? weekdayAverage(me, weekday) : 0,
      friends: friends.length ? sum(friends.map((row) => weekdayAverage(row, weekday))) / friends.length : 0,
    }))
    const hourly = Array.from({ length: 24 }, (_, hour) => {
      // Clock hours, not offsets from midnight, so a daylight-saving day still lands in the right bars.
      const from = new Date(at).setHours(hour, 0, 0, 0), to = new Date(at).setHours(hour + 1, 0, 0, 0)
      const point: Record<string, number | string> = { label: hourLabel(hour) }
      for (const row of rows) point[row.id] = sum((row.blocks ?? []).map(([start, end]) => Math.max(0, Math.min(end ? Date.parse(end) : at, to) - Math.max(Date.parse(start), from)))) / 60_000
      return point
    })
    const subjectTotals = new Map<string, number>()
    for (const row of rows) for (const [id, ms] of Object.entries(row.subjects ?? {})) subjectTotals.set(id, (subjectTotals.get(id) ?? 0) + ms)
    const records = rows.map((row) => {
      const previous = comparable ? sum(row.days.slice(days, days * 2)) : 0
      let longest = 0, run = 0
      for (const ms of row.days) { run = ms >= 60_000 ? run + 1 : 0; longest = Math.max(longest, run) }
      return {
        row, total: total(row), active: row.days.slice(0, days).filter((ms) => ms >= 60_000).length, best: Math.max(...row.days), longest,
        change: previous >= 60_000 ? Math.round((total(row) - previous) / previous * 100) : null,
        exams: row.exams?.length ? Math.round(sum(row.exams.map((exam) => exam.percent)) / row.exams.length) : null,
      }
    })
    return { now, rows, cumulative, weekly, weekdays, hourly, records, hasFriends: friends.length > 0, subjects: [...subjectTotals].sort((a, b) => b[1] - a[1]).map(([id]) => id) }
  }, [unsorted, days, span, comparable, at])
  const { now, rows, records } = data
  const range = (length: number) => length === 1 ? "today" : length === 84 ? "last 12 weeks" : `last ${length} days`
  const period = range(days)
  const spanLabel = range(span)
  const studiedInSpan = rows.some((row) => row.days.slice(0, span).some((ms) => ms >= 60_000))
  const studiedEver = rows.some((row) => row.days.some((ms) => ms >= 60_000))
  const examRows = rows.filter((row) => row.exams?.length)
  const share = records.filter((record) => record.total >= 60_000)
  const groupTotal = sum(share.map((record) => record.total))

  return (
    <section aria-labelledby="friends-statistics" className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h2 id="friends-statistics" className="focal-section-title">Statistics</h2>
          <p className="mt-1 text-sm text-muted-foreground">{scope} · {period}, unless a chart names its own range.</p>
        </div>
        <ul aria-label="Chart colours" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          {rows.map((row) => <li key={row.id} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px]" style={{ background: row.color }} /><span className={row.isMe ? "font-medium text-foreground" : undefined}>{row.name}</span></li>)}
        </ul>
      </div>

      {studiedEver || examRows.length || rows.some((row) => row.total >= 60_000) ? <div className="grid min-w-0 gap-4 md:grid-cols-2 2xl:grid-cols-3">
        <Panel icon={TrendingUp} title="Cumulative study" description={`Running total, ${spanLabel}`}>
          {studiedInSpan ? <ChartContainer config={{}} className={chartClass} aria-label={`Running total of study time for each person over the ${spanLabel}`}>
            <LineChart accessibilityLayer data={data.cumulative} margin={margin}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={32} />
              <YAxis {...axis} width={40} tickFormatter={hours} />
              <ChartTooltip content={<PeopleTip unit={HOUR} />} />
              {rows.map((row) => <Line key={row.id} type="monotone" dataKey={row.id} name={row.name} stroke={row.color} strokeWidth={row.isMe ? 3 : 1.5} dot={false} isAnimationActive={false} />)}
            </LineChart>
          </ChartContainer> : <Empty />}
        </Panel>

        <Panel icon={ChartColumn} title="Weekly hours · 12 weeks" description="Each bar is the 7 days ending on its date">
          {studiedEver ? <ChartContainer config={{}} className={chartClass} aria-label="Study time per week for each person over twelve weeks">
            <BarChart accessibilityLayer data={data.weekly} margin={margin}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={24} />
              <YAxis {...axis} width={40} tickFormatter={hours} />
              <ChartTooltip content={<PeopleTip unit={HOUR} />} />
              {rows.map((row) => <Bar key={row.id} dataKey={row.id} name={row.name} stackId="people" fill={row.color} maxBarSize={36} isAnimationActive={false} />)}
            </BarChart>
          </ChartContainer> : <Empty>No study in the last 12 weeks.</Empty>}
        </Panel>

        <Panel icon={ChartPie} title="Share of study time" description={period}>
          {share.length ? <div className="flex h-full flex-wrap items-center gap-x-6 gap-y-4">
            <div className="relative mx-auto size-44 shrink-0">
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
                <span className="text-lg font-semibold tabular-nums">{duration(groupTotal)}</span>
                <span className="text-xs text-muted-foreground">combined</span>
              </div>
              <ChartContainer config={{}} className="relative aspect-square size-full" aria-label={`Each person's share of ${duration(groupTotal)} studied ${period}`}>
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent hideLabel formatter={tip(HOUR)} />} />
                  <Pie data={share.map(({ row, total }) => ({ name: row.name, value: total / HOUR, fill: row.color }))} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="95%" stroke="var(--card)" strokeWidth={2} isAnimationActive={false} />
                </PieChart>
              </ChartContainer>
            </div>
            <ol className="grid min-w-40 flex-1 gap-1.5 text-sm">
              {share.map(({ row, total }) => <li key={row.id} className="flex items-center gap-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: row.color }} />
                <span className={cn("min-w-0 flex-1 truncate", row.isMe && "font-medium")}>{row.name}</span>
                <span className="tabular-nums text-muted-foreground">{duration(total)}</span>
                <span className="w-9 text-right tabular-nums">{Math.round(total / groupTotal * 100)}%</span>
              </li>)}
            </ol>
          </div> : <Empty />}
        </Panel>

        <Panel icon={CalendarDays} title="Weekday rhythm · 12 weeks" description="Average study on each weekday">
          {studiedEver ? <ChartContainer config={{}} className={chartClass} aria-label="Average study time per weekday: you against your friends' average">
            <BarChart accessibilityLayer data={data.weekdays} margin={margin}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} interval={0} />
              <YAxis {...axis} width={40} tickFormatter={hours} />
              <ChartTooltip content={<ChartTooltipContent formatter={tip(HOUR)} />} />
              <Bar dataKey="you" name="You" fill="var(--primary)" maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false} />
              {data.hasFriends ? <Bar dataKey="friends" name="Friends’ average" fill="color-mix(in srgb, var(--muted-foreground) 45%, transparent)" maxBarSize={22} radius={[3, 3, 0, 0]} isAnimationActive={false} /> : null}
            </BarChart>
          </ChartContainer> : <Empty>No study in the last 12 weeks.</Empty>}
          {studiedEver ? <p className="mt-3 flex flex-wrap gap-x-4 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] bg-primary" />You</span>
            {data.hasFriends ? <span className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-[2px] bg-muted-foreground/45" />Friends’ average</span> : null}
          </p> : null}
        </Panel>

        <Panel icon={Clock} title="Today by hour" description="Minutes studied in each hour">
          {rows.some((row) => row.blocks?.length) ? <ChartContainer config={{}} className={chartClass} aria-label="Minutes each person studied in each hour of today">
            <BarChart accessibilityLayer data={data.hourly} margin={margin}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="label" {...axis} interval={2} />
              <YAxis {...axis} width={40} tickFormatter={(value) => `${value}m`} />
              <ChartTooltip content={<PeopleTip unit={60_000} />} />
              {rows.map((row) => <Bar key={row.id} dataKey={row.id} name={row.name} stackId="people" fill={row.color} isAnimationActive={false} />)}
            </BarChart>
          </ChartContainer> : <Empty>No one has studied yet today.</Empty>}
        </Panel>

        <Panel icon={BookOpen} title="Subject mix · 30 days">
          {data.subjects.length ? <div className="grid gap-2.5">
            {rows.map((row) => {
              const entries = Object.entries(row.subjects ?? {}).filter(([, ms]) => ms > 0).sort((a, b) => b[1] - a[1])
              const all = sum(entries.map(([, ms]) => ms))
              return <div key={row.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_4rem] items-center gap-3 text-sm">
                <span className={cn("truncate", row.isMe && "font-medium")}>{row.name}</span>
                {row.subjects == null ? <span className="text-xs text-muted-foreground">Kept private</span>
                  : all ? <span className="flex h-4 overflow-hidden rounded-sm bg-muted" role="img" aria-label={`${row.name}: ${entries.map(([id, ms]) => `${subjectName(id || null)} ${Math.round(ms / all * 100)}%`).join(", ")}`}>
                    {entries.map(([id, ms]) => <span key={id} title={`${subjectName(id || null)}: ${duration(ms)} · ${Math.round(ms / all * 100)}%`} style={{ width: `${ms / all * 100}%`, background: getSubjectColor(id) }} />)}
                  </span>
                  : <span className="text-xs text-muted-foreground">No study</span>}
                <span className="text-right tabular-nums text-muted-foreground">{row.subjects == null ? "" : duration(all)}</span>
              </div>
            })}
            <ul aria-label="Subject colours" className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
              {data.subjects.map((id) => <li key={id} className="flex items-center gap-1.5"><span aria-hidden className="size-2.5 rounded-full" style={{ background: getSubjectColor(id) }} />{subjectName(id || null)}</li>)}
            </ul>
          </div> : <Empty>No shared subject time in the last 30 days.</Empty>}
        </Panel>

        <Panel icon={GraduationCap} title="Exam scores" description="Recent papers from people who share results">
          {examRows.length ? <ChartContainer config={{}} className={chartClass} aria-label="Recent exam scores by date for each person who shares results">
            <ScatterChart accessibilityLayer margin={margin}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="at" type="number" scale="time" domain={["dataMin", "dataMax"]} padding={{ left: 12, right: 12 }} {...axis} tickFormatter={(value) => format(new Date(value), "d MMM")} minTickGap={32} />
              <YAxis dataKey="percent" type="number" domain={[(lowest: number) => Math.max(0, Math.floor(lowest / 10) * 10 - 10), 100]} {...axis} width={40} tickFormatter={(value) => `${value}%`} />
              <ZAxis range={[70, 70]} />
              <ChartTooltip cursor={false} content={({ active, payload }) => {
                const point = payload?.[0]?.payload as { name: string; title: string; percent: number; at: number } | undefined
                return active && point ? <div className="grid gap-0.5 rounded-lg border border-border/50 bg-popover px-2.5 py-1.5 text-xs shadow-xl">
                  <span className="font-medium">{point.name} · {point.percent}%</span>
                  <span className="max-w-56 text-muted-foreground">{point.title}</span>
                  <span className="text-muted-foreground">{format(new Date(point.at), "d MMM yyyy")}</span>
                </div> : null
              }} />
              {examRows.map((row) => <Scatter key={row.id} name={row.name} data={row.exams!.map((exam) => ({ ...exam, name: row.name }))} fill={row.color} isAnimationActive={false} />)}
            </ScatterChart>
          </ChartContainer> : <Empty>No shared exam results yet.</Empty>}
        </Panel>

        <Panel icon={Grid3x3} title="Consistency" description={`Each square is a day, ${spanLabel}`} className="2xl:col-span-2">
          <div className="grid gap-1.5">
            {records.map(({ row }) => {
              const active = row.days.slice(0, span).filter((ms) => ms >= 60_000).length
              return <div key={row.id} className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] items-center gap-3 text-sm">
                <span className={cn("truncate", row.isMe && "font-medium")}>{row.name}</span>
                <div role="img" aria-label={`${row.name} studied on ${active} of the ${spanLabel}`} className="grid gap-px" style={{ gridTemplateColumns: `repeat(${span}, minmax(0, 1fr))` }}>
                  {Array.from({ length: span }, (_, index) => span - 1 - index).map((offset) => <span key={offset} className="h-5 rounded-[2px]" style={{ background: getHeatColor(heatLevel(row.days[offset])) }} title={`${format(subDays(now, offset), "EEE d MMM")}: ${duration(row.days[offset])}`} />)}
                </div>
                <span className="text-right tabular-nums text-muted-foreground">{active}/{span}</span>
              </div>
            })}
            <div className="grid grid-cols-[5.5rem_minmax(0,1fr)_3rem] gap-3 text-xs text-muted-foreground" aria-hidden>
              <span /><span className="flex justify-between"><span>{format(subDays(now, span - 1), "d MMM")}</span><span>Today</span></span><span />
            </div>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">Less{([0, 1, 2, 3, 4] as const).map((level) => <span key={level} aria-hidden className="size-3 rounded-[2px]" style={{ background: getHeatColor(level) }} />)}More · under 1h, 1–2h, 2–4h, 4h or more</p>
          </div>
        </Panel>

        <Panel flush icon={Trophy} title="Records" description={`Totals are for ${period}; streaks and best days cover 12 weeks`} className="md:col-span-2 2xl:col-span-3">
          <Table>
            <TableHeader><TableRow>
              <TableHead>Person</TableHead><TableHead className="text-right">Study time</TableHead>{comparable ? <TableHead className="text-right">vs previous {days} days</TableHead> : null}<TableHead className="text-right">Daily average</TableHead><TableHead className="text-right">Active days</TableHead><TableHead className="text-right">Streak</TableHead><TableHead className="text-right">Longest streak</TableHead><TableHead className="text-right">Best day</TableHead><TableHead className="text-right">Exam average</TableHead><TableHead className="text-right">All time</TableHead>
            </TableRow></TableHeader>
            <TableBody>{records.map(({ row, total, active, best, longest, change, exams }) => <TableRow key={row.id} className="tabular-nums">
              <TableCell><span className="flex items-center gap-2"><span aria-hidden className="size-2.5 shrink-0 rounded-[2px]" style={{ background: row.color }} /><span className={cn("max-w-40 truncate", row.isMe && "font-medium")}>{row.name}</span></span></TableCell>
              <TableCell className="text-right font-medium">{duration(total)}</TableCell>
              {comparable ? <TableCell className="text-right">{change == null ? <span className="text-muted-foreground">—</span> : <Delta value={change} suffix="%" />}</TableCell> : null}
              <TableCell className="text-right">{duration(total / days)}</TableCell>
              <TableCell className="text-right">{active}/{days}</TableCell>
              <TableCell className="text-right">{row.streak}d</TableCell>
              <TableCell className="text-right">{longest}d</TableCell>
              <TableCell className="text-right">{duration(best)}</TableCell>
              <TableCell className="text-right">{exams == null ? <span className="text-muted-foreground">—</span> : `${exams}%`}</TableCell>
              <TableCell className="text-right">{duration(row.total)}</TableCell>
            </TableRow>)}</TableBody>
          </Table>
        </Panel>
      </div> : <div className="rounded-lg border border-border bg-card"><EmptyState icon={ChartColumn} title="No statistics yet" description="Charts and records appear once someone on the list logs study time." /></div>}
    </section>
  )
})
