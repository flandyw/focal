import { useEffect, useMemo, useState } from "react"
import { Check, ListFilter, Search } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import {
  daysUntil,
  formatExamDate,
  formatExamLabel,
  formatExamTime,
  isPast,
  isUpcoming,
  type TimetableEntry,
} from "@/lib/timetable"
import { useTickingNow } from "@/hooks/use-ticking-now"
import { cn } from "@/lib/utils"

type Section = {
  title: string
  description: string
  entries: TimetableEntry[]
  muted?: boolean
}

function sortUpcoming(first: TimetableEntry, second: TimetableEntry, now: Date): number {
  const daysA = daysUntil(first, now)
  const daysB = daysUntil(second, now)
  if (daysA !== daysB) return daysA - daysB
  return first.date.localeCompare(second.date) || (first.startTime ?? "").localeCompare(second.startTime ?? "")
}

function sortPast(first: TimetableEntry, second: TimetableEntry, now: Date): number {
  const firstPast = isPast(first, now)
  const secondPast = isPast(second, now)
  if (firstPast !== secondPast) return firstPast ? -1 : 1
  if (firstPast && secondPast) {
    return second.date.localeCompare(first.date)
  }
  return first.date.localeCompare(second.date)
}

function buildSections(entries: TimetableEntry[], now: Date, query: string): { upcoming: Section; past: Section } {
  const matches = (entry: TimetableEntry) => {
    if (!query) return true
    const needle = query.toLowerCase()
    return (
      entry.subject.toLowerCase().includes(needle) ||
      (entry.paper?.toLowerCase().includes(needle) ?? false) ||
      entry.id.toLowerCase().includes(needle)
    )
  }
  const upcomingEntries = entries
    .filter((entry) => isUpcoming(entry, now) && matches(entry))
    .toSorted((first, second) => sortUpcoming(first, second, now))
  const pastEntries = entries
    .filter((entry) => !isUpcoming(entry, now) && matches(entry))
    .toSorted((first, second) => sortPast(first, second, now))
  const allUpcomingCount = entries.filter((entry) => isUpcoming(entry, now)).length
  const allPastCount = entries.length - allUpcomingCount
  return {
    upcoming: {
      title: `${upcomingEntries.length} of ${allUpcomingCount} upcoming`,
      description: "Tick the ones you're sitting. They'll surface on your dashboard with a countdown.",
      entries: upcomingEntries,
    },
    past: {
      title: pastEntries.length ? `${pastEntries.length} of ${allPastCount} past` : "",
      description: "These exams have already happened. You can still mark them for your records.",
      entries: pastEntries,
      muted: true,
    },
  }
}

function groupByDate(entries: TimetableEntry[]): Array<{ dateLabel: string; entries: TimetableEntry[] }> {
  const buckets = new Map<string, TimetableEntry[]>()
  for (const entry of entries) {
    const key = formatExamDate(entry)
    const bucket = buckets.get(key) ?? []
    bucket.push(entry)
    buckets.set(key, bucket)
  }
  return [...buckets.entries()].map(([dateLabel, groupEntries]) => ({
    dateLabel,
    entries: groupEntries.toSorted((first, second) => {
      const firstTime = first.startTime ?? ""
      const secondTime = second.startTime ?? ""
      if (firstTime && secondTime) return firstTime.localeCompare(secondTime)
      if (firstTime) return -1
      if (secondTime) return 1
      return first.subject.localeCompare(second.subject)
    }),
  }))
}

export function ExamTrackerPicker({
  open,
  onOpenChange,
  entries,
  trackedIds,
  onToggle,
  onClearAll,
  onTrackSubjects,
  subjectMatchCount,
  trackedCount,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  entries: TimetableEntry[]
  trackedIds: string[]
  onToggle: (id: string) => void
  onClearAll: () => void
  onTrackSubjects: () => void
  subjectMatchCount: number
  trackedCount: number
}) {
  const [query, setQuery] = useState("")
  const now = useTickingNow()

  useEffect(() => {
    if (!open) setQuery("")
  }, [open])

  const sections = useMemo(() => buildSections(entries, now, query), [entries, now, query])
  const trackedSet = useMemo(() => new Set(trackedIds), [trackedIds])
  const groupedUpcoming = useMemo(() => groupByDate(sections.upcoming.entries), [sections.upcoming.entries])
  const groupedPast = useMemo(() => groupByDate(sections.past.entries), [sections.past.entries])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-6 py-5">
          <DialogTitle>Track VCE exams I'm doing</DialogTitle>
          <DialogDescription>
            {trackedCount === 0
              ? "Pick the exams you're enrolled in — they'll appear on your dashboard with a countdown."
              : `${trackedCount} exam${trackedCount === 1 ? "" : "s"} tracked. Toggle to update.`}
          </DialogDescription>
        </DialogHeader>
        <div className="border-b bg-muted/30 px-6 py-3">
          <div className="relative">
            <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter by subject or paper…"
              className="w-full pl-9"
              aria-label="Filter exams"
            />
          </div>
        </div>
        <div className="max-h-[55vh] overflow-y-auto overscroll-contain">
          {groupedUpcoming.length === 0 && groupedPast.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
              <ListFilter className="size-5" aria-hidden />
              <p>No VCE exams match "{query}".</p>
            </div>
          ) : (
            <div className="flex flex-col gap-6 px-6 py-5">
              {groupedUpcoming.length > 0 ? (
                <section aria-labelledby="section-upcoming">
                  <header className="mb-2 flex items-center justify-between gap-3">
                    <h3 id="section-upcoming" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Upcoming
                    </h3>
                  </header>
                  <ExamsByDate groups={groupedUpcoming} trackedSet={trackedSet} onToggle={onToggle} />
                </section>
              ) : null}
              {groupedPast.length > 0 ? (
                <section aria-labelledby="section-past">
                  <header className="mb-2 flex items-center justify-between gap-3">
                    <h3 id="section-past" className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      Past
                    </h3>
                  </header>
                  <ExamsByDate groups={groupedPast} trackedSet={trackedSet} onToggle={onToggle} muted />
                </section>
              ) : null}
            </div>
          )}
        </div>
        <DialogFooter className="border-t bg-muted/30 px-6 py-4 sm:justify-between">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={onTrackSubjects} disabled={subjectMatchCount === 0}>
              Track my subjects{subjectMatchCount > 0 ? ` (${subjectMatchCount})` : ""}
            </Button>
            <Button variant="ghost" size="sm" onClick={onClearAll} disabled={trackedCount === 0}>
              Clear all
            </Button>
          </div>
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ExamsByDate({
  groups,
  trackedSet,
  onToggle,
  muted,
}: {
  groups: Array<{ dateLabel: string; entries: TimetableEntry[] }>
  trackedSet: Set<string>
  onToggle: (id: string) => void
  muted?: boolean
}) {
  return (
    <div className="flex flex-col gap-4">
      {groups.map(({ dateLabel, entries }) => (
        <div key={dateLabel}>
          <p
            className={cn(
              "mb-1.5 text-xs font-medium tabular-nums",
              muted ? "text-muted-foreground/80" : "text-muted-foreground",
            )}
          >
            {dateLabel}
          </p>
          <ul className="flex flex-col rounded-lg border" role="list">
            {entries.map((entry, index) => (
              <ExamRow
                key={entry.id}
                entry={entry}
                tracked={trackedSet.has(entry.id)}
                onToggle={() => onToggle(entry.id)}
                muted={muted}
                divider={index < entries.length - 1}
              />
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}

function ExamRow({
  entry,
  tracked,
  onToggle,
  muted,
  divider,
}: {
  entry: TimetableEntry
  tracked: boolean
  onToggle: () => void
  muted?: boolean
  divider?: boolean
}) {
  const checkboxId = `track-${entry.id}`
  return (
    <li
      className={cn(
        "transition-colors hover:bg-muted/40",
        divider && "border-b",
        muted && "opacity-70",
      )}
    >
      <label
        htmlFor={checkboxId}
        className="flex cursor-pointer items-start gap-3 px-3 py-2.5"
      >
        <span className="relative mt-0.5 flex size-5 shrink-0 items-center justify-center">
          <input
            id={checkboxId}
            type="checkbox"
            checked={tracked}
            onChange={onToggle}
            className={cn(
              "peer size-5 shrink-0 appearance-none rounded-md border transition-colors",
              "border-input bg-background",
              "checked:border-primary checked:bg-primary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
            )}
          />
          <Check
            className="pointer-events-none absolute size-3.5 text-primary-foreground opacity-0 transition-opacity peer-checked:opacity-100"
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1 text-sm leading-tight">
          <span className="block font-medium">{formatExamLabel(entry)}</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {formatExamTime(entry) ?? entry.scheduledNote ?? "Date TBD"}
          </span>
        </span>
      </label>
    </li>
  )
}
