import { lazy, memo, Suspense, type ReactNode } from "react";
import {
  BarChart3,
  Calendar as CalendarIcon,
  CalendarClock,
  CircleDot,
  GraduationCap,
  Home,
  Inbox as InboxIcon,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project, StudySession, Subject } from "@/lib/types";
import { cn } from "@/lib/utils";

const StudyTimer = lazy(() =>
  import("@/components/timer/StudyTimer").then((module) => ({
    default: module.StudyTimer,
  })),
);

function CollapsibleInline({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!show) return null;
  return <span className={cn("min-w-0 truncate", className)}>{children}</span>;
}

interface SidebarProps {
  sessions: StudySession[];
  customSubjects: Subject[];
  availableSubjects?: Subject[];
  selectedProject?: Project;
  homeSelected: boolean;
  assessmentsSelected: boolean;
  timetableSelected: boolean;
  plannerSelected: boolean;
  inboxSelected: boolean;
  analyticsSelected: boolean;
  examTrackSelected: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelectHome: () => void;
  onSelectAssessments: () => void;
  onSelectTimetable: () => void;
  onSelectPlanner: () => void;
  onSelectInbox: () => void;
  onSelectAnalytics: () => void;
  onSelectExamTrack: () => void;
  onStartPomodoroSession: (data: {
    subjectIds: string[];
    durationSeconds: number;
    projectId?: string;
    cycleNumber: number;
    intent?: string;
  }) => Promise<StudySession>;
  onUpdatePomodoroSession: (
    id: string,
    updates: Partial<Omit<StudySession, "id" | "created_at">>,
  ) => Promise<void>;
  onDeletePomodoroSession?: (id: string) => Promise<void>;
  onSearch?: () => void;
  onSettings?: () => void;
}

interface DestinationButtonProps {
  label: string;
  accessibleLabel?: string;
  icon: LucideIcon;
  selected: boolean;
  collapsed: boolean;
  onClick: () => void;
  wide?: boolean;
}

function DestinationButton({
  label,
  accessibleLabel = label,
  icon: Icon,
  selected,
  collapsed,
  onClick,
  wide,
}: DestinationButtonProps) {
  return (
    <Button
      variant={selected ? "secondary" : "ghost"}
      size={collapsed ? "icon" : "sm"}
      onClick={onClick}
      title={collapsed ? accessibleLabel : undefined}
      aria-label={accessibleLabel === label && !collapsed ? undefined : accessibleLabel}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "min-w-0 text-muted-foreground",
        !collapsed && "h-9 justify-start px-2.5",
        selected && "bg-sidebar-accent text-sidebar-accent-foreground",
        wide && !collapsed && "col-span-2 justify-center",
      )}
    >
      <Icon />
      <CollapsibleInline show={!collapsed} className="font-medium">
        {label}
      </CollapsibleInline>
    </Button>
  );
}

export const Sidebar = memo(function Sidebar({
  sessions,
  customSubjects,
  availableSubjects,
  selectedProject,
  homeSelected,
  assessmentsSelected,
  timetableSelected,
  plannerSelected,
  inboxSelected,
  analyticsSelected,
  examTrackSelected,
  isCollapsed,
  onToggleCollapse,
  onSelectHome,
  onSelectAssessments,
  onSelectTimetable,
  onSelectPlanner,
  onSelectInbox,
  onSelectAnalytics,
  onSelectExamTrack,
  onStartPomodoroSession,
  onUpdatePomodoroSession,
  onDeletePomodoroSession,
  onSearch,
  onSettings,
}: SidebarProps) {
  return (
    <aside
      aria-label="Primary navigation and focus timer"
      className="flex h-full min-h-0 flex-col overflow-hidden border-r border-sidebar-border/90 bg-sidebar text-sidebar-foreground shadow-[1px_0_0_color-mix(in_oklch,var(--border),transparent_45%)]"
    >
      <div className={cn("border-b border-sidebar-border/70 bg-background/20 py-3", isCollapsed ? "px-1.5" : "px-3")}>
        <div className={cn("flex items-center gap-2.5", isCollapsed && "justify-center gap-1")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10">
            <CircleDot className="size-4" aria-hidden />
          </span>
          <CollapsibleInline show={!isCollapsed} className="font-display text-sm font-semibold tracking-tight">
            Focal
          </CollapsibleInline>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapse}
            className={cn("shrink-0", !isCollapsed && "ml-auto")}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <StudyTimer
              prominent
              customSubjects={customSubjects}
              availableSubjects={availableSubjects}
              sessions={sessions}
              selectedProject={selectedProject}
              onSearch={onSearch}
              onSettings={onSettings}
              onStartSession={onStartPomodoroSession}
              onUpdateSession={onUpdatePomodoroSession}
              onDeleteSession={onDeletePomodoroSession}
            />
          </Suspense>
        </div>
      )}

      <nav
        aria-label="Workspace"
        className={cn(
          "border-t border-sidebar-border/70 bg-background/15",
          isCollapsed ? "flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto px-1.5 py-2" : "grid grid-cols-2 gap-1.5 p-2.5",
        )}
      >
        <DestinationButton label="Today" icon={Home} selected={homeSelected} collapsed={isCollapsed} onClick={onSelectHome} />
        <DestinationButton label="Planner" accessibleLabel="Adaptive planner" icon={CalendarClock} selected={plannerSelected} collapsed={isCollapsed} onClick={onSelectPlanner} />
        <DestinationButton label="Inbox" accessibleLabel="Academic inbox" icon={InboxIcon} selected={inboxSelected} collapsed={isCollapsed} onClick={onSelectInbox} />
        <DestinationButton label="Schedule" icon={CalendarIcon} selected={timetableSelected} collapsed={isCollapsed} onClick={onSelectTimetable} />
        <DestinationButton label="Progress" icon={BarChart3} selected={analyticsSelected} collapsed={isCollapsed} onClick={onSelectAnalytics} />
        <DestinationButton label="Exams" accessibleLabel="Exam practice" icon={GraduationCap} selected={examTrackSelected} collapsed={isCollapsed} onClick={onSelectExamTrack} />
        <DestinationButton label="Assessments" icon={Library} selected={assessmentsSelected} collapsed={isCollapsed} onClick={onSelectAssessments} wide />
      </nav>

      {isCollapsed && (
        <Suspense fallback={null}>
          <StudyTimer
            isCollapsed
            onExpand={onToggleCollapse}
            customSubjects={customSubjects}
            availableSubjects={availableSubjects}
            sessions={sessions}
            selectedProject={selectedProject}
            onSearch={onSearch}
            onSettings={onSettings}
            onStartSession={onStartPomodoroSession}
            onUpdateSession={onUpdatePomodoroSession}
            onDeleteSession={onDeletePomodoroSession}
          />
        </Suspense>
      )}
    </aside>
  );
});
