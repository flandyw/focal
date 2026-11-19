import { useEffect, useMemo, useState } from "react"
import { CalendarClock, CircleCheck, Clock3, GraduationCap, MoreHorizontal, Pencil, Percent, Play, Plus, Trash2, Trophy } from "lucide-react"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { SacSheet } from "./sac-sheet"
import { SacTimer } from "./sac-timer"
import { PageHeader } from "./page-header"
import { Delta, Meter, StatGrid, StatTile } from "./workspace-layout"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { ChartContainer, ChartTooltip } from "./ui/chart"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "./ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "./ui/empty"
import { Label } from "./ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs"
import { buildSacSubjectStats, computeSacStats, getUpcomingSacs, isCompletedSac, sacPercentage, type SacRecord } from "../lib/sac"
import type { SacTimerSession } from "../lib/ongoing-timers"
import { useTickingNow } from "../hooks/use-ticking-now"
import { localDate } from "../lib/learning-workspace"

type SacPageProps = {
  openTimerRequest?: number
  /** Set when the page is filtered to one subject, so its empty state doesn't claim there are no SACs at all. */
  scopedSubject?: string
  records: SacRecord[]
  subjects: string[]
  preferredSubjects: string[]
  activeTimer?: SacTimerSession
  onTimerChange: (session: SacTimerSession | undefined) => void
  onSave: (record: SacRecord) => void
  onDelete: (record: SacRecord) => void
}

const chartConfig = { percentage: { label: "SAC result", color: "var(--chart-2)" } }
const sacStatusLabels = { all: "All statuses", upcoming: "Upcoming", awaiting: "Awaiting result", completed: "Completed" }
const sacStatusOptions = Object.entries(sacStatusLabels).map(([value, label]) => ({ value, label }))

function sacStatus(record: SacRecord, today: string) {
  return isCompletedSac(record) ? "completed" : record.scheduledAt < today ? "awaiting" : "upcoming"
}

function formatDate(value: string) {
  return new Date(`${value.slice(0, 10)}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
}

function formatDuration(seconds: number) {
  const total = Math.round(seconds / 60)
  const hours = Math.floor(total / 60)
  return hours ? `${hours}h ${total % 60}m` : `${total}m`
}

function daysUntil(value: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${value}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
}

function SacStatsRow({ records, today }: { records: SacRecord[]; today: string }) {
  const stats = useMemo(() => computeSacStats(records, today), [records, today])
  const results = useMemo(() => records.filter(isCompletedSac).toSorted((a, b) => (a.completedAt ?? a.scheduledAt).localeCompare(b.completedAt ?? b.scheduledAt)).map((record) => sacPercentage(record)!), [records])
  return (
    <StatGrid>
      <StatTile icon={CircleCheck} tone="success" label="Completed SACs" value={stats.completed} hint={`${stats.upcoming} upcoming · ${stats.total} tracked`} />
      <StatTile icon={Percent} label="Weighted average" value={stats.average === null ? "—" : `${stats.average.toFixed(1)}%`} delta={stats.trend !== null && Math.abs(stats.trend) >= 0.5 ? <Delta value={Number(stats.trend.toFixed(1))} suffix=" pp" /> : null} hint={stats.trend === null ? "Weighted by SAC weighting" : "First result to latest"} spark={results} />
      <StatTile icon={Trophy} label="Best result" value={stats.best === null ? "—" : `${stats.best.toFixed(1)}%`} hint="Strongest completed assessment" />
      <StatTile icon={Clock3} label="Timed work" value={stats.totalTimedSeconds ? formatDuration(stats.totalTimedSeconds) : "—"} hint="Recorded by the SAC timer" />
    </StatGrid>
  )
}

function SacTrend({ records }: { records: SacRecord[] }) {
  const points = useMemo(() => records.filter(isCompletedSac).toSorted((a, b) => (a.completedAt ?? a.scheduledAt).localeCompare(b.completedAt ?? b.scheduledAt)).map((record) => ({
    id: record.id,
    timestamp: new Date(`${(record.completedAt ?? record.scheduledAt).slice(0, 10)}T00:00:00`).getTime(),
    date: formatDate(record.completedAt ?? record.scheduledAt),
    percentage: sacPercentage(record)!,
    subject: record.subject,
    provider: record.provider,
    title: record.title,
    sacNumber: record.sacNumber,
    score: record.score,
    maxScore: record.maxScore,
  })), [records])
  const average = points.length ? points.reduce((total, point) => total + point.percentage, 0) / points.length : 0
  const summary = points.length < 2 ? `${points.length} completed SAC result.` : `${points.length} results, from ${points[0].percentage.toFixed(0)}% to ${points.at(-1)!.percentage.toFixed(0)}%.`
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>SAC performance</CardTitle><CardDescription>{points.length ? summary : "Complete a SAC to start charting results over time."}</CardDescription></CardHeader>
      <CardContent>
        {points.length ? <ChartContainer config={chartConfig} className="h-72 w-full aspect-auto" role="img" aria-label={summary}>
          <LineChart data={points} margin={{ left: 4, right: 8, top: 12, bottom: 4 }} accessibilityLayer>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="timestamp" type="number" domain={([min, max]: readonly [number, number]) => min === max ? [min - 43_200_000, max + 43_200_000] : [min, max]} ticks={points.length > 0 && points[0].timestamp === points.at(-1)?.timestamp ? [points[0].timestamp] : undefined} scale="time" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={(value) => new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} />
            <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={42} tickFormatter={(value) => `${value}%`} />
            {points.length >= 2 ? <ReferenceLine y={average} stroke="var(--color-percentage)" strokeDasharray="4 4" label={{ value: `Avg ${average.toFixed(0)}%`, position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} /> : null}
            <ChartTooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const point = payload[0].payload as (typeof points)[number]
              return <div className="min-w-48 rounded-lg border bg-popover p-3 text-xs text-popover-foreground shadow-md"><p className="font-medium">{point.title}</p><p className="text-muted-foreground">{point.subject} · {point.provider}{point.sacNumber ? ` · SAC ${point.sacNumber}` : ""} · {point.date}</p><p className="mt-1.5 font-mono font-medium tabular-nums">{point.score}/{point.maxScore} · {point.percentage.toFixed(1)}%</p></div>
            }} />
            <Line type="monotone" dataKey="percentage" stroke="var(--color-percentage)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--color-percentage)" }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ChartContainer> : <div className="rounded-md border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">No completed SAC results yet.</div>}
      </CardContent>
    </Card>
  )
}

export function SacPage({ openTimerRequest = 0, scopedSubject, records, subjects, preferredSubjects, activeTimer, onTimerChange, onSave, onDelete }: SacPageProps) {
  const [tab, setTab] = useState<"overview" | "timer">(() =>
    activeTimer || openTimerRequest || typeof sessionStorage !== "undefined" && sessionStorage.getItem("examtrack.sac-timer") ? "timer" : "overview"
  )
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- an alert for the running timer was tapped while this page was open
    if (openTimerRequest) setTab("timer")
  }, [openTimerRequest])
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<SacRecord | null>(null)
  const [timerRecord, setTimerRecord] = useState<SacRecord | null>(null)
  const [statusFilter, setStatusFilter] = useState("all")
  const today = localDate(useTickingNow())
  const visibleRecords = useMemo(() => (statusFilter === "all" ? records : records.filter((record) => sacStatus(record, today) === statusFilter))
    .toSorted((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)), [records, statusFilter, today])
  const upcoming = useMemo(() => getUpcomingSacs(records, today), [records, today])
  const awaiting = useMemo(() => records.filter((record) => !isCompletedSac(record) && record.scheduledAt < today).toSorted((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)), [records, today])
  const subjectStats = useMemo(() => buildSacSubjectStats(records, today), [records, today])
  const allSubjects = useMemo(() => [...new Set([...subjects, ...records.map((record) => record.subject)])], [records, subjects])

  function startTimer(record?: SacRecord) {
    setTimerRecord(record ?? null)
    setTab("timer")
  }

  function save(record: SacRecord) {
    onSave(record)
    setEditing(null)
  }

  return (
    <div className="grid gap-5">
      <PageHeader icon={GraduationCap} title="SACs" description="Plan school assessments, time them and chart the results.">
        <Button variant="outline" onClick={() => startTimer()}><Clock3 />Start timer</Button>
        <Button onClick={() => { setEditing(null); setSheetOpen(true) }}><Plus />Plan or log SAC</Button>
      </PageHeader>
      <Tabs value={tab} onValueChange={(value) => setTab(value as "overview" | "timer")}>
        <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="timer">Timer</TabsTrigger></TabsList>
        <TabsContent value="overview" className="mt-4 grid gap-5">
          {records.length ? <>
            <SacStatsRow records={records} today={today} />
            {awaiting.length ? <Card><CardHeader><CardTitle>Awaiting results <span className="text-muted-foreground tabular-nums">{awaiting.length}</span></CardTitle><CardDescription>These dates have passed. Enter the mark when it comes back.</CardDescription></CardHeader><CardContent><ul className="divide-y rounded-lg border">{awaiting.map((record) => <li key={record.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-medium">{record.title}</p><p className="text-xs text-muted-foreground">{record.subject} · {formatDate(record.scheduledAt)} · {-daysUntil(record.scheduledAt)}d ago</p></div><Button size="sm" variant="outline" onClick={() => { setEditing(record); setSheetOpen(true) }}><Pencil />Enter result</Button></li>)}</ul></CardContent></Card> : null}
            {upcoming.length ? <Card><CardHeader><CardTitle>Upcoming SACs</CardTitle>{upcoming.length > 6 ? <CardDescription>Next 6 of {upcoming.length}. The rest are listed under All SACs.</CardDescription> : null}</CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{upcoming.slice(0, 6).map((record) => { const remaining = daysUntil(record.scheduledAt); return <div key={record.id} className="focal-tile grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3 rounded-lg border p-4 hover:border-primary/40"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{record.title}</p><p className="truncate text-sm text-muted-foreground" title={`${record.subject} · ${record.provider}`}>{record.subject} · {record.provider}{record.sacNumber ? ` · SAC ${record.sacNumber}` : ""} · Unit {record.unit}</p></div><Badge className="shrink-0 tabular-nums" variant={remaining <= 7 ? "secondary" : "outline"}>{remaining === 0 ? "Today" : remaining === 1 ? "Tomorrow" : `${remaining} days`}</Badge></div><p className="text-xs text-muted-foreground tabular-nums">{formatDate(record.scheduledAt)} · {record.durationMinutes} min{record.areaOfStudy ? ` · ${record.areaOfStudy}` : ""}</p><div className="flex gap-2 [&>*]:flex-1"><Button variant="outline" size="sm" onClick={() => startTimer(record)}><Play />Start timer</Button><Button variant="ghost" size="sm" onClick={() => { setEditing(record); setSheetOpen(true) }}><Pencil />Edit</Button></div></div> })}</div></CardContent></Card> : null}
            <div className="grid gap-5 lg:grid-cols-3"><div className="min-w-0 lg:col-span-2"><SacTrend records={records} /></div><Card><CardHeader><CardTitle>Subjects</CardTitle></CardHeader><CardContent><ul className="grid gap-4">{subjectStats.map((entry) => <li key={entry.subject} className="grid gap-1.5"><div className="flex items-baseline justify-between gap-3"><p className="truncate text-sm font-medium">{entry.subject}</p><span className="text-sm font-semibold tabular-nums">{entry.average === null ? "—" : `${entry.average.toFixed(1)}%`}</span></div><Meter value={entry.average ?? 0} /><p className="text-xs text-muted-foreground">{entry.completed} completed · {entry.upcoming} upcoming</p></li>)}</ul></CardContent></Card></div>
            <section aria-labelledby="all-sacs-title" className="grid gap-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 id="all-sacs-title" className="text-lg font-semibold">All SACs</h2>
                  <p className="text-sm text-muted-foreground" role="status">{statusFilter === "all" ? "Upcoming plans and completed results in one place." : `Showing ${visibleRecords.length} of ${records.length} SACs.`}</p>
                </div>
                <div className="flex items-center gap-2">
                  <Label htmlFor="sac-status-filter">Filter by status</Label>
                  <Select items={sacStatusOptions} value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? "all")}>
                    <SelectTrigger id="sac-status-filter" className="w-36"><SelectValue /></SelectTrigger>
                    <SelectContent>{sacStatusOptions.map(({ value, label }) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {visibleRecords.length ? <div className="overflow-hidden rounded-lg border bg-card">
                <Table>
                  <TableHeader><TableRow><TableHead>SAC</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead className="text-right">Result</TableHead><TableHead className="text-right">Timing</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
                  <TableBody>{visibleRecords.map((record) => {
                    const percentage = sacPercentage(record)
                    const status = sacStatus(record, today)
                    return <TableRow key={record.id}>
                      <TableCell>
                        <button type="button" className="rounded-xs text-left font-medium hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none" onClick={() => { setEditing(record); setSheetOpen(true) }}>{record.title}</button>
                        <div className="text-xs text-muted-foreground">{record.subject} · {record.provider}{record.sacNumber ? ` · SAC ${record.sacNumber}` : ""} · Unit {record.unit}{record.areaOfStudy ? ` · ${record.areaOfStudy}` : ""}</div>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums">{formatDate(record.scheduledAt)}</TableCell>
                      <TableCell><Badge variant={status === "completed" ? "success" : status === "awaiting" ? "secondary" : "outline"}>{sacStatusLabels[status]}</Badge></TableCell>
                      <TableCell className="text-right tabular-nums">{percentage === null ? "—" : <><div className="font-medium">{percentage.toFixed(1)}%</div><div className="text-xs text-muted-foreground">{record.score}/{record.maxScore}</div><Meter value={percentage} className="ml-auto mt-1 w-16" /></>}</TableCell>
                      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">{record.timing ? <><div>{formatDuration(record.timing.actualSeconds)}</div>{record.timing.overtimeSeconds ? <div className="text-xs text-destructive">+{formatDuration(record.timing.overtimeSeconds)} over</div> : null}</> : `${record.durationMinutes} min planned`}</TableCell>
                      <TableCell>
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}><MoreHorizontal /><span className="sr-only">Actions for {record.title}</span></DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {status === "upcoming" ? <DropdownMenuItem onClick={() => startTimer(record)}><Play />Start timer</DropdownMenuItem> : null}
                            <DropdownMenuItem onClick={() => { setEditing(record); setSheetOpen(true) }}><Pencil />{status === "awaiting" ? "Enter result" : "Edit SAC"}</DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem variant="destructive" onClick={() => onDelete(record)}><Trash2 />Delete SAC</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  })}</TableBody>
                </Table>
              </div> : <div className="grid justify-items-center gap-3 rounded-lg border px-4 py-8">
                <p className="text-sm text-muted-foreground">No SACs with this status.</p>
                <Button variant="outline" size="sm" onClick={() => setStatusFilter("all")}>Show all SACs</Button>
              </div>}
            </section>
          </> : <Empty className="min-h-[24rem] border"><EmptyHeader><EmptyMedia variant="icon"><CalendarClock /></EmptyMedia><EmptyTitle>{scopedSubject ? `No ${scopedSubject} SACs yet` : "Track your first SAC"}</EmptyTitle><EmptyDescription>Plan an upcoming assessment or log a completed result to begin building subject statistics.</EmptyDescription></EmptyHeader><EmptyContent><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={() => startTimer()}><Clock3 />Start timer</Button><Button onClick={() => setSheetOpen(true)}><Plus />Plan or log SAC</Button></div></EmptyContent></Empty>}
        </TabsContent>
        <TabsContent value="timer" className="mt-4"><SacTimer key={timerRecord?.id ?? "manual"} records={records} subjects={allSubjects} preferredSubjects={preferredSubjects} scopedSubject={scopedSubject} initialRecord={timerRecord} activeSession={activeTimer} onSessionChange={onTimerChange} onSave={(record) => { save(record); setTimerRecord(null); setTab("overview") }} /></TabsContent>
      </Tabs>
      {sheetOpen ? <SacSheet open subjects={allSubjects} preferredSubjects={preferredSubjects} scopedSubject={scopedSubject} initialRecord={editing} onOpenChange={(open) => { setSheetOpen(open); if (!open) setEditing(null) }} onSave={save} /> : null}
    </div>
  )
}
