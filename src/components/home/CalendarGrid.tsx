import {
  useState,
  useCallback,
  useMemo,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { createPortal } from "react-dom";
import type { KeyboardEvent } from "react";
import {
  format,
  isSameMonth,
  isToday,
  isWithinInterval,
  parseISO,
  differenceInDays,
} from "date-fns";
import {
  motion,
  AnimatePresence,
  useMotionValue,
} from "framer-motion";
import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  CheckCircle2,
  Trash2,
  CalendarDays,
  Plus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem as CtxMenuItem,
  ContextMenuSeparator as CtxMenuSep,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { getSubjectById, getEventTypeInfo, cn } from "@/lib/utils";
import { getCalendarSessionIndicators } from "@/lib/groupSessions";
import { moveCalendarEventToDate } from "@/lib/calendarNavigation";
import type { CalendarEvent, Project, StudySession } from "@/lib/types";

const CALENDAR_FALLBACK_COLOR = "var(--muted-foreground)";
const DRAG_THRESHOLD = 4;

function formatCompactDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${Math.max(1, Math.round(totalMinutes))}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

function parseDateKey(dateKey: string): Date | null {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return null;
  return new Date(year, month - 1, day);
}

function moveDateByDayDelta(date: Date, dayDelta: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + dayDelta);
  return next;
}

interface CalendarGridProps {
  currentMonth: Date;
  calendarView: "month" | "week";
  selectedDate: string | null;
  deadlinesByDate: Record<string, Project[]>;
  sessionsByDate: Record<string, StudySession[]>;
  eventsByDate: Record<string, CalendarEvent[]>;
  events: CalendarEvent[];
  projects: Project[];
  onSetCalendarView: (view: "month" | "week") => void;
  onPrevPeriod: () => void;
  onNextPeriod: () => void;
  onToday: () => void;
  onSelectDate: (dateKey: string) => void;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (session: StudySession) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onNewEvent: (initialDate: Date) => void;
  onMoveEvent?: (
    eventId: string,
    newStartTime: string,
    newEndTime?: string,
  ) => void;
  onDeleteCalendarItems?: (itemIds: {
    eventIds: string[];
    sessionIds: string[];
  }) => void;
  onSetCalendarItemsCompleted?: (
    itemIds: { eventIds: string[]; sessionIds: string[] },
    isCompleted: boolean,
  ) => void;
}

interface DragState {
  eventId: string;
  sourceDateKey: string;
  title: string;
  color: string;
}

export function CalendarGrid({
  currentMonth,
  calendarView,
  selectedDate,
  deadlinesByDate,
  sessionsByDate,
  eventsByDate,
  events,
  projects,
  onSetCalendarView,
  onPrevPeriod,
  onNextPeriod,
  onToday,
  onSelectDate,
  onSelectProject,
  onSelectSession,
  onSelectEvent,
  onNewEvent,
  onMoveEvent,
  onDeleteCalendarItems,
  onSetCalendarItemsCompleted,
}: CalendarGridProps) {
  const [hoveredDateKey, setHoveredDateKey] = useState<string | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const isDragActiveRef = useRef(false);
  const [isTrackingPointer, setIsTrackingPointer] = useState(false);
  const pointerStartRef = useRef<{
    x: number;
    y: number;
    eventId: string;
    sourceDateKey: string;
    title: string;
    color: string;
  } | null>(null);
  const hoveredDateKeyRef = useRef<string | null>(null);
  const ghostX = useMotionValue(0);
  const ghostY = useMotionValue(0);

  // Stable refs so the document-level listeners never reference stale callbacks
  const onMoveEventRef = useRef(onMoveEvent);
  useEffect(() => {
    onMoveEventRef.current = onMoveEvent;
  });
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  });

  const monthStart = useMemo(() => {
    const d = new Date(currentMonth);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  }, [currentMonth]);

  const monthEnd = useMemo(() => {
    const d = new Date(currentMonth);
    d.setMonth(d.getMonth() + 1, 0);
    d.setHours(23, 59, 59, 999);
    return d;
  }, [currentMonth]);

  const daysInMonth = useMemo(() => {
    const days: Date[] = [];
    const current = new Date(monthStart);
    while (current <= monthEnd) {
      days.push(new Date(current));
      current.setDate(current.getDate() + 1);
    }
    return days;
  }, [monthStart, monthEnd]);

  const calendarPad = useMemo(() => {
    return Array.from({ length: monthStart.getDay() }, (_, i) => i);
  }, [monthStart]);

  const calendarTrailingPad = useMemo(() => {
    const occupiedCells = calendarPad.length + daysInMonth.length;
    return Array.from(
      { length: (7 - (occupiedCells % 7)) % 7 },
      (_, i) => i,
    );
  }, [calendarPad.length, daysInMonth.length]);

  const weekStart = useMemo(() => {
    const date = new Date(currentMonth);
    const start = new Date(date);
    start.setDate(start.getDate() - start.getDay());
    start.setHours(0, 0, 0, 0);
    return start;
  }, [currentMonth]);

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => {
      const date = new Date(weekStart);
      date.setDate(date.getDate() + i);
      return date;
    });
  }, [weekStart]);

  const multiDayEvents = useMemo(() => {
    return events.filter((event) => {
      if (!event.endTime) return false;
      const startKey = format(parseISO(event.startTime), "yyyy-MM-dd");
      const endKey = format(parseISO(event.endTime), "yyyy-MM-dd");
      return startKey !== endKey;
    });
  }, [events]);

  const getMultiDayForDate = useCallback(
    (dateKey: string): CalendarEvent[] => {
      return multiDayEvents.filter((event) => {
        const startKey = format(parseISO(event.startTime), "yyyy-MM-dd");
        const endKey = format(parseISO(event.endTime!), "yyyy-MM-dd");
        return dateKey >= startKey && dateKey <= endKey;
      });
    },
    [multiDayEvents],
  );

  const getMultiDayPosition = useCallback(
    (
      event: CalendarEvent,
      dateKey: string,
    ): "start" | "middle" | "end" | "alone" => {
      const startKey = format(parseISO(event.startTime), "yyyy-MM-dd");
      const endKey = format(parseISO(event.endTime!), "yyyy-MM-dd");
      const isStart = dateKey === startKey;
      const isEnd = dateKey === endKey;
      if (isStart && isEnd) return "alone";
      if (isStart) return "start";
      if (isEnd) return "end";
      return "middle";
    },
    [],
  );

  // Hit-test: find the date key from a screen point
  const findDateKeyFromPoint = useCallback(
    (x: number, y: number): string | null => {
      const els = document.elementsFromPoint(x, y);
      for (const el of els) {
        const key = (el as HTMLElement).dataset?.dateKey;
        if (key) return key;
      }
      return null;
    },
    [],
  );

  // ---- Custom drag-and-drop via pointer events ----

  const handleEventPointerDown = useCallback(
    (
      e: React.PointerEvent,
      eventId: string,
      sourceDateKey: string,
      title: string,
      color: string,
    ) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      isDragActiveRef.current = false;
      pointerStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        eventId,
        sourceDateKey,
        title,
        color,
      };
      dragStateRef.current = null;
      // Suppress text selection from the very first pointerdown — browsers begin
      // a selection immediately on press, so we can't wait for the drag threshold.
      document.body.style.userSelect = "none";
      document.body.style.webkitUserSelect = "none";
      ghostX.set(e.clientX);
      ghostY.set(e.clientY);
      setIsTrackingPointer(true);
    },
    [ghostX, ghostY],
  );

  // Document-level pointer tracking while a drag may be pending or active.
  // useLayoutEffect so the listeners are attached before paint — the first
  // pointermove after press is never missed.
  useLayoutEffect(() => {
    if (!isTrackingPointer) return;

    const onMove = (e: PointerEvent) => {
      // Promote to "active drag" once we cross the threshold — flips cursor and
      // suppresses text selection. The ghost is already visible from press.
      if (!isDragActiveRef.current) {
        const start = pointerStartRef.current;
        if (start) {
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (
            Math.abs(dx) >= DRAG_THRESHOLD ||
            Math.abs(dy) >= DRAG_THRESHOLD
          ) {
            isDragActiveRef.current = true;
            const nextDragState = {
              eventId: start.eventId,
              sourceDateKey: start.sourceDateKey,
              title: start.title,
              color: start.color,
            };
            dragStateRef.current = nextDragState;
            setDragState(nextDragState);
            document.body.style.cursor = "grabbing";
            document.body.style.userSelect = "none";
          }
        }
      }

      // Ghost follows the cursor 1:1 — motion values skip React render entirely
      ghostX.set(e.clientX);
      ghostY.set(e.clientY);

      const key = findDateKeyFromPoint(e.clientX, e.clientY);
      if (key !== hoveredDateKeyRef.current) {
        hoveredDateKeyRef.current = key;
        setHoveredDateKey(key);
      }
    };

    const onUp = (e: PointerEvent) => {
      const start = pointerStartRef.current;
      const wasActive = isDragActiveRef.current;
      isDragActiveRef.current = false;

      if (wasActive && start && onMoveEventRef.current) {
        e.preventDefault(); // suppress the click that would follow the drag

        const targetKey = hoveredDateKeyRef.current;
        if (targetKey && targetKey !== start.sourceDateKey) {
          const targetDate = parseDateKey(targetKey);
          if (targetDate) {
            const event = eventsRef.current.find(
              (ev) => ev.id === start.eventId,
            );
            if (event) {
              const moved = moveCalendarEventToDate(
                event.startTime,
                event.endTime,
                targetDate,
              );
              // Commit immediately — no snap animation, no delay
              onMoveEventRef.current(
                start.eventId,
                moved.startTime,
                moved.endTime,
              );
            }
          }
        }
      }

      // Tear down synchronously so the ghost disappears the instant the
      // pointer is released.
      if (wasActive) {
        window.setTimeout(() => {
          dragStateRef.current = null;
        }, 0);
      } else {
        dragStateRef.current = null;
      }
      pointerStartRef.current = null;
      hoveredDateKeyRef.current = null;
      setIsTrackingPointer(false);
      setDragState(null);
      setHoveredDateKey(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";

      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };

    const onCancel = () => {
      isDragActiveRef.current = false;
      dragStateRef.current = null;
      pointerStartRef.current = null;
      setIsTrackingPointer(false);
      setDragState(null);
      setHoveredDateKey(null);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);

    return () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
  }, [isTrackingPointer, findDateKeyFromPoint, ghostX, ghostY]);

  // ---- Keyboard handler for month cells ----
  const handleMonthCellKeyDown = useCallback(
    (e: KeyboardEvent<HTMLElement>, dateKey: string) => {
      const dayDelta =
        e.key === "ArrowLeft"
          ? -1
          : e.key === "ArrowRight"
            ? 1
            : e.key === "ArrowUp"
              ? -7
              : e.key === "ArrowDown"
                ? 7
                : 0;
      if (dayDelta !== 0) {
        e.preventDefault();
        const date = parseDateKey(dateKey);
        if (date)
          onSelectDate(
            format(moveDateByDayDelta(date, dayDelta), "yyyy-MM-dd"),
          );
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      const date = parseDateKey(dateKey);
      if (e.shiftKey && date) onNewEvent(date);
      else onSelectDate(dateKey);
    },
    [onNewEvent, onSelectDate],
  );

  const today = new Date();
  const isViewingToday =
    calendarView === "month"
      ? isSameMonth(currentMonth, today)
      : isWithinInterval(today, { start: weekStart, end: weekDays[6] });
  const periodLabel =
    calendarView === "month"
      ? format(currentMonth, "MMMM yyyy")
      : `${format(weekStart, "MMM d")} – ${format(weekDays[6], "MMM d, yyyy")}`;

  // ---- Drag ghost (portal) ----
  // Mirrors the actual event chip after the pointer crosses the drag threshold.
  const dragGhost = dragState ? (
    <motion.div
      key="drag-ghost"
      initial={false}
      style={{
        position: "fixed",
        left: 0,
        top: 0,
        x: ghostX,
        y: ghostY,
        translateX: "-50%",
        translateY: "-50%",
        zIndex: 9999,
        pointerEvents: "none",
      }}
    >
      <div
        className="flex h-5 max-w-56 items-center gap-1 overflow-hidden rounded-[3px]"
        style={{
          backgroundColor: dragState.color + "14",
          borderLeft: `3px solid ${dragState.color}`,
          boxShadow: `0 10px 24px -6px ${dragState.color}40, 0 2px 6px rgba(0,0,0,0.10), 0 0 0 1px ${dragState.color}1f`,
        }}
      >
        <span className="truncate px-1.5 text-caption font-medium leading-5 text-foreground/80">
          {dragState.title}
        </span>
      </div>
    </motion.div>
  ) : null;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{periodLabel}</h2>
          <p className="text-xs text-muted-foreground">
            Arrow keys move dates; Shift + Enter creates an event.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            size="sm"
            onClick={() =>
              onNewEvent(parseDateKey(selectedDate ?? "") ?? today)
            }
          >
            <Plus />
            New event
          </Button>
          <div
            className="flex gap-0.5 rounded-lg bg-muted p-0.5"
            role="group"
            aria-label="Calendar view"
          >
            <Button
              variant={calendarView === "month" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => onSetCalendarView("month")}
              aria-pressed={calendarView === "month"}
            >
              Month
            </Button>
            <Button
              variant={calendarView === "week" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => onSetCalendarView("week")}
              aria-pressed={calendarView === "week"}
            >
              Week
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onPrevPeriod}
            aria-label={`Previous ${calendarView}`}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant={isViewingToday ? "secondary" : "ghost"}
            size="sm"
            onClick={onToday}
          >
            Today
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onNextPeriod}
            aria-label={`Next ${calendarView}`}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>

      {calendarView === "month" && (
        <div className="grid grid-cols-7 gap-0 rounded-lg border bg-background/16">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <div
              key={day}
              className="flex h-7 items-center justify-center border-b border-border/15 text-micro font-medium uppercase text-muted-foreground/70"
            >
              {day}
            </div>
          ))}
          {calendarPad.map((i) => (
            <div key={`pad-${i}`} className="h-28 border-b border-border/15" />
          ))}
          {daysInMonth.map((date) => {
            const dateKey = format(date, "yyyy-MM-dd");
            const dayDeadlines = deadlinesByDate[dateKey] || [];
            const daySessions = sessionsByDate[dateKey] || [];
            const dayEvents = eventsByDate[dateKey] || [];
            const isCurrentMonth = isSameMonth(date, currentMonth);
            const isTodayDate = isToday(date);
            const isHovered = hoveredDateKey === dateKey && !!dragState;
            const dayMultiDayEvents = getMultiDayForDate(dateKey);
            const multiDayEventIds = new Set(
              dayMultiDayEvents.map((e) => e.id),
            );
            const sessionIndicators = getCalendarSessionIndicators(
              daySessions,
              projects,
            );
            const allItems = [
              ...dayDeadlines.map((p) => ({
                type: "deadline" as const,
                name: p.name,
                color:
                  getSubjectById(p.subjectId)?.color ?? CALENDAR_FALLBACK_COLOR,
                kind: "deadline" as const,
                id: p.id,
              })),
              ...sessionIndicators.map((ind) => {
                const session = ind.count === 1
                  ? daySessions.find((item) => item.id === ind.sessionIds[0])
                  : undefined;
                return {
                  type: "session" as const,
                  name: session?.title ?? ind.shortCode,
                  meta: `${ind.count > 1 ? `${ind.count}× · ` : ""}${formatCompactDuration(ind.totalMinutes)}`,
                  color: ind.color,
                  kind: "session" as const,
                  id: ind.subjectId,
                  status: ind.status,
                  session,
                };
              }),
              ...dayEvents.map((e) => ({
                type: "event" as const,
                name: e.title,
                meta: format(parseISO(e.startTime), "h:mm a"),
                color: getEventTypeInfo(e.eventType).color,
                kind: "event" as const,
                id: e.id,
                event: e,
                status: e.isFinished ? ("completed" as const) : ("planned" as const),
              })),
            ];
            const regularItems = allItems.filter(
              (item) => !multiDayEventIds.has(item.id),
            );
            const visibleItems = regularItems.slice(0, 3);
            const overflow = regularItems.length - 3;

            return (
              <ContextMenu key={dateKey}>
                <ContextMenuTrigger asChild>
              <div
                role="button"
                tabIndex={0}
                data-date-key={dateKey}
                onClick={() => onSelectDate(dateKey)}
                onDoubleClick={() => onNewEvent(date)}
                onKeyDown={(e) => handleMonthCellKeyDown(e, dateKey)}
                aria-label={`${format(date, "EEEE, MMMM d")}; ${dayEvents.length} events, ${daySessions.length} sessions, ${dayDeadlines.length} deadlines`}
                className={cn(
                  "relative flex h-28 w-full cursor-pointer flex-col items-start justify-start border-b border-border/15 p-1.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  selectedDate === dateKey
                    ? "bg-primary/8 shadow-[inset_0_0_0_1px_var(--primary)]"
                    : "bg-background/16 hover:bg-accent/24",
                  isTodayDate && selectedDate !== dateKey && "bg-primary/5",
                  !isCurrentMonth && "opacity-30",
                  isHovered &&
                    "bg-accent/30 shadow-[inset_0_0_0_1px_var(--primary)]",
                )}
              >
                <div
                  className={cn(
                    "flex h-5 w-5 items-center justify-center rounded-lg text-micro font-semibold leading-none",
                    isTodayDate && "bg-primary/12",
                    isTodayDate ? "text-primary" : "text-foreground/80",
                  )}
                >
                  {date.getDate()}
                </div>
                {dayMultiDayEvents.length > 0 && (
                  <div className="mt-0.5 w-[calc(100%+0.75rem)] -mx-1.5 space-y-px">
                    {" "}
                    {dayMultiDayEvents.map((event) => {
                      const position = getMultiDayPosition(event, dateKey);
                      const color = getEventTypeInfo(event.eventType).color;
                      const isStart =
                        position === "start" || position === "alone";
                      return (
                        <ContextMenu key={event.id}>
                          <ContextMenuTrigger asChild>
                            <div
                              role="button"
                              tabIndex={0}
                              onPointerDown={(e) => {
                                if (onMoveEvent)
                                  handleEventPointerDown(
                                    e,
                                    event.id,
                                    dateKey,
                                    event.title,
                                    color,
                                  );
                              }}
                              onClick={(e) => {
                                if (!dragStateRef.current) {
                                  e.stopPropagation();
                                  onSelectEvent(event);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.preventDefault();
                                e.stopPropagation();
                                onSelectEvent(event);
                              }}
                              className="flex h-5 w-full items-center gap-1 overflow-hidden text-left transition-opacity hover:opacity-85 rounded-none cursor-pointer"
                              style={{
                                backgroundColor: color + "12",
                                touchAction: "none",
                              }}
                            >
                              {isStart && (
                                <div
                                  className="h-full w-0.75 shrink-0"
                                  style={{ backgroundColor: color }}
                                />
                              )}
                              {isStart && (
                                <span className="truncate text-caption font-medium leading-5 text-foreground/75">
                                  {event.title}
                                </span>
                              )}
                              {isStart &&
                                (() => {
                                  const dayCount =
                                    differenceInDays(
                                      parseISO(event.endTime!),
                                      parseISO(event.startTime),
                                    ) + 1;
                                  return dayCount >= 3 ? (
                                    <span className="ml-auto mr-1 shrink-0 text-micro text-foreground/40 font-medium">
                                      {dayCount}d
                                    </span>
                                  ) : null;
                                })()}
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-40">
                            <CtxMenuItem onSelect={() => onSelectEvent(event)}>
                              <Pencil className="h-4 w-4" />
                              Edit
                            </CtxMenuItem>
                            {onSetCalendarItemsCompleted && (
                              <CtxMenuItem
                                onSelect={() =>
                                  onSetCalendarItemsCompleted(
                                    { eventIds: [event.id], sessionIds: [] },
                                    !event.isFinished,
                                  )
                                }
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                {event.isFinished
                                  ? "Mark current"
                                  : "Mark complete"}
                              </CtxMenuItem>
                            )}
                            <CtxMenuSep />
                            <CtxMenuItem
                              variant="destructive"
                              onSelect={() =>
                                onDeleteCalendarItems?.({
                                  eventIds: [event.id],
                                  sessionIds: [],
                                })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </CtxMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
                  </div>
                )}
                <div className="mt-0.5 w-[calc(100%+0.75rem)] -mx-1.5 space-y-px">
                  {visibleItems.map((item, idx) => {
                    const isDraggableEvent =
                      "event" in item && item.type === "event";
                    const sharedClasses =
                      "flex h-5 w-full items-center gap-1 overflow-hidden rounded-[3px]";
                    const isSession = item.type === "session";
                    const hasStatus = "status" in item;
                    const content = (
                      <>
                        {hasStatus ? (
                          item.status === "completed" ? (
                            <CheckCircle2
                              className="ml-1 h-2.5 w-2.5 shrink-0"
                              style={{ color: item.color }}
                              aria-hidden="true"
                            />
                          ) : (
                            <span
                              className={cn(
                                "ml-1 h-1.5 w-1.5 shrink-0 rounded-full",
                                item.status === "in-progress" && "ring-2 ring-primary/25",
                              )}
                              style={{ backgroundColor: item.color }}
                              aria-hidden="true"
                            />
                          )
                        ) : (
                          <div
                            className="h-full w-0.75 shrink-0"
                            style={{ backgroundColor: item.color }}
                          />
                        )}
                        <span className={cn(
                          "truncate text-caption font-medium leading-5",
                          isSession ? "text-foreground/85" : "text-foreground/75",
                          hasStatus && item.status === "completed" && "line-through opacity-70",
                        )}>
                          {item.name}
                        </span>
                        {hasStatus && (
                          <span className="ml-auto mr-1 shrink-0 text-micro font-medium tabular-nums text-muted-foreground/70">
                            {item.meta}
                          </span>
                        )}
                      </>
                    );
                    if (isDraggableEvent) {
                      const ev = (item as { event: CalendarEvent }).event;
                      const evColor = getEventTypeInfo(ev.eventType).color;
                      return (
                        <ContextMenu key={`${item.type}-${idx}`}>
                          <ContextMenuTrigger asChild>
                            <div
                              role="button"
                              tabIndex={0}
                              onPointerDown={(e) => {
                                if (onMoveEvent)
                                  handleEventPointerDown(
                                    e,
                                    ev.id,
                                    dateKey,
                                    ev.title,
                                    evColor,
                                  );
                              }}
                              onClick={(e) => {
                                if (!dragStateRef.current) {
                                  e.stopPropagation();
                                  onSelectEvent(ev);
                                }
                              }}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter" && e.key !== " ") return;
                                e.preventDefault();
                                e.stopPropagation();
                                onSelectEvent(ev);
                              }}
                              className={cn(
                                sharedClasses,
                                "cursor-grab active:cursor-grabbing",
                              )}
                              style={{
                                backgroundColor: item.color + "12",
                                touchAction: "none",
                              }}
                            >
                              {content}
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent className="w-40">
                            <CtxMenuItem onSelect={() => onSelectEvent(ev)}>
                              <Pencil className="h-4 w-4" />
                              Edit
                            </CtxMenuItem>
                            {onSetCalendarItemsCompleted && (
                              <CtxMenuItem
                                onSelect={() =>
                                  onSetCalendarItemsCompleted(
                                    { eventIds: [ev.id], sessionIds: [] },
                                    !ev.isFinished,
                                  )
                                }
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                {ev.isFinished
                                  ? "Mark current"
                                  : "Mark complete"}
                              </CtxMenuItem>
                            )}
                            <CtxMenuSep />
                            <CtxMenuItem
                              variant="destructive"
                              onSelect={() =>
                                onDeleteCalendarItems?.({
                                  eventIds: [ev.id],
                                  sessionIds: [],
                                })
                              }
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </CtxMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    }
                    if (isSession) {
                      return (
                        <button
                          key={`${item.type}-${idx}`}
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            if (item.session) onSelectSession(item.session);
                            else onSelectDate(dateKey);
                          }}
                          className={cn(
                            sharedClasses,
                            "text-left transition-colors hover:bg-accent/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                            item.status === "completed" && "opacity-70 hover:opacity-90",
                          )}
                          style={{ backgroundColor: item.color + "10" }}
                          aria-label={`${item.name} study, ${item.meta}${item.status === "completed" ? ", completed" : item.status === "in-progress" ? ", active" : ""}`}
                        >
                          {content}
                        </button>
                      );
                    }
                    return (
                      <div
                        key={`${item.type}-${idx}`}
                        className={sharedClasses}
                        style={{ backgroundColor: item.color + "12" }}
                      >
                        {content}
                      </div>
                    );
                  })}
                  {overflow > 0 && (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onSelectDate(dateKey);
                      }}
                      className={cn(
                        "text-micro font-medium leading-tight text-muted-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                        selectedDate === dateKey ? "px-0" : "px-1.5",
                      )}
                      aria-label={`Show ${overflow} more items on ${format(date, "MMMM d")}`}
                    >
                      +{overflow} item{overflow !== 1 ? "s" : ""}
                    </button>
                  )}
                </div>
              </div>
                </ContextMenuTrigger>
                <ContextMenuContent className="w-40">
                  <CtxMenuItem onSelect={() => onNewEvent(date)}>
                    <Plus className="h-4 w-4" />
                    New event
                  </CtxMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
          {calendarTrailingPad.map((i) => (
            <div
              key={`trailing-pad-${i}`}
              className="h-28 border-b border-border/15"
              aria-hidden="true"
            />
          ))}
        </div>
      )}

      {calendarView === "week" && (
        <div className="space-y-2">
          <div className="grid grid-cols-7 gap-1">
            {weekDays.map((date) => {
              const dateKey = format(date, "yyyy-MM-dd");
              const dayDeadlines = deadlinesByDate[dateKey] || [];
              const daySessions = sessionsByDate[dateKey] || [];
              const dayEvents = eventsByDate[dateKey] || [];
              const isTodayDate = isToday(date);
              const isHovered = hoveredDateKey === dateKey && !!dragState;
              const dayMultiDayEvents = getMultiDayForDate(dateKey);
              const multiDayEventIds = new Set(
                dayMultiDayEvents.map((e) => e.id),
              );
              const sessionIndicators = getCalendarSessionIndicators(
                daySessions,
                projects,
              );
              const regularDayEvents = dayEvents.filter(
                (e) => !multiDayEventIds.has(e.id),
              );
              const allItems = [
                ...dayDeadlines.map((p) => ({
                  type: "deadline" as const,
                  name: p.name,
                  color:
                    getSubjectById(p.subjectId)?.color ??
                    CALENDAR_FALLBACK_COLOR,
                  project: p,
                })),
                ...sessionIndicators.map((ind) => {
                  const session = ind.count === 1
                    ? daySessions.find((item) => item.id === ind.sessionIds[0])
                    : undefined;
                  return {
                    type: "session" as const,
                    name: session?.title ?? ind.shortCode,
                    meta: `${ind.count > 1 ? `${ind.count}× · ` : ""}${formatCompactDuration(ind.totalMinutes)}`,
                    color: ind.color,
                    kind: "session" as const,
                    id: ind.subjectId,
                    status: ind.status,
                    session,
                  };
                }),
                ...regularDayEvents.map((e) => ({
                  type: "event" as const,
                  name: e.title,
                  meta: format(parseISO(e.startTime), "h:mm a"),
                  color: getEventTypeInfo(e.eventType).color,
                  event: e,
                  status: e.isFinished ? ("completed" as const) : ("planned" as const),
                })),
              ];

              return (
                <ContextMenu key={dateKey}>
                  <ContextMenuTrigger asChild>
                <div
                  data-date-key={dateKey}
                  className={cn(
                    "min-h-40 rounded-lg border p-2 transition-colors",
                    selectedDate === dateKey
                      ? "border-primary/65 bg-primary/8 ring-1 ring-primary/25"
                      : "border-border/35 bg-background/16 hover:border-border hover:bg-accent/24",
                    isTodayDate &&
                      selectedDate !== dateKey &&
                      "border-primary/40 bg-primary/5",
                    isHovered &&
                      "border-primary/50 bg-accent/30 ring-2 ring-primary/20",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => onSelectDate(dateKey)}
                    onKeyDown={(e) => handleMonthCellKeyDown(e, dateKey)}
                    aria-label={format(date, "EEEE, MMMM d")}
                    className={cn(
                      "mb-2 flex h-7 w-7 items-center justify-center rounded-xl text-xs font-semibold transition-colors",
                      isTodayDate
                        ? "bg-primary text-primary-foreground"
                        : "text-foreground/80 hover:bg-muted/65",
                    )}
                  >
                    {date.getDate()}
                  </button>
                  {dayMultiDayEvents.length > 0 && (
                    <div className="mb-1 w-full space-y-0.5">
                      {dayMultiDayEvents.map((event) => {
                        const color = getEventTypeInfo(event.eventType).color;
                        return (
                          <ContextMenu key={event.id}>
                            <ContextMenuTrigger asChild>
                          <button
                            type="button"
                            onPointerDown={(e) => {
                              if (onMoveEvent)
                                handleEventPointerDown(
                                  e,
                                  event.id,
                                  dateKey,
                                  event.title,
                                  color,
                                );
                            }}
                            onClick={(e) => {
                              if (!dragStateRef.current) {
                                e.stopPropagation();
                                onSelectEvent(event);
                              }
                            }}
                            className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/45"
                            style={{
                              backgroundColor: color + "14",
                              touchAction: "none",
                            }}
                          >
                            <div
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: color }}
                            />
                            <span className="min-w-0 truncate text-xs font-medium leading-tight text-foreground/80">
                              {event.title}
                            </span>
                          </button>
                            </ContextMenuTrigger>
                            <ContextMenuContent className="w-40">
                              <CtxMenuItem onSelect={() => onSelectEvent(event)}>
                                <Pencil className="h-4 w-4" />
                                Edit
                              </CtxMenuItem>
                              {onSetCalendarItemsCompleted && (
                                <CtxMenuItem
                                  onSelect={() => onSetCalendarItemsCompleted(
                                    { eventIds: [event.id], sessionIds: [] },
                                    !event.isFinished,
                                  )}
                                >
                                  <CheckCircle2 className="h-4 w-4" />
                                  {event.isFinished ? "Mark current" : "Mark complete"}
                                </CtxMenuItem>
                              )}
                              <CtxMenuSep />
                              <CtxMenuItem
                                variant="destructive"
                                onSelect={() => onDeleteCalendarItems?.({ eventIds: [event.id], sessionIds: [] })}
                              >
                                <Trash2 className="h-4 w-4" />
                                Delete
                              </CtxMenuItem>
                            </ContextMenuContent>
                          </ContextMenu>
                        );
                      })}
                    </div>
                  )}
                  <div className="space-y-1">
                    {allItems.map((item, idx) => {
                      const itemButton = (
                      <button
                        type="button"
                        onPointerDown={(e) => {
                          if (
                            onMoveEvent &&
                            item.type === "event" &&
                            "event" in item
                          ) {
                            const ev = item.event;
                            const color = getEventTypeInfo(ev.eventType).color;
                            handleEventPointerDown(
                              e,
                              ev.id,
                              dateKey,
                              ev.title,
                              color,
                            );
                          }
                        }}
                        onClick={(e) => {
                          if (dragStateRef.current) return;
                          e.stopPropagation();
                          if (item.type === "deadline" && "project" in item)
                            onSelectProject(item.project.id);
                          else if (item.type === "session") {
                            if (item.session) onSelectSession(item.session);
                            else onSelectDate(dateKey);
                          }
                          else if (item.type === "event" && "event" in item)
                            onSelectEvent(item.event);
                        }}
                        className={cn(
                          "flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left transition-colors hover:bg-muted/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          item.type === "session" && "border border-border/30 bg-background/35",
                          item.type === "session" && item.status === "completed" && "opacity-65 hover:opacity-90",
                        )}
                        style={{
                          touchAction:
                            item.type === "event" && "event" in item
                              ? "none"
                              : undefined,
                        }}
                      >
                        {item.type === "session" && item.status === "completed" ? (
                          <CheckCircle2
                            className="h-3 w-3 shrink-0"
                            style={{ color: item.color }}
                            aria-hidden="true"
                          />
                        ) : (
                          <div
                            className={cn(
                              "h-1.5 w-1.5 shrink-0 rounded-full",
                              item.type === "session" && item.status === "in-progress" && "ring-2 ring-primary/20",
                            )}
                            style={{ backgroundColor: item.color }}
                          />
                        )}
                        <span
                          className={cn(
                            "min-w-0 truncate text-xs font-medium leading-tight text-foreground/80",
                            item.type === "event" && item.status === "completed" && "line-through opacity-70",
                          )}
                        >
                          {item.name}
                        </span>
                        {(item.type === "session" || item.type === "event") && (
                          <span className="ml-auto shrink-0 text-micro font-medium tabular-nums text-muted-foreground">
                            {item.type === "session" && item.status === "in-progress" ? "Active · " : ""}{item.meta}
                          </span>
                        )}
                      </button>
                      );
                      if (item.type !== "event" || !("event" in item)) {
                        return <div key={`${item.type}-${idx}`}>{itemButton}</div>;
                      }
                      const event = item.event;
                      return (
                        <ContextMenu key={`${item.type}-${idx}`}>
                          <ContextMenuTrigger asChild>{itemButton}</ContextMenuTrigger>
                          <ContextMenuContent className="w-40">
                            <CtxMenuItem onSelect={() => onSelectEvent(event)}>
                              <Pencil className="h-4 w-4" />
                              Edit
                            </CtxMenuItem>
                            {onSetCalendarItemsCompleted && (
                              <CtxMenuItem
                                onSelect={() => onSetCalendarItemsCompleted(
                                  { eventIds: [event.id], sessionIds: [] },
                                  !event.isFinished,
                                )}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                {event.isFinished ? "Mark current" : "Mark complete"}
                              </CtxMenuItem>
                            )}
                            <CtxMenuSep />
                            <CtxMenuItem
                              variant="destructive"
                              onSelect={() => onDeleteCalendarItems?.({ eventIds: [event.id], sessionIds: [] })}
                            >
                              <Trash2 className="h-4 w-4" />
                              Delete
                            </CtxMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                      );
                    })}
                    {allItems.length === 0 &&
                      dayMultiDayEvents.length === 0 && (
                        <div className="flex flex-col items-center gap-1.5 px-1.5 py-3">
                          <CalendarDays
                            className="h-8 w-8 text-muted-foreground/25"
                            aria-hidden="true"
                          />
                          <p className="text-caption text-muted-foreground/50">
                            No items
                          </p>
                        </div>
                      )}
                  </div>
                </div>
                  </ContextMenuTrigger>
                  <ContextMenuContent className="w-40">
                    <CtxMenuItem onSelect={() => onNewEvent(date)}>
                      <Plus className="h-4 w-4" />
                      New event
                    </CtxMenuItem>
                  </ContextMenuContent>
                </ContextMenu>
              );
            })}
          </div>
        </div>
      )}

      {/* Drag ghost portal — rendered outside the calendar DOM so it can roam freely */}
      {createPortal(
        <AnimatePresence>{dragGhost}</AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
