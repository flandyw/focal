import { memo } from "react";
import {
  CheckCircle2,
  Circle,
  Copy,
  Link,
  MoreHorizontal,
  Pencil,
  Star,
  Archive,
  Trash2,
  Timer,
  Upload,
  Folder,
  FileText,
  BookOpen,
  Languages,
  Library,
  Calculator,
  ChartNoAxesColumn,
  FlaskConical,
  Atom,
  Dna,
  Brain,
  Landmark,
  Map as MapIcon,
  TrendingUp,
  BriefcaseBusiness,
  NotebookPen,
  CalendarDays,
  ClipboardList,
  MapPin,
  type LucideIcon,
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem as CtxMenuItem,
  ContextMenuSeparator as CtxMenuSep,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  cn,
  formatDeadline,
  isOverdue,
  getDeadlineTypeInfo,
  getSubjectById,
} from "@/lib/utils";
import type { DeadlineType, Project, StudySession } from "@/lib/types";

const SUBJECT_ICONS: Record<string, LucideIcon> = {
  eng: BookOpen,
  "eng-lang": Languages,
  lit: Library,
  mm: Calculator,
  sm: Calculator,
  gm: ChartNoAxesColumn,
  chem: FlaskConical,
  phys: Atom,
  bio: Dna,
  psych: Brain,
  hist: Landmark,
  geo: MapIcon,
  econ: TrendingUp,
  bm: BriefcaseBusiness,
};

const DEADLINE_ICONS: Record<DeadlineType | "default", LucideIcon> = {
  sac: NotebookPen,
  exam: CalendarDays,
  assignment: ClipboardList,
  default: MapPin,
};

function getSidebarProjectIcon(project: Project): LucideIcon {
  if (project.subjectId && SUBJECT_ICONS[project.subjectId]) {
    return SUBJECT_ICONS[project.subjectId];
  }
  return Folder;
}

function getSidebarDeadlineIcon(type?: DeadlineType): LucideIcon {
  return type ? DEADLINE_ICONS[type] : DEADLINE_ICONS.default;
}

interface AssessmentRowProps {
  project: Project;
  variant?: "sidebar" | "homepage";
  isCollapsed: boolean;
  selectedId: string | null;
  selectedProjectIds?: Set<string>;
  onToggleProjectSelection?: (id: string) => void;
  onSelect: (id: string) => void;
  fileCounts: Record<string, number>;
  bumpProjectIds?: Set<string>;
  onOpenProjectSettings?: (id: string) => void;
  onDuplicateProject?: (id: string) => void;
  onToggleFinished?: (id: string) => void;
  onToggleFavorite?: (id: string) => void;
  onToggleArchive?: (id: string) => void;
  onDelete: (id: string) => void;
  onStartPomodoroSession: (data: {
    subjectIds: string[];
    durationSeconds: number;
    projectId?: string;
    cycleNumber: number;
  }) => Promise<StudySession>;
  onAddFile?: (projectId: string) => void;
}

export const AssessmentRow = memo(function AssessmentRow({
  project,
  variant = "sidebar",
  isCollapsed,
  selectedId,
  selectedProjectIds,
  onToggleProjectSelection,
  onSelect,
  fileCounts,
  bumpProjectIds,
  onOpenProjectSettings,
  onDuplicateProject,
  onToggleFinished,
  onToggleFavorite,
  onToggleArchive,
  onDelete,
  onStartPomodoroSession,
  onAddFile,
}: AssessmentRowProps) {
  const ProjectIcon = getSidebarProjectIcon(project);
  const subject = getSubjectById(project.subjectId);
  const deadlineInfo = getDeadlineTypeInfo(project.deadlineType);
  const DeadlineIcon = getSidebarDeadlineIcon(project.deadlineType);
  const isMultiSelecting = (selectedProjectIds?.size ?? 0) > 0;
  const isSelected = selectedProjectIds?.has(project.id) ?? false;
  const checklistCount = project.checklist?.length ?? 0;
  const completedChecklistCount = project.checklist?.filter((item) => item.completed).length ?? 0;
  const progress = project.isFinished
    ? 100
    : checklistCount > 0
      ? Math.round((completedChecklistCount / checklistCount) * 100)
      : 0;
  const overdue = Boolean(project.deadline && isOverdue(project.deadline));
  const statusLabel = project.isFinished
    ? "Completed"
    : overdue
      ? "Overdue"
      : progress > 0
        ? "In progress"
        : "Not started";
  const deadlineLabel = project.deadline
    ? new Date(project.deadline).toLocaleDateString(undefined, {
        day: "numeric",
        month: "short",
        year: new Date(project.deadline).getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
      })
    : "No deadline";
  const deadlineDays = project.deadline
    ? Math.ceil((new Date(project.deadline).getTime() - Date.now()) / 86_400_000)
    : null;
  const deadlineMeta = project.isFinished
    ? "Finished"
    : deadlineDays === null
      ? "Add a due date"
      : deadlineDays < 0
        ? `${Math.abs(deadlineDays)} ${Math.abs(deadlineDays) === 1 ? "day" : "days"} overdue`
        : deadlineDays === 0
          ? "Today"
          : deadlineDays === 1
            ? "Tomorrow"
            : `in ${deadlineDays} days`;

  const handleProjectClick = () => {
    if (selectedProjectIds && selectedProjectIds.size > 0 && onToggleProjectSelection) {
      onToggleProjectSelection(project.id);
    } else {
      onSelect(project.id);
    }
  };

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          aria-label={project.name}
          aria-current={selectedId === project.id ? "page" : undefined}
          className={cn(
            "group relative w-full min-w-0 max-w-full cursor-pointer overflow-hidden transition-colors",
            isCollapsed
              ? "flex items-center justify-center gap-1.5 rounded-md px-2 py-1.25"
              : variant === "homepage"
                ? "grid min-h-18 grid-cols-[auto_auto_minmax(0,1fr)_2rem] items-center gap-3 border-b border-border/60 px-3 py-2.5 last:border-b-0 hover:bg-muted/35 min-[760px]:grid-cols-[auto_auto_minmax(0,1fr)_8rem_2rem] min-[1100px]:grid-cols-[auto_auto_minmax(0,1fr)_5rem_8rem_8rem_2rem]"
                : "flex items-center gap-1.5 rounded-md px-2 py-1.25 pr-8",
            selectedId === project.id
              ? "bg-accent text-accent-foreground"
              : "hover:bg-accent hover:text-accent-foreground",
            isSelected && "ring-1 ring-ring bg-accent/60",
            project.isArchived && "opacity-60",
            project.isFinished && "opacity-70",
          )}
          onClick={handleProjectClick}
          onKeyDown={(event) => {
            if (event.currentTarget !== event.target) return;
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            handleProjectClick();
          }}
        >
          {/* Checkbox for multi-select */}
          {!isCollapsed && onToggleProjectSelection && (
            <Checkbox
              aria-label={`Select ${project.name}`}
              checked={isSelected}
              onCheckedChange={() => onToggleProjectSelection(project.id)}
              onClick={(event) => event.stopPropagation()}
              className={cn(
                isMultiSelecting
                  ? "opacity-100"
                  : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
              )}
            />
          )}
          <span className="relative shrink-0">
            <span
              className={cn(
                "flex items-center justify-center rounded-md border bg-background text-muted-foreground",
                isCollapsed ? "size-6.5" : variant === "homepage" ? "size-9" : "size-5",
              )}
              style={
                subject
                  ? {
                      backgroundColor: subject.color + "14",
                      color: subject.color,
                    }
                  : undefined
              }
            >
              <ProjectIcon
                className={cn(isCollapsed ? "size-4" : variant === "homepage" ? "size-4" : "size-3")}
                aria-hidden="true"
              />
            </span>
            {project.isLinked && isCollapsed && (
              <span className="absolute -bottom-0.5 -right-0.5 flex h-2.5 w-2.5 items-center justify-center rounded-full bg-primary ring-1 ring-background">
                <Link className="size-2 text-primary-foreground" />
              </span>
            )}
          </span>
          {!isCollapsed && (
            <div className="min-w-0 flex-1">
              <div className="flex w-full min-w-0 items-center gap-1">
                <p className={cn("w-0 min-w-0 flex-1 truncate font-medium", variant === "homepage" ? "text-sm leading-5" : "text-xs leading-4")}>
                  {project.name}
                </p>
                <div className="flex shrink-0 items-center gap-1">
                  {project.isFinished && (
                    <span className="hidden text-xs font-medium text-green-600 dark:text-green-400 min-[1050px]:inline-flex">
                      Done
                    </span>
                  )}
                  {project.isLinked && (
                    <span
                      className="text-muted-foreground/70"
                      title="Linked folder"
                    >
                      <Link className="size-3" aria-hidden="true" />
                    </span>
                  )}
                </div>
                {variant !== "homepage" && fileCounts[project.id] > 0 && (
                  <span
                    className={cn(
                      "ml-2 text-sm text-muted-foreground tabular-nums shrink-0 max-[900px]:hidden inline-block",
                      bumpProjectIds?.has(project.id) && "animate-badge-bump",
                    )}
                  >
                    {fileCounts[project.id]}
                  </span>
                )}
              </div>
              {variant === "homepage" && (
                <p className="mt-0.5 truncate text-xs text-muted-foreground">
                  {[subject?.name, project.description].filter(Boolean).join(" · ") || "Unassigned assessment"}
                </p>
              )}
              {variant !== "homepage" && project.deadline && !project.isFinished && (
                <div className="mt-0.5 flex max-w-full items-center gap-1 overflow-hidden">
                  <span
                    className="flex items-center gap-0.5 text-xs text-muted-foreground/70 select-none max-[900px]:hidden"
                    style={{ color: deadlineInfo.color }}
                  >
                    <DeadlineIcon className="size-2.5" aria-hidden="true" />
                    {deadlineInfo.label}
                  </span>
                  <span
                    className={cn(
                      "truncate text-xs font-medium select-none",
                      isOverdue(project.deadline)
                        ? "text-destructive"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatDeadline(project.deadline)}
                  </span>
                </div>
              )}
            </div>
          )}
          {!isCollapsed && variant === "homepage" && (
            <>
              <div className="hidden items-center gap-1.5 text-xs tabular-nums text-muted-foreground min-[1100px]:flex">
                <FileText className="size-3.5" aria-hidden="true" />
                <span className={cn(bumpProjectIds?.has(project.id) && "animate-badge-bump")}>
                  {fileCounts[project.id] ?? 0}
                </span>
              </div>
              <div className="hidden min-w-0 min-[1100px]:block">
                <div className={cn(
                  "flex items-center gap-1.5 text-xs",
                  project.isFinished ? "text-success" : overdue ? "text-destructive" : "text-muted-foreground",
                )}>
                  {project.isFinished ? <CheckCircle2 className="size-3.5" aria-hidden="true" /> : <Circle className="size-3.5" aria-hidden="true" />}
                  <span className="truncate">{statusLabel}</span>
                </div>
                {!project.isFinished && !overdue && (
                  <div className="mt-1 flex items-center gap-1.5">
                    <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={`${project.name} progress`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
                      <div className="h-full rounded-full bg-primary" style={{ width: `${progress}%` }} />
                    </div>
                    <span className="text-caption tabular-nums text-muted-foreground">{progress}%</span>
                  </div>
                )}
              </div>
              <div className="hidden min-w-0 min-[760px]:block">
                <p className={cn("truncate text-xs font-medium", overdue && !project.isFinished ? "text-destructive" : "text-foreground/85")}>
                  {deadlineLabel}
                </p>
                <p className="mt-0.5 truncate text-caption text-muted-foreground">
                  {deadlineMeta}
                </p>
              </div>
            </>
          )}
          {!isCollapsed && (
            <div className={cn("shrink-0", variant === "homepage" ? "relative" : "absolute right-1.5 top-1/2 -translate-y-1/2")}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    aria-label={`Assessment actions for ${project.name}`}
                    variant="ghost"
                    size="icon-xs"
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-44">
                  {onOpenProjectSettings && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.stopPropagation();
                        onOpenProjectSettings(project.id);
                      }}
                    >
                      <Pencil />
                      Rename
                    </DropdownMenuItem>
                  )}
                  {onDuplicateProject && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.stopPropagation();
                        onDuplicateProject(project.id);
                      }}
                    >
                      <Copy />
                      Duplicate
                    </DropdownMenuItem>
                  )}
                  {onToggleFinished && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.stopPropagation();
                        onToggleFinished(project.id);
                      }}
                    >
                      <CheckCircle2
                        className={cn(
                          project.isFinished && "text-green-500",
                        )}
                      />
                      {project.isFinished ? "Mark current" : "Mark complete"}
                    </DropdownMenuItem>
                  )}
                  {onToggleFavorite && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.stopPropagation();
                        onToggleFavorite(project.id);
                      }}
                    >
                      <Star
                        className={cn(
                          project.isFavorite && "fill-yellow-400 text-yellow-400",
                        )}
                      />
                      {project.isFavorite ? "Unstar" : "Star"}
                    </DropdownMenuItem>
                  )}
                  {onToggleArchive && (
                    <DropdownMenuItem
                      onSelect={(event) => {
                        event.stopPropagation();
                        onToggleArchive(project.id);
                      }}
                    >
                      <Archive />
                      {project.isArchived ? "Restore" : "Archive"}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    variant="destructive"
                    onSelect={(event) => {
                      event.stopPropagation();
                      onDelete(project.id);
                    }}
                  >
                    <Trash2 />
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          )}
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-44">
        {onOpenProjectSettings && (
          <CtxMenuItem
            onSelect={(event) => {
              event.stopPropagation();
              onOpenProjectSettings(project.id);
            }}
          >
            <Pencil />
            Rename
          </CtxMenuItem>
        )}
        <CtxMenuItem
          onSelect={(event) => {
            event.stopPropagation();
            const subjectIds = project.subjectId ? [project.subjectId] : [];
            void onStartPomodoroSession({
              subjectIds,
              durationSeconds: 25 * 60,
              projectId: project.id,
              cycleNumber: 0,
            });
          }}
        >
          <Timer />
          Start Session
        </CtxMenuItem>
        {onAddFile && (
          <CtxMenuItem
            onSelect={(event) => {
              event.stopPropagation();
              onAddFile(project.id);
            }}
          >
            <Upload />
            Add File
          </CtxMenuItem>
        )}
        <CtxMenuSep />
        {onDuplicateProject && (
          <CtxMenuItem
            onSelect={(event) => {
              event.stopPropagation();
              onDuplicateProject(project.id);
            }}
          >
            <Copy />
            Duplicate
          </CtxMenuItem>
        )}
        {onToggleFinished && (
          <CtxMenuItem
            onSelect={(event) => {
              event.stopPropagation();
              onToggleFinished(project.id);
            }}
          >
            <CheckCircle2 />
            {project.isFinished ? "Mark current" : "Mark complete"}
          </CtxMenuItem>
        )}
        {onToggleFavorite && (
          <CtxMenuItem
            onSelect={(event) => {
              event.stopPropagation();
              onToggleFavorite(project.id);
            }}
          >
            <Star />
            {project.isFavorite ? "Unstar" : "Star"}
          </CtxMenuItem>
        )}
        {onToggleArchive && (
          <CtxMenuItem
            onSelect={(event) => {
              event.stopPropagation();
              onToggleArchive(project.id);
            }}
          >
            <Archive />
            {project.isArchived ? "Restore" : "Archive"}
          </CtxMenuItem>
        )}
        <CtxMenuSep />
        <CtxMenuItem
          variant="destructive"
          onSelect={(event) => {
            event.stopPropagation();
            onDelete(project.id);
          }}
        >
          <Trash2 />
          Delete
        </CtxMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
});
