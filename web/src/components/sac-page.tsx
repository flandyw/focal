import { useMemo, useState } from "react"
import { CalendarClock, Clock3, MoreHorizontal, Pencil, Play, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react"
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { SacSheet } from "@/components/sac-sheet"
import { SacTimer } from "@/components/sac-timer"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { buildSacSubjectStats, computeSacStats, getUpcomingSacs, isCompletedSac, sacPercentage, type SacRecord } from "@/lib/sac"
import type { SacTimerSession } from "@/lib/ongoing-timers"

type SacPageProps = {
  records: SacRecord[]
  subjects: string[]
  preferredSubjects: string[]
  activeTimer?: SacTimerSession
  onTimerChange: (session: SacTimerSession | undefined) => void
  onSave: (record: SacRecord) => void
  onDelete: (record: SacRecord) => void
}

const chartConfig = { percentage: { label: "SAC result", color: "var(--chart-2)" } }

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })
}

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.round((seconds % 3600) / 60)
  return hours ? `${hours}h ${minutes}m` : `${minutes}m`
}

function daysUntil(value: string) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(`${value}T00:00:00`).getTime() - today.getTime()) / 86_400_000)
}

function SacStatsRow({ records }: { records: SacRecord[] }) {
  const stats = useMemo(() => computeSacStats(records), [records])
  return (
    <div className="grid gap-5 rounded-lg border bg-card px-5 py-5 sm:grid-cols-2 lg:grid-cols-4 lg:divide-x lg:divide-border">
      <div className="space-y-1.5 lg:pr-6"><p className="text-sm text-muted-foreground">Completed SACs</p><p className="text-3xl font-semibold tabular-nums">{stats.completed}</p><p className="text-xs text-muted-foreground">{stats.upcoming} upcoming · {stats.total} tracked</p></div>
      <div className="space-y-1.5 lg:px-6"><p className="text-sm text-muted-foreground">Weighted average</p><div className="flex items-baseline gap-2"><p className="text-3xl font-semibold tabular-nums">{stats.average === null ? "—" : `${stats.average.toFixed(1)}%`}</p>{stats.trend !== null && Math.abs(stats.trend) >= 0.5 ? <span className="inline-flex items-center text-xs font-medium tabular-nums">{stats.trend > 0 ? <TrendingUp className="mr-1 size-3.5" /> : <TrendingDown className="mr-1 size-3.5" />}{stats.trend > 0 ? "+" : ""}{stats.trend.toFixed(1)} pts</span> : null}</div><p className="text-xs text-muted-foreground">Uses entered assessment weightings when available</p></div>
      <div className="space-y-1.5 lg:px-6"><p className="text-sm text-muted-foreground">Best result</p><p className="text-3xl font-semibold tabular-nums">{stats.best === null ? "—" : `${stats.best.toFixed(1)}%`}</p><p className="text-xs text-muted-foreground">Strongest completed assessment</p></div>
      <div className="space-y-1.5 lg:pl-6"><p className="text-sm text-muted-foreground">Timed work</p><p className="text-3xl font-semibold tabular-nums">{stats.totalTimedSeconds ? formatDuration(stats.totalTimedSeconds) : "—"}</p><p className="text-xs text-muted-foreground">Recorded by the SAC timer</p></div>
    </div>
  )
}

function SacTrend({ records }: { records: SacRecord[] }) {
  const points = useMemo(() => records.filter(isCompletedSac).toSorted((a, b) => (a.completedAt ?? a.scheduledAt).localeCompare(b.completedAt ?? b.scheduledAt)).map((record) => ({
    id: record.id,
    timestamp: new Date(`${record.completedAt ?? record.scheduledAt}T00:00:00`).getTime(),
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
            <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} scale="time" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={(value) => new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" })} />
            <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={42} tickFormatter={(value) => `${value}%`} />
            {points.length >= 2 ? <ReferenceLine y={average} stroke="var(--color-percentage)" strokeDasharray="4 4" label={{ value: `Avg ${average.toFixed(0)}%`, position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} /> : null}
            <ChartTooltip content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const point = payload[0].payload as (typeof points)[number]
              return <div className="min-w-48 rounded-lg border bg-background p-3 text-xs shadow-md"><p className="font-medium">{point.title}</p><p className="text-muted-foreground">{point.subject} · {point.provider}{point.sacNumber ? ` · SAC ${point.sacNumber}` : ""} · {point.date}</p><p className="mt-1.5 font-mono font-medium tabular-nums">{point.score}/{point.maxScore} · {point.percentage.toFixed(1)}%</p></div>
            }} />
            <Line type="monotone" dataKey="percentage" stroke="var(--color-percentage)" strokeWidth={2.5} dot={{ r: 4, fill: "var(--color-percentage)" }} activeDot={{ r: 6 }} isAnimationActive={false} />
          </LineChart>
        </ChartContainer> : <div className="rounded-md border bg-muted/30 px-4 py-10 text-center text-sm text-muted-foreground">No completed SAC results yet.</div>}
      </CardContent>
    </Card>
  )
}

export function SacPage({ records, subjects, preferredSubjects, activeTimer, onTimerChange, onSave, onDelete }: SacPageProps) {
  const [tab, setTab] = useState<"overview" | "timer">(() =>
    activeTimer || typeof sessionStorage !== "undefined" && (
      sessionStorage.getItem("examtrack.sac-timer") ||
      new URLSearchParams(location.search).get("timer") === "sac"
    ) ? "timer" : "overview"
  )
  const [sheetOpen, setSheetOpen] = useState(false)
  const [editing, setEditing] = useState<SacRecord | null>(null)
  const [timerRecord, setTimerRecord] = useState<SacRecord | null>(null)
  const upcoming = useMemo(() => getUpcomingSacs(records), [records])
  const subjectStats = useMemo(() => buildSacSubjectStats(records), [records])
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
    <div className="grid gap-6">
      <PageHeader title="SACs" description="Plan Units 1–4 school assessments, preserve timed conditions, and track results by subject.">
        <Button variant="outline" onClick={() => startTimer()}><Clock3 />Start timer</Button>
        <Button onClick={() => { setEditing(null); setSheetOpen(true) }}><Plus />Plan or log SAC</Button>
      </PageHeader>
      <Tabs value={tab} onValueChange={(value) => setTab(value as "overview" | "timer")}>
        <TabsList><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="timer">Timer</TabsTrigger></TabsList>
        <TabsContent value="overview" className="mt-4 grid gap-6">
          {records.length ? <>
            {upcoming.length ? <Card><CardHeader><CardTitle>Upcoming SACs</CardTitle><CardDescription>Your next assessments, ordered by date.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{upcoming.slice(0, 6).map((record) => { const remaining = daysUntil(record.scheduledAt); return <div key={record.id} className="grid gap-3 rounded-lg border p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium">{record.title}</p><p className="text-sm text-muted-foreground">{record.subject} · {record.provider}{record.sacNumber ? ` · SAC ${record.sacNumber}` : ""} · Unit {record.unit}</p></div><Badge variant={remaining <= 7 ? "secondary" : "outline"}>{remaining === 0 ? "Today" : remaining === 1 ? "Tomorrow" : `${remaining} days`}</Badge></div><p className="text-xs text-muted-foreground">{formatDate(record.scheduledAt)} · {record.durationMinutes} min{record.areaOfStudy ? ` · ${record.areaOfStudy}` : ""}</p><Button variant="outline" size="sm" onClick={() => startTimer(record)}><Play />Start timer</Button></div> })}</div></CardContent></Card> : null}
            <SacStatsRow records={records} />
            <div className="grid gap-6 lg:grid-cols-3"><div className="min-w-0 lg:col-span-2"><SacTrend records={records} /></div><Card><CardHeader><CardTitle>Subjects</CardTitle><CardDescription>Completed and upcoming SAC evidence.</CardDescription></CardHeader><CardContent><ul className="divide-y rounded-lg border">{subjectStats.map((entry) => <li key={entry.subject} className="flex items-center gap-3 px-4 py-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{entry.subject}</p><p className="text-xs text-muted-foreground">{entry.completed} completed · {entry.upcoming} upcoming</p></div><span className="text-sm font-semibold tabular-nums">{entry.average === null ? "—" : `${entry.average.toFixed(1)}%`}</span></li>)}</ul></CardContent></Card></div>
            <section aria-labelledby="all-sacs-title" className="grid gap-4"><div><h2 id="all-sacs-title" className="text-lg font-semibold">All SACs</h2><p className="text-sm text-muted-foreground">Upcoming plans and completed results in one place.</p></div><div className="overflow-x-auto rounded-lg border"><Table><TableHeader><TableRow><TableHead>SAC</TableHead><TableHead>Date</TableHead><TableHead>Status</TableHead><TableHead>Result</TableHead><TableHead>Timing</TableHead><TableHead className="w-12"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader><TableBody>{records.toSorted((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).map((record) => { const percentage = sacPercentage(record); return <TableRow key={record.id}><TableCell><div className="font-medium">{record.title}</div><div className="text-xs text-muted-foreground">{record.subject} · {record.provider}{record.sacNumber ? ` · SAC ${record.sacNumber}` : ""} · Unit {record.unit}{record.areaOfStudy ? ` · ${record.areaOfStudy}` : ""}</div></TableCell><TableCell className="whitespace-nowrap">{formatDate(record.scheduledAt)}</TableCell><TableCell><Badge variant={isCompletedSac(record) ? "secondary" : "outline"}>{isCompletedSac(record) ? "Completed" : "Upcoming"}</Badge></TableCell><TableCell className="tabular-nums">{percentage === null ? "—" : <><div>{percentage.toFixed(1)}%</div><div className="text-xs text-muted-foreground">{record.score}/{record.maxScore}</div></>}</TableCell><TableCell className="whitespace-nowrap text-sm tabular-nums">{record.timing ? <><div>{formatDuration(record.timing.actualSeconds)}</div>{record.timing.overtimeSeconds ? <div className="text-xs text-destructive">+{formatDuration(record.timing.overtimeSeconds)}</div> : null}</> : `${record.durationMinutes} min planned`}</TableCell><TableCell><DropdownMenu><DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" />}><MoreHorizontal /><span className="sr-only">SAC actions</span></DropdownMenuTrigger><DropdownMenuContent align="end">{!isCompletedSac(record) ? <DropdownMenuItem onClick={() => startTimer(record)}><Play />Start timer</DropdownMenuItem> : null}<DropdownMenuItem onClick={() => { setEditing(record); setSheetOpen(true) }}><Pencil />Edit SAC</DropdownMenuItem><DropdownMenuSeparator /><DropdownMenuItem variant="destructive" onClick={() => onDelete(record)}><Trash2 />Delete SAC</DropdownMenuItem></DropdownMenuContent></DropdownMenu></TableCell></TableRow> })}</TableBody></Table></div></section>
          </> : <Empty className="min-h-[24rem] border"><EmptyHeader><EmptyMedia variant="icon"><CalendarClock /></EmptyMedia><EmptyTitle>Track your first SAC</EmptyTitle><EmptyDescription>Plan an upcoming assessment or log a completed result to begin building subject statistics.</EmptyDescription></EmptyHeader><EmptyContent><div className="flex flex-wrap justify-center gap-2"><Button variant="outline" onClick={() => startTimer()}><Clock3 />Start timer</Button><Button onClick={() => setSheetOpen(true)}><Plus />Plan or log SAC</Button></div></EmptyContent></Empty>}
        </TabsContent>
        <TabsContent value="timer" className="mt-4"><SacTimer key={timerRecord?.id ?? "manual"} records={records} subjects={allSubjects} preferredSubjects={preferredSubjects} initialRecord={timerRecord} activeSession={activeTimer} onSessionChange={onTimerChange} onSave={(record) => { save(record); setTimerRecord(null); setTab("overview") }} /></TabsContent>
      </Tabs>
      {sheetOpen ? <SacSheet open subjects={allSubjects} preferredSubjects={preferredSubjects} initialRecord={editing} onOpenChange={(open) => { setSheetOpen(open); if (!open) setEditing(null) }} onSave={save} /> : null}
    </div>
  )
}
