import { useState, useEffect, useMemo, memo } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { format, parseISO } from "date-fns";
import {
  MapPin,
  Trash2,
  X,
  CheckCircle2,
  Combine,
  Wand2,
  ClipboardPaste,
  ArrowRight,
  Plus,
  Sparkles,
} from "lucide-react";
import {
  getDayLabelForDate,
  getTimetableEntriesForDay,
  getCurrentPeriodInfo,
} from "@/lib/timetable";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import type { TimetableConfig } from "@/lib/settings";
import type {
  CalendarEvent,
  Project,
  StudySession,
  StudySessionDraft,
} from "@/lib/types";
import { CalendarGrid } from "@/components/home/CalendarGrid";
import { DayDetail } from "@/components/home/DayDetail";
import { QuickLinks } from "@/components/home/QuickLinks";

interface HomeViewProps {
  projects: Project[];
  sessions: StudySession[];
  events: CalendarEvent[];
  onSelectProject: (projectId: string) => void;
  onSelectSession: (session: StudySession) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onConvertToSession?: (event: CalendarEvent) => void;
  onNewSession: (initialDate?: Date) => void;
  onNewEvent: (initialDate?: Date) => void;
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
}

const CALENDAR_VIEW_KEY = "focal-calendar-view";

function readCalendarView(): "month" | "week" {
  try {
    return localStorage.getItem(CALENDAR_VIEW_KEY) === "week" ? "week" : "month";
  } catch {
    return "month";
  }
}

function formatHours(minutes: number) {
  return minutes < 60 ? `${Math.round(minutes)}m` : `${(minutes / 60).toFixed(1)}h`;
}

function formatDaysUntil(deadline: string, now: Date) {
  const days = Math.round(
    (parseISO(format(parseISO(deadline), "yyyy-MM-dd")).getTime() -
      parseISO(getLocalDateValue(now)).getTime()) /
      86_400_000,
  );
  if (days < 0) return `${-days}d late`;
  if (days === 0) return "Today";
  if (days === 1) return "Tmrw";
  return format(parseISO(deadline), "EEE d");
}

function Stat({ label, value, tone }: { label: string; value: string | number; tone?: "danger" }) {
  const empty = value === 0 || value === "0m";
  return (
    <div className="flex items-baseline gap-1.5">
      <dt className="order-2 text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "order-1 text-sm font-semibold tabular-nums",
          empty ? "text-muted-foreground" : tone === "danger" ? "text-destructive" : "text-foreground",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

function RailHeading({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-1.5 flex h-7 items-center justify-between gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {children}
      </h2>
      {action}
    </div>
  );
}

export const HomeView = memo(function HomeView({
  projects,
  sessions,
  events,
  onSelectProject,
  onSelectSession,
  onSelectEvent,
  onConvertToSession,
  onNewSession,
  onNewEvent,
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
}: HomeViewProps) {
  const [clockNow, setClockNow] = useState(() => new Date());
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(() =>
    getLocalDateValue(new Date()),
  );
  const [calendarView, setCalendarView] = useState<"month" | "week">(readCalendarView);
  const [calendarSelectionMode, setCalendarSelectionMode] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [eventBatchSaving, setEventBatchSaving] = useState(false);
  const [textPlannerOpen, setTextPlannerOpen] = useState(false);
  const [plannerMode, setPlannerMode] = useState<"ai" | "chatbot">("ai");

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
    try {
      localStorage.setItem(CALENDAR_VIEW_KEY, calendarView);
    } catch {
      // The chosen view remains available for this session.
    }
  }, [calendarView]);

  useEffect(() => {
    if (!calendarSelectionMode) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setCalendarSelectionMode(false);
      setSelectedEventIds([]);
      setSelectedSessionIds([]);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [calendarSelectionMode]);

  const selectedCalendarDate = selectedDate
    ? parseISO(selectedDate)
    : undefined;

  const {
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

  const deadlines = useMemo(
    () =>
      [...overdueProjects, ...dueThisWeek].sort(
        (a, b) => parseISO(a.deadline!).getTime() - parseISO(b.deadline!).getTime(),
      ),
    [overdueProjects, dueThisWeek],
  );

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
  const isHeadingToday = headingDateKey === todayDateKey;
  const studiedMinutes = (sessionsByDate[headingDateKey] ?? [])
    .filter((session) => session.execution.state === "completed")
    .reduce((total, session) => total + getSessionEffectiveMinutes(session), 0);
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
    selectedBatchSessions.every((session) => session.execution.state === "completed");

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

  const runBatch = async (action: () => Promise<void>) => {
    if (selectedBatchCount === 0) return;
    setEventBatchSaving(true);
    try {
      await action();
      clearEventSelection();
    } finally {
      setEventBatchSaving(false);
    }
  };
  const batchIds = () => ({
    eventIds: selectedBatchEvents.map((event) => event.id),
    sessionIds: selectedBatchSessions.map((session) => session.id),
  });

  const handlePrevPeriod = () =>
    setCurrentMonth((prev) => shiftCalendarPeriod(prev, calendarView, -1));
  const handleNextPeriod = () =>
    setCurrentMonth((prev) => shiftCalendarPeriod(prev, calendarView, 1));
  const handleToday = () => {
    const today = new Date();
    setCurrentMonth(today);
    setSelectedDate(getLocalDateValue(today));
  };

  const timetable = (() => {
    if (!timetableConfig?.enabled) return null;
    const dayLabel = getDayLabelForDate(
      now,
      timetableConfig.day1Starts,
      timetableConfig.holidays,
    );
    if (dayLabel === null) return null;
    const periods = getTimetableEntriesForDay(dayLabel, timetableConfig.entries)
      .flatMap((e) => e.periods)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (periods.length === 0) return null;
    return { dayLabel, periods, info: getCurrentPeriodInfo(periods, now) };
  })();

  const eventBatchToolbar =
    selectedBatchCount > 0
      ? createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-2 min-[900px]:px-4">
            <div
              role="toolbar"
              aria-label="Selected calendar items"
              className="pointer-events-auto flex w-full max-w-2xl flex-wrap items-center justify-between gap-2 rounded-t-lg border border-b-0 bg-popover px-3 py-2 text-popover-foreground shadow-md"
            >
              <p className="text-sm tabular-nums" aria-live="polite">
                {eventBatchSaving ? (
                  "Saving…"
                ) : (
                  <>
                    <span className="font-semibold">{selectedBatchCount} selected</span>
                    <span className="text-muted-foreground">
                      {" · "}
                      {selectedDate ? format(parseISO(selectedDate), "EEE d MMM") : "calendar"}
                    </span>
                  </>
                )}
              </p>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button variant="ghost" size="sm" onClick={clearEventSelection} disabled={eventBatchSaving}>
                  <X />
                  Cancel
                </Button>
                {canMergeSelectedItems && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={eventBatchSaving}
                    onClick={() =>
                      runBatch(() =>
                        canMergeSelectedEvents
                          ? onMergeEvents(batchIds().eventIds)
                          : onMergeStudySessions(batchIds().sessionIds),
                      )
                    }
                  >
                    <Combine />
                    Merge
                  </Button>
                )}
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={eventBatchSaving}
                  onClick={() => runBatch(() => onDeleteCalendarItems(batchIds()))}
                >
                  <Trash2 />
                  Delete
                </Button>
                <Button
                  size="sm"
                  disabled={eventBatchSaving}
                  onClick={() =>
                    runBatch(() =>
                      onSetCalendarItemsCompleted(batchIds(), !allSelectedItemsComplete),
                    )
                  }
                >
                  {allSelectedItemsComplete ? <X /> : <CheckCircle2 />}
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
            "px-4 pt-3 min-[1200px]:px-6",
            selectedBatchCount > 0 ? "pb-24" : "pb-6",
          )}
        >
          <header className="mb-4 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border/70 pb-3">
            <h1 className="flex items-baseline gap-2 text-lg font-semibold tracking-tight">
              {isHeadingToday ? "Today" : format(headingDate, "EEEE")}
              <span className="text-sm font-normal text-muted-foreground tabular-nums">
                {format(headingDate, isHeadingToday ? "EEE d MMM" : "d MMM yyyy")}
              </span>
            </h1>
            <dl className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
              <Stat label="studied" value={formatHours(studiedMinutes)} />
              <Stat label="overdue" value={overdueProjects.length} tone="danger" />
              <Stat label="due in 7d" value={dueThisWeek.length} />
              <Stat label="events in 7d" value={upcomingEvents.length} />
            </dl>
            <div className="ml-auto flex items-center gap-1.5">
              <Button variant="outline" size="sm" onClick={() => onNewSession(selectedCalendarDate)}>
                <Plus />
                Session
              </Button>
              <Button size="sm" onClick={() => onNewEvent(selectedCalendarDate)}>
                <Plus />
                Event
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Tools">
                    <Sparkles />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {onOpenAiAssistant && (
                    <DropdownMenuItem onSelect={onOpenAiAssistant}>
                      <Sparkles />
                      AI Assistant
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem onSelect={() => { setPlannerMode("ai"); setTextPlannerOpen(true); }}>
                    <Wand2 />
                    Text to events
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => { setPlannerMode("chatbot"); setTextPlannerOpen(true); }}>
                    <ClipboardPaste />
                    Import from chatbot
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </header>

          <div className="grid grid-cols-1 gap-x-6 gap-y-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="min-w-0">
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
                onConvertToSession={onConvertToSession}
                onNewEvent={onNewEvent}
                onDeleteCalendarItems={onDeleteCalendarItems}
                onSetCalendarItemsCompleted={onSetCalendarItemsCompleted}
              />
            </div>

            <aside className="min-w-0 space-y-5" aria-label="Day overview">
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
                  onConvertToSession={onConvertToSession}
                  onNewEvent={() => onNewEvent(selectedCalendarDate)}
                  onNewSession={() => onNewSession(selectedCalendarDate)}
                  onDeleteCalendarItems={onDeleteCalendarItems}
                  onSetCalendarItemsCompleted={onSetCalendarItemsCompleted}
                />
              )}

              {deadlines.length > 0 && (
                <section aria-labelledby="home-deadlines-heading">
                  <RailHeading>
                    <span id="home-deadlines-heading">Deadlines · {deadlines.length}</span>
                  </RailHeading>
                  <ul className="divide-y divide-border/50 border-y border-border/60">
                    {deadlines.map((project) => {
                      const subject = getSubjectById(project.subjectId);
                      const late = parseISO(project.deadline!).getTime() < now.getTime();
                      return (
                        <li key={project.id}>
                          <button
                            type="button"
                            onClick={() => onSelectProject(project.id)}
                            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span
                              className="h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40"
                              style={subject ? { backgroundColor: subject.color } : undefined}
                              aria-hidden="true"
                            />
                            <span className="min-w-0 flex-1 truncate font-medium">
                              {project.icon} {project.name}
                            </span>
                            {subject && (
                              <span className="shrink-0 text-muted-foreground">{subject.shortCode}</span>
                            )}
                            <span
                              className={cn(
                                "w-14 shrink-0 text-right tabular-nums",
                                late ? "font-medium text-destructive" : "text-muted-foreground",
                              )}
                            >
                              {formatDaysUntil(project.deadline!, now)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              )}

              {timetable && (
                <section aria-labelledby="home-timetable-heading">
                  <RailHeading
                    action={
                      <Button
                        onClick={onGoTimetable}
                        variant="ghost"
                        size="icon-xs"
                        className="text-muted-foreground"
                        aria-label="Open timetable"
                      >
                        <ArrowRight />
                      </Button>
                    }
                  >
                    <span id="home-timetable-heading">
                      Timetable · Day {timetable.dayLabel}
                      {timetable.info.current && timetable.info.remainingMinutes > 0 && (
                        <span className="ml-1.5 font-normal normal-case tracking-normal text-foreground tabular-nums">
                          {timetable.info.remainingMinutes}m left
                        </span>
                      )}
                    </span>
                  </RailHeading>
                  <ol className="divide-y divide-border/50 border-y border-border/60">
                    {timetable.periods.map((period, idx) => {
                      const subject = getSubjectById(period.subject);
                      const isCurrent =
                        timetable.info.current?.startTime === period.startTime &&
                        timetable.info.current?.subject === period.subject;
                      const isNext =
                        !isCurrent &&
                        timetable.info.next?.startTime === period.startTime &&
                        timetable.info.next?.subject === period.subject;
                      return (
                        <li
                          key={idx}
                          aria-current={isCurrent ? "time" : undefined}
                          className={cn(
                            "flex items-center gap-2 px-2 py-1.5 text-xs",
                            isCurrent && "bg-primary/10",
                          )}
                        >
                          <span
                            className="h-3 w-0.5 shrink-0 rounded-full bg-muted-foreground/40"
                            style={subject ? { backgroundColor: subject.color } : undefined}
                            aria-hidden="true"
                          />
                          <span className="w-24 shrink-0 tabular-nums text-muted-foreground">
                            {formatTime12(period.startTime)}–{formatTime12(period.endTime)}
                          </span>
                          <span className="min-w-0 flex-1 truncate font-medium">
                            {subject ? subject.name : period.subject}
                          </span>
                          {period.location && (
                            <span className="flex shrink-0 items-center gap-0.5 text-muted-foreground">
                              <MapPin className="h-3 w-3" aria-hidden="true" />
                              {period.location}
                            </span>
                          )}
                          {(isCurrent || isNext) && (
                            <span className="shrink-0 rounded bg-foreground/[0.06] px-1 font-medium text-foreground/80">
                              {isCurrent ? "Now" : "Next"}
                            </span>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </section>
              )}

              <QuickLinks />
            </aside>
          </div>
        </div>
      </ScrollArea>

      <TextEventPlanner
        key={textPlannerOpen ? `planner-open-${plannerMode}` : "planner-closed"}
        open={textPlannerOpen}
        onOpenChange={setTextPlannerOpen}
        title={plannerMode === "chatbot" ? "Import from chatbot" : "Text to Events"}
        description="Review drafts before anything is added to your calendar."
        initialText=""
        initialMode={plannerMode}
        projects={projects}
        planningSubjects={planningSubjects}
        onCreateEvents={onCreateEvents}
        onCreateStudySessions={onCreateStudySessions}
      />

      {eventBatchToolbar}
    </>
  );
});
