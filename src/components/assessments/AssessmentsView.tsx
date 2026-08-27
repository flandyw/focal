import { memo, useMemo, useRef, useState, type DragEvent } from "react";
import {
  Archive,
  ArrowUpDown,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Files,
  FolderOpen,
  ListChecks,
  Plus,
  Search,
  Star,
  TriangleAlert,
  X,
  type LucideIcon,
} from "lucide-react";
import { AssessmentRow } from "@/components/project/AssessmentRow";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { sortProjects, type ProjectSortKey } from "@/hooks/useProjects";
import type { Project, StudySession } from "@/lib/types";
import { getSubjectById, isOverdue } from "@/lib/utils";

type FilterMode = "active" | "favorites" | "finished" | "archived";

const FILTERS: { mode: FilterMode; label: string; icon: LucideIcon }[] = [
  { mode: "active", label: "Current", icon: CircleDot },
  { mode: "favorites", label: "Starred", icon: Star },
  { mode: "finished", label: "Completed", icon: CheckCircle2 },
  { mode: "archived", label: "Archived", icon: Archive },
];

const SORT_OPTIONS: { key: ProjectSortKey; label: string }[] = [
  { key: "deadline", label: "Deadline" },
  { key: "name", label: "Name A–Z" },
  { key: "created-newest", label: "Newest" },
  { key: "created-oldest", label: "Oldest" },
  { key: "fileCount", label: "File count" },
];

interface AssessmentsViewProps {
  projects: Project[];
  fileCounts: Record<string, number>;
  bumpProjectIds?: Set<string>;
  sortKey: ProjectSortKey;
  onSortChange: (key: ProjectSortKey) => void;
  selectedProjectIds: Set<string>;
  onToggleProjectSelection: (id: string) => void;
  onSelectProject: (id: string) => void;
  onNewProject: () => void;
  onDelete: (id: string) => void;
  onOpenProjectSettings: (id: string) => void;
  onDuplicateProject: (id: string) => void;
  onToggleFavorite: (id: string) => void;
  onToggleArchive: (id: string) => void;
  onToggleFinished: (id: string) => void;
  onStartSession: (data: {
    subjectIds: string[];
    durationSeconds: number;
    projectId?: string;
    cycleNumber: number;
  }) => Promise<StudySession>;
  onAddFile: (projectId: string) => void;
  onDropFolder?: (path: string) => void;
  onBulkArchive: (ids: string[]) => void;
  onBulkUnarchive: (ids: string[]) => void;
  onBulkFinish: (ids: string[]) => void;
  onBulkDelete: (ids: string[]) => void;
}

export const AssessmentsView = memo(function AssessmentsView({
  projects,
  fileCounts,
  bumpProjectIds,
  sortKey,
  onSortChange,
  selectedProjectIds,
  onToggleProjectSelection,
  onSelectProject,
  onNewProject,
  onDelete,
  onOpenProjectSettings,
  onDuplicateProject,
  onToggleFavorite,
  onToggleArchive,
  onToggleFinished,
  onStartSession,
  onAddFile,
  onDropFolder,
  onBulkArchive,
  onBulkUnarchive,
  onBulkFinish,
  onBulkDelete,
}: AssessmentsViewProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>("active");
  const [subjectId, setSubjectId] = useState("all");
  const [query, setQuery] = useState("");
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);

  const handleDragEnter = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFolder) return;
    event.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  };
  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFolder) return;
    event.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    if (!onDropFolder) return;
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    const uri = event.dataTransfer.getData("text/uri-list").split(/\r?\n/).find((line) => line.trim().startsWith("file://"));
    const uriPath = uri?.trim();
    const path = uriPath ?? event.dataTransfer.getData("text/plain").trim();
    if (path) onDropFolder(path);
  };

  const counts = useMemo(() => {
    let active = 0;
    let favorites = 0;
    let finished = 0;
    let archived = 0;
    let dueSoon = 0;
    let overdue = 0;
    const now = Date.now();
    const nextWeek = now + 7 * 24 * 60 * 60 * 1000;
    for (const project of projects) {
      if (project.isArchived) archived += 1;
      else if (project.isFinished) finished += 1;
      else {
        active += 1;
        if (project.isFavorite) favorites += 1;
        const deadline = project.deadline ? new Date(project.deadline).getTime() : Number.NaN;
        if (Number.isFinite(deadline) && deadline >= now && deadline <= nextWeek) dueSoon += 1;
        if (project.deadline && isOverdue(project.deadline)) overdue += 1;
      }
    }
    const materials = Object.values(fileCounts).reduce((total, count) => total + count, 0);
    return { active, favorites, finished, archived, dueSoon, overdue, materials };
  }, [fileCounts, projects]);

  const statusProjects = useMemo(() => projects.filter((project) => {
      const inFilter = filterMode === "archived"
        ? project.isArchived
        : filterMode === "finished"
          ? project.isFinished && !project.isArchived
          : filterMode === "favorites"
            ? project.isFavorite && !project.isFinished && !project.isArchived
            : !project.isFinished && !project.isArchived;
      return inFilter;
    }), [filterMode, projects]);

  const subjectTabs = useMemo(() => {
    const tabs = new Map<string, { label: string; count: number }>();
    for (const project of statusProjects) {
      const subject = getSubjectById(project.subjectId);
      const id = project.subjectId ?? "unassigned";
      const current = tabs.get(id);
      tabs.set(id, { label: subject?.name ?? "Unassigned", count: (current?.count ?? 0) + 1 });
    }
    return [...tabs.entries()]
      .map(([id, tab]) => ({ id, ...tab }))
      .sort((a, b) => a.id === "unassigned" ? 1 : b.id === "unassigned" ? -1 : a.label.localeCompare(b.label));
  }, [statusProjects]);

  const selectedSubjectId = subjectId === "all" || subjectTabs.some((tab) => tab.id === subjectId)
    ? subjectId
    : "all";

  const filtered = useMemo(() => {
    const normalisedQuery = query.trim().toLocaleLowerCase();
    return sortProjects(statusProjects, sortKey, fileCounts).filter((project) => {
      if (selectedSubjectId !== "all" && (project.subjectId ?? "unassigned") !== selectedSubjectId) return false;
      if (!normalisedQuery) return true;
      const subject = getSubjectById(project.subjectId);
      return [project.name, project.description, subject?.name, subject?.shortCode]
        .some((value) => value?.toLocaleLowerCase().includes(normalisedQuery));
    });
  }, [fileCounts, query, selectedSubjectId, sortKey, statusProjects]);

  const selectedIds = filtered.filter((project) => selectedProjectIds.has(project.id)).map((project) => project.id);
  const allSelected = filtered.length > 0 && selectedIds.length === filtered.length;
  const filterCount = (mode: FilterMode) => counts[mode];
  const clearSelection = () => selectedProjectIds.forEach(onToggleProjectSelection);
  const toggleAll = () => {
    if (allSelected) selectedIds.forEach(onToggleProjectSelection);
    else filtered.forEach((project) => {
      if (!selectedProjectIds.has(project.id)) onToggleProjectSelection(project.id);
    });
  };
  const sortLabel = SORT_OPTIONS.find((option) => option.key === sortKey)?.label ?? "Sort";
  const selectedSubjectLabel = selectedSubjectId === "all"
    ? "All subjects"
    : subjectTabs.find((tab) => tab.id === selectedSubjectId)?.label ?? "All subjects";

  return (
    <div
      className="relative flex h-full min-h-0 flex-col bg-background"
      onDragEnter={handleDragEnter}
      onDragOver={(event) => onDropFolder && event.preventDefault()}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragOver && (
        <div className="pointer-events-none absolute inset-3 z-50 flex items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-background/90 backdrop-blur-sm" role="status" aria-live="polite">
          <div className="text-center">
            <span className="mx-auto flex size-12 items-center justify-center rounded-xl bg-primary/10 text-primary"><FolderOpen /></span>
            <p className="mt-3 font-semibold">Drop folder to create assessment</p>
          </div>
        </div>
      )}
      <header className="border-b border-border/70 px-6 pb-0 pt-6 lg:px-10 lg:pt-8">
        <div className="mx-auto flex max-w-[94rem] items-start justify-between gap-6">
          <div>
            <p className="text-micro font-semibold uppercase tracking-wider text-muted-foreground">Study library</p>
            <h1 className="mt-1 font-display text-3xl font-semibold tracking-[-0.035em]">Assessments</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              All your assessment materials, deadlines and study work in one place.
            </p>
          </div>
          <Button className="mt-1" onClick={onNewProject}>
            <Plus />
            New assessment
          </Button>
        </div>
        <div className="mx-auto mt-7 grid max-w-[94rem] grid-cols-2 divide-x divide-border/70 overflow-hidden sm:grid-cols-3 lg:grid-cols-5">
          <div className="px-0 pb-5 pr-5">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><BookOpen className="size-3.5" />Current</p>
            <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums">{counts.active}</p>
            <p className="mt-0.5 text-caption text-muted-foreground">Across {subjectTabs.length} subjects</p>
          </div>
          <div className="px-5 pb-5">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Clock3 className="size-3.5" />Due in 7 days</p>
            <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums">{counts.dueSoon}</p>
            <p className="mt-0.5 text-caption text-muted-foreground">Needs attention soon</p>
          </div>
          <div className="hidden px-5 pb-5 sm:block">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><TriangleAlert className="size-3.5" />Overdue</p>
            <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums">{counts.overdue}</p>
            <p className="mt-0.5 text-caption text-muted-foreground">Past deadline</p>
          </div>
          <div className="hidden px-5 pb-5 lg:block">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5" />Completed</p>
            <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums">{counts.finished}</p>
            <p className="mt-0.5 text-caption text-muted-foreground">Finished work</p>
          </div>
          <div className="hidden px-5 pb-5 lg:block">
            <p className="flex items-center gap-2 text-xs text-muted-foreground"><Files className="size-3.5" />Materials</p>
            <p className="mt-1.5 font-heading text-2xl font-semibold tabular-nums">{counts.materials}</p>
            <p className="mt-0.5 text-caption text-muted-foreground">Resources and notes</p>
          </div>
        </div>
      </header>

      <div className="border-b border-border/70 px-6 lg:px-10">
        <div className="mx-auto flex max-w-[94rem] items-center gap-1 overflow-x-auto py-0" role="tablist" aria-label="Assessment subjects">
          <button
            type="button"
            role="tab"
            aria-selected={selectedSubjectId === "all"}
            onClick={() => setSubjectId("all")}
            className={selectedSubjectId === "all"
              ? "relative shrink-0 px-3 py-3 text-xs font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary"
              : "shrink-0 px-3 py-3 text-xs text-muted-foreground transition-colors hover:text-foreground"}
          >
            All subjects
          </button>
          {subjectTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={selectedSubjectId === tab.id}
              onClick={() => setSubjectId(tab.id)}
              className={selectedSubjectId === tab.id
                ? "relative shrink-0 px-3 py-3 text-xs font-medium text-foreground after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary"
                : "shrink-0 px-3 py-3 text-xs text-muted-foreground transition-colors hover:text-foreground"}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border-b border-border/70 px-6 py-3 lg:px-10">
        <div className="mx-auto flex max-w-[94rem] flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-muted/60 p-1" role="group" aria-label="Filter assessments">
            {FILTERS.map(({ mode, label, icon: Icon }) => (
              <Button
                key={mode}
                variant={filterMode === mode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  clearSelection();
                  setFilterMode(mode);
                  setSubjectId("all");
                }}
                aria-pressed={filterMode === mode}
              >
                <Icon className="max-[1200px]:hidden" />
                {label}
                <span className="text-xs tabular-nums text-muted-foreground max-[1200px]:hidden">{filterCount(mode)}</span>
              </Button>
            ))}
          </div>
          <div className="relative ml-auto min-w-48 flex-1 sm:max-w-64">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search assessments"
              aria-label="Search assessments"
              className="pl-8 pr-8"
            />
            {query && (
              <Button variant="ghost" size="icon-xs" className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setQuery("")} aria-label="Clear search">
                <X />
              </Button>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" aria-label={`Sort assessments. Current order: ${sortLabel}`}>
                <ArrowUpDown />
                {sortLabel}
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuRadioGroup value={sortKey} onValueChange={(value) => onSortChange(value as ProjectSortKey)}>
                {SORT_OPTIONS.map((option) => (
                  <DropdownMenuRadioItem key={option.key} value={option.key}>{option.label}</DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
          {filtered.length > 0 && (
            <Button variant="ghost" size="sm" onClick={toggleAll} aria-pressed={allSelected} title={allSelected ? "Clear selection" : "Select all assessments"}>
              <ListChecks />
              <span className="max-[1050px]:hidden">{allSelected ? "Clear" : "Select all"}</span>
            </Button>
          )}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="mx-auto max-w-[94rem] px-6 py-5 lg:px-10">
          <div className="mb-4 flex items-baseline gap-2">
            <h2 className="font-display text-xl font-semibold tracking-tight">{selectedSubjectLabel}</h2>
            <span className="text-xs tabular-nums text-muted-foreground">{filtered.length} assessments</span>
          </div>
          {filtered.length > 0 ? (
            <section aria-label={`${selectedSubjectLabel} assessments`} className="border-y border-border/70">
              <div className="grid grid-cols-[auto_auto_minmax(0,1fr)_2rem] items-center gap-3 border-b border-border/70 px-3 py-2 text-micro font-medium uppercase tracking-wide text-muted-foreground min-[760px]:grid-cols-[auto_auto_minmax(0,1fr)_8rem_2rem] min-[1100px]:grid-cols-[auto_auto_minmax(0,1fr)_5rem_8rem_8rem_2rem]">
                <span className="col-span-3">Assessment</span>
                <span className="hidden min-[1100px]:block">Materials</span>
                <span className="hidden min-[1100px]:block">Status</span>
                <span className="hidden min-[760px]:block">Due date</span>
                <span className="sr-only">Actions</span>
              </div>
              <div>
                {filtered.map((project) => (
                  <AssessmentRow
                    key={project.id}
                    project={project}
                    variant="homepage"
                    isCollapsed={false}
                    selectedId={null}
                    selectedProjectIds={selectedProjectIds}
                    onToggleProjectSelection={onToggleProjectSelection}
                    onSelect={onSelectProject}
                    fileCounts={fileCounts}
                    bumpProjectIds={bumpProjectIds}
                    onOpenProjectSettings={onOpenProjectSettings}
                    onDuplicateProject={onDuplicateProject}
                    onToggleFinished={onToggleFinished}
                    onToggleFavorite={onToggleFavorite}
                    onToggleArchive={onToggleArchive}
                    onDelete={onDelete}
                    onStartPomodoroSession={onStartSession}
                    onAddFile={onAddFile}
                  />
                ))}
              </div>
            </section>
          ) : (
            <div className="flex min-h-72 flex-col items-center justify-center border-y border-dashed px-6 text-center">
              <span className="flex size-12 items-center justify-center rounded-xl bg-muted text-muted-foreground"><FolderOpen /></span>
              <h2 className="mt-4 font-display text-lg font-semibold">
                {query.trim() ? "No matching assessments" : filterMode === "active" ? "No current assessments" : `No ${FILTERS.find((filter) => filter.mode === filterMode)?.label.toLocaleLowerCase()} assessments`}
              </h2>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {query.trim() ? "Try a different name or subject." : filterMode === "active" ? "Create an assessment when you need a dedicated home for its materials and plan." : "Items moved here will appear in this view."}
              </p>
              {query.trim() ? (
                <Button variant="outline" className="mt-4" onClick={() => setQuery("")}>Clear search</Button>
              ) : filterMode === "active" ? (
                <Button className="mt-4" onClick={onNewProject}><Plus />New assessment</Button>
              ) : (
                <Button variant="outline" className="mt-4" onClick={() => { setFilterMode("active"); setSubjectId("all"); }}>Show current</Button>
              )}
            </div>
          )}
        </div>
      </ScrollArea>

      {selectedIds.length > 0 && (
        <div className="border-t bg-card px-6 py-2.5 lg:px-10" role="region" aria-label="Selected assessment actions">
          <div className="mx-auto flex max-w-[94rem] items-center gap-2">
            <span className="mr-auto text-sm font-medium tabular-nums">{selectedIds.length} selected</span>
            <Button variant="ghost" size="sm" onClick={() => selectedIds.forEach(onToggleProjectSelection)}>Clear</Button>
            {filterMode === "archived" ? (
              <Button variant="outline" size="sm" onClick={() => onBulkUnarchive(selectedIds)}>Restore</Button>
            ) : (
              <Button variant="outline" size="sm" onClick={() => onBulkArchive(selectedIds)}>Archive</Button>
            )}
            <Button variant="outline" size="sm" onClick={() => onBulkFinish(selectedIds)}>Complete</Button>
            <Button variant="destructive" size="sm" onClick={() => onBulkDelete(selectedIds)}>Delete</Button>
          </div>
        </div>
      )}
    </div>
  );
});
