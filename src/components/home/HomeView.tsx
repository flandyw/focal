import {
  useState,
  useCallback,
  useEffect,
  useMemo,
  memo,
  Fragment,
} from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import {
  Clock,
  MapPin,
  Trash2,
  X,
  CheckCircle2,
  Combine,
  Check,
  Wand2,
  ArrowRight,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Pin,
  Settings2,
  Sparkles,
} from "lucide-react";
import {
  getDayLabelForDate,
  getTimetableEntriesForDay,
  getCurrentPeriodInfo,
} from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  getSubjectById,
  getSessionEffectiveMinutes,
  cn,
  getLocalDateValue,
  formatTime12,
} from "@/lib/utils";
import { TextEventPlanner } from "@/components/planning/TextEventPlanner";
import { buildTodayOverview } from "@/features/home/todayOverview";
import { shiftCalendarPeriod } from "@/lib/calendarNavigation";
import {
  FOCUS_PRIORITIES_KEY,
  getPriorityItems,
  readFocusPriorities,
} from "@/lib/studyPriority";
import type { TimetableConfig } from "@/lib/settings";
import type {
  CalendarEvent,
  PriorityItem,
  Project,
  StudySession,
  StudySessionDraft,
} from "@/lib/types";
import { CalendarGrid } from "@/components/home/CalendarGrid";
import { DayDetail } from "@/components/home/DayDetail";
import { QuickLinks } from "@/components/home/QuickLinks";
import { StudyPriorities } from "@/components/home/StudyPriorities";

interface HomeViewProps {
  projects: Project[];
  sessions: StudySession[];
  events: CalendarEvent[];
  onSelectProject: (projectId: string) => void;
  onSelectSession: (session: StudySession) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onNewSession: (initialDate?: Date) => void;
  onNewEvent: (initialDate?: Date) => void;
  onNewProject: () => void;
  onCreateEvents: (
    events: Omit<CalendarEvent, "id" | "created_at">[],
  ) => Promise<void>;
  onCreateStudySessions: (sessions: StudySessionDraft[]) => Promise<void>;
  onDeleteCalendarItems: (itemIds: {
    eventIds: string[];
    sessionIds: string[];
  }) => Promise<void>;
  onSetCalendarItemsCompleted: (
    itemIds: { eventIds: string[]; sessionIds: string[] },
    isCompleted: boolean,
  ) => Promise<void>;
  onMergeEvents: (ids: string[]) => Promise<void>;
  onMergeStudySessions: (ids: string[]) => Promise<void>;
  onGoTimetable: () => void;
  timetableConfig: TimetableConfig | null;
  onMoveEvent?: (
    eventId: string,
    newStartTime: string,
    newEndTime?: string,
  ) => void;
  onOpenAiAssistant?: () => void;
  onStartFocus: (item: PriorityItem) => void;
}

const STUDY_NEXT_EXPANDED_KEY = "focal-study-next-expanded";

function readStudyNextExpanded() {
  try {
    return localStorage.getItem(STUDY_NEXT_EXPANDED_KEY) !== "false";
  } catch {
    return true;
  }
}

export const HomeView = memo(function HomeView({
  projects,
  sessions,
  events,
  onSelectProject,
  onSelectSession,
  onSelectEvent,
  onNewSession,
  onNewEvent,
  onNewProject: _onNewProject,
  onCreateEvents,
  onCreateStudySessions,
  onDeleteCalendarItems,
  onSetCalendarItemsCompleted,
  onMergeEvents,
  onMergeStudySessions,
  onGoTimetable,
  onMoveEvent,
  timetableConfig,
  onOpenAiAssistant,
  onStartFocus,
}: HomeViewProps) {
  const [clockNow, setClockNow] = useState(() => new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getLocalDateValue(new Date()),
  );
  const [calendarView, setCalendarView] = useState<"month" | "week">("month");
  const [calendarSelectionMode, setCalendarSelectionMode] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [eventBatchSaving, setEventBatchSaving] = useState(false);
  const [textPlannerOpen, setTextPlannerOpen] = useState(false);
  const [textPlannerTitle, setTextPlannerTitle] = useState("Text to Events");
  const [textPlannerDescription, setTextPlannerDescription] = useState(
    "Paste a notice, rough plan, or teacher message. Review drafts before adding them.",
  );
  const [textPlannerInitialText, setTextPlannerInitialText] = useState("");
  const [focusPriorities, setFocusPriorities] = useState(readFocusPriorities);
  const [studyNextExpanded, setStudyNextExpanded] = useState(readStudyNextExpanded);

  useEffect(() => {
    const refreshNow = () => setClockNow(new Date());
    const timer = window.setInterval(refreshNow, 60_000);
    window.addEventListener("focus", refreshNow);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshNow);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(FOCUS_PRIORITIES_KEY, JSON.stringify(focusPriorities));
  }, [focusPriorities]);

  useEffect(() => {
    try {
      localStorage.setItem(STUDY_NEXT_EXPANDED_KEY, String(studyNextExpanded));
    } catch {
      // The section still works when browser storage is unavailable.
    }
  }, [studyNextExpanded]);

  const selectedCalendarDate = selectedDate
    ? parseISO(selectedDate)
    : undefined;

  const {
    activeProjects,
    overdueProjects,
    dueThisWeek,
    planningSubjects,
    upcomingEvents,
    deadlinesByDate,
    sessionsByDate,
    eventsByDate,
    now,
  } = useMemo(
    () => buildTodayOverview(projects, sessions, events, clockNow),
    [clockNow, events, projects, sessions],
  );

  const prioritySubjectIds = useMemo(() => {
    const ids = new Set<string>();
    activeProjects.forEach((project) => {
      if (project.subjectId) ids.add(project.subjectId);
    });
    events.forEach((event) => {
      if (!event.isFinished && event.subjectId) ids.add(event.subjectId);
    });
    return ids;
  }, [activeProjects, events]);
  const prioritySubjects = useMemo(
    () => planningSubjects.filter((subject) => prioritySubjectIds.has(subject.id)),
    [planningSubjects, prioritySubjectIds],
  );
  const effectiveSubjectOrder = useMemo(() => {
    const available = new Set(prioritySubjects.map((subject) => subject.id));
    const saved = focusPriorities.subjectOrder.filter((subjectId) => available.has(subjectId));
    return [
      ...saved,
      ...prioritySubjects.map((subject) => subject.id).filter((subjectId) => !saved.includes(subjectId)),
    ];
  }, [focusPriorities.subjectOrder, prioritySubjects]);
  const priorityItems = useMemo(
    () => getPriorityItems({
      projects,
      sessions,
      events,
      now: now.getTime(),
      subjectOrder: effectiveSubjectOrder,
      pinnedEventIds: focusPriorities.pinnedEventIds,
    }),
    [effectiveSubjectOrder, events, focusPriorities.pinnedEventIds, now, projects, sessions],
  );
  const pinnableEvents = useMemo(() => {
    const cutoff = now.getTime() + 30 * 24 * 60 * 60 * 1000;
    return events
      .filter((event) => {
        const start = parseISO(event.startTime).getTime();
        return !event.isFinished && start >= now.getTime() && start <= cutoff;
      })
      .sort((a, b) => parseISO(a.startTime).getTime() - parseISO(b.startTime).getTime())
      .slice(0, 8);
  }, [events, now]);

  const movePrioritySubject = (subjectId: string, direction: -1 | 1) => {
    const index = effectiveSubjectOrder.indexOf(subjectId);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= effectiveSubjectOrder.length) return;
    const next = [...effectiveSubjectOrder];
    [next[index], next[target]] = [next[target], next[index]];
    setFocusPriorities((current) => ({ ...current, subjectOrder: next }));
  };

  const togglePinnedEvent = (eventId: string) => {
    setFocusPriorities((current) => ({
      ...current,
      pinnedEventIds: current.pinnedEventIds.includes(eventId)
        ? current.pinnedEventIds.filter((id) => id !== eventId)
        : [...current.pinnedEventIds, eventId],
    }));
  };

  const selectedEventIdSet = useMemo(
    () => new Set(selectedEventIds),
    [selectedEventIds],
  );
  const selectedSessionIdSet = useMemo(
    () => new Set(selectedSessionIds),
    [selectedSessionIds],
  );
  const selectedDayDeadlines = selectedDate
    ? (deadlinesByDate[selectedDate] ?? [])
    : [];
  const selectedDaySessions = selectedDate
    ? (sessionsByDate[selectedDate] ?? [])
    : [];
  const selectedDayEvents = selectedDate
    ? (eventsByDate[selectedDate] ?? [])
    : [];
  const todayDateKey = getLocalDateValue(now);
  const headingDateKey = selectedDate ?? todayDateKey;
  const headingDate = parseISO(headingDateKey);
  const selectedStudyHours = (sessionsByDate[headingDateKey] ?? [])
    .filter((session) => session.status === "completed")
    .reduce((total, session) => total + getSessionEffectiveMinutes(session), 0) / 60;
  const selectedBatchEvents = selectedDayEvents.filter((event) =>
    selectedEventIdSet.has(event.id),
  );
  const selectedBatchSessions = selectedDaySessions.filter((session) =>
    selectedSessionIdSet.has(session.id),
  );
  const selectedBatchCount =
    selectedBatchEvents.length + selectedBatchSessions.length;
  const canMergeSelectedEvents =
    selectedBatchEvents.length >= 2 && selectedBatchSessions.length === 0;
  const canMergeSelectedSessions =
    selectedBatchSessions.length >= 2 && selectedBatchEvents.length === 0;
  const canMergeSelectedItems =
    canMergeSelectedEvents || canMergeSelectedSessions;
  const allSelectedItemsComplete =
    selectedBatchCount > 0 &&
    selectedBatchEvents.every((event) => event.isFinished) &&
    selectedBatchSessions.every((session) => session.status === "completed");

  const clearEventSelection = () => {
    setCalendarSelectionMode(false);
    setSelectedEventIds([]);
    setSelectedSessionIds([]);
  };

  const handleSelectCalendarDate = (dateKey: string) => {
    setSelectedDate(dateKey);
    setCurrentMonth(parseISO(dateKey));
    clearEventSelection();
  };

  const handleSetCalendarView = (view: "month" | "week") => {
    if (selectedDate) setCurrentMonth(parseISO(selectedDate));
    setCalendarView(view);
  };

  const handleToggleEventSelection = (eventId: string) => {
    setSelectedEventIds((current) =>
      current.includes(eventId)
        ? current.filter((id) => id !== eventId)
        : [...current, eventId],
    );
  };

  const handleToggleSessionSelection = (sessionId: string) => {
    setSelectedSessionIds((current) =>
      current.includes(sessionId)
        ? current.filter((id) => id !== sessionId)
        : [...current, sessionId],
    );
  };

  const handleSelectAllCalendarItems = () => {
    if (selectedBatchCount === selectedDayEvents.length + selectedDaySessions.length) {
      setSelectedEventIds([]);
      setSelectedSessionIds([]);
      return;
    }
    setSelectedEventIds(selectedDayEvents.map((event) => event.id));
    setSelectedSessionIds(selectedDaySessions.map((session) => session.id));
  };

  const handleDeleteSelectedEvents = async () => {
    if (selectedBatchCount === 0) return;
    setEventBatchSaving(true);
    try {
      const eventIds = selectedBatchEvents.map((event) => event.id);
      const sessionIds = selectedBatchSessions.map((session) => session.id);
      await onDeleteCalendarItems({ eventIds, sessionIds });
      clearEventSelection();
    } finally {
      setEventBatchSaving(false);
    }
  };

  const handleMergeSelectedEvents = async () => {
    if (!canMergeSelectedItems) return;
    setEventBatchSaving(true);
    try {
      if (canMergeSelectedEvents) {
        await onMergeEvents(selectedBatchEvents.map((event) => event.id));
      } else if (canMergeSelectedSessions) {
        await onMergeStudySessions(
          selectedBatchSessions.map((session) => session.id),
        );
      }
      clearEventSelection();
    } finally {
      setEventBatchSaving(false);
    }
  };

  const handleToggleSelectedEventsComplete = async () => {
    if (selectedBatchCount === 0) return;
    setEventBatchSaving(true);
    try {
      const eventIds = selectedBatchEvents.map((event) => event.id);
      const sessionIds = selectedBatchSessions.map((session) => session.id);
      const nextComplete = !allSelectedItemsComplete;
      await onSetCalendarItemsCompleted({ eventIds, sessionIds }, nextComplete);
      clearEventSelection();
    } finally {
      setEventBatchSaving(false);
    }
  };

  const handlePrevPeriod = () =>
    setCurrentMonth((prev) => shiftCalendarPeriod(prev, calendarView, -1));
  const handleNextPeriod = () =>
    setCurrentMonth((prev) => shiftCalendarPeriod(prev, calendarView, 1));
  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(getLocalDateValue(today));
  };

  const handleOpenTextPlanner = useCallback(() => {
    setTextPlannerTitle("Text to Events");
    setTextPlannerDescription(
      "Paste a notice, rough plan, or teacher message. Review drafts before adding them.",
    );

    setTextPlannerInitialText("");
    setTextPlannerOpen(true);
  }, []);

  const handlePrioritySelect = (item: PriorityItem) => {
    if (item.sessionId) {
      const session = sessions.find(
        (candidate) => candidate.id === item.sessionId,
      );
      if (session) {
        onSelectSession(session);
        return;
      }
    }
    if (item.eventId) {
      const event = events.find((candidate) => candidate.id === item.eventId);
      if (event) {
        onSelectEvent(event);
        return;
      }
    }
    if (item.projectId) {
      onSelectProject(item.projectId);
      return;
    }
    onNewSession(selectedCalendarDate);
  };

  const eventBatchToolbar =
    selectedBatchCount > 0
      ? createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 min-[900px]:px-4">
            <div className="pointer-events-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 rounded-t-lg border border-b-0 bg-popover px-3 py-2 text-popover-foreground shadow-md">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <Check className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <p className="truncate text-xs font-semibold">
                    Calendar selection
                  </p>
                  <p className="text-sm text-muted-foreground tabular-nums" aria-live="polite">
                    {eventBatchSaving ? (
                      "Saving changes…"
                    ) : (
                      <>
                        {selectedBatchCount} selected from{" "}
                        {selectedDate
                          ? format(parseISO(selectedDate), "MMM d")
                          : "calendar"}
                        {selectedBatchSessions.length > 0 &&
                        selectedBatchEvents.length > 0
                          ? ` (${selectedBatchEvents.length} events, ${selectedBatchSessions.length} sessions)`
                          : ""}
                      </>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-end gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 rounded-md px-2.5 text-xs"
                  onClick={clearEventSelection}
                  disabled={eventBatchSaving}
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
                {canMergeSelectedItems && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-8 gap-1.5 rounded-md px-2.5 text-xs"
                    onClick={handleMergeSelectedEvents}
                    disabled={eventBatchSaving}
                  >
                    <Combine className="h-3.5 w-3.5" />
                    Merge
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  className="h-8 gap-1.5 rounded-md px-2.5 text-xs"
                  onClick={handleDeleteSelectedEvents}
                  disabled={eventBatchSaving}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Delete
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="h-8 gap-1.5 rounded-md px-2.5 text-xs"
                  onClick={handleToggleSelectedEventsComplete}
                  disabled={eventBatchSaving}
                >
                  {allSelectedItemsComplete ? (
                    <X className="h-3.5 w-3.5" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  {allSelectedItemsComplete ? "Reopen" : "Complete"}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <ScrollArea className="h-full">
        <div
          className={cn(
            "px-4 pt-4 min-[1200px]:px-6 min-[1200px]:pt-5",
            selectedBatchCount > 0
              ? "pb-24 min-[1200px]:pb-24"
              : "pb-6 min-[1200px]:pb-8",
          )}
        >
          <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border/70 pb-5">
            <div className="min-w-0">
              <p className="mb-1 text-xs font-medium text-foreground/60 tabular-nums">
                {format(headingDate, "EEEE · d MMMM")}
              </p>
              <h1 className="text-xl font-semibold tracking-tight">
                {headingDateKey === todayDateKey
                  ? "Today"
                  : format(headingDate, "d MMMM")}
              </h1>
              {(() => {
                const meta: [string, ReactNode][] = [];
                if (selectedStudyHours > 0)
                  meta.push([
                    "studied",
                    <span className="font-medium text-foreground/80 tabular-nums">
                      {selectedStudyHours.toFixed(1)}h studied
                    </span>,
                  ]);
                if (overdueProjects.length > 0)
                  meta.push([
                    "overdue",
                    <span className="font-medium text-destructive">
                      {overdueProjects.length} overdue
                    </span>,
                  ]);
                if (dueThisWeek.length > 0)
                  meta.push([
                    "due",
                    <span>{dueThisWeek.length} due this week</span>,
                  ]);
                if (upcomingEvents.length > 0)
                  meta.push([
                    "events",
                    <span>
                      {upcomingEvents.length} event
                      {upcomingEvents.length !== 1 ? "s" : ""} this week
                    </span>,
                  ]);
                return (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {meta.length > 0 ? (
                      meta.map(([key, part], i) => (
                        <Fragment key={key}>
                          {i > 0 && (
                            <span className="text-muted-foreground/40">
                              {" · "}
                            </span>
                          )}
                          {part}
                        </Fragment>
                      ))
                    ) : (
                      <span>No urgent deadlines. Keep the workspace tidy.</span>
                    )}
                  </p>
                );
              })()}
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="text-muted-foreground">
                  <Sparkles />
                  Tools
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {onOpenAiAssistant && (
                  <DropdownMenuItem onSelect={onOpenAiAssistant}>
                    <Sparkles />
                    AI Assistant
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onSelect={handleOpenTextPlanner}>
                  <Wand2 />
                  Text to events
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <section aria-labelledby="study-next-heading" className={studyNextExpanded ? "mb-7" : "mb-5"}>
            <div className={cn("flex flex-wrap items-end justify-between gap-3", studyNextExpanded && "mb-3")}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
                  Study
                </p>
                <div className="mt-1 flex items-center gap-1">
                  <h2
                    id="study-next-heading"
                    className="text-lg font-semibold tracking-tight"
                  >
                    Study next
                  </h2>
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="text-muted-foreground"
                    onClick={() => setStudyNextExpanded((expanded) => !expanded)}
                    aria-label={`${studyNextExpanded ? "Collapse" : "Expand"} Study next`}
                    aria-controls="study-next-content"
                    aria-expanded={studyNextExpanded}
                    title={`${studyNextExpanded ? "Collapse" : "Expand"} Study next`}
                  >
                    <ChevronDown className={cn("transition-transform motion-reduce:transition-none", !studyNextExpanded && "-rotate-90")} />
                  </Button>
                </div>
                {studyNextExpanded && (
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    Start the highest-impact work now; tune the queue when priorities change.
                  </p>
                )}
              </div>
              {studyNextExpanded && <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Settings2 />
                    Tune queue
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[min(26rem,calc(100vw-2rem))] p-3">
                  <PopoverHeader>
                    <PopoverTitle>Focus priorities</PopoverTitle>
                    <PopoverDescription>
                      Ranked subjects and pinned events influence the next-focus queue; urgent work still stays visible.
                    </PopoverDescription>
                  </PopoverHeader>
                  <div className="mt-2 space-y-4">
                    <section aria-labelledby="priority-subjects-heading">
                      <h3 id="priority-subjects-heading" className="mb-2 text-sm font-semibold">
                        Subjects
                      </h3>
                      {effectiveSubjectOrder.length > 0 ? (
                        <div className="space-y-1">
                          {effectiveSubjectOrder.map((subjectId, index) => {
                            const subject = prioritySubjects.find((item) => item.id === subjectId);
                            if (!subject) return null;
                            return (
                              <div key={subjectId} className="flex items-center gap-2 rounded-md border px-2 py-1.5">
                                <span className="w-5 text-center text-sm font-semibold tabular-nums text-muted-foreground">
                                  {index + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate text-sm">{subject.name}</span>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={index === 0}
                                  onClick={() => movePrioritySubject(subjectId, -1)}
                                  aria-label={`Move ${subject.name} up`}
                                >
                                  <ArrowUp />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={index === effectiveSubjectOrder.length - 1}
                                  onClick={() => movePrioritySubject(subjectId, 1)}
                                  aria-label={`Move ${subject.name} down`}
                                >
                                  <ArrowDown />
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No active subjects yet.</p>
                      )}
                    </section>
                    <section aria-labelledby="priority-events-heading">
                      <h3 id="priority-events-heading" className="mb-2 flex items-center gap-2 text-sm font-semibold">
                        <Pin className="size-4" />
                        Pinned events
                      </h3>
                      {pinnableEvents.length > 0 ? (
                        <div className="max-h-48 space-y-1 overflow-y-auto pr-1">
                          {pinnableEvents.map((event) => {
                            const checked = focusPriorities.pinnedEventIds.includes(event.id);
                            return (
                              <label key={event.id} className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover:bg-accent">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={() => togglePinnedEvent(event.id)}
                                  aria-label={`Prioritise ${event.title}`}
                                  className="mt-0.5"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{event.title}</span>
                                  <span className="block text-sm text-muted-foreground">
                                    {format(parseISO(event.startTime), "EEE d MMM")}
                                  </span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground">No events in the next 30 days.</p>
                      )}
                    </section>
                  </div>
                </PopoverContent>
              </Popover>}
            </div>
            <div id="study-next-content" hidden={!studyNextExpanded}>
              <StudyPriorities
                items={priorityItems}
                onSelectItem={handlePrioritySelect}
                onStartItem={onStartFocus}
                onPlanSession={() => onNewSession(selectedCalendarDate)}
              />
            </div>
          </section>

          <section
            aria-labelledby="planning-heading"
            className="border-t border-border/70 pt-5"
          >
            <div className="mb-4">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Planning
              </p>
              <h2
                id="planning-heading"
                className="mt-1 text-lg font-semibold tracking-tight"
              >
                Calendar and day plan
              </h2>
              <p className="mt-0.5 text-sm text-muted-foreground">
                Make time for the queue, then coordinate everything around it.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-x-7 gap-y-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(18rem,0.85fr)]">
              <div className="min-w-0">
                <div className="flex h-full flex-col gap-4">
                <CalendarGrid
                  currentMonth={currentMonth}
                  calendarView={calendarView}
                  selectedDate={selectedDate}
                  deadlinesByDate={deadlinesByDate}
                  sessionsByDate={sessionsByDate}
                  eventsByDate={eventsByDate}
                  events={events}
                  projects={projects}
                  onMoveEvent={onMoveEvent}
                  onSetCalendarView={handleSetCalendarView}
                  onPrevPeriod={handlePrevPeriod}
                  onNextPeriod={handleNextPeriod}
                  onToday={handleToday}
                  onSelectDate={handleSelectCalendarDate}
                  onSelectProject={onSelectProject}
                  onSelectSession={onSelectSession}
                  onSelectEvent={onSelectEvent}
                  onNewEvent={onNewEvent}
                  onDeleteCalendarItems={onDeleteCalendarItems}
                  onSetCalendarItemsCompleted={onSetCalendarItemsCompleted}
                />

                </div>
              </div>

            <div className="space-y-6">
              <QuickLinks />

              {selectedDate && (
                <DayDetail
                  selectedDate={selectedDate}
                  deadlines={selectedDayDeadlines}
                  sessions={selectedDaySessions}
                  events={events}
                  projects={projects}
                  calendarSelectionMode={calendarSelectionMode}
                  selectedEventIdSet={selectedEventIdSet}
                  selectedSessionIdSet={selectedSessionIdSet}
                  onClose={() => {
                    setSelectedDate(null);
                    clearEventSelection();
                  }}
                  onToggleSelectionMode={() => setCalendarSelectionMode(true)}
                  onClearSelection={clearEventSelection}
                  onSelectAll={handleSelectAllCalendarItems}
                  allSelected={
                    selectedBatchCount > 0 &&
                    selectedBatchCount ===
                      selectedDayEvents.length + selectedDaySessions.length
                  }
                  onToggleEventSelection={handleToggleEventSelection}
                  onToggleSessionSelection={handleToggleSessionSelection}
                  onSelectProject={onSelectProject}
                  onSelectSession={onSelectSession}
                  onSelectEvent={onSelectEvent}
                  onNewEvent={() => onNewEvent(selectedCalendarDate)}
                  onNewSession={() => onNewSession(selectedCalendarDate)}
                  onDeleteCalendarItems={onDeleteCalendarItems}
                  onSetCalendarItemsCompleted={onSetCalendarItemsCompleted}
                />
              )}

              {timetableConfig?.enabled &&
                (() => {
                  const dayLabel = getDayLabelForDate(
                    now,
                    timetableConfig.day1Starts,
                    timetableConfig.holidays,
                  );
                  if (dayLabel === null) return null;
                  const entries = getTimetableEntriesForDay(
                    dayLabel,
                    timetableConfig.entries,
                  );
                  if (entries.length === 0) return null;
                  const periods = entries
                    .flatMap((e) => e.periods)
                    .sort((a, b) => a.startTime.localeCompare(b.startTime));
                  const periodInfo = getCurrentPeriodInfo(periods, now);
                  return (
                    <section className="border-t border-border/70 pt-4">
                      <h3 className="mb-2.5 flex items-center gap-1.5 text-sm font-semibold">
                        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                        Today&apos;s Timetable · Day {dayLabel}
                        <Button
                          onClick={onGoTimetable}
                          variant="link"
                          size="xs"
                          className="ml-auto text-muted-foreground"
                        >
                          View timetable
                          <ArrowRight />
                        </Button>
                      </h3>
                      <div className="divide-y divide-border/50 border-y border-border/60">
                        {periods.map((period, idx) => {
                          const subject = getSubjectById(period.subject);
                          const isCurrent =
                            periodInfo.current?.startTime ===
                              period.startTime &&
                            periodInfo.current?.subject === period.subject;
                          const isNext =
                            periodInfo.next?.startTime === period.startTime &&
                            periodInfo.next?.subject === period.subject;
                          return (
                            <div
                              key={idx}
                              className={cn(
                                "relative flex items-center gap-2 px-2.5 py-2",
                                isCurrent
                                  ? "bg-primary/10"
                                  : "bg-transparent",
                              )}
                            >
                              {/* Subject color accent bar */}
                              {subject && (
                                <div
                                  className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full"
                                  style={{ backgroundColor: subject.color }}
                                />
                              )}

                              {/* Current period pulsing dot */}
                              {isCurrent && (
                                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary motion-safe:animate-pulse" />
                              )}

                              {/* Time */}
                              <span className="w-14 shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                                {formatTime12(period.startTime)}
                              </span>

                              {/* Subject name */}
                              <span
                                className="min-w-0 truncate text-xs"
                                style={{ color: subject?.color }}
                              >
                                {subject ? subject.name : period.subject}
                              </span>

                              {/* End time or Up next badge */}
                              <span className="ml-auto shrink-0 text-xs tabular-nums">
                                {isNext && !isCurrent ? (
                                  <span className="rounded border border-foreground/10 bg-foreground/[0.06] px-1.5 py-0.5 text-xs font-medium text-foreground/80">
                                    Up next
                                  </span>
                                ) : (
                                  <span className="text-muted-foreground/70">
                                    {formatTime12(period.endTime)}
                                  </span>
                                )}
                              </span>

                              {/* Location */}
                              {period.location && (
                                <span className="hidden shrink-0 items-center gap-0.5 truncate text-xs text-muted-foreground/70 sm:flex">
                                  <MapPin className="h-2.5 w-2.5" />
                                  {period.location}
                                </span>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Next period countdown */}
                      {periodInfo.current &&
                        periodInfo.remainingMinutes > 0 && (
                          <div className="mt-2 flex items-center gap-2 rounded-md bg-primary/10 px-2.5 py-1.5">
                            <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                            <span className="text-xs text-muted-foreground">
                              {periodInfo.next ? (
                                <>
                                  <span className="font-medium text-foreground">
                                    {periodInfo.remainingMinutes}m
                                  </span>{" "}
                                  remaining —{" "}
                                  <span className="text-muted-foreground">
                                    {getSubjectById(periodInfo.next.subject)
                                      ?.name ?? periodInfo.next.subject}
                                  </span>{" "}
                                  at{" "}
                                  <span className="tabular-nums">
                                    {formatTime12(periodInfo.next.startTime)}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <span className="font-medium text-foreground">
                                    {periodInfo.remainingMinutes}m
                                  </span>{" "}
                                  remaining
                                </>
                              )}
                            </span>
                          </div>
                        )}
                    </section>
                  );
                })()}

              </div>
            </div>
          </section>
        </div>
      </ScrollArea>

      <TextEventPlanner
        key={textPlannerOpen ? "planner-open" : "planner-closed"}
        open={textPlannerOpen}
        onOpenChange={setTextPlannerOpen}
        title={textPlannerTitle}
        description={textPlannerDescription}
        initialText={textPlannerInitialText}
        projects={projects}
        planningSubjects={planningSubjects}
        onCreateEvents={onCreateEvents}
        onCreateStudySessions={onCreateStudySessions}
      />

      {eventBatchToolbar}
    </>
  );
});
