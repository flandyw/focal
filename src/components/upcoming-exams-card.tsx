import { downloadExamFile } from "../lib/host"
import { useMemo } from "react"
import { ArrowRight, CalendarDays, CheckCircle2, Download, Plus } from "lucide-react"
import { Badge } from "./ui/badge"
import { Button } from "./ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import {
  daysUntil,
  buildTimetableCalendar,
  formatExamDate,
  formatExamLabel,
  getExamStart,
  isPast,
  isUpcoming,
  type TimetableEntry,
} from "../lib/timetable"
import { useTickingNow } from "../hooks/use-ticking-now"

const MAX_VISIBLE = 5

function pickUpcoming(entries: TimetableEntry[], trackedSet: Set<string>, now: Date): TimetableEntry[] {
  return entries
    .filter((entry) => trackedSet.has(entry.id) && isUpcoming(entry, now))
    .toSorted((a, b) => getExamStart(a).getTime() - getExamStart(b).getTime())
}

function pickPast(entries: TimetableEntry[], trackedSet: Set<string>, now: Date): TimetableEntry[] {
  return entries
    .filter((entry) => trackedSet.has(entry.id) && isPast(entry, now))
    .toSorted((a, b) => getExamStart(b).getTime() - getExamStart(a).getTime())
}

export function UpcomingExamsCard({
  entries,
  trackedIds,
  onOpenPicker,
  sourceUrl,
}: {
  entries: TimetableEntry[]
  trackedIds: string[]
  onOpenPicker: () => void
  sourceUrl: string
}) {
  const now = useTickingNow()
  const trackedSet = useMemo(() => new Set(trackedIds), [trackedIds])

  const upcoming = useMemo(() => pickUpcoming(entries, trackedSet, now), [entries, trackedSet, now])
  const past = useMemo(() => pickPast(entries, trackedSet, now), [entries, trackedSet, now])
  const totalTracked = trackedIds.length

  function downloadCalendar() {
    const calendar = buildTimetableCalendar(entries.filter((entry) => trackedSet.has(entry.id)), sourceUrl)
    void downloadExamFile(new Blob([calendar], { type: "text/calendar;charset=utf-8" }), "vce-exams.ics")
  }

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex items-center gap-2">
              <CalendarDays className="size-4 text-muted-foreground" aria-hidden />
              <CardTitle>Official VCE exam deadlines</CardTitle>
            </div>
            <CardDescription>
              {totalTracked === 0
                ? "Track the exams you're sitting to see days remaining here."
                : upcoming.length > MAX_VISIBLE ? `Next ${MAX_VISIBLE} of ${upcoming.length} upcoming` : `${upcoming.length} upcoming of ${totalTracked} tracked`}
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            {totalTracked > 0 ? (
              <Button variant="outline" size="sm" onClick={downloadCalendar}>
                <Download aria-hidden />
                Add to calendar
              </Button>
            ) : null}
            <Button variant="outline" size="sm" onClick={onOpenPicker}>
              {totalTracked === 0 ? (
                <>
                  <Plus aria-hidden />
                  Track exams
                </>
              ) : (
                <>
                  Manage
                  <ArrowRight aria-hidden />
                </>
              )}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {totalTracked === 0 ? (
          <EmptyState onOpenPicker={onOpenPicker} />
        ) : upcoming.length === 0 ? (
          <AllCompleteState past={past} />
        ) : (
          <ul className="flex flex-col divide-y rounded-lg border" role="list">
            {upcoming.slice(0, MAX_VISIBLE).map((entry) => (
              <UpcomingRow key={entry.id} entry={entry} now={now} />
            ))}
          </ul>
        )}
        {upcoming.length > 0 && past.length > 0 ? (
          <p className="mt-3 text-xs text-muted-foreground tabular-nums">
            {past.length} tracked exam{past.length === 1 ? "" : "s"} already passed.
          </p>
        ) : null}
      </CardContent>
    </Card>
  )
}

function EmptyState({ onOpenPicker }: { onOpenPicker: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed bg-accent/30 px-4 py-5">
      <div className="space-y-1">
        <p className="text-sm font-medium leading-snug">
          Tell us which VCE exams you're sitting.
        </p>
        <p className="text-sm text-muted-foreground leading-snug text-pretty">
          We'll count down the days to each one here, from the GAT in June to the last written
          paper in November.
        </p>
      </div>
      <Button size="sm" onClick={onOpenPicker}>
        <Plus aria-hidden />
        Pick your exams
      </Button>
    </div>
  )
}

function AllCompleteState({ past }: { past: TimetableEntry[] }) {
  const last = past[0]
  if (!last) return <p className="rounded-lg border bg-muted/30 px-4 py-4 text-sm text-muted-foreground">Your tracked exams aren't in this year's timetable. Choose Manage to pick them again.</p>
  return (
    <div className="flex items-start gap-3 rounded-lg border bg-muted/30 px-4 py-4 text-sm text-muted-foreground">
      <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-foreground" aria-hidden />
      <div className="space-y-1">
        <p className="text-foreground">All tracked exams are complete.</p>
        <p className="text-xs tabular-nums">
          Last tracked: {formatExamLabel(last)} on {formatExamDate(last)}.
        </p>
      </div>
    </div>
  )
}

function UpcomingRow({ entry, now }: { entry: TimetableEntry; now: Date }) {
  const days = daysUntil(entry, now)
  const isRange = entry.dateEnd !== null
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="truncate text-sm font-medium">{formatExamLabel(entry)}</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatExamDate(entry)}
          {entry.scheduledNote ? <> · {entry.scheduledNote}</> : null}
        </p>
      </div>
      <Badge variant={days <= 7 ? "default" : "secondary"} className="shrink-0 text-xs tabular-nums">
        <span aria-hidden>{isRange ? days <= 0 ? "Window open" : `Opens in ${days}d` : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days}d`}</span>
        <span className="sr-only">{isRange ? days <= 0 ? "Window open now" : `Window opens in ${days} day${days === 1 ? "" : "s"}` : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `In ${days} days`}</span>
      </Badge>
    </li>
  )
}
