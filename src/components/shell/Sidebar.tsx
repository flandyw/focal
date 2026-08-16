import {
  useState,
  memo,
  useCallback,
  useRef,
  useMemo,
  lazy,
  Suspense,
  type ReactNode,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Archive,
  ArrowUpDown,
  BarChart3,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FolderOpen,
  Home,
  GraduationCap,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  Star,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AssessmentRow } from "@/components/project/AssessmentRow";
import { cn, getSubjectById } from "@/lib/utils";
import type { ProjectSortKey } from "@/hooks/useProjects";
import { sortProjects } from "@/hooks/useProjects";
import type { Project, StudySession, Subject } from "@/lib/types";

const StudyTimer = lazy(() => import("@/components/timer/StudyTimer").then((module) => ({ default: module.StudyTimer })));

type FilterMode = "active" | "favorites" | "archived" | "finished";

interface AssessmentSubjectGroup {
  subjectId: string;
  label: string;
  shortCode: string;
  color?: string;
  assessments: Project[];
}

type SidebarListItem =
  | { type: "group-header"; id: string; group: AssessmentSubjectGroup }
  | { type: "assessment"; id: string; project: Project };

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
  return (
    <span
      className={cn(
        "inline-flex min-w-0 overflow-hidden whitespace-nowrap",
        className,
      )}
    >
      {children}
    </span>
  );
}

function CollapsibleBlock({
  show,
  children,
  className,
}: {
  show: boolean;
  children: ReactNode;
  className?: string;
}) {
  if (!show) return null;
  return (
    <div className={cn("min-w-0 overflow-hidden", className)}>{children}</div>
  );
}

function getAssessmentSubjectGroups(
  assessments: Project[],
): AssessmentSubjectGroup[] {
  const groups = new Map<string, AssessmentSubjectGroup>();
  assessments.forEach((assessment) => {
    const subject = getSubjectById(assessment.subjectId);
    const subjectId = assessment.subjectId ?? "unassigned";
    const existing = groups.get(subjectId);
    if (existing) {
      existing.assessments.push(assessment);
      return;
    }
    groups.set(subjectId, {
      subjectId,
      label: subject?.name ?? "Unassigned",
      shortCode: subject?.shortCode ?? "GEN",
      color: subject?.color,
      assessments: [assessment],
    });
  });
  return Array.from(groups.values()).sort((a, b) => {
    if (a.subjectId === "unassigned") return 1;
    if (b.subjectId === "unassigned") return -1;
    return a.label.localeCompare(b.label);
  });
}

const SORT_OPTIONS: { key: ProjectSortKey; label: string }[] = [
  { key: "deadline", label: "Deadline" },
  { key: "name", label: "Name A–Z" },
  { key: "created-newest", label: "Newest" },
  { key: "created-oldest", label: "Oldest" },
  { key: "fileCount", label: "File count" },
];

interface SidebarProps {
  projects: Project[];
  sessions: StudySession[];
  customSubjects: Subject[];
  availableSubjects?: Subject[];
  selectedId: string | null;
  homeSelected: boolean;
  timetableSelected: boolean;
  analyticsSelected: boolean;
  examTrackSelected: boolean;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  onSelect: (id: string) => void;
  onSelectHome: () => void;
  onSelectTimetable: () => void;
  onSelectAnalytics: () => void;
  onSelectExamTrack: () => void;
  onDelete: (id: string) => void;
  onOpenFocus: () => void;
  onNewProject: () => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onToggleFinished?: (id: string) => void;
  onOpenProjectSettings?: (id: string) => void;
  onDuplicateProject?: (id: string) => void;
  onDropFolder?: (path: string) => void;
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
  onAddFile?: (projectId: string) => void;
  fileCounts: Record<string, number>;
  bumpProjectIds?: Set<string>;
  onSearch?: () => void;
  onSettings?: () => void;
  sortKey?: ProjectSortKey;
  onSortChange?: (key: ProjectSortKey) => void;
  selectedProjectIds?: Set<string>;
  onToggleProjectSelection?: (id: string) => void;
  onBulkArchive?: (ids: string[]) => void;
  onBulkUnarchive?: (ids: string[]) => void;
  onBulkFinish?: (ids: string[]) => void;
  onBulkDelete?: (ids: string[]) => void;
}

export const Sidebar = memo(function Sidebar({
  projects,
  sessions,
  customSubjects,
  availableSubjects,
  selectedId,
  homeSelected,
  timetableSelected,
  analyticsSelected,
  examTrackSelected,
  isCollapsed,
  onToggleCollapse,
  onSelect,
  onSelectHome,
  onSelectTimetable,
  onSelectAnalytics,
  onSelectExamTrack,
  onDelete,
  onOpenFocus,
  onNewProject,
  onToggleFavorite,
  onToggleArchive,
  onToggleFinished,
  onStartPomodoroSession,
  onUpdatePomodoroSession,
  onDeletePomodoroSession,
  onAddFile,
  onOpenProjectSettings,
  onDuplicateProject,
  onDropFolder,
  fileCounts,
  bumpProjectIds,
  onSearch,
  onSettings,
  sortKey = "deadline",
  onSortChange,
  selectedProjectIds,
  onToggleProjectSelection,
  onBulkArchive,
  onBulkUnarchive,
  onBulkFinish,
  onBulkDelete,
}: SidebarProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>("active");
  const [isDragOver, setIsDragOver] = useState(false);
  const [showSortMenu, setShowSortMenu] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);

  const dragCounter = useRef(0);

  const handleDragEnter = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current += 1;
      if (!isDragOver) setIsDragOver(true);
    },
    [isDragOver],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounter.current = 0;
      setIsDragOver(false);

      if (!onDropFolder) return;

      const uriList = e.dataTransfer.getData("text/uri-list");
      if (uriList) {
        const lines = uriList.split(/\r?\n/).filter((line) => line.trim());
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith("file://")) {
            onDropFolder(trimmed);
            return;
          }
        }
      }

      const plain = e.dataTransfer.getData("text/plain");
      if (plain) {
        const trimmed = plain.trim();
        if (trimmed) {
          onDropFolder(trimmed);
          return;
        }
      }
    },
    [onDropFolder],
  );

  const effectiveSortKey = sortKey ?? "deadline";
  const sorted = useMemo(
    () => sortProjects(projects, effectiveSortKey, fileCounts),
    [projects, effectiveSortKey, fileCounts],
  );

  const filtered = useMemo(
    () =>
      sorted.filter((p) => {
        if (filterMode === "favorites")
          return p.isFavorite && !p.isArchived && !p.isFinished;
        if (filterMode === "archived") return p.isArchived;
        if (filterMode === "finished") return p.isFinished && !p.isArchived;
        return !p.isArchived && !p.isFinished;
      }),
    [sorted, filterMode],
  );

  const subjectGroups = useMemo(
    () => getAssessmentSubjectGroups(filtered),
    [filtered],
  );

  const parentRef = useRef<HTMLDivElement>(null);

  const flatItems = useMemo<SidebarListItem[]>(() => {
    const items: SidebarListItem[] = [];
    for (const group of subjectGroups) {
      if (!isCollapsed) {
        items.push({
          type: "group-header",
          id: `group-${group.subjectId}`,
          group,
        });
      }
      for (const project of group.assessments) {
        items.push({ type: "assessment", id: project.id, project });
      }
    }
    return items;
  }, [subjectGroups, isCollapsed]);

  // ponytail: TanStack Virtual's useVirtualizer returns non-memoizable functions;
  // we rely on TanStack Virtual intentionally and accept that React Compiler skips this hook.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: flatItems.length,
    getScrollElement: () => parentRef.current,
    estimateSize: (index) => {
      const item = flatItems[index];
      if (!item) return 44;
      if (item.type === "group-header") return 28;
      return isCollapsed ? 32 : 44;
    },
    overscan: 5,
  });

  const virtualItems = virtualizer.getVirtualItems();

  const selectedProject = selectedId
    ? projects.find((project) => project.id === selectedId)
    : undefined;

  const { activeCount, filterItems } = useMemo(() => {
    let favoriteCount = 0;
    let archivedCount = 0;
    let finishedCount = 0;
    let activeCount = 0;
    for (const p of sorted) {
      if (p.isArchived) {
        archivedCount++;
      } else if (p.isFinished) {
        finishedCount++;
      } else {
        activeCount++;
        if (p.isFavorite) favoriteCount++;
      }
    }
    const items: {
      mode: FilterMode;
      label: string;
      icon: LucideIcon;
      count?: number;
    }[] = [
      { mode: "active", label: "Current", icon: CircleDot, count: activeCount },
      { mode: "favorites", label: "Starred", icon: Star, count: favoriteCount },
      {
        mode: "archived",
        label: "Archive",
        icon: Archive,
        count: archivedCount,
      },
      {
        mode: "finished",
        label: "Done",
        icon: CheckCircle2,
        count: finishedCount,
      },
    ];
    return { activeCount, filterItems: items };
  }, [sorted]);

  const selectedCount = selectedProjectIds?.size ?? 0;
  const selectedIdsArray = selectedProjectIds
    ? Array.from(selectedProjectIds)
    : [];
  const bulkBarVisible = selectedCount > 0 && !isCollapsed;

  const sortLabel =
    SORT_OPTIONS.find((o) => o.key === sortKey)?.label ?? "Sort";
  const librarySelected = Boolean(selectedId);
  const emptyState = {
    active: {
      title: "No current assessments",
      description: "Create an assessment to start organising your study.",
    },
    favorites: {
      title: "Nothing starred yet",
      description: "Star important assessments to keep them close.",
    },
    archived: {
      title: "Archive is empty",
      description: "Archived assessments will appear here.",
    },
    finished: {
      title: "Nothing completed yet",
      description: "Finished assessments will appear here.",
    },
  }[filterMode];

  return (
    <aside
      aria-label="Assessment navigation"
      className={cn(
        "relative flex h-full flex-col overflow-hidden border-r border-sidebar-border/90 bg-sidebar text-sidebar-foreground shadow-[1px_0_0_color-mix(in_oklch,var(--border),transparent_45%)] transition-[background-color,border-color]",
        isDragOver && "border-primary/40 ring-2 ring-ring/50 ring-inset",
      )}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-2 z-50 flex items-center justify-center rounded-lg border-2 border-dashed border-primary/40 bg-background/90 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2.5 px-4 text-center text-foreground">
            <span className="flex size-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <FolderOpen className="size-5" />
            </span>
            <span className="text-sm font-semibold">
              Drop folder to create assessment
            </span>
          </div>
        </div>
      )}
      <div
        className={cn(
          "border-b border-sidebar-border/80 bg-background/25 pb-3.5 pt-3.5 min-[1200px]:pb-4 min-[1200px]:pt-4",
          isCollapsed ? "px-1.5 min-[1200px]:px-2" : "px-3 min-[1200px]:px-4",
        )}
      >
        <div
          className={cn(
            "flex items-center gap-2.5 select-none",
            isCollapsed && "justify-center gap-1.5",
          )}
        >
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary ring-1 ring-primary/10">
            <CircleDot className="size-4" aria-hidden="true" />
          </span>
          <CollapsibleBlock show={!isCollapsed}>
            <h1 className="font-display text-sm font-semibold leading-4 tracking-[-0.015em]">Focal</h1>
            <p className="mt-1 text-[11px] leading-3 text-muted-foreground max-[900px]:hidden">
              Your study workspace
            </p>
          </CollapsibleBlock>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggleCollapse}
            className={cn("shrink-0", !isCollapsed && "ml-auto")}
            title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {isCollapsed ? (
              <PanelLeftOpen />
            ) : (
              <PanelLeftClose />
            )}
          </Button>
        </div>

        <div className="mt-3.5 flex justify-center">
          <Button
            variant="default"
            onClick={onOpenFocus}
            className={cn(
              "font-semibold shadow-sm hover:shadow",
              isCollapsed ? "size-8 rounded-lg" : "w-full justify-center",
            )}
            size={isCollapsed ? "icon" : "sm"}
            title={isCollapsed ? "Start focus" : undefined}
            aria-label={isCollapsed ? "Start focus" : undefined}
          >
            <Play className="fill-current" />
            <CollapsibleInline show={!isCollapsed}>Start focus</CollapsibleInline>
          </Button>
        </div>
      </div>

      <div
        className={cn(
          "space-y-1.5 pt-3.5",
          isCollapsed ? "px-1.5 min-[1200px]:px-2" : "px-2.5 min-[1200px]:px-3",
        )}
      >
        <CollapsibleBlock show={!isCollapsed} className="px-2 pb-1">
          <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground/85">
            Study
          </p>
        </CollapsibleBlock>
        <Button
          variant={homeSelected ? "secondary" : "ghost"}
          onClick={() => {
            setLibraryOpen(false);
            onSelectHome();
          }}
          className={cn(
            "w-full text-muted-foreground",
            !isCollapsed && "justify-start",
            homeSelected && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
          size={isCollapsed ? "icon" : "default"}
          title={isCollapsed ? "Today (H)" : undefined}
          aria-label={isCollapsed ? "Today" : undefined}
          aria-current={homeSelected ? "page" : undefined}
        >
          <Home />
          <CollapsibleInline show={!isCollapsed} className="font-medium">
            Today
          </CollapsibleInline>
        </Button>

        <Button
          variant={timetableSelected ? "secondary" : "ghost"}
          onClick={() => {
            setLibraryOpen(false);
            onSelectTimetable();
          }}
          className={cn(
            "w-full text-muted-foreground",
            !isCollapsed && "justify-start",
            timetableSelected && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
          size={isCollapsed ? "icon" : "default"}
          title={isCollapsed ? "Schedule (T)" : undefined}
          aria-label={isCollapsed ? "Schedule" : undefined}
          aria-current={timetableSelected ? "page" : undefined}
        >
          <CalendarIcon />
          <CollapsibleInline show={!isCollapsed} className="font-medium">
            Schedule
          </CollapsibleInline>
        </Button>

        <Button
          variant={analyticsSelected ? "secondary" : "ghost"}
          onClick={() => {
            setLibraryOpen(false);
            onSelectAnalytics();
          }}
          className={cn(
            "w-full text-muted-foreground",
            !isCollapsed && "justify-start",
            analyticsSelected && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
          size={isCollapsed ? "icon" : "default"}
          title={isCollapsed ? "Progress (A)" : undefined}
          aria-label={isCollapsed ? "Progress" : undefined}
          aria-current={analyticsSelected ? "page" : undefined}
        >
          <BarChart3 />
          <CollapsibleInline show={!isCollapsed} className="font-medium">
            Progress
          </CollapsibleInline>
        </Button>

        <Button
          variant={examTrackSelected ? "secondary" : "ghost"}
          onClick={() => {
            setLibraryOpen(false);
            onSelectExamTrack();
          }}
          className={cn(
            "w-full text-muted-foreground",
            !isCollapsed && "justify-start",
            examTrackSelected && "bg-sidebar-accent text-sidebar-accent-foreground",
          )}
          size={isCollapsed ? "icon" : "default"}
          title={isCollapsed ? "Exam practice" : undefined}
          aria-label={isCollapsed ? "Exam practice" : undefined}
          aria-current={examTrackSelected ? "page" : undefined}
        >
          <GraduationCap />
          <CollapsibleInline show={!isCollapsed} className="font-medium">
            Exam practice
          </CollapsibleInline>
        </Button>

        <div
          className={cn(
            "overflow-hidden rounded-lg transition-colors",
            libraryOpen && "bg-background/35",
          )}
        >
          <div
            className={cn(
              "items-center gap-0.5",
              isCollapsed ? "flex flex-col py-0.5" : "flex p-0.5",
            )}
          >
            <Button
              variant={librarySelected ? "secondary" : "ghost"}
              onClick={() => setLibraryOpen((current) => !current)}
              className={cn(
                "min-w-0 text-muted-foreground",
                isCollapsed ? "shrink-0" : "flex-1 justify-start",
                librarySelected &&
                  "bg-sidebar-accent text-sidebar-accent-foreground",
              )}
              size={isCollapsed ? "icon" : "default"}
              title={isCollapsed ? "Assessments" : undefined}
              aria-label={isCollapsed ? "Assessments" : undefined}
              aria-expanded={libraryOpen}
            >
              <Library />
              <CollapsibleInline show={!isCollapsed} className="font-medium">
                Assessments
              </CollapsibleInline>
              <CollapsibleInline
                show={!isCollapsed}
                className="ml-auto items-center gap-0.5"
              >
                <span className="flex size-5 items-center justify-center rounded-full bg-muted/70 text-[11px] font-medium leading-none tabular-nums text-muted-foreground">
                  {activeCount}
                </span>
                <span className="flex size-5 items-center justify-center">
                  <ChevronDown
                    className={cn(
                      "size-3.5 shrink-0 transition-transform",
                      !libraryOpen && "-rotate-90",
                    )}
                    aria-hidden="true"
                  />
                </span>
              </CollapsibleInline>
            </Button>
            <Button
              variant="ghost"
              onClick={onNewProject}
              size={isCollapsed ? "icon-xs" : "icon-sm"}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title="New assessment"
              aria-label="New assessment"
            >
              <Plus />
            </Button>
          </div>

          {libraryOpen && (
            <div
              role="group"
              aria-label="Filter assessments"
              className={cn(
                "gap-1 border-t border-sidebar-border/70 p-1",
                isCollapsed ? "flex flex-col items-center" : "grid grid-cols-2",
              )}
            >
              {filterItems.map(({ mode, label, icon: Icon, count }) => (
                <Button
                  key={mode}
                  onClick={() => setFilterMode(mode)}
                  variant={filterMode === mode ? "secondary" : "ghost"}
                  size={isCollapsed ? "icon-xs" : "xs"}
                  className={cn(
                    isCollapsed ? undefined : "w-full justify-start",
                    filterMode === mode && "font-medium",
                  )}
                  title={isCollapsed ? label : undefined}
                  aria-label={
                    isCollapsed
                      ? `${label}${count != null ? `, ${count}` : ""}`
                      : undefined
                  }
                  aria-pressed={filterMode === mode}
                >
                  <Icon />
                  <CollapsibleInline show={!isCollapsed}>
                    {label}
                  </CollapsibleInline>
                  {count != null && count > 0 && !isCollapsed && (
                    <CollapsibleInline
                      show={!isCollapsed}
                      className="ml-auto tabular-nums text-[11px] text-muted-foreground"
                    >
                      {count}
                    </CollapsibleInline>
                  )}
                </Button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Virtualized project list */}
      {libraryOpen ? <>
        {!isCollapsed && (
          <div className="mt-3 flex items-center border-t border-sidebar-border/70 px-4 pb-1.5 pt-3">
            <p className="min-w-0 flex-1 text-[11px] font-medium text-muted-foreground">
              {filtered.length} {filtered.length === 1 ? "item" : "items"}
            </p>
            {onSortChange && (
              <DropdownMenu open={showSortMenu} onOpenChange={setShowSortMenu}>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="xs"
                    className="max-w-28 text-muted-foreground"
                    aria-label={`Sort assessments. Current order: ${sortLabel}`}
                    title={`Sort by ${sortLabel}`}
                  >
                    <ArrowUpDown />
                    <span className="truncate">{sortLabel}</span>
                    <ChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  {SORT_OPTIONS.map((opt) => (
                    <DropdownMenuItem
                      key={opt.key}
                      onSelect={() => onSortChange(opt.key)}
                      className={cn(sortKey === opt.key && "font-medium")}
                    >
                      {opt.label}
                      {sortKey === opt.key && (
                        <CircleDot className="ml-auto size-3" />
                      )}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        <ScrollArea
          viewportRef={parentRef}
          className={cn(
            "min-h-0 w-full flex-1",
            "px-1.5 pb-1.5 pt-1 min-[1200px]:px-2",
          )}
        >
          {subjectGroups.length > 0 ? (
          <div
            style={{
              height: `${virtualizer.getTotalSize()}px`,
              width: "100%",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItems[0]?.start ?? 0}px)`,
              }}
            >
              {virtualItems.map((virtualItem) => {
                const item = flatItems[virtualItem.index];
                return (
                  <div
                    key={virtualItem.key}
                    data-index={virtualItem.index}
                    ref={virtualizer.measureElement}
                    className="mb-0.5"
                  >
                    {item.type === "group-header" && !isCollapsed && (
                      <div className="mb-0.5 flex items-center gap-2 px-2 pb-0.5 pt-1.5">
                        <span
                          className="size-1.5 shrink-0 rounded-full bg-muted-foreground/40"
                          style={
                            item.group.color
                              ? { backgroundColor: item.group.color }
                              : undefined
                          }
                        />
                        <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-muted-foreground" role="heading" aria-level={2}>
                          {item.group.label}
                        </p>
                        <span className="text-[10px] tabular-nums text-muted-foreground/80">
                          {item.group.assessments.length}
                        </span>
                      </div>
                    )}
                    {item.type === "assessment" && (
                      <AssessmentRow
                        project={item.project}
                        isCollapsed={isCollapsed}
                        selectedId={selectedId}
                        selectedProjectIds={selectedProjectIds}
                        onToggleProjectSelection={onToggleProjectSelection}
                        onSelect={onSelect}
                        fileCounts={fileCounts}
                        bumpProjectIds={bumpProjectIds}
                        onOpenProjectSettings={onOpenProjectSettings}
                        onDuplicateProject={onDuplicateProject}
                        onToggleFinished={onToggleFinished}
                        onToggleFavorite={onToggleFavorite}
                        onToggleArchive={onToggleArchive}
                        onDelete={onDelete}
                        onStartPomodoroSession={onStartPomodoroSession}
                        onAddFile={onAddFile}
                      />
                    )}
                  </div>
                );            })}
          </div>
        </div>
          ) : (
            <div
              className={cn(
                "mx-1 mt-2 flex flex-col items-center justify-center rounded-lg border border-dashed border-sidebar-border bg-background/20 text-center",
                isCollapsed ? "px-1 py-4" : "px-4 py-6",
              )}
            >
              <span className="flex size-9 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <FolderOpen className="size-4" aria-hidden="true" />
              </span>
              <CollapsibleBlock show={!isCollapsed} className="mt-2.5">
                <p className="text-xs font-semibold">{emptyState.title}</p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {emptyState.description}
                </p>
                {filterMode === "active" && (
                  <Button
                    variant="outline"
                    size="xs"
                    className="mt-3"
                    onClick={onNewProject}
                  >
                    <Plus />
                    New assessment
                  </Button>
                )}
                {filterMode !== "active" && (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="mt-3"
                    onClick={() => setFilterMode("active")}
                  >
                    Show current
                  </Button>
                )}
              </CollapsibleBlock>
            </div>
          )}
        </ScrollArea>
      </> : <div className="min-h-0 flex-1" />}

      {/* Bulk action bar */}
      {libraryOpen && bulkBarVisible &&
        (onBulkArchive ?? onBulkUnarchive) &&
        onBulkFinish &&
        onBulkDelete && (
          <div
            className="mx-2 mb-2 flex items-center gap-1.5 rounded-lg border bg-background/65 p-1.5 shadow-sm"
            role="region"
            aria-label="Selected assessment actions"
          >
            <span className="px-2 text-xs font-medium tabular-nums" aria-live="polite">
              {selectedCount} selected
            </span>
            <div className="ml-auto flex items-center gap-0.5">
              <Button
                variant="ghost"
                size="xs"
                onClick={() =>
                  selectedIdsArray.forEach((id) => onToggleProjectSelection?.(id))
                }
              >
                Clear
              </Button>
              {filterMode === "archived"
                ? onBulkUnarchive && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onBulkUnarchive(selectedIdsArray)}
                    >
                      Restore
                    </Button>
                  )
                : onBulkArchive && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => onBulkArchive(selectedIdsArray)}
                    >
                      Archive
                    </Button>
                  )}
              <Button
                variant="ghost"
                size="xs"
                onClick={() => onBulkFinish(selectedIdsArray)}
              >
                Finish
              </Button>
              <Button
                variant="destructive"
                size="xs"
                onClick={() => {
                  if (onBulkDelete) onBulkDelete(selectedIdsArray);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        )}

      <Suspense fallback={null}>
        <StudyTimer
          isCollapsed={isCollapsed}
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
    </aside>
  );
});
