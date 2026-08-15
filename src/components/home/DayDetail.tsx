import { useMemo, type ComponentType, type ReactNode } from "react"
import { format, parseISO, differenceInDays } from "date-fns"
import { X, Check, ChevronRight, CheckCircle2, Trash2, Pencil, CalendarClock, BookOpen, CalendarDays, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem as CtxMenuItem,
  ContextMenuSeparator as CtxMenuSep,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { formatDeadline, getSubjectById, getEventTypeInfo, getSessionEffectiveMinutes, getSessionSubjectIds, cn } from "@/lib/utils"
import type { CalendarEvent, Project, StudySession } from "@/lib/types"

function formatStartTime(startTime: string): string {
  return format(parseISO(startTime), "h:mm a")
}

function formatTimeRange(startTime: string, endTime?: string) {
  const startLabel = format(parseISO(startTime), "h:mm a")
  if (!endTime) return startLabel
  const startKey = format(parseISO(startTime), "yyyy-MM-dd")
  const endKey = format(parseISO(endTime), "yyyy-MM-dd")
  if (startKey !== endKey) {
    return `${format(parseISO(startTime), "MMM d, h:mm a")} – ${format(parseISO(endTime), "MMM d, h:mm a")}`
  }
  return `${startLabel} – ${format(parseISO(endTime), "h:mm a")}`
}

function formatMultiDayEventMeta(startTime: string, endTime: string): string {
  const startDate = parseISO(startTime)
  const endDate = parseISO(endTime)
  const dayCount = differenceInDays(endDate, startDate) + 1
  if (dayCount <= 1) {
    // Same-day event — fall back to normal time display (caller handles this)
    return `${format(parseISO(startTime), "h:mm a")} - ${format(endDate, "h:mm a")}`
  }
  const endLabel = format(endDate, "EEE d MMM")
  return `Multi-day · Ends ${endLabel} (${dayCount} days)`
}

function isEventOnDate(event: CalendarEvent, dateKey: string): boolean {
  const startKey = format(parseISO(event.startTime), "yyyy-MM-dd")
  if (startKey === dateKey) return true
  if (!event.endTime) return false
  const endKey = format(parseISO(event.endTime), "yyyy-MM-dd")
  return dateKey >= startKey && dateKey <= endKey
}

function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 1) return "<1m"
  const hours = Math.floor(totalMinutes / 60)
  const mins = Math.round(totalMinutes % 60)
  if (hours === 0) return `${mins}m`
  if (mins === 0) return `${hours}h`
  return `${hours}h ${mins}m`
}

interface DayDetailProps {
  selectedDate: string
  deadlines: Project[]
  sessions: StudySession[]
  events: CalendarEvent[]
  projects: Project[]
  calendarSelectionMode: boolean
  selectedEventIdSet: Set<string>
  selectedSessionIdSet: Set<string>
  onClose: () => void
  onToggleSelectionMode: () => void
  onClearSelection: () => void
  onSelectAll: () => void
  allSelected: boolean
  onToggleEventSelection: (eventId: string) => void
  onToggleSessionSelection: (sessionId: string) => void
  onSelectProject: (projectId: string) => void
  onSelectSession: (session: StudySession) => void
  onSelectEvent: (event: CalendarEvent) => void
  onNewEvent: () => void
  onNewSession: () => void
  onDeleteCalendarItems?: (itemIds: { eventIds: string[]; sessionIds: string[] }) => void
  onSetCalendarItemsCompleted?: (itemIds: { eventIds: string[]; sessionIds: string[] }, isCompleted: boolean) => void
}

type DayItem =
  | { kind: "event"; item: CalendarEvent }
  | { kind: "session"; item: StudySession }

interface DayItemView {
  id: string
  title: string
  timeLabel: string
  timeDetail?: string
  metaLabel: string
  accentColor?: string
  kindLabel: string
  kindColor?: string
  selected: boolean
  onToggleSelection: () => void
  onOpen: () => void
  selection: { eventIds: string[]; sessionIds: string[] }
  markComplete: boolean
}

function buildDayItemView(
  dayItem: DayItem,
  projects: Project[],
  selectedEventIdSet: Set<string>,
  selectedSessionIdSet: Set<string>,
  onToggleEventSelection: (eventId: string) => void,
  onToggleSessionSelection: (sessionId: string) => void,
  onSelectEvent: (event: CalendarEvent) => void,
  onSelectSession: (session: StudySession) => void,
): DayItemView {
  if (dayItem.kind === "event") {
    const event = dayItem.item
    const subject = getSubjectById(event.subjectId)
    const eventInfo = getEventTypeInfo(event.eventType)
    const isMultiDay = event.endTime && format(parseISO(event.startTime), "yyyy-MM-dd") !== format(parseISO(event.endTime), "yyyy-MM-dd")
    return {
      id: event.id,
      title: event.title,
      timeLabel: isMultiDay && event.endTime
        ? "Multi-day"
        : formatStartTime(event.startTime),
      timeDetail: isMultiDay && event.endTime
        ? formatMultiDayEventMeta(event.startTime, event.endTime)
        : event.endTime
          ? formatTimeRange(event.startTime, event.endTime)
          : undefined,
      metaLabel: [event.location, subject?.shortCode].filter(Boolean).join(" · "),
      accentColor: subject?.color ?? eventInfo.color,
      kindLabel: eventInfo.label,
      kindColor: eventInfo.color,
      selected: selectedEventIdSet.has(event.id),
      onToggleSelection: () => onToggleEventSelection(event.id),
      onOpen: () => onSelectEvent(event),
      selection: { eventIds: [event.id], sessionIds: [] },
      markComplete: !event.isFinished,
    }
  }

  const session = dayItem.item
  const project = session.projectId
    ? projects.find((candidate) => candidate.id === session.projectId)
    : undefined
  const subjectIds = getSessionSubjectIds(session, project)
  const primarySubject = getSubjectById(subjectIds[0])
  const subjects = subjectIds
    .map((subjectId) => getSubjectById(subjectId)?.shortCode ?? subjectId)
    .join(", ")
  const duration = formatDuration(getSessionEffectiveMinutes(session))
  return {
    id: session.id,
    title: session.title,
    timeLabel: formatStartTime(session.startTime),
    timeDetail: session.endTime
      ? `${formatTimeRange(session.startTime, session.endTime)} · ${duration}`
      : duration,
    metaLabel: [
      project?.name ?? subjects,
      session.schedule.blocks.length > 1
        ? `${session.schedule.blocks.length} blocks`
        : undefined,
    ].filter(Boolean).join(" · "),
    accentColor: primarySubject?.color,
    kindLabel: session.status === "in-progress" ? "In progress" : "Session",
    kindColor: session.status === "in-progress" ? undefined : primarySubject?.color,
    selected: selectedSessionIdSet.has(session.id),
    onToggleSelection: () => onToggleSessionSelection(session.id),
    onOpen: () => onSelectSession(session),
    selection: { eventIds: [], sessionIds: [session.id] },
    markComplete: session.status !== "completed",
  }
}

function sortDayItems(items: DayItem[]): DayItem[] {
  return [...items].sort(
    (a, b) => parseISO(a.item.startTime).getTime() - parseISO(b.item.startTime).getTime(),
  )
}

function DaySection({
  title,
  count,
  icon: Icon,
  muted = false,
  children,
}: {
  title: string
  count: number
  icon?: ComponentType<{ className?: string }>
  muted?: boolean
  children: ReactNode
}) {
  return (
    <div className={cn(muted && "opacity-85")}>
      <div className="mb-1.5 flex items-center gap-2 px-0.5">
        {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground/70" aria-hidden="true" />}
        <p className="text-xs font-semibold text-foreground/85">{title}</p>
        <p className="text-micro tabular-nums text-muted-foreground">
          {count} {count === 1 ? "item" : "items"}
        </p>
      </div>
      <div className="divide-y divide-border/30 border-y border-border/45">
        {children}
      </div>
    </div>
  )
}

function KindBadge({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded px-1.5 py-0.5 text-[9px] font-medium leading-none whitespace-nowrap",
        !color && "bg-muted/70 text-muted-foreground",
      )}
      style={color ? { backgroundColor: color + "18", color } : undefined}
    >
      {label}
    </span>
  )
}

export function DayDetail({
  selectedDate,
  deadlines,
  sessions,
  events,
  projects,
  calendarSelectionMode,
  selectedEventIdSet,
  selectedSessionIdSet,
  onClose,
  onToggleSelectionMode,
  onClearSelection,
  onSelectAll,
  allSelected,
  onToggleEventSelection,
  onToggleSessionSelection,
  onSelectProject,
  onSelectSession,
  onSelectEvent,
  onNewEvent,
  onNewSession,
  onDeleteCalendarItems,
  onSetCalendarItemsCompleted,
}: DayDetailProps) {
  const dateKey = selectedDate
  const dayEvents = useMemo(() =>
    events.filter((event) => isEventOnDate(event, dateKey)),
    [events, dateKey],
  )
  const hasItems = deadlines.length > 0 || sessions.length > 0 || dayEvents.length > 0
  const uncompletedItems = useMemo<DayItem[]>(
    () => sortDayItems([
      ...sessions
        .filter((session) => session.status !== "completed")
        .map((session) => ({ kind: "session" as const, item: session })),
      ...dayEvents
        .filter((event) => !event.isFinished)
        .map((event) => ({ kind: "event" as const, item: event })),
    ]),
    [dayEvents, sessions],
  )
  const completedItems = useMemo<DayItem[]>(
    () => sortDayItems([
      ...sessions
        .filter((session) => session.status === "completed")
        .map((session) => ({ kind: "session" as const, item: session })),
      ...dayEvents
        .filter((event) => event.isFinished)
        .map((event) => ({ kind: "event" as const, item: event })),
    ]),
    [dayEvents, sessions],
  )
  const calendarItemCount = sessions.length + dayEvents.length
  const completedCount = completedItems.length
  const progressPct = calendarItemCount > 0
    ? Math.round((completedCount / calendarItemCount) * 100)
    : 0

  const renderDayItemList = (items: DayItem[], isCompleted: boolean) => (
    <div className="divide-y divide-border/30">
      {items.map((dayItem) => {
        const view = buildDayItemView(
          dayItem,
          projects,
          selectedEventIdSet,
          selectedSessionIdSet,
          onToggleEventSelection,
          onToggleSessionSelection,
          onSelectEvent,
          onSelectSession,
        )
        return (
          <ContextMenu key={`${dayItem.kind}-${view.id}`}>
            <div className="group relative flex items-stretch">
              <ContextMenuTrigger asChild>
                <Button
                  variant="ghost"
                  onClick={() => {
                    if (calendarSelectionMode) {
                      view.onToggleSelection()
                      return
                    }
                    view.onOpen()
                  }}
                  className={cn(
                    "relative h-auto min-h-[3.25rem] flex-1 rounded-none px-3 py-2.5 text-left hover:bg-accent/35",
                    view.selected && "bg-primary/10 hover:bg-primary/12",
                    isCompleted && "hover:bg-background/55",
                  )}
                >
                  {view.accentColor && (
                    <span
                      className="absolute inset-y-2.5 left-0 w-0.5 rounded-r-full"
                      style={{ backgroundColor: view.accentColor }}
                      aria-hidden="true"
                    />
                  )}
                  <div className="grid w-full min-w-0 grid-cols-[4.5rem_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 sm:grid-cols-[5rem_minmax(0,1fr)_auto]">
                    <div className="flex min-w-0 items-start gap-1.5 pl-1">
                      {calendarSelectionMode && (
                        <span
                          className={cn(
                            "mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors",
                            view.selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : "border-border bg-background/50",
                          )}
                          aria-hidden="true"
                        >
                          {view.selected && <Check className="h-3 w-3" />}
                        </span>
                      )}
                      <div className="min-w-0">
                        <span className="block truncate text-xs font-semibold tabular-nums text-foreground/90" title={view.timeLabel}>
                          {view.timeLabel}
                        </span>
                        {view.timeDetail && (
                          <span className="mt-0.5 block truncate text-[10px] leading-3 tabular-nums text-muted-foreground" title={view.timeDetail}>
                            {view.timeDetail}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="min-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-xs font-medium text-foreground" title={view.title}>
                          {view.title}
                        </span>
                        <KindBadge label={view.kindLabel} color={view.kindColor} />
                      </div>
                      {view.metaLabel && (
                        <span className="mt-0.5 block truncate text-micro leading-4 text-muted-foreground" title={view.metaLabel}>
                          {view.metaLabel}
                        </span>
                      )}
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5">
                      {isCompleted && (
                        <div className="flex items-center gap-1 text-success">
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                          <span className="hidden text-[10px] font-medium min-[420px]:inline">Done</span>
                        </div>
                      )}
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/45 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground/70" aria-hidden="true" />
                    </div>
                  </div>
                </Button>
              </ContextMenuTrigger>
              {!isCompleted && onSetCalendarItemsCompleted && !calendarSelectionMode && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="my-auto mr-1 h-7 w-7 shrink-0 self-center text-muted-foreground/60 opacity-0 transition-opacity hover:bg-success/10 hover:text-success group-hover:opacity-100 focus-visible:opacity-100"
                  aria-label={`Mark ${view.title} complete`}
                  onClick={() => onSetCalendarItemsCompleted(view.selection, true)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <ContextMenuContent className="w-40">
              <CtxMenuItem onSelect={view.onOpen}>
                <Pencil className="h-4 w-4" />
                Edit
              </CtxMenuItem>
              {onSetCalendarItemsCompleted && (
                <CtxMenuItem onSelect={() => onSetCalendarItemsCompleted(view.selection, view.markComplete)}>
                  <CheckCircle2 className="h-4 w-4" />
                  {view.markComplete ? "Mark complete" : "Mark current"}
                </CtxMenuItem>
              )}
              <CtxMenuSep />
              <CtxMenuItem
                variant="destructive"
                onSelect={() => onDeleteCalendarItems?.(view.selection)}
              >
                <Trash2 className="h-4 w-4" />
                Delete
              </CtxMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        )
      })}
    </div>
  )

  return (
    <section className="border-t border-border/70 pt-4">
      <div className="mb-3.5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold tracking-tight">
            {format(parseISO(selectedDate), "EEEE")}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {format(parseISO(selectedDate), "MMMM d, yyyy")}
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1">
          {hasItems && (
            <>
              <Button variant="outline" size="sm" onClick={onNewSession}>
                <Plus />
                Session
              </Button>
              <Button size="sm" onClick={onNewEvent}>
                <Plus />
                Event
              </Button>
            </>
          )}
          {(dayEvents.length > 0 || sessions.length > 0) && (
            <Button
              variant={calendarSelectionMode ? "secondary" : "ghost"}
              size="sm"
              onClick={() => {
                if (calendarSelectionMode) {
                  onClearSelection()
                  return
                }
                onToggleSelectionMode()
              }}
            >
              {calendarSelectionMode ? "Cancel" : "Select"}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onClose}
            aria-label="Close selected day"
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mb-3.5 grid grid-cols-3 divide-x divide-border/50 border-y border-border/60">
        <div className="px-2 py-2.5 text-center">
          <p className="text-sm font-semibold tabular-nums">{deadlines.length}</p>
          <p className="text-[10px] text-muted-foreground">due</p>
        </div>
        <div className="px-2 py-2.5 text-center">
          <p className="text-sm font-semibold tabular-nums">{dayEvents.length}</p>
          <p className="text-[10px] text-muted-foreground">events</p>
        </div>
        <div className="px-2 py-2.5 text-center">
          <p className="text-sm font-semibold tabular-nums">{sessions.length}</p>
          <p className="text-[10px] text-muted-foreground">sessions</p>
        </div>
      </div>

      {calendarItemCount > 0 && (
        <div className="mb-3.5">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
            <span>{completedCount} of {calendarItemCount} done</span>
            <span className="tabular-nums">{progressPct}%</span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-background/60">
            <div
              className="h-full rounded-full bg-success/70 transition-[width] duration-300"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {calendarSelectionMode && (
        <div className="mb-3 flex items-center justify-between gap-2 rounded-xl border border-primary/20 bg-primary/8 px-2.5 py-2">
          <p className="text-xs font-medium text-primary">
            Pick items below, or select the whole day.
          </p>
          <Button variant="ghost" size="xs" onClick={onSelectAll}>
            {allSelected ? "Clear all" : "Select all"}
          </Button>
        </div>
      )}

      {hasItems ? (
        <div className="space-y-3">
          {deadlines.length > 0 && (
            <DaySection title="Due" count={deadlines.length} icon={CalendarClock}>
              <div className="divide-y divide-border/30">
                {deadlines.map((p) => {
                  const subject = getSubjectById(p.subjectId)
                  return (
                    <Button
                      key={p.id}
                      variant="ghost"
                      onClick={() => onSelectProject(p.id)}
                      className="group h-auto min-h-[3.25rem] w-full justify-start rounded-none px-3 py-2.5 text-left hover:bg-accent/35"
                    >
                      <div className="flex w-full min-w-0 items-center gap-2.5">
                        {subject && (
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: subject.color }}
                            aria-hidden="true"
                          />
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-medium">{p.icon} {p.name}</p>
                          <p className="mt-0.5 text-micro text-muted-foreground">
                            {formatDeadline(p.deadline!)}
                          </p>
                        </div>
                        {subject && (
                          <KindBadge label={subject.shortCode} color={subject.color} />
                        )}
                        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/45 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                      </div>
                    </Button>
                  )
                })}
              </div>
            </DaySection>
          )}

          {uncompletedItems.length > 0 && (
            <DaySection title="Schedule" count={uncompletedItems.length} icon={CalendarDays}>
              {renderDayItemList(uncompletedItems, false)}
            </DaySection>
          )}

          {completedItems.length > 0 && (
            <DaySection title="Completed" count={completedItems.length} icon={BookOpen} muted>
              {renderDayItemList(completedItems, true)}
            </DaySection>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border/70 bg-background/30 px-4 py-5 text-center">
          <CalendarDays className="mx-auto mb-2 h-5 w-5 text-muted-foreground/50" aria-hidden="true" />
          <p className="text-xs font-medium text-foreground/80">Nothing scheduled</p>
          <p className="mt-0.5 text-micro text-muted-foreground">Sessions and events for this day will show up here.</p>
          <div className="mt-3 flex justify-center gap-2">
            <Button variant="outline" size="sm" onClick={onNewSession}>Plan session</Button>
            <Button size="sm" onClick={onNewEvent}>Add event</Button>
          </div>
        </div>
      )}
    </section>
  )
}
