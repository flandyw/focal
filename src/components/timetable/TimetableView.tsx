import { memo, useEffect, useMemo, useState } from "react"
import {
  AlertCircle,
  CalendarClock,
  CalendarDays,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Clock3,
  MapPin,
  Pencil,
  Play,
  Plus,
  Settings2,
  Target,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area"
import { TimetableManager } from "@/components/timetable/TimetableManager"
import {
  DEFAULT_VIEW_SETTINGS,
  getCycleLength,
  getDayToWeekday,
  getTimetableConfig,
  getWeekendTimetables,
  setTimetableConfig,
} from "@/lib/settings"
import {
  getCurrentPeriodInfo,
  getDayLabelForDate,
  getNextTimetableDay,
  getTimetablePeriodError,
  getTimetablePeriodsForDay,
  isTimetableBreakLabel,
  timetableTimeToMinutes,
} from "@/lib/timetable"
import type {
  CalendarEvent,
  PriorityItem,
  Project,
  StudySession,
  Subject,
  TimetableConfig,
  TimetableDayLabel,
  TimetablePeriod,
} from "@/lib/types"
import { VCE_SUBJECTS } from "@/lib/types"
import { cn, formatTime } from "@/lib/utils"
import { getPriorityItems, readFocusPriorities } from "@/lib/studyPriority"

const DAYS_PER_BLOCK = 5
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const

interface TimetableViewProps {
  customSubjects: Subject[]
  projects: Project[]
  sessions: StudySession[]
  events: CalendarEvent[]
  onNewSession: () => void
  onSelectProject: (projectId: string) => void
  onStartFocus: (item: PriorityItem) => void
}

function PlanningQueue({
  items,
  onNewSession,
  onSelectProject,
  onStartFocus,
}: {
  items: PriorityItem[]
  onNewSession: () => void
  onSelectProject: (projectId: string) => void
  onStartFocus: (item: PriorityItem) => void
}) {
  return (
    <Card size="sm" className="mt-3">
      <CardHeader className="border-b px-3 py-2.5">
        <div>
          <CardTitle className="flex items-center gap-2 text-sm">
            <Target className="size-4 text-primary" />
            Unscheduled next actions
          </CardTitle>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Turn the priority queue into study blocks before the week fills up.
          </p>
        </div>
        <CardAction>
          <Button type="button" size="sm" onClick={onNewSession}>
            <Plus />
            Plan session
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-2 p-3 min-[1050px]:grid-cols-2 min-[1450px]:grid-cols-4">
        {items.length > 0 ? items.map((item) => (
          <div key={item.id} className="flex min-w-0 items-center gap-2 rounded-lg border bg-background px-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{item.title}</p>
              <p className="truncate text-sm text-muted-foreground">{item.reason}</p>
            </div>
            {item.projectId && (
              <Button type="button" variant="ghost" size="icon-sm" onClick={() => onSelectProject(item.projectId!)} aria-label={`Open ${item.title}`}>
                <ChevronRight />
              </Button>
            )}
            <Button type="button" variant="outline" size="icon-sm" disabled={item.subjectIds.length === 0} onClick={() => onStartFocus(item)} aria-label={`Start focus for ${item.title}`}>
              <Play />
            </Button>
          </div>
        )) : (
          <p className="text-sm text-muted-foreground">No unscheduled work needs attention.</p>
        )}
      </CardContent>
    </Card>
  )
}

function dayForDate(config: TimetableConfig, date: Date): TimetableDayLabel | null {
  return config.currentDayOverride ?? getDayLabelForDate(
    date,
    config.day1Starts,
    config.holidays,
    getCycleLength(config),
    getWeekendTimetables(config),
  )
}

function blockDays(selectedDay: TimetableDayLabel, cycleLength: number): TimetableDayLabel[] {
  const start = Math.floor((selectedDay - 1) / DAYS_PER_BLOCK) * DAYS_PER_BLOCK + 1
  return Array.from(
    { length: Math.min(DAYS_PER_BLOCK, cycleLength - start + 1) },
    (_, index) => start + index,
  )
}

function periodProgress(period: TimetablePeriod, now: Date): number {
  const start = timetableTimeToMinutes(period.startTime)
  const end = timetableTimeToMinutes(period.endTime)
  if (start === null || end === null || end <= start) return 0
  const current = now.getHours() * 60 + now.getMinutes()
  return Math.min(Math.max(((current - start) / (end - start)) * 100, 0), 100)
}

function emitTimetableUpdate() {
  window.dispatchEvent(new CustomEvent("focal-timetable-updated"))
}

function DayCard({
  dayLabel,
  weekday,
  periods,
  subjects,
  isSelected,
  isToday,
  isNextSchoolDay,
  now,
  showLocations,
  showBreaks,
  use24Hour,
  onSelect,
  onEdit,
}: {
  dayLabel: TimetableDayLabel
  weekday: number
  periods: TimetablePeriod[]
  subjects: Map<string, Subject>
  isSelected: boolean
  isToday: boolean
  isNextSchoolDay: boolean
  now: Date
  showLocations: boolean
  showBreaks: boolean
  use24Hour: boolean
  onSelect: () => void
  onEdit: () => void
}) {
  const visiblePeriods = showBreaks
    ? periods
    : periods.filter((period) => !isTimetableBreakLabel(period.period))
  const current = isToday ? getCurrentPeriodInfo(periods, now).current : null

  return (
    <Card
      size="sm"
      className={cn(
        "h-full min-w-0 gap-0 py-0 transition-colors",
        isSelected && "ring-primary/45",
        isToday && "bg-primary/[0.025] ring-primary/60",
        isNextSchoolDay && "bg-primary/[0.025] ring-primary/60",
      )}
    >
      <CardHeader className="border-b border-border/70 px-3 py-3">
        <button type="button" onClick={onSelect} className="min-w-0 text-left outline-none focus-visible:rounded focus-visible:ring-2 focus-visible:ring-ring">
          <div className="flex items-center gap-2">
            <CardTitle>Day {dayLabel}</CardTitle>
            {isToday && <Badge variant="secondary">Today</Badge>}
            {isNextSchoolDay && <Badge variant="secondary">Next school day</Badge>}
          </div>
          <p className="mt-0.5 text-caption text-muted-foreground">{WEEKDAY_SHORT[weekday] ?? "Day"} · {visiblePeriods.length} {visiblePeriods.length === 1 ? "entry" : "entries"}</p>
        </button>
        <CardAction>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label={`Edit Day ${dayLabel}`}>
            <Pencil />
          </Button>
        </CardAction>
      </CardHeader>

      <CardContent className="flex-1 px-0 py-1">
        {visiblePeriods.length === 0 ? (
          <button type="button" onClick={onEdit} className="flex min-h-36 w-full flex-col items-center justify-center px-4 text-center text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
            <Plus className="mb-2 h-4 w-4" />
            <span className="text-caption">Add entries for Day {dayLabel}</span>
          </button>
        ) : (
          <ol className="divide-y divide-border/60">
            {visiblePeriods.map((period, index) => {
              const subject = subjects.get(period.subject)
              const isCurrent = current === period
              const error = getTimetablePeriodError(period)
              const isBreak = isTimetableBreakLabel(period.period)
              return (
                <li
                  key={`${period.startTime}-${period.period}-${index}`}
                  className={cn(
                    "relative grid grid-cols-[3.6rem_minmax(0,1fr)] gap-2 overflow-hidden px-3 py-2.5",
                    isBreak && "bg-muted/30",
                    isCurrent && "bg-primary/[0.07]",
                  )}
                >
                  <time className="pt-0.5 text-micro font-medium tabular-nums text-muted-foreground">
                    {formatTime(period.startTime, use24Hour)}
                  </time>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/35"
                        style={subject ? { backgroundColor: subject.color } : undefined}
                      />
                      <p className="truncate text-sm font-medium leading-tight">
                        {subject?.shortCode ?? subject?.name ?? (period.subject ? period.subject : period.period)}
                      </p>
                      {isCurrent && <span className="ml-auto shrink-0 text-micro font-semibold text-primary">Now</span>}
                    </div>
                    {Boolean(subject ?? period.subject) && <p className="mt-1 truncate text-caption text-muted-foreground">{period.period}</p>}
                    <div className="mt-1 flex min-w-0 items-center gap-1.5 text-micro text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      <span className="shrink-0 tabular-nums">to {formatTime(period.endTime, use24Hour)}</span>
                      {showLocations && period.location && (
                        <>
                          <span aria-hidden="true">·</span>
                          <MapPin className="h-3 w-3" />
                          <span className="truncate">{period.location}</span>
                        </>
                      )}
                    </div>
                    {error && (
                      <p className="mt-1 flex items-center gap-1 text-micro text-destructive">
                        <AlertCircle className="h-3 w-3" />
                        {error}
                      </p>
                    )}
                  </div>
                  {isCurrent && (
                    <span className="absolute inset-x-0 bottom-0 h-0.5 bg-primary/15">
                      <span className="block h-full bg-primary" style={{ width: `${periodProgress(period, now)}%` }} />
                    </span>
                  )}
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}

export const TimetableView = memo(function TimetableView({
  customSubjects,
  projects,
  sessions,
  events,
  onNewSession,
  onSelectProject,
  onStartFocus,
}: TimetableViewProps) {
  const [config, setConfig] = useState<TimetableConfig>(getTimetableConfig)
  const [now, setNow] = useState(() => new Date())
  const [selectedDay, setSelectedDay] = useState<TimetableDayLabel>(() => {
    const todayDay = dayForDate(config, now)
    if (todayDay !== null) return todayDay
    return getNextTimetableDay(
      now,
      config.day1Starts,
      config.holidays,
      getCycleLength(config),
      getWeekendTimetables(config),
    )?.dayLabel ?? 1
  })
  const [managerOpen, setManagerOpen] = useState(false)
  const [editingDay, setEditingDay] = useState<TimetableDayLabel>(selectedDay)
  const focusPriorities = useMemo(readFocusPriorities, [])
  const planningItems = useMemo(
    () => getPriorityItems({
      projects,
      sessions,
      events,
      now: now.getTime(),
      subjectOrder: focusPriorities.subjectOrder,
      pinnedEventIds: focusPriorities.pinnedEventIds,
    }).filter((item) => item.kind !== "planned-session").slice(0, 4),
    [events, focusPriorities.pinnedEventIds, focusPriorities.subjectOrder, now, projects, sessions],
  )

  useEffect(() => {
    const refresh = () => setConfig(getTimetableConfig())
    window.addEventListener("focal-timetable-updated", refresh)
    window.addEventListener("focal-sync-data-changed", refresh)
    return () => {
      window.removeEventListener("focal-timetable-updated", refresh)
      window.removeEventListener("focal-sync-data-changed", refresh)
    }
  }, [])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const cycleLength = getCycleLength(config)
  const todayDay = dayForDate(config, now)
  const nextTimetableDay = todayDay === null ? getNextTimetableDay(
    now,
    config.day1Starts,
    config.holidays,
    cycleLength,
    getWeekendTimetables(config),
  ) : null
  const computedCalendarDay = getDayLabelForDate(
    now,
    config.day1Starts,
    config.holidays,
    cycleLength,
    getWeekendTimetables(config),
  )
  const weekdays = getDayToWeekday(config)
  const days = blockDays(Math.min(selectedDay, cycleLength), cycleLength)
  const blockNumber = Math.floor((days[0] - 1) / DAYS_PER_BLOCK) + 1
  const blockCount = Math.ceil(cycleLength / DAYS_PER_BLOCK)
  const viewSettings = { ...DEFAULT_VIEW_SETTINGS, ...config.viewSettings }
  const subjects = useMemo(() => {
    const byId = new Map(VCE_SUBJECTS.map((subject) => [subject.id, subject]))
    for (const subject of customSubjects) byId.set(subject.id, subject)
    return byId
  }, [customSubjects])
  const todayPeriods = todayDay ? getTimetablePeriodsForDay(todayDay, config.entries) : []
  const liveInfo = getCurrentPeriodInfo(todayPeriods, now)
  const liveSubject = liveInfo.current ? subjects.get(liveInfo.current.subject) : undefined
  const nextSubject = liveInfo.next ? subjects.get(liveInfo.next.subject) : undefined

  useEffect(() => {
    if (selectedDay > cycleLength) setSelectedDay(cycleLength)
  }, [cycleLength, selectedDay])

  const openManager = (day = selectedDay) => {
    setEditingDay(day)
    setManagerOpen(true)
  }

  const selectAdjacentBlock = (direction: -1 | 1) => {
    const nextBlock = (blockNumber - 1 + direction + blockCount) % blockCount
    setSelectedDay(nextBlock * DAYS_PER_BLOCK + 1)
  }

  const goToRelevantDay = () => {
    const day = todayDay ?? nextTimetableDay?.dayLabel
    if (day) setSelectedDay(day)
  }

  const clearDayOverride = () => {
    const next = { ...config, currentDayOverride: null }
    setTimetableConfig(next)
    setConfig(next)
    emitTimetableUpdate()
    if (computedCalendarDay) setSelectedDay(computedCalendarDay)
  }

  if (config.entries.length === 0) {
    return (
      <ScrollArea className="h-full bg-background">
        <div className="p-5 min-[1200px]:p-8">
          <div className="mx-auto max-w-6xl">
            <h1 className="text-xl font-semibold tracking-tight">Plan</h1>
            <p className="mt-1 text-sm text-muted-foreground">Schedule the work that matters, then fit it around school.</p>
            <PlanningQueue items={planningItems} onNewSession={onNewSession} onSelectProject={onSelectProject} onStartFocus={onStartFocus} />
          </div>
        <div className="mx-auto mt-5 w-full max-w-xl rounded-xl border bg-card p-7 text-center shadow-sm min-[1200px]:p-9">
          <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <CalendarClock className="h-5 w-5" />
          </span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight">Your school week, at a glance</h1>
          <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Add your cycle once. Focal will show the right day, current class, next class, and rooms without turning your timetable into another planner.
          </p>
          <Button type="button" onClick={() => openManager(1)} className="mt-6">
            <Plus />
            Set up timetable
          </Button>
        </div>
        <TimetableManager open={managerOpen} onOpenChange={setManagerOpen} customSubjects={customSubjects} initialDay={editingDay} />
        </div>
      </ScrollArea>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-3 min-[1200px]:px-6 min-[1200px]:py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-primary" />
              <h1 className="text-lg font-semibold tracking-tight">Plan</h1>
              <Badge variant="outline">Timetable</Badge>
              {!config.enabled && <Badge variant="outline">Hidden from Today</Badge>}
            </div>
            <p className="mt-1 text-caption text-muted-foreground">
              {cycleLength}-day cycle{config.day1Starts ? ` · Day 1 started ${config.day1Starts}` : " · Start date needed"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={goToRelevantDay} disabled={!todayDay && !nextTimetableDay}>
              {todayDay ? "Today" : "Next school day"}
            </Button>
            <Button type="button" size="sm" onClick={() => openManager()}>
              <Settings2 />
              Manage
            </Button>
          </div>
        </div>

        <PlanningQueue items={planningItems} onNewSession={onNewSession} onSelectProject={onSelectProject} onStartFocus={onStartFocus} />

        <div className="mt-3 grid gap-2 min-[920px]:grid-cols-[minmax(0,1fr)_auto] min-[920px]:items-center">
          <div className="min-w-0 rounded-lg border bg-muted/25 px-3 py-2.5">
            {todayDay === null ? (
              <div className="flex items-center gap-2.5">
                <CalendarOff className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">No timetable today</p>
                  <p className="text-caption text-muted-foreground">
                    {nextTimetableDay
                      ? `Next up: ${nextTimetableDay.date.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" })} · Day ${nextTimetableDay.dayLabel}`
                      : "Weekend, holiday, or before the cycle starts."}
                  </p>
                </div>
              </div>
            ) : liveInfo.current ? (
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" style={liveSubject ? { backgroundColor: liveSubject.color } : undefined} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {liveSubject?.name ?? (liveInfo.current.subject ? liveInfo.current.subject : liveInfo.current.period)}
                    <span className="font-normal text-muted-foreground"> · {liveInfo.remainingMinutes}m left</span>
                  </p>
                  <p className="truncate text-caption text-muted-foreground">
                    Day {todayDay} · {liveInfo.current.period}{liveInfo.current.location ? ` · ${liveInfo.current.location}` : ""}
                  </p>
                </div>
              </div>
            ) : liveInfo.next ? (
              <div className="flex min-w-0 items-center gap-2.5">
                <Clock3 className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">Next: {nextSubject?.name ?? (liveInfo.next.subject ? liveInfo.next.subject : liveInfo.next.period)}</p>
                  <p className="truncate text-caption text-muted-foreground">Day {todayDay} · {formatTime(liveInfo.next.startTime, viewSettings.use24Hour)}</p>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2.5">
                <CalendarOff className="h-4 w-4 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Classes are finished</p>
                  <p className="text-caption text-muted-foreground">Day {todayDay} has no more entries today.</p>
                </div>
              </div>
            )}
          </div>
          {config.currentDayOverride && (
            <Button type="button" variant="ghost" size="sm" onClick={clearDayOverride} className="justify-self-start min-[920px]:justify-self-end">
              Use calendar day
            </Button>
          )}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border/70 px-4 py-2.5 min-[1200px]:px-6">
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="icon-sm" onClick={() => selectAdjacentBlock(-1)} disabled={blockCount <= 1} aria-label="Previous timetable block"><ChevronLeft /></Button>
            <div className="min-w-0 flex-1">
              <ScrollArea className="w-full whitespace-nowrap">
                <div className="flex w-max min-w-full justify-center gap-1">
                  {Array.from({ length: cycleLength }, (_, index) => index + 1).map((day) => (
                    <Button
                      key={day}
                      type="button"
                      size="sm"
                      variant={selectedDay === day ? "secondary" : "ghost"}
                      onClick={() => setSelectedDay(day)}
                      aria-pressed={selectedDay === day}
                      className={cn((todayDay === day || nextTimetableDay?.dayLabel === day) && selectedDay !== day && "text-primary")}
                    >
                      Day {day}
                    </Button>
                  ))}
                </div>
                <ScrollBar orientation="horizontal" />
              </ScrollArea>
            </div>
            <Button type="button" variant="outline" size="icon-sm" onClick={() => selectAdjacentBlock(1)} disabled={blockCount <= 1} aria-label="Next timetable block"><ChevronRight /></Button>
          </div>
        </div>

        <ScrollArea className="min-h-0 flex-1">
          <div className="p-3 min-[1200px]:p-4 min-[1600px]:p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-caption font-medium text-muted-foreground">Block {blockNumber} of {blockCount} · Days {days[0]}–{days[days.length - 1]}</p>
              <p className="hidden text-caption text-muted-foreground min-[1050px]:block">Select any day to focus it</p>
            </div>
            <div className="grid items-start gap-3 min-[1050px]:grid-cols-2 min-[1280px]:grid-cols-3 min-[1550px]:grid-cols-5">
              {days.map((day) => (
                <div key={day} className={cn("min-w-0", day !== selectedDay && "hidden min-[1050px]:block")}>
                  <DayCard
                    dayLabel={day}
                    weekday={weekdays[day - 1] ?? 1}
                    periods={getTimetablePeriodsForDay(day, config.entries)}
                    subjects={subjects}
                    isSelected={selectedDay === day}
                    isToday={todayDay === day}
                    isNextSchoolDay={todayDay === null && nextTimetableDay?.dayLabel === day}
                    now={now}
                    showLocations={viewSettings.showLocations}
                    showBreaks={viewSettings.showBreaks}
                    use24Hour={viewSettings.use24Hour}
                    onSelect={() => setSelectedDay(day)}
                    onEdit={() => openManager(day)}
                  />
                </div>
              ))}
            </div>
          </div>
        </ScrollArea>
      </div>

      <TimetableManager open={managerOpen} onOpenChange={setManagerOpen} customSubjects={customSubjects} initialDay={editingDay} />
    </div>
  )
})
