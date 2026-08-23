import { createElement } from "react";
import {
  Clock,
  Download,
  Folder,
  Bookmark,
  Link,
  Settings,
  FolderUp,
  Plus,
  CheckCircle2,
  RefreshCw,
  Pencil,
  CalendarPlus,
  ListChecks,
  Play,
  Brain,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  formatDeadline,
  isOverdue,
  getSubjectById,
  getDeadlineTypeInfo,
  getSessionEffectiveMinutes,
} from "@/lib/utils";
import type {
  Project,
  StudySession,
} from "@/lib/types";
import { getProjectIcon } from "./shared";

interface ProjectHeaderProps {
  project: Project;
  sessions: StudySession[];
  viewMode: "files" | "sessions" | "learning";
  onViewModeChange: (mode: "files" | "sessions" | "learning") => void;
  onOpenSettings: () => void;
  onToggleFinished?: (id: string) => void;
  onOpenFolder: () => void;
  onAddFiles: () => void;
  onRefresh?: () => void;
  hasPendingChanges?: boolean;
  onExport?: () => void;
  onSaveAsTemplate?: () => void;
  onPlanSession?: () => void;
  onStartFocus?: () => void;
}

export function ProjectHeader({
  project,
  sessions,
  viewMode,
  onViewModeChange,
  onOpenSettings,
  onToggleFinished,
  onOpenFolder,
  onAddFiles,
  onRefresh,
  hasPendingChanges,
  onExport,
  onSaveAsTemplate,
  onPlanSession,
  onStartFocus,
}: ProjectHeaderProps) {
  const subject = getSubjectById(project.subjectId);
  const deadlineInfo = getDeadlineTypeInfo(project.deadlineType);
  const projectIcon = getProjectIcon(project.subjectId);
  const checklist = project.checklist ?? [];
  const completedTasks = checklist.filter((item) => item.completed).length;
  const nextTask = checklist.find((item) => !item.completed)?.text;
  const plannedMinutes = sessions
    .filter((session) => session.status === "planned" && new Date(session.startTime) >= new Date())
    .reduce((total, session) => total + getSessionEffectiveMinutes(session), 0);
  return (
    <div className="border-b">
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 min-[1200px]:px-5">
        {/* Left: icon + title + inline metadata */}
        <div className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted"
            style={
              subject
                ? {
                    backgroundColor: subject.color + "14",
                    color: subject.color,
                  }
                : undefined
            }
          >
            {createElement(projectIcon, {
              className: "size-4",
              "aria-hidden": true,
            })}
          </span>

          <div className="flex min-w-0 items-center gap-2">
            <div className="group/left flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-base font-medium">{project.name}</h2>
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onOpenSettings}
                className="shrink-0 opacity-0 focus-visible:opacity-100 group-hover/left:opacity-100"
                aria-label={`Rename ${project.name}`}
                title="Rename"
              >
                <Pencil />
              </Button>
            </div>

            <div className="hidden items-center gap-1 sm:flex">
              {project.deadline && (
                <Badge
                  variant={
                    !project.isFinished && isOverdue(project.deadline)
                      ? "destructive"
                      : "secondary"
                  }
                  style={
                    project.deadlineType
                      ? {
                          backgroundColor: deadlineInfo.color + "14",
                          color: deadlineInfo.color,
                        }
                      : undefined
                  }
                >
                  {deadlineInfo.icon} {formatDeadline(project.deadline)}
                </Badge>
              )}
              {project.isLinked && (
                <Badge variant="outline" className="hidden lg:flex">
                  <Link aria-hidden="true" />
                  Linked
                </Badge>
              )}
            </div>
          </div>
        </div>

        {/* Right: view toggle + actions */}
        <div className="flex shrink-0 items-center gap-1">
          {/* View toggle */}
          <div className="flex items-center gap-0.5 rounded-lg bg-muted p-0.5">
            <Button
              variant={viewMode === "files" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => onViewModeChange("files")}
              aria-pressed={viewMode === "files"}
            >
              <Folder />
              Files
            </Button>
            <Button
              variant={viewMode === "sessions" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => onViewModeChange("sessions")}
              aria-pressed={viewMode === "sessions"}
            >
              <Clock />
              Sessions
              {sessions.length > 0 && (
                <span className="tabular-nums">{sessions.length}</span>
              )}
            </Button>
            <Button
              variant={viewMode === "learning" ? "secondary" : "ghost"}
              size="xs"
              onClick={() => onViewModeChange("learning")}
              aria-pressed={viewMode === "learning"}
            >
              <Brain />
              Learn
              {(project.studyCards?.length ?? 0) > 0 && (
                <span className="tabular-nums">{project.studyCards?.length}</span>
              )}
            </Button>
          </div>

          <div className="mx-1 hidden h-4 w-px bg-border/60 sm:block" />

          <Tooltip>
            <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onOpenSettings}
                aria-label="Assessment details"
              >
                <Settings />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Assessment details</TooltipContent>
          </Tooltip>

          {onRefresh && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative"
                  onClick={onRefresh}
                  aria-label={hasPendingChanges ? "Refresh files with external changes" : "Refresh files"}
                >
                  <RefreshCw />
                  {hasPendingChanges && (
                    <span
                      aria-hidden
                      className="absolute right-0 top-0 size-2 rounded-full bg-primary ring-2 ring-background"
                    />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {hasPendingChanges
                  ? "External changes detected — click to refresh"
                  : "Refresh files"}
              </TooltipContent>
            </Tooltip>
          )}

          {onToggleFinished && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => onToggleFinished(project.id)}
                  aria-label={project.isFinished ? "Mark as current" : "Mark as complete"}
                >
                  <CheckCircle2 className={project.isFinished ? "text-success" : undefined} />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {project.isFinished ? "Mark as current" : "Mark as complete"}
              </TooltipContent>
            </Tooltip>
          )}

          {onSaveAsTemplate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onSaveAsTemplate}
                  aria-label="Save as template"
                >
                  <Bookmark />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Save as template</TooltipContent>
            </Tooltip>
          )}

          {onExport && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onExport}
                  aria-label="Export project"
                >
                  <Download />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">Export project</TooltipContent>
            </Tooltip>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={onOpenFolder}
              >
                <FolderUp />
                <span className="max-[950px]:hidden">Open folder</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="bottom">Open in Finder</TooltipContent>
          </Tooltip>

          <Button size="sm" onClick={onAddFiles}>
            <Plus />
            <span>Add files</span>
          </Button>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-4 py-2.5 min-[1200px]:px-5">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <ListChecks className="size-4" />
            {checklist.length > 0 ? (
              <><span className="font-medium text-foreground">{completedTasks}/{checklist.length}</span> tasks ready</>
            ) : (
              <span className="font-medium text-foreground">No tasks yet</span>
            )}
          </span>
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="size-4" />
            <span className="font-medium text-foreground">{Math.round(plannedMinutes / 6) / 10}h</span> planned
          </span>
          <span className="min-w-0 truncate text-muted-foreground">
            Next action: <span className="font-medium text-foreground">{nextTask ?? "Define the first task"}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          {onPlanSession && (
            <Button variant="outline" size="sm" onClick={onPlanSession}>
              <CalendarPlus />
              Plan
            </Button>
          )}
          {onStartFocus && (
            <Button size="sm" onClick={onStartFocus} disabled={!project.subjectId}>
              <Play />
              Start focus
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
