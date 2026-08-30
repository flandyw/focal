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
  Search,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { Project, StudySession, Subject } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isMacOS } from "@/lib/platform";

const WORKSPACE_MODIFIER = isMacOS ? "⌘" : "Ctrl+";

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
  shortcut?: string;
}

function DestinationButton({
  label,
  accessibleLabel = label,
  icon: Icon,
  selected,
  collapsed,
  onClick,
  shortcut,
}: DestinationButtonProps) {
  return (
    <Button
      variant={selected ? "secondary" : "ghost"}
      size={collapsed ? "icon" : "sm"}
      onClick={onClick}
      title={collapsed ? `${accessibleLabel}${shortcut ? ` · ${shortcut}` : ""}` : undefined}
      aria-label={accessibleLabel === label && !collapsed ? undefined : accessibleLabel}
      aria-keyshortcuts={shortcut?.startsWith("⌘")
        ? `Meta+${shortcut.slice(1)}`
        : shortcut?.startsWith("Ctrl+")
          ? `Control+${shortcut.slice(5)}`
          : shortcut}
      aria-current={selected ? "page" : undefined}
      className={cn(
        "min-w-0 rounded-lg text-muted-foreground transition-colors",
        !collapsed && "h-10 w-full justify-start gap-3 px-3",
        selected && "bg-sidebar-accent text-sidebar-accent-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--sidebar-primary),transparent_78%)]",
      )}
    >
      <Icon />
      <CollapsibleInline show={!collapsed} className="font-medium">
        {label}
      </CollapsibleInline>
      {!collapsed && shortcut && <kbd aria-hidden="true" className="ml-auto font-mono text-micro text-muted-foreground/65">{shortcut}</kbd>}
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
      className="flex h-full min-h-0 flex-col overflow-hidden border-r border-sidebar-border/80 bg-sidebar text-sidebar-foreground"
    >
      <div className={cn("py-4", isCollapsed ? "px-2" : "px-4")}>
        <div className={cn("flex items-center gap-2.5", isCollapsed && "justify-center gap-1")}>
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary ring-1 ring-primary/20">
            <CircleDot className="size-4" aria-hidden />
          </span>
          <CollapsibleInline show={!isCollapsed} className="font-display text-base font-semibold tracking-tight">
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

      <nav
        aria-label="Workspace"
        className={cn(
          "min-h-0 flex-1 overflow-y-auto",
          isCollapsed ? "flex flex-col items-center gap-1 px-2 py-2" : "space-y-1 px-3 pb-4 pt-2",
        )}
      >
        {!isCollapsed && (
          <p className="mb-2 px-3 text-micro font-semibold uppercase tracking-[0.14em] text-muted-foreground/70">
            Workspace
          </p>
        )}
        {onSearch && <DestinationButton label="Search" icon={Search} selected={false} collapsed={isCollapsed} onClick={onSearch} shortcut="/" />}
        <DestinationButton label="Today" icon={Home} selected={homeSelected} collapsed={isCollapsed} onClick={onSelectHome} shortcut={`${WORKSPACE_MODIFIER}1`} />
        <DestinationButton label="Assessments" icon={Library} selected={assessmentsSelected} collapsed={isCollapsed} onClick={onSelectAssessments} shortcut={`${WORKSPACE_MODIFIER}2`} />
        <DestinationButton label="Planner" accessibleLabel="Adaptive planner" icon={CalendarClock} selected={plannerSelected} collapsed={isCollapsed} onClick={onSelectPlanner} shortcut={`${WORKSPACE_MODIFIER}3`} />
        <DestinationButton label="Schedule" icon={CalendarIcon} selected={timetableSelected} collapsed={isCollapsed} onClick={onSelectTimetable} shortcut={`${WORKSPACE_MODIFIER}4`} />
        <DestinationButton label="Inbox" accessibleLabel="Academic inbox" icon={InboxIcon} selected={inboxSelected} collapsed={isCollapsed} onClick={onSelectInbox} shortcut={`${WORKSPACE_MODIFIER}5`} />
        <DestinationButton label="Exams" accessibleLabel="Exam practice" icon={GraduationCap} selected={examTrackSelected} collapsed={isCollapsed} onClick={onSelectExamTrack} shortcut={`${WORKSPACE_MODIFIER}6`} />
        <DestinationButton label="Progress" icon={BarChart3} selected={analyticsSelected} collapsed={isCollapsed} onClick={onSelectAnalytics} shortcut={`${WORKSPACE_MODIFIER}7`} />
      </nav>

      <div className="shrink-0">
        <Suspense fallback={null}>
          <StudyTimer
            isCollapsed={isCollapsed}
            prominent={!isCollapsed}
            onExpand={isCollapsed ? onToggleCollapse : undefined}
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
    </aside>
  );
});
