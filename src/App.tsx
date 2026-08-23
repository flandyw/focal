import {
  lazy,
  Suspense,
  memo,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { platform } from "@tauri-apps/plugin-os";
import { downloadDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-dialog";
import {
  AnimatePresence,
  MotionConfig,
  motion,
  useReducedMotion,
} from "framer-motion";
import {
  MOTION_DURATION,
  MOTION_EASE,
  pressable as pressableMotion,
  staggerContainer,
  staggerItem,
} from "@/lib/motion";
import { Toaster, toast } from "sonner";
import { FolderOpen, Loader2 } from "lucide-react";
import { useProjects, type ProjectSortKey } from "@/hooks/useProjects";
import { useProjectsDirectoryWatcher } from "@/hooks/useProjectsDirectoryWatcher";
import { useStudySessions } from "@/hooks/useStudySessions";
import { useEvents } from "@/hooks/useEvents";
import { useDeadlineNotifications } from "@/hooks/useDeadlineNotifications";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";
import { useNotionSync } from "@/hooks/useNotionSync";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { useSupabaseSync } from "@/hooks/useSupabaseSync";
import { useTheme } from "@/lib/themes";
import { setCachedPreference } from "@/lib/storage/preferences";
import { useAppNavigation } from "@/features/shell/useAppNavigation";
import { useSyncedPreferences } from "@/features/preferences/useSyncedPreferences";
import { confirmDestructiveAction, confirmAction } from "@/lib/confirmToast";
import { showUndoToast } from "@/lib/undoToast";
import { sanitiseFolderName } from "@/lib/utils";
import {
  getProjectsRootPath,
} from "@/lib/settings";
import {
  isPomodoroSession,
  getPomodoroDescription,
  getPomodoroTitle,
  getUniqueStrings,
  getUniqueArrayItems,
} from "@/lib/pomodoro";
import {
  repeatCalendarEvent,
  repeatStudySession,
} from "@/lib/repeatPlanningItem";
import {
  mergedStudySessionTitle,
  mergeStudySessionTimelines,
  startPlannedStudySession,
} from "@/lib/studySessions";
import {
  forcePushAndMerge,
  forcePushAndOverwrite,
  pullNow,
  pushNow,
  clearFailedItems,
  retryFailedItem,
  dropQueueItem,
  resolveConflictAcceptRemote,
  resolveConflictKeepLocal,
  dismissConflict,
  clearConflicts,
} from "@/lib/sync/engine";
import type { SyncTable } from "@/lib/sync/types";
import { ErrorBoundary } from "@/components/shell/ErrorBoundary";
import { Sidebar } from "@/components/shell/Sidebar";
import { TitleBar } from "@/components/shell/TitleBar";
import type { EventDialogProps } from "@/components/planning/EventDialog";
import { NotionSyncIndicator } from "@/components/sync/NotionSyncIndicator";
import { SupabaseSyncIndicator } from "@/components/sync/SupabaseSyncIndicator";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  type CalendarEvent,
  type ConfidenceScore,
  type EventType,
  type PriorityItem,
  type StudySession,
  type StudySessionStatus,
} from "@/lib/types";
import type { ProjectTemplate } from "@/lib/types";

const TimetableView = lazy(() =>
  import("@/components/timetable/TimetableView").then((m) => ({
    default: m.TimetableView,
  })),
);
const SettingsView = lazy(() =>
  import("@/components/settings/SettingsView").then((m) => ({
    default: m.SettingsView,
  })),
);
const AnalyticsView = lazy(() =>
  import("@/components/analytics/AnalyticsView").then((m) => ({
    default: m.AnalyticsView,
  })),
);
const ExamTrackView = lazy(() =>
  import("@/components/examtrack/ExamTrackView").then((m) => ({
    default: m.ExamTrackView,
  })),
);
const AIAssistantPanel = lazy(() =>
  import("@/components/assistant/AIAssistantPanel").then((m) => ({
    default: m.AIAssistantPanel,
  })),
);
const AdaptivePlannerView = lazy(() => import("@/components/planning/AdaptivePlannerView").then((m) => ({ default: m.AdaptivePlannerView })));
const AcademicInboxView = lazy(() => import("@/components/inbox/AcademicInboxView").then((m) => ({ default: m.AcademicInboxView })));
const ProjectDetail = lazy(() => import("@/components/project/ProjectDetail").then((m) => ({ default: m.ProjectDetail })));
const HomeView = lazy(() => import("@/components/home/HomeView").then((m) => ({ default: m.HomeView })));
const ProjectDialog = lazy(() => import("@/components/project/ProjectDialog").then((m) => ({ default: m.ProjectDialog })));
const ProjectTemplateDialog = lazy(() => import("@/components/project/ProjectTemplateDialog").then((m) => ({ default: m.ProjectTemplateDialog })));
const StudySessionDialog = lazy(() => import("@/components/planning/StudySessionDialog").then((m) => ({ default: m.StudySessionDialog })));
const GlobalSearch = lazy(() => import("@/components/shell/GlobalSearch").then((m) => ({ default: m.GlobalSearch })));
const DataExport = lazy(() => import("@/components/settings/DataExport").then((m) => ({ default: m.DataExport })));
const CustomSubjects = lazy(() => import("@/components/settings/CustomSubjects").then((m) => ({ default: m.CustomSubjects })));
const NotionConflictDialog = lazy(() => import("@/components/sync/NotionConflictDialog").then((m) => ({ default: m.NotionConflictDialog })));
const EventDialog = lazy(() => import("@/components/planning/EventDialog").then((m) => ({ default: m.EventDialog })));
const KeyboardShortcutsDialog = lazy(() =>
  import("@/components/shell/KeyboardShortcutsDialog").then((m) => ({
    default: m.KeyboardShortcutsDialog,
  })),
);

function ViewFallback({ label }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label={label ? `Loading ${label}` : "Loading"}
      className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground"
    >
      <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
      {label ? `Loading ${label}…` : "Loading…"}
    </div>
  );
}

const SHELL_LAYOUT_TRANSITION = { duration: 0.24, ease: MOTION_EASE } as const;
const VIEW_TRANSITION = { duration: 0.18, ease: MOTION_EASE } as const;
const EMPTY_STATE_TRANSITION = {
  duration: MOTION_DURATION.slow,
  ease: MOTION_EASE,
} as const;

try {
  if (platform() !== "macos")
    document.documentElement.classList.add("non-macos");
} catch {
  /* Tauri runtime not available (dev/browser) */
}

function App() {
  const [projectsRoot, setProjectsRoot] = useState(() => getProjectsRootPath());

  // Initialize projects directory override from localStorage on startup
  useEffect(() => {
    if (projectsRoot) {
      invoke("set_projects_directory", { path: projectsRoot }).catch((e) => {
        console.error("Failed to set projects directory:", e);
        toast.warning(
          "Your saved projects folder could not be loaded. It may have been moved or deleted.",
        );
      });
    }
  }, [projectsRoot]);

  useProjectsDirectoryWatcher(projectsRoot);

  const {
    projects,
    addProject,
    updateProject,
    renameProjectFolder,
    changeProjectFolder,
    deleteProject,
    restoreProject,
    duplicateProject,
    bulkArchive,
    bulkUnarchive,
    bulkFinish,
    bulkDelete,
    addChecklistItem,
    addChecklistItems,
    toggleChecklistItem,
    removeChecklistItem,
    addDependency,
    removeDependency,
    getTemplates,
    saveAsTemplate,
    deleteTemplate,
    loadFromTemplate,
    scanAndImportProjects,
    linkFolderAsProject,
  } = useProjects();
  const {
    sessions,
    loading: sessionsLoading,
    addSession,
    addSessions,
    updateSession,
    updateSessions,
    deleteSession,
    deleteSessions,
    restoreSession,
    restoreSessions,
    restoreMergedSessions,
    updateAndDeleteSessions,
    syncSessions: rawSyncSessions,
  } = useStudySessions();
  const {
    events,
    loading: eventsLoading,
    addEvent,
    addEvents,
    updateEvent,
    updateEvents,
    deleteEvent,
    deleteEvents,
    restoreEvent,
    restoreEvents,
    updateAndDeleteEvents,
    syncEvents,
  } = useEvents();
  const navigation = useAppNavigation();
  const {
    selectedId,
    homeSelected,
    settingsView,
    analyticsView,
    examTrackView,
    timetableView,
    plannerView,
    inboxView,
  } = navigation;
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<StudySession | null>(
    null,
  );
  const [eventDialogOpen, setEventDialogOpen] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(
    null,
  );
  const [newItemInitialDate, setNewItemInitialDate] = useState<
    Date | undefined
  >(undefined);
  const [newItemDialogKey, setNewItemDialogKey] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [fileCounts, setFileCounts] = useState<Record<string, number>>({});
  const prevFileCountsRef = useRef<Record<string, number>>({});
  const [bumpProjectIds, setBumpProjectIds] = useState<Set<string>>(new Set());
  const bumpTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [subjectsOpen, setSubjectsOpen] = useState(false);
  const [aiAssistantOpen, setAiAssistantOpen] = useState(false);
  const [aiAssistantLoaded, setAiAssistantLoaded] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarSortKey, setSidebarSortKey] =
    useState<ProjectSortKey>("deadline");
  const [selectedProjectIds, setSelectedProjectIds] = useState<Set<string>>(
    new Set(),
  );
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [templateSaveProjectId, setTemplateSaveProjectId] = useState<
    string | null
  >(null);
  const [templates, setTemplates] = useState<ProjectTemplate[]>(() =>
    getTemplates(),
  );
  const [zoom, setZoom] = useState(() => {
    try {
      const stored = localStorage.getItem("focal-app-scale");
      const parsed = stored ? parseFloat(stored) : 1;
      return Number.isFinite(parsed) && parsed >= 0.5 && parsed <= 2
        ? parsed
        : 1;
    } catch {
      return 1;
    }
  });

  // Persist zoom to localStorage and apply natively via Tauri webview zoom
  useEffect(() => {
    setCachedPreference("focal-app-scale", String(zoom), false);
    invoke("window_set_zoom", { scale: zoom }).catch(() => {
      // Tauri not available (dev/browser mode)
    });
  }, [zoom]);

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + 0.1, 1.5));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - 0.1, 0.75));
  }, []);

  const handleZoomReset = useCallback(() => {
    setZoom(1);
  }, []);

  const reduceMotion = useReducedMotion();
  const {
    allSubjects,
    availableSubjects,
    customSubjects,
    hiddenSubjectIds,
    timetableConfig,
    setCustomSubjects,
    toggleSubjectVisibility: handleToggleSubjectVisibility,
    showAllSubjects: handleShowAllSubjects,
  } = useSyncedPreferences();
  const { mode, resolvedDark, seedColor, setMode, setSeedColor } = useTheme();
  const supabaseAuth = useSupabaseAuth();
  const supabaseSync = useSupabaseSync(supabaseAuth.session);
  const supabaseInitialSyncSettled = !supabaseAuth.loading && (
    !supabaseAuth.session
    || supabaseSync.status === "synced"
    || supabaseSync.status === "pending"
    || supabaseSync.status === "error"
  );
  const syncSessions = rawSyncSessions;

  const {
    syncStatus,
    lastSyncTime,
    notionConflicts,
    notionConflictDialogOpen,
    setNotionConflictDialogOpen,
    performNotionSync,
    requestNotionSync,
    pushEventChange,
    pushSessionChange,
    resolveConflicts,
  } = useNotionSync({
    events,
    sessions,
    allSubjects,
    syncEvents,
    syncSessions,
  });

  const initialAutoSyncDoneRef = useRef(false);
  useEffect(() => {
    if (eventsLoading || sessionsLoading || !supabaseInitialSyncSettled) return;
    if (initialAutoSyncDoneRef.current) return;
    initialAutoSyncDoneRef.current = true;
    void performNotionSync(false);
  }, [eventsLoading, sessionsLoading, performNotionSync, supabaseInitialSyncSettled]);

  useEffect(() => {
    if (eventsLoading || sessionsLoading || !supabaseInitialSyncSettled) return;
    const syncNow = () => {
      void requestNotionSync(false);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        syncNow();
      }
    };
    const interval = window.setInterval(syncNow, 60 * 1000);
    window.addEventListener("focus", syncNow);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", syncNow);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [eventsLoading, sessionsLoading, requestNotionSync, supabaseInitialSyncSettled]);

  const selectedProject = projects.find((p) => p.id === selectedId) ?? null;
  const selectedProjectSessions = useMemo(
    () =>
      selectedProject
        ? sessions.filter((s) => s.projectId === selectedProject.id)
        : [],
    [sessions, selectedProject],
  );

  const refreshFileCounts = useCallback(async () => {
    const results = await Promise.allSettled(
      projects.map((project) =>
        invoke<number>("get_project_file_count", {
          projectName: project.folder_path,
        }).then((count) => ({ id: project.id, count })),
      ),
    );
    const counts: Record<string, number> = {};
    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "fulfilled") {
        counts[result.value.id] = result.value.count;
      } else {
        counts[projects[i].id] = 0;
      }
    }
    const bumps = new Set<string>();
    for (const [id, count] of Object.entries(counts)) {
      const prev = prevFileCountsRef.current[id];
      if (prev !== undefined && prev !== count) {
        bumps.add(id);
      }
    }
    prevFileCountsRef.current = counts;
    setFileCounts(counts);
    if (bumps.size > 0) {
      setBumpProjectIds(bumps);
      if (bumpTimeoutRef.current) clearTimeout(bumpTimeoutRef.current);
      bumpTimeoutRef.current = setTimeout(() => {
        bumpTimeoutRef.current = null;
        setBumpProjectIds(new Set());
      }, 500);
    }
  }, [projects]);

  const projectCountTimeoutsRef = useRef<
    Record<string, ReturnType<typeof setTimeout>>
  >({});

  const refreshFileCountForProject = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;
      try {
        const count = await invoke<number>("get_project_file_count", {
          projectName: project.folder_path,
        });
        const prev = prevFileCountsRef.current[projectId];
        prevFileCountsRef.current = {
          ...prevFileCountsRef.current,
          [projectId]: count,
        };
        setFileCounts((prevCounts) => ({ ...prevCounts, [projectId]: count }));
        if (prev !== undefined && prev !== count) {
          setBumpProjectIds((prevBumps) => {
            const next = new Set(prevBumps);
            next.add(projectId);
            return next;
          });
          if (bumpTimeoutRef.current) clearTimeout(bumpTimeoutRef.current);
          bumpTimeoutRef.current = setTimeout(() => {
            bumpTimeoutRef.current = null;
            setBumpProjectIds(new Set());
          }, 500);
        }
      } catch (e) {
        console.error(
          `Failed to refresh file count for project ${projectId}:`,
          e,
        );
      }
    },
    [projects],
  );

  const debouncedRefreshFileCountForProject = useCallback(
    (projectId: string) => {
      if (projectCountTimeoutsRef.current[projectId]) {
        clearTimeout(projectCountTimeoutsRef.current[projectId]);
      }
      projectCountTimeoutsRef.current[projectId] = setTimeout(() => {
        delete projectCountTimeoutsRef.current[projectId];
        void refreshFileCountForProject(projectId);
      }, 200);
    },
    [refreshFileCountForProject],
  );

  // Keep study reminders current while the app remains open.
  useDeadlineNotifications(projects, events, sessions);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshFileCounts();
  }, [refreshFileCounts]);

  const handleSelectProject = useCallback((id: string) => {
    navigation.selectProject(id);
  }, [navigation]);

  const handleSelectHome = useCallback(() => {
    navigation.selectHome();
  }, [navigation]);

  const handleSelectTimetable = useCallback(() => {
    navigation.selectTimetable();
  }, [navigation]);

  const handleSelectPlanner = useCallback(() => {
    navigation.selectPlanner();
  }, [navigation]);

  const handleSelectInbox = useCallback(() => {
    navigation.selectInbox();
  }, [navigation]);

  const handleSelectAnalytics = useCallback(() => {
    navigation.selectAnalytics();
  }, [navigation]);

  const handleSelectExamTrack = useCallback(() => {
    navigation.selectExamTrack();
  }, [navigation]);

  const handleSelectSettings = useCallback(() => {
    navigation.openSettings();
  }, [navigation]);

  const handleOpenNewSession = useCallback((initialDate?: Date) => {
    setSelectedSession(null);
    setNewItemInitialDate(initialDate);
    setNewItemDialogKey((key) => key + 1);
    setSessionDialogOpen(true);
  }, []);

  const handleOpenNewEvent = useCallback((initialDate?: Date) => {
    setSelectedEvent(null);
    setNewItemInitialDate(initialDate);
    setNewItemDialogKey((key) => key + 1);
    setEventDialogOpen(true);
  }, []);

  const handleOpenAiAssistant = useCallback(() => {
    setAiAssistantLoaded(true);
    setAiAssistantOpen(true);
  }, []);

  const handleOpenFocus = useCallback(() => {
    window.dispatchEvent(new CustomEvent("focal-focus-request", { detail: {} }));
  }, []);

  useKeyboardShortcuts({
    onSearch: () => setSearchOpen((open) => !open),
    onNewAssessment: () => setDialogOpen(true),
    onNewEvent: () => handleOpenNewEvent(),
    onNewSession: () => handleOpenNewSession(),
    onGoHome: handleSelectHome,
    onOpenFocus: handleOpenFocus,
    onGoTimetable: handleSelectTimetable,
    onGoAnalytics: handleSelectAnalytics,
    onGoSettings: handleSelectSettings,
    onOpenAiAssistant: handleOpenAiAssistant,
    onShowShortcuts: () => setShortcutsOpen(true),
    onToggleSidebar: () => setSidebarCollapsed((prev) => !prev),
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: handleZoomReset,
  });

  const handleOpenAiSettings = useCallback(() => {
    navigation.openSettings();
    setAiAssistantOpen(false);
  }, [navigation]);

  const handleAddFileFromSidebar = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;

      try {
        const selected = await open({
          multiple: true,
          directory: false,
          defaultPath: await downloadDir(),
        });
        if (!selected || selected.length === 0) return;

        await invoke("move_files_to_project", {
          files: selected,
          projectName: project.folder_path,
          copy: true,
        });
        await refreshFileCountForProject(projectId);
        toast.success(
          `Added ${selected.length} file${selected.length === 1 ? "" : "s"} to ${project.name}`,
        );
      } catch (e) {
        await refreshFileCountForProject(projectId);
        toast.error(`Failed to add all files: ${String(e)}`);
      }
    },
    [projects, refreshFileCountForProject],
  );
  const handleResolveConflicts = useCallback(
    (resolutions: Record<string, "local" | "notion" | "skip">) => {
      return resolveConflicts(resolutions);
    },
    [resolveConflicts],
  );

  const handleCreateProject = useCallback(
    async (data: {
      name: string;
      description?: string;
      icon?: string;
      subjectId?: string;
      unit?: "1" | "2" | "3" | "4";
      deadline?: string;
      deadlineType?: "sac" | "exam" | "assignment";
    }) => {
      try {
        const project = await addProject(
          data.name,
          data.description,
          data.icon,
          data.deadline,
          data.subjectId,
          data.unit,
          data.deadlineType,
        );
        navigation.selectProject(project.id);
        toast.success(`Assessment "${data.name}" created`, {
          action: {
            label: "Add files",
            onClick: () => void handleAddFileFromSidebar(project.id),
          },
        });
      } catch (e) {
        toast.error(`Failed to create assessment: ${String(e)}`);
      }
    },
    [addProject, handleAddFileFromSidebar, navigation],
  );

  const handleUpdateProject = useCallback(
    async (
      id: string,
      data: {
        name: string;
        description?: string;
        icon?: string;
        subjectId?: string;
        unit?: "1" | "2" | "3" | "4";
        deadline?: string;
        deadlineType?: "sac" | "exam" | "assignment";
        isFavorite?: boolean;
        isArchived?: boolean;
        isFinished?: boolean;
      },
    ) => {
      const project = projects.find((p) => p.id === id);
      const nameChanged = project && data.name !== project.name;

      try {
        await updateProject(id, data);
        toast.success(`Assessment updated`);

        if (nameChanged && project) {
          const sanitised = sanitiseFolderName(data.name);
          if (sanitised && sanitised !== project.folder_path) {
            const confirmed = await confirmAction({
              title: `Rename folder to "${sanitised}"?`,
              description: `The folder on disk is currently "${project.folder_path}".`,
              actionLabel: "Rename",
              cancelLabel: "Keep",
              duration: 15000,
            });
            if (confirmed) {
              try {
                await renameProjectFolder(id, data.name);
                toast.success("Folder renamed");
              } catch (e) {
                toast.error(`Failed to rename folder: ${String(e)}`);
              }
            }
          }
        }
      } catch (e) {
        toast.error(`Failed to update assessment: ${String(e)}`);
      }
    },
    [projects, updateProject, renameProjectFolder],
  );

  const handleDeleteProject = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      const confirmed = await confirmDestructiveAction({
        title: `Delete "${project.name}"?`,
        description: "This also removes associated study sessions.",
        actionLabel: "Delete",
      });
      if (!confirmed) return;
      try {
        await deleteProject(id);
        if (selectedId === id) {
          navigation.selectHome();
        }
        showUndoToast({
          message: `Assessment "${project.name}" deleted`,
          onUndo: async () => {
            await restoreProject(project);
            toast.success(`Assessment "${project.name}" restored`);
          },
        });
        void requestNotionSync(false);
      } catch (e) {
        toast.error(`Failed to delete assessment: ${String(e)}`);
      }
    },
    [projects, deleteProject, selectedId, restoreProject, requestNotionSync, navigation],
  );

  const handleCreateStudySession = useCallback(
    async (data: {
      id?: string;
      projectId?: string;
      subjectIds: string[];
      title: string;
      startTime: string;
      endTime: string;
      description?: string;
      topics?: string[];
      notes?: string;
      status?: StudySessionStatus;
      confidence?: ConfidenceScore;
      blockers?: string;
      nextAction?: string;
      completedAt?: string;
      activeDurations?: { start: string; end: string }[];
    }) => {
      try {
        const blocks = data.activeDurations?.length
          ? data.activeDurations
          : [{ start: data.startTime, end: data.endTime }];
        const execution =
          data.status === "completed"
            ? {
                state: "completed" as const,
                intervals: [],
                completedAt: data.completedAt ?? new Date().toISOString(),
              }
            : data.status === "in-progress"
              ? { state: "in-progress" as const, intervals: [] }
              : { state: "planned" as const, intervals: [] as [] };
        const newSession = await addSession({
          projectId: data.projectId,
          subjectIds: data.subjectIds,
          title: data.title,
          description: data.description,
          topics: data.topics,
          schedule: { blocks },
          execution,
          reflection: {
            notes: data.notes,
            confidence: data.confidence,
            blockers: data.blockers,
            nextAction: data.nextAction,
          },
          createdVia: "manual",
        });
        toast.success(`Study session "${data.title}" created`);
        setSessionDialogOpen(false);
        void pushSessionChange(newSession);
      } catch (e) {
        toast.error(`Failed to create study session: ${String(e)}`);
      }
    },
    [addSession, pushSessionChange, setSessionDialogOpen],
  );

  const handleCreateStudySessions = useCallback(
    async (
      items: {
        projectId?: string;
        subjectIds: string[];
        title: string;
        startTime: string;
        endTime: string;
        description?: string;
        topics?: string[];
        notes?: string;
      }[],
    ) => {
      try {
        await addSessions(items);
        toast.success(
          `${items.length} study session${items.length !== 1 ? "s" : ""} created`,
        );
        void requestNotionSync(false);
      } catch (e) {
        toast.error(`Failed to create study sessions: ${String(e)}`);
        throw e;
      }
    },
    [addSessions, requestNotionSync],
  );

  const handleStartPomodoroSession = useCallback(
    async (data: {
      subjectIds: string[];
      durationSeconds: number;
      projectId?: string;
      sessionId?: string;
      cycleNumber: number;
      intent?: string;
    }) => {
      try {
        const start = new Date();
        const end = new Date(start.getTime() + data.durationSeconds * 1000);
        const durationMinutes = Math.round(data.durationSeconds / 60);
        const projectName = data.projectId
          ? projects.find((p) => p.id === data.projectId)?.name
          : undefined;
        let focusIntent = data.intent?.trim();
        if (focusIntent?.length === 0) focusIntent = undefined;
        focusIntent ??= getPomodoroTitle(data.subjectIds, projectName);
        const blockStart = start.toISOString();
        const blockEnd = end.toISOString();
        const plannedSession = data.sessionId
          ? sessions.find(
              (session) =>
                session.id === data.sessionId &&
                session.execution.state === "planned",
            )
          : undefined;

        if (plannedSession) {
          const startedSession = startPlannedStudySession(plannedSession, {
            startedAt: blockStart,
            cycleNumber: data.cycleNumber,
            subjectIds: data.subjectIds,
            projectId: data.projectId,
            intent: focusIntent,
          });
          await updateSession(plannedSession.id, {
            projectId: startedSession.projectId,
            subjectIds: startedSession.subjectIds,
            title: startedSession.title,
            execution: startedSession.execution,
          });
          void pushSessionChange(startedSession);
          return startedSession;
        }

        const session = await addSession({
          projectId: data.projectId,
          subjectIds: data.subjectIds,
          title: focusIntent,
          description: getPomodoroDescription(durationMinutes),
          schedule: { blocks: [{ start: blockStart, end: blockEnd }] },
          execution: {
            state: "in-progress",
            intervals: [
              {
                start: blockStart,
                source: "pomodoro",
                cycleNumber: data.cycleNumber,
              },
            ],
          },
          createdVia: "manual",
        });
        void pushSessionChange(session);
        return session;
      } catch (e) {
        toast.error(`Failed to start Pomodoro session: ${String(e)}`);
        throw e;
      }
    },
    [projects, sessions, addSession, updateSession, pushSessionChange],
  );

  const handleUpdatePomodoroSession = useCallback(
    async (
      id: string,
      updates: Partial<Omit<StudySession, "id" | "created_at">>,
    ) => {
      try {
        const session = sessions.find((s) => s.id === id);
        const effectiveUpdates = { ...updates };

        if (session && isPomodoroSession(session)) {
          const subjectIds = updates.subjectIds ?? session.subjectIds;
          const projectName = session.projectId
            ? projects.find((p) => p.id === session.projectId)?.name
            : undefined;
          if (updates.subjectIds && session.title === getPomodoroTitle(session.subjectIds, projectName)) {
            effectiveUpdates.title = getPomodoroTitle(subjectIds, projectName);
          }

          if (updates.execution?.state === "completed") {
            const durationMs = updates.execution.intervals.reduce((total, interval) => {
              if (!interval.end) return total;
              const start = new Date(interval.start).getTime();
              const end = new Date(interval.end).getTime();
              return total + (Number.isFinite(start) && end > start ? end - start : 0);
            }, 0);
            effectiveUpdates.description = getPomodoroDescription(
              Math.max(1, Math.round(durationMs / 60000)),
            );
          }
        }

        await updateSession(id, effectiveUpdates);
        if (session)
          void pushSessionChange({ ...session, ...effectiveUpdates });
      } catch (e) {
        toast.error(`Failed to update Pomodoro session: ${String(e)}`);
        throw e;
      }
    },
    [sessions, projects, updateSession, pushSessionChange],
  );

  const handleEditStudySession = useCallback(
    async (data: {
      id?: string;
      projectId?: string;
      subjectIds: string[];
      title: string;
      startTime: string;
      endTime: string;
      description?: string;
      topics?: string[];
      notes?: string;
      status?: StudySessionStatus;
      confidence?: ConfidenceScore;
      blockers?: string;
      nextAction?: string;
      completedAt?: string;
      activeDurations?: { start: string; end: string }[];
    }) => {
      if (!data.id) return;
      try {
        const updates: Partial<Omit<StudySession, "id" | "created_at">> = {
          projectId: data.projectId,
          subjectIds: data.subjectIds,
          title: data.title,
          startTime: data.startTime,
          endTime: data.endTime,
          description: data.description,
          topics: data.topics,
          notes: data.notes,
          activeDurations: data.activeDurations,
        };
        if (data.status) updates.status = data.status;
        updates.confidence = data.confidence;
        updates.blockers = data.blockers;
        updates.nextAction = data.nextAction;
        updates.completedAt = data.completedAt;
        await updateSession(data.id, updates);
        toast.success("Study session updated");
        setSessionDialogOpen(false);
        setSelectedSession(null);
        const sessionForPush = sessions.find(
          (s: StudySession) => s.id === data.id,
        );
        if (sessionForPush)
          void pushSessionChange({ ...sessionForPush, ...updates });
      } catch (e) {
        toast.error(`Failed to update study session: ${String(e)}`);
      }
    },
    [
      sessions,
      updateSession,
      pushSessionChange,
      setSessionDialogOpen,
      setSelectedSession,
    ],
  );

  const handleAiUpdateStudySession = useCallback(
    async (
      id: string,
      updates: Partial<Omit<StudySession, "id" | "created_at">>,
    ) => {
      const session = sessions.find((item) => item.id === id);
      if (!session) return false;
      try {
        await updateSession(id, updates);
        toast.success(
          `Study session "${updates.title ?? session.title}" updated`,
        );
        void pushSessionChange({ ...session, ...updates });
        return true;
      } catch (e) {
        toast.error(`Failed to update study session: ${String(e)}`);
        return false;
      }
    },
    [sessions, updateSession, pushSessionChange],
  );

  const handleDeleteStudySession = useCallback(
    async (id: string) => {
      const session = sessions.find((s) => s.id === id);
      if (!session) return;
      const confirmed = await confirmDestructiveAction({
        title: `Delete "${session.title}"?`,
        description: "This study session will be removed from your calendar.",
        actionLabel: "Delete",
      });
      if (!confirmed) return;
      try {
        await deleteSession(id);
        showUndoToast({
          message: "Study session deleted",
          onUndo: async () => {
            await restoreSession(session);
            toast.success("Study session restored");
          },
        });
        setSessionDialogOpen(false);
        setSelectedSession(null);
        void requestNotionSync(false);
      } catch (e) {
        toast.error(`Failed to delete study session: ${String(e)}`);
      }
    },
    [
      sessions,
      deleteSession,
      restoreSession,
      setSessionDialogOpen,
      setSelectedSession,
      requestNotionSync,
    ],
  );

  const handleRepeatStudySession = useCallback(
    async (session: StudySession) => {
      try {
        const repeated = await addSession(repeatStudySession(session));
        toast.success(`"${repeated.title}" planned for next week`);
        setSessionDialogOpen(false);
        setSelectedSession(null);
        void pushSessionChange(repeated);
      } catch (e) {
        toast.error(`Failed to plan study session: ${String(e)}`);
      }
    },
    [addSession, pushSessionChange],
  );

  const handleCreateEvent = useCallback(
    async (data: {
      title: string;
      description?: string;
      startTime: string;
      endTime?: string;
      eventType: EventType;
      subjectId?: string;
      location?: string;
      isFinished?: boolean;
      finishedAt?: string;
    }) => {
      try {
        const created = await addEvent(data);
        if (!created) {
          toast.info(`Event "${data.title}" already exists`);
          setEventDialogOpen(false);
          return true;
        }
        toast.success(`Event "${data.title}" added`);
        setEventDialogOpen(false);
        void pushEventChange(created);
        return true;
      } catch (e) {
        toast.error(`Failed to add event: ${String(e)}`);
        return false;
      }
    },
    [addEvent, pushEventChange, setEventDialogOpen],
  );

  const handleCreateEvents = useCallback(
    async (items: Omit<CalendarEvent, "id" | "created_at">[]) => {
      try {
        const created = await addEvents(items);
        if (created.length === 0) {
          toast.info("No events added — they already exist");
          return;
        }
        toast.success(`${created.length} event${created.length !== 1 ? "s" : ""} added`);
        void requestNotionSync(false);
      } catch (e) {
        toast.error(`Failed to add events: ${String(e)}`);
        throw e;
      }
    },
    [addEvents, requestNotionSync],
  );

  const handleImportVcaaEvents = useCallback(
    async (items: Omit<CalendarEvent, "id" | "created_at">[]) => {
      const existingBySourceId = new Map(
        events.flatMap((event) =>
          event.source?.type === "vcaa"
            ? [[event.source.id, event] as const]
            : [],
        ),
      );
      const creates: Omit<CalendarEvent, "id" | "created_at">[] = [];
      const updates: {
        id: string;
        updates: Partial<Omit<CalendarEvent, "id" | "created_at">>;
      }[] = [];
      for (const item of items) {
        const existing =
          item.source?.type === "vcaa"
            ? existingBySourceId.get(item.source.id)
            : undefined;
        if (existing) {
          updates.push({
            id: existing.id,
            updates: {
              title: item.title,
              startTime: item.startTime,
              endTime: item.endTime,
              eventType: "exam",
              subjectId: item.subjectId,
              source: item.source,
            },
          });
        } else creates.push(item);
      }
      await syncEvents(creates, updates);
    },
    [events, syncEvents],
  );

  const handleEditEvent = useCallback(
    async (data: {
      id: string;
      title: string;
      description?: string;
      startTime: string;
      endTime?: string;
      eventType: EventType;
      subjectId?: string;
      location?: string;
      isFinished?: boolean;
      finishedAt?: string;
    }) => {
      try {
        await updateEvent(data.id, {
          title: data.title,
          description: data.description,
          startTime: data.startTime,
          endTime: data.endTime,
          eventType: data.eventType,
          subjectId: data.subjectId,
          location: data.location,
          isFinished: data.isFinished,
          finishedAt: data.finishedAt,
        });
        toast.success("Event updated");
        setEventDialogOpen(false);
        setSelectedEvent(null);
        const { id, ...rest } = data;
        void pushEventChange({
          ...events.find((e: CalendarEvent) => e.id === id),
          ...rest,
        } as CalendarEvent);
        return true;
      } catch (e) {
        toast.error(`Failed to update event: ${String(e)}`);
        return false;
      }
    },
    [
      updateEvent,
      events,
      pushEventChange,
      setEventDialogOpen,
      setSelectedEvent,
    ],
  );

  const handleDeleteEvent = useCallback(
    async (id: string) => {
      const event = events.find((item) => item.id === id);
      if (!event) return false;
      try {
        await deleteEvent(id);
        showUndoToast({
          message: "Event deleted",
          onUndo: async () => {
            await restoreEvent(event);
            toast.success("Event restored");
          },
        });
        setEventDialogOpen(false);
        setSelectedEvent(null);
        void requestNotionSync(false);
        return true;
      } catch (e) {
        toast.error(`Failed to delete event: ${String(e)}`);
        return false;
      }
    },
    [
      events,
      deleteEvent,
      restoreEvent,
      setEventDialogOpen,
      setSelectedEvent,
      requestNotionSync,
    ],
  );

  const handleRepeatEvent = useCallback(
    async (event: CalendarEvent) => {
      try {
        const repeated = await addEvent(repeatCalendarEvent(event));
        if (!repeated) {
          toast.info(`"${event.title}" already exists next week`);
          return;
        }
        toast.success(`"${event.title}" duplicated for next week`);
        setEventDialogOpen(false);
        setSelectedEvent(null);
        void pushEventChange(repeated);
      } catch (e) {
        toast.error(`Failed to duplicate event: ${String(e)}`);
      }
    },
    [addEvent, pushEventChange],
  );

  const handleDeleteCalendarItems = useCallback(
    async (itemIds: { eventIds: string[]; sessionIds: string[] }) => {
      const total = itemIds.eventIds.length + itemIds.sessionIds.length;
      if (total === 0) return;
      if (itemIds.eventIds.length === 1 && itemIds.sessionIds.length === 0) {
        await handleDeleteEvent(itemIds.eventIds[0]);
        return;
      }

      const deletedEvents = itemIds.eventIds
        .map((id) => events.find((e) => e.id === id))
        .filter((e): e is CalendarEvent => Boolean(e));
      const deletedSessions = itemIds.sessionIds
        .map((id) => sessions.find((s) => s.id === id))
        .filter((s): s is StudySession => Boolean(s));

      try {
        await Promise.all([
          itemIds.eventIds.length > 0
            ? deleteEvents(itemIds.eventIds)
            : Promise.resolve(),
          itemIds.sessionIds.length > 0
            ? deleteSessions(itemIds.sessionIds)
            : Promise.resolve(),
        ]);
        showUndoToast({
          message: `${total} calendar item${total === 1 ? "" : "s"} deleted`,
          onUndo: async () => {
            await Promise.all([
              deletedEvents.length > 0
                ? restoreEvents(deletedEvents)
                : Promise.resolve(),
              deletedSessions.length > 0
                ? restoreSessions(deletedSessions)
                : Promise.resolve(),
            ]);
            toast.success(
              `${total} calendar item${total === 1 ? "" : "s"} restored`,
            );
          },
        });
        void requestNotionSync(false);
      } catch (e) {
        toast.error(`Failed to delete calendar items: ${String(e)}`);
        throw e;
      }
    },
    [
      events,
      sessions,
      handleDeleteEvent,
      deleteEvents,
      deleteSessions,
      restoreEvents,
      restoreSessions,
      requestNotionSync,
    ],
  );

  const handleSetCalendarItemsCompleted = useCallback(
    async (
      itemIds: { eventIds: string[]; sessionIds: string[] },
      isCompleted: boolean,
    ) => {
      const total = itemIds.eventIds.length + itemIds.sessionIds.length;
      if (total === 0) return;
      const completedAt = isCompleted ? new Date().toISOString() : undefined;
      try {
        await Promise.all([
          itemIds.eventIds.length > 0
            ? updateEvents(
                itemIds.eventIds.map((id) => ({
                  id,
                  updates: { isFinished: isCompleted, finishedAt: completedAt },
                })),
              )
            : Promise.resolve(),
          itemIds.sessionIds.length > 0
            ? updateSessions(
                itemIds.sessionIds.map((id) => ({
                  id,
                  updates: {
                    status: isCompleted ? "completed" : "planned",
                    completedAt,
                  },
                })),
              )
            : Promise.resolve(),
        ]);
        toast.success(
          `${total} calendar item${total === 1 ? "" : "s"} marked ${isCompleted ? "complete" : "current"}`,
        );
        void requestNotionSync(false);
      } catch (e) {
        toast.error(`Failed to update calendar items: ${String(e)}`);
        throw e;
      }
    },
    [updateEvents, updateSessions, requestNotionSync],
  );

  const handleMergeEvents = useCallback(
    async (ids: string[]) => {
      const selectedEvents = ids
        .map((id) => events.find((event) => event.id === id))
        .filter((event): event is CalendarEvent => Boolean(event))
        .sort(
          (a, b) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        );

      if (selectedEvents.length < 2) return;

      const keeper = selectedEvents[0];
      const startMs = Math.min(
        ...selectedEvents
          .map((event) => new Date(event.startTime).getTime())
          .filter(Number.isFinite),
      );
      const endMs = Math.max(
        ...selectedEvents
          .map((event) => new Date(event.endTime ?? event.startTime).getTime())
          .filter(Number.isFinite),
      );
      if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
        toast.error("Failed to merge events: invalid event time");
        return;
      }

      const descriptions = selectedEvents
        .map((event) => event.description?.trim())
        .filter((description): description is string => Boolean(description));
      const uniqueDescriptions = Array.from(new Set(descriptions));
      const allComplete = selectedEvents.every((event) => event.isFinished);
      const sameSubject = selectedEvents.every(
        (event) => event.subjectId === keeper.subjectId,
      );
      const sameLocation = selectedEvents.every(
        (event) => event.location === keeper.location,
      );

      try {
        await updateAndDeleteEvents(
          [
            {
              id: keeper.id,
              updates: {
                title:
                  selectedEvents.length === 2
                    ? `${selectedEvents[0].title} / ${selectedEvents[1].title}`
                    : `${selectedEvents[0].title} + ${selectedEvents.length - 1} more`,
                description:
                  uniqueDescriptions.length > 0
                    ? uniqueDescriptions.join("\n\n")
                    : keeper.description,
                startTime: new Date(startMs).toISOString(),
                endTime: new Date(endMs).toISOString(),
                eventType: keeper.eventType,
                subjectId: sameSubject ? keeper.subjectId : undefined,
                location: sameLocation ? keeper.location : undefined,
                isFinished: allComplete,
                finishedAt: allComplete
                  ? (keeper.finishedAt ?? new Date().toISOString())
                  : undefined,
              },
            },
          ],
          selectedEvents.slice(1).map((event) => event.id),
        );

        toast.success(`${selectedEvents.length} events merged`);
        void requestNotionSync(false);
      } catch (e) {
        toast.error(`Failed to merge events: ${String(e)}`);
        throw e;
      }
    },
    [events, updateAndDeleteEvents, requestNotionSync],
  );

  const handleMergeStudySessions = useCallback(
    async (ids: string[]) => {
      const selectedSessions = ids
        .map((id) => sessions.find((session) => session.id === id))
        .filter((session): session is StudySession => Boolean(session))
        .sort(
          (a, b) =>
            new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
        );

      if (selectedSessions.length < 2) return;

      const inProgressSessions = selectedSessions.filter(
        (session) => session.execution.state === "in-progress",
      );
      if (inProgressSessions.length > 1) {
        toast.error("Finish all but one active study session before merging");
        return;
      }
      const keeper = inProgressSessions[0] ?? selectedSessions[0];

      const descriptions = getUniqueStrings(
        selectedSessions.map((session) => session.description),
      );
      const notes = getUniqueStrings(
        selectedSessions.map((session) => session.notes),
      );
      const blockers = getUniqueStrings(
        selectedSessions.map((session) => session.blockers),
      );
      const nextActions = getUniqueStrings(
        selectedSessions.map((session) => session.nextAction),
      );
      const topicItems = getUniqueArrayItems(
        selectedSessions.map((session) => session.topics),
      );
      const subjectIds = getUniqueArrayItems(
        selectedSessions.map((session) => session.subjectIds),
      );
      const sameProject = selectedSessions.every(
        (session) => session.projectId === keeper.projectId,
      );
      const sameConfidence = selectedSessions.every(
        (session) => session.confidence === keeper.confidence,
      );
      const deletedSessions = selectedSessions.filter(
        (session) => session.id !== keeper.id,
      );
      try {
        const timeline = mergeStudySessionTimelines(selectedSessions);
        await updateAndDeleteSessions(
          [
            {
              id: keeper.id,
              updates: {
                projectId: sameProject ? keeper.projectId : undefined,
                subjectIds,
                title: mergedStudySessionTitle(selectedSessions),
                description:
                  descriptions.length > 0
                    ? descriptions.join("\n\n")
                    : keeper.description,
                schedule: timeline.schedule,
                execution: timeline.execution,
                topics: topicItems.length > 0 ? topicItems : undefined,
                notes: notes.length > 0 ? notes.join("\n\n") : keeper.notes,
                confidence: sameConfidence ? keeper.confidence : undefined,
                blockers:
                  blockers.length > 0 ? blockers.join("\n\n") : keeper.blockers,
                nextAction:
                  nextActions.length > 0
                    ? nextActions.join("\n\n")
                    : keeper.nextAction,
              },
            },
          ],
          deletedSessions.map((session) => session.id),
        );

        showUndoToast({
          message: `${selectedSessions.length} study sessions merged`,
          onUndo: async () => {
            await restoreMergedSessions(selectedSessions);
            toast.success("Study sessions restored");
            void requestNotionSync(false);
          },
        });
        void requestNotionSync(false);
      } catch (e) {
        toast.error(`Failed to merge study sessions: ${String(e)}`);
        throw e;
      }
    },
    [
      sessions,
      updateAndDeleteSessions,
      restoreMergedSessions,
      requestNotionSync,
    ],
  );

  const handleToggleFavorite = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      try {
        await updateProject(id, { isFavorite: !project.isFavorite });
      } catch (e) {
        toast.error(`Failed to update assessment: ${String(e)}`);
      }
    },
    [projects, updateProject],
  );

  const handleToggleArchive = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      try {
        await updateProject(id, { isArchived: !project.isArchived });
        if (!project.isArchived) {
          toast.success(`"${project.name}" archived`);
        } else {
          toast.success(`"${project.name}" restored`);
          navigation.selectProject(project.id);
        }
      } catch (e) {
        toast.error(`Failed to update assessment: ${String(e)}`);
      }
    },
    [projects, updateProject, navigation],
  );

  const handleToggleFinished = useCallback(
    async (id: string) => {
      const project = projects.find((p) => p.id === id);
      if (!project) return;
      try {
        await updateProject(id, { isFinished: !project.isFinished });
        if (!project.isFinished) {
          toast.success(`"${project.name}" marked as complete`);
        } else {
          toast.success(`"${project.name}" marked as current`);
        }
      } catch (e) {
        toast.error(`Failed to update assessment: ${String(e)}`);
      }
    },
    [projects, updateProject],
  );

  const handleSelectSession = useCallback(
    (session: StudySession) => {
      setSelectedSession(session);
      setSessionDialogOpen(true);
    },
    [setSelectedSession, setSessionDialogOpen],
  );

  const handleSelectEvent = useCallback(
    (event: CalendarEvent) => {
      setSelectedEvent(event);
      setEventDialogOpen(true);
    },
    [setSelectedEvent, setEventDialogOpen],
  );

  const handleMoveEvent = useCallback(
    (eventId: string, newStartTime: string, newEndTime?: string) => {
      const updates: Partial<Omit<CalendarEvent, "id" | "created_at">> = {
        startTime: newStartTime,
      };
      if (newEndTime) {
        updates.endTime = newEndTime;
      }
      void updateEvent(eventId, updates);
    },
    [updateEvent],
  );

  const handleSyncNotionCalendar = useCallback(
    async (onProgress: (msg: string) => void) => {
      return performNotionSync(true, onProgress);
    },
    [performNotionSync],
  );

  const handleNewProject = useCallback(() => {
    setDialogOpen(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setSettingsOpen(true);
  }, []);

  const handleOpenProjectSettings = useCallback((id: string) => {
    navigation.selectProject(id);
    setSettingsOpen(true);
  }, [navigation]);

  const handleDropFolder = useCallback(
    async (path: string) => {
      try {
        const result = await invoke<{
          folder_path: string;
          is_linked: boolean;
        }>("handle_folder_drop", { sourcePath: path });
        const existingPaths = new Set(projects.map((p) => p.folder_path));
        if (existingPaths.has(result.folder_path)) {
          toast.error(`A project for "${result.folder_path}" already exists`);
          return;
        }
        const project = await addProject(
          result.folder_path,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          true,
          result.folder_path,
          result.is_linked,
        );
        navigation.selectProject(project.id);
        toast.success(
          result.is_linked
            ? `Linked "${result.folder_path}"`
            : `Imported "${result.folder_path}"`,
        );
      } catch (e) {
        toast.error(`Failed to drop folder: ${String(e)}`);
      }
    },
    [projects, addProject, navigation],
  );

  // New project management handlers
  const handleDuplicateProject = useCallback(
    async (id: string) => {
      try {
        const copy = await duplicateProject(id);
        navigation.selectProject(copy.id);
        toast.success(`Duplicated as "${copy.name}"`);
      } catch (e) {
        toast.error(`Failed to duplicate: ${String(e)}`);
      }
    },
    [duplicateProject, navigation],
  );

  const handleToggleProjectSelection = useCallback((id: string) => {
    setSelectedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const handleBulkArchive = useCallback(
    async (ids: string[]) => {
      try {
        await bulkArchive(ids);
        setSelectedProjectIds(new Set());
        toast.success(
          `${ids.length} assessment${ids.length > 1 ? "s" : ""} archived`,
        );
      } catch (e) {
        toast.error(`Failed to archive: ${String(e)}`);
      }
    },
    [bulkArchive],
  );

  const handleBulkUnarchive = useCallback(
    async (ids: string[]) => {
      try {
        await bulkUnarchive(ids);
        setSelectedProjectIds(new Set());
        toast.success(
          `${ids.length} assessment${ids.length > 1 ? "s" : ""} restored`,
        );
      } catch (e) {
        toast.error(`Failed to restore: ${String(e)}`);
      }
    },
    [bulkUnarchive],
  );

  const handleBulkFinish = useCallback(
    async (ids: string[]) => {
      try {
        await bulkFinish(ids);
        setSelectedProjectIds(new Set());
        toast.success(
          `${ids.length} assessment${ids.length > 1 ? "s" : ""} marked complete`,
        );
      } catch (e) {
        toast.error(`Failed to update: ${String(e)}`);
      }
    },
    [bulkFinish],
  );

  const handleBulkDelete = useCallback(
    async (ids: string[]) => {
      const confirmed = await confirmDestructiveAction({
        title: `Delete ${ids.length} assessment${ids.length > 1 ? "s" : ""}?`,
        description: "This also removes associated study sessions.",
        actionLabel: "Delete",
      });
      if (!confirmed) return;
      try {
        await bulkDelete(ids);
        setSelectedProjectIds(new Set());
        if (selectedId && ids.includes(selectedId)) {
          navigation.selectHome();
        }
        toast.success(
          `${ids.length} assessment${ids.length > 1 ? "s" : ""} deleted`,
        );
      } catch (e) {
        toast.error(`Failed to delete: ${String(e)}`);
      }
    },
    [bulkDelete, selectedId, navigation],
  );

  const handleUpdateNotes = useCallback(
    async (notes: string) => {
      if (!selectedId) return;
      try {
        await updateProject(selectedId, { notes: notes || undefined });
      } catch (e) {
        toast.error(`Failed to update notes: ${String(e)}`);
      }
    },
    [selectedId, updateProject],
  );

  const handleAddChecklistItem = useCallback(
    async (text: string) => {
      if (!selectedId) return;
      try {
        await addChecklistItem(selectedId, text);
      } catch (e) {
        toast.error(`Failed to add task: ${String(e)}`);
      }
    },
    [selectedId, addChecklistItem],
  );

  const handleAddChecklistItems = useCallback(
    async (texts: string[]) => {
      if (!selectedId || texts.length === 0) return;
      try {
        const count = await addChecklistItems(selectedId, texts);
        if (count > 0) toast.success(`${count} VCE prep step${count === 1 ? "" : "s"} added`);
      } catch (e) {
        toast.error(`Failed to add prep steps: ${String(e)}`);
      }
    },
    [addChecklistItems, selectedId],
  );

  const handleToggleChecklistItem = useCallback(
    async (itemId: string) => {
      if (!selectedId) return;
      try {
        await toggleChecklistItem(selectedId, itemId);
      } catch (e) {
        toast.error(`Failed to update task: ${String(e)}`);
      }
    },
    [selectedId, toggleChecklistItem],
  );

  const handleRemoveChecklistItem = useCallback(
    async (itemId: string) => {
      if (!selectedId) return;
      try {
        await removeChecklistItem(selectedId, itemId);
      } catch (e) {
        toast.error(`Failed to remove task: ${String(e)}`);
      }
    },
    [selectedId, removeChecklistItem],
  );

  const handleAddDependency = useCallback(
    async (dependsOnId: string) => {
      if (!selectedId) return;
      try {
        await addDependency(selectedId, dependsOnId);
      } catch (e) {
        toast.error(`Failed to add dependency: ${String(e)}`);
      }
    },
    [selectedId, addDependency],
  );

  const handleRemoveDependency = useCallback(
    async (dependsOnId: string) => {
      if (!selectedId) return;
      try {
        await removeDependency(selectedId, dependsOnId);
      } catch (e) {
        toast.error(`Failed to remove dependency: ${String(e)}`);
      }
    },
    [selectedId, removeDependency],
  );

  const handleSaveAsTemplate = useCallback(
    (projectId: string | null, name: string) => {
      if (!projectId) return;
      try {
        saveAsTemplate(projectId, name);
        setTemplates(getTemplates());
        toast.success(`Template "${name}" saved`);
      } catch (e) {
        toast.error(`Failed to save template: ${String(e)}`);
      }
    },
    [saveAsTemplate, getTemplates],
  );

  const handleDeleteTemplate = useCallback(
    (templateId: string) => {
      deleteTemplate(templateId);
      setTemplates(getTemplates());
    },
    [deleteTemplate, getTemplates],
  );

  const handleLoadTemplate = useCallback(
    async (templateId: string) => {
      try {
        const project = await loadFromTemplate(templateId);
        navigation.selectProject(project.id);
        toast.success(`Created "${project.name}" from template`);
      } catch (e) {
        toast.error(`Failed to load template: ${String(e)}`);
      }
    },
    [loadFromTemplate, navigation],
  );

  const handleOpenTemplateDialog = useCallback(
    (projectId?: string) => {
      setTemplates(getTemplates());
      setTemplateSaveProjectId(projectId ?? null);
      setTemplateDialogOpen(true);
    },
    [getTemplates],
  );

  const handleExportProject = useCallback(() => {
    if (!selectedProject) return;
    try {
      const data = {
        exportedAt: new Date().toISOString(),
        assessment: selectedProject,
        sessions: selectedProjectSessions,
      };
      const content = JSON.stringify(data, null, 2);
      const blob = new Blob([content], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `focal-${selectedProject.name.replace(/[^a-zA-Z0-9]/g, "-")}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("Project exported");
    } catch (e) {
      toast.error(`Failed to export: ${String(e)}`);
    }
  }, [selectedProject, selectedProjectSessions]);

  const handleChangeProjectFolder = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;

      try {
        const selected = await open({
          directory: true,
          multiple: false,
        });
        if (!selected || typeof selected !== "string") return;

        const folderPath = await invoke<string>("link_folder_as_project", {
          sourcePath: selected,
        });
        const existingPaths = new Set(projects.map((p) => p.folder_path));
        if (
          existingPaths.has(folderPath) &&
          folderPath !== project.folder_path
        ) {
          toast.error(`A project for "${folderPath}" already exists`);
          return;
        }
        await changeProjectFolder(projectId, folderPath);
        toast.success(`Folder changed to "${folderPath}"`);
      } catch (e) {
        toast.error(`Failed to change folder: ${String(e)}`);
      }
    },
    [projects, changeProjectFolder],
  );

  const handleToggleCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const handleStartFocus = useCallback((item: PriorityItem) => {
    const projectLabel = item.projectId
      ? projects.find((project) => project.id === item.projectId)?.name
      : undefined;
    window.dispatchEvent(new CustomEvent("focal-focus-request", {
      detail: {
        subjectIds: item.subjectIds,
        sessionId: item.sessionId,
        projectId: item.projectId,
        projectLabel,
        intent: item.title,
      },
    }));
  }, [projects]);

  const contentKey = settingsView
    ? "settings"
    : examTrackView
      ? "examtrack"
    : plannerView
      ? "planner"
    : inboxView
      ? "inbox"
    : analyticsView
      ? "analytics"
      : timetableView
        ? "timetable"
        : homeSelected
          ? "home"
          : selectedProject
            ? `project-${selectedProject.id}`
            : "empty";
  const layoutTransition = reduceMotion
    ? { duration: 0 }
    : SHELL_LAYOUT_TRANSITION;
  const viewTransition = reduceMotion ? { duration: 0 } : VIEW_TRANSITION;

  return (
    <TooltipProvider>
      <MotionConfig reducedMotion="user">
        <ErrorBoundary>
          <div className="relative flex h-full flex-col overflow-hidden text-foreground">
            <TitleBar
              onNewAssessment={handleNewProject}
              onNewEvent={() => handleOpenNewEvent()}
              onNewSession={() => handleOpenNewSession()}
              onSearch={() => setSearchOpen(true)}
              onSettings={navigation.openSettings}
              onHelp={() => setShortcutsOpen(true)}
            >
              {!settingsView && <NotionSyncIndicator
                status={syncStatus}
                lastSyncTime={lastSyncTime}
                onClick={() => requestNotionSync(true)}
                disabled={syncStatus === "syncing"}
              />}
              {!settingsView && <SupabaseSyncIndicator
                sync={supabaseSync}
                signedIn={Boolean(supabaseAuth.user)}
              />}
            </TitleBar>
            <div className="relative z-10 flex min-h-0 flex-1">
              {!settingsView && <motion.div
                layout
                className="min-h-0 h-full shrink-0"
                style={{
                  width: sidebarCollapsed
                    ? "4.25rem"
                    : "clamp(13rem, 23vw, 18rem)",
                }}
                transition={layoutTransition}
              >
                <Sidebar
                  projects={projects}
                  sessions={sessions}
                  customSubjects={customSubjects}
                  availableSubjects={availableSubjects}
                  selectedId={selectedId}
                  homeSelected={homeSelected}
                  plannerSelected={plannerView}
                  inboxSelected={inboxView}
                  analyticsSelected={analyticsView}
                  examTrackSelected={examTrackView}
                  isCollapsed={sidebarCollapsed}
                  onToggleCollapse={handleToggleCollapse}
                  onSelect={handleSelectProject}
                  onSelectHome={handleSelectHome}
                  onSelectPlanner={handleSelectPlanner}
                  onSelectInbox={handleSelectInbox}
                  onOpenFocus={handleOpenFocus}
                  onSelectAnalytics={handleSelectAnalytics}
                  onSelectExamTrack={handleSelectExamTrack}
                  onDelete={handleDeleteProject}
                  onNewProject={handleNewProject}
                  onToggleFavorite={handleToggleFavorite}
                  onToggleArchive={handleToggleArchive}
                  onToggleFinished={handleToggleFinished}
                  onStartPomodoroSession={handleStartPomodoroSession}
                  onUpdatePomodoroSession={handleUpdatePomodoroSession}
                  onDeletePomodoroSession={handleDeleteStudySession}
                  onAddFile={handleAddFileFromSidebar}
                  onOpenProjectSettings={handleOpenProjectSettings}
                  onDuplicateProject={handleDuplicateProject}
                  onDropFolder={handleDropFolder}
                  fileCounts={fileCounts}
                  bumpProjectIds={bumpProjectIds}
                  onSelectTimetable={handleSelectTimetable}
                  timetableSelected={timetableView}
                  onSearch={() => setSearchOpen(true)}
                  onSettings={navigation.openSettings}
                  sortKey={sidebarSortKey}
                  onSortChange={setSidebarSortKey}
                  selectedProjectIds={selectedProjectIds}
                  onToggleProjectSelection={handleToggleProjectSelection}
                  onBulkArchive={handleBulkArchive}
                  onBulkUnarchive={handleBulkUnarchive}
                  onBulkFinish={handleBulkFinish}
                  onBulkDelete={handleBulkDelete}
                />
              </motion.div>}
              <motion.main
                layout
                transition={layoutTransition}
                className="min-w-0 flex-1 overflow-hidden bg-background selection:bg-primary/20"
              >
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.div
                    key={contentKey}
                    className="relative z-10 h-full"
                    initial={{ opacity: 0, x: reduceMotion ? 0 : 6 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: reduceMotion ? 0 : -3 }}
                    transition={viewTransition}
                  >
                    {settingsView ? (
                      <Suspense fallback={<ViewFallback label="settings" />}>
                        <SettingsView
                          onBack={navigation.closeSettings}
                          mode={mode}
                          setMode={setMode}
                          seedColor={seedColor}
                          setSeedColor={setSeedColor}
                          zoom={zoom}
                          onZoomChange={(v) => setZoom(v)}
                          subjects={allSubjects}
                          hiddenSubjectIds={hiddenSubjectIds}
                          onToggleSubjectVisibility={
                            handleToggleSubjectVisibility
                          }
                          onShowAllSubjects={handleShowAllSubjects}
                          events={events}
                          onImportVcaaEvents={handleImportVcaaEvents}
                          onOpenExport={() => setExportOpen(true)}
                          onOpenSubjects={() => setSubjectsOpen(true)}
                          onSyncNotionCalendar={handleSyncNotionCalendar}
                          lastSyncTime={lastSyncTime}
                          projects={projects}
                          onFilesChanged={refreshFileCounts}
                          supabaseConfigured={supabaseAuth.configured}
                          supabaseEmail={supabaseAuth.user?.email}
                          supabaseLoading={supabaseAuth.loading}
                          supabaseError={supabaseAuth.error}
                          supabaseSync={supabaseSync}
                          onSupabaseSignIn={supabaseAuth.signIn}
                          onSupabaseSignUp={supabaseAuth.signUp}
                          onSupabaseSignOut={supabaseAuth.signOut}
                          onForcePushAndMerge={() => void forcePushAndMerge()}
                          onForcePushAndOverwrite={() =>
                            void forcePushAndOverwrite()
                          }
                          onPullNow={() => void pullNow()}
                          onPushNow={() => void pushNow()}
                          onClearFailedItems={() => clearFailedItems()}
                          onRetryFailedItem={(table, rowId) => {
                            void retryFailedItem(table as SyncTable, rowId);
                          }}
                          onDropFailedItem={(table, rowId) => {
                            void dropQueueItem(table as SyncTable, rowId);
                          }}
                          onAcceptRemote={(table, rowId) => {
                            void resolveConflictAcceptRemote(
                              table as SyncTable,
                              rowId,
                            );
                          }}
                          onKeepLocal={(table, rowId) => {
                            void resolveConflictKeepLocal(
                              table as SyncTable,
                              rowId,
                            );
                          }}
                          onDismissConflict={(table, rowId) => {
                            dismissConflict(table as SyncTable, rowId);
                          }}
                          onClearConflicts={() => clearConflicts()}
                          onProjectsRootChanged={() => {
                            setProjectsRoot(getProjectsRootPath());
                            void refreshFileCounts();
                          }}
                          onScanAndImportProjects={scanAndImportProjects}
                          onLinkFolderAsProject={linkFolderAsProject}
                        />
                      </Suspense>
                    ) : examTrackView ? (
                      <Suspense fallback={<ViewFallback label="ExamTrack" />}>
                        <ExamTrackView
                          subjects={allSubjects}
                          onCreateStudySessions={handleCreateStudySessions}
                        />
                      </Suspense>
                    ) : plannerView ? (
                      <Suspense fallback={<ViewFallback label="adaptive planner" />}>
                        <AdaptivePlannerView
                          projects={projects}
                          sessions={sessions}
                          events={events}
                          timetable={timetableConfig}
                          onUpdateProject={(id, updates) => updateProject(id, updates)}
                          onCreateStudySessions={handleCreateStudySessions}
                        />
                      </Suspense>
                    ) : inboxView ? (
                      <Suspense fallback={<ViewFallback label="academic inbox" />}>
                        <AcademicInboxView
                          projects={projects}
                          onUpdateProject={(id, updates) => updateProject(id, updates)}
                          onFilesChanged={refreshFileCountForProject}
                        />
                      </Suspense>
                    ) : timetableView ? (
                      <Suspense fallback={<ViewFallback label="timetable" />}>
                        <TimetableView
                          customSubjects={customSubjects}
                          projects={projects}
                          sessions={sessions}
                          events={events}
                          onNewSession={() => handleOpenNewSession()}
                          onSelectProject={handleSelectProject}
                          onStartFocus={handleStartFocus}
                        />
                      </Suspense>
                    ) : analyticsView ? (
                      <Suspense fallback={<ViewFallback label="analytics" />}>
                        <AnalyticsView
                          sessions={sessions}
                          projects={projects}
                          events={events}
                          onNewSession={handleOpenNewSession}
                          onSelectProject={handleSelectProject}
                          onStartFocus={handleStartFocus}
                        />
                      </Suspense>
                    ) : homeSelected ? (
                      <Suspense fallback={<ViewFallback label="today" />}>
                        <HomeView
                        projects={projects}
                        sessions={sessions}
                        events={events}
                        onSelectProject={handleSelectProject}
                        onSelectSession={handleSelectSession}
                        onSelectEvent={handleSelectEvent}
                        onMoveEvent={handleMoveEvent}
                        onNewSession={handleOpenNewSession}
                        onNewEvent={handleOpenNewEvent}
                        onNewProject={handleNewProject}
                        onCreateEvents={handleCreateEvents}
                        onCreateStudySessions={handleCreateStudySessions}
                        onDeleteCalendarItems={handleDeleteCalendarItems}
                        onSetCalendarItemsCompleted={
                          handleSetCalendarItemsCompleted
                        }
                        onMergeEvents={handleMergeEvents}
                        onMergeStudySessions={handleMergeStudySessions}
                        onGoTimetable={handleSelectTimetable}
                        timetableConfig={timetableConfig}
                        onOpenAiAssistant={handleOpenAiAssistant}
                        onStartFocus={handleStartFocus}
                        />
                      </Suspense>
                    ) : selectedProject ? (
                      <Suspense fallback={<ViewFallback label="assessment" />}>
                        <ProjectDetail
                        project={selectedProject}
                        sessions={selectedProjectSessions}
                        onFilesChanged={() =>
                          debouncedRefreshFileCountForProject(
                            selectedProject.id,
                          )
                        }
                        onOpenSettings={handleOpenSettings}
                        onToggleFinished={handleToggleFinished}
                        onSelectSession={handleSelectSession}
                        onNewSession={handleOpenNewSession}
                        onUpdateNotes={handleUpdateNotes}
                        onAddChecklistItem={handleAddChecklistItem}
                        onAddChecklistItems={handleAddChecklistItems}
                        onToggleChecklistItem={handleToggleChecklistItem}
                        onRemoveChecklistItem={handleRemoveChecklistItem}
                        onAddDependency={handleAddDependency}
                        onRemoveDependency={handleRemoveDependency}
                        onOpenProject={handleSelectProject}
                        availableProjects={projects}
                        onExport={handleExportProject}
                        onSaveAsTemplate={() =>
                          handleOpenTemplateDialog(selectedProject.id)
                        }
                        onStartFocus={() => handleStartFocus({
                          id: `project-${selectedProject.id}`,
                          kind: "plan-prep",
                          title: selectedProject.checklist?.find((item) => !item.completed)?.text ?? selectedProject.name,
                          reason: "Selected assessment",
                          urgency: "medium",
                          subjectIds: selectedProject.subjectId ? [selectedProject.subjectId] : [],
                          projectId: selectedProject.id,
                          action: "Start focus",
                        })}
                        onUpdateProject={(updates) => updateProject(selectedProject.id, updates)}
                        />
                      </Suspense>
                    ) : (
                      <motion.div
                        className="flex h-full flex-col items-center justify-center px-8 text-center"
                        variants={staggerContainer(0.08, 0.1)}
                        initial="initial"
                        animate="animate"
                      >
                        <motion.div
                          variants={staggerItem}
                          transition={EMPTY_STATE_TRANSITION}
                          className="mb-4 flex size-12 items-center justify-center rounded-lg bg-muted"
                        >
                          <motion.div
                            animate={
                              reduceMotion ? undefined : { y: [0, -3, 0] }
                            }
                            transition={
                              reduceMotion
                                ? { duration: 0 }
                                : {
                                    duration: 4,
                                    repeat: Infinity,
                                    ease: "easeInOut",
                                  }
                            }
                          >
                            <FolderOpen className="h-8 w-8 text-muted-foreground/25" />
                          </motion.div>
                        </motion.div>
                        <motion.p
                          variants={staggerItem}
                          transition={EMPTY_STATE_TRANSITION}
                          className="mb-6 max-w-56 text-sm leading-relaxed text-muted-foreground"
                        >
                          Choose an assessment from the sidebar or create a new
                          one to start organising your files.
                        </motion.p>
                        <motion.div
                          variants={staggerItem}
                          transition={EMPTY_STATE_TRANSITION}
                        >
                          <Button
                            onClick={handleNewProject}
                            size="sm"
                            className="gap-1.5"
                            {...pressableMotion(reduceMotion)}
                          >
                            <FolderOpen className="h-4 w-4" />
                            New Assessment
                          </Button>
                        </motion.div>
                      </motion.div>
                    )}
                  </motion.div>
                </AnimatePresence>
              </motion.main>
              {aiAssistantLoaded && (
                <Suspense fallback={null}>
                  <AIAssistantPanel
                    open={aiAssistantOpen}
                    onOpenChange={setAiAssistantOpen}
                    onOpenSettings={handleOpenAiSettings}
                    sessions={sessions}
                    events={events}
                    projects={projects}
                    subjects={availableSubjects}
                    onCreateSession={handleCreateStudySession}
                    onUpdateSession={handleAiUpdateStudySession}
                    onCreateEvent={handleCreateEvent}
                    onUpdateEvent={handleEditEvent}
                    onDeleteEvent={handleDeleteEvent}
                    contextRefs={{ project: selectedProject }}
                  />
                </Suspense>
              )}
            </div>
            {dialogOpen && <Suspense fallback={null}>
              <ProjectDialog
                open
                onOpenChange={setDialogOpen}
                onSubmit={handleCreateProject}
                customSubjects={customSubjects}
                availableSubjects={availableSubjects}
              />
            </Suspense>}
            {sessionDialogOpen && <Suspense fallback={null}>
              <StudySessionDialog
              key={selectedSession?.id ?? `new-session-${newItemDialogKey}`}
              open={sessionDialogOpen}
              onOpenChange={setSessionDialogOpen}
              projects={projects}
              customSubjects={customSubjects}
              availableSubjects={availableSubjects}
              session={selectedSession}
              initialDate={newItemInitialDate}
              onSubmit={
                selectedSession
                  ? handleEditStudySession
                  : handleCreateStudySession
              }
              onDelete={selectedSession ? handleDeleteStudySession : undefined}
              onPlanAgain={selectedSession ? handleRepeatStudySession : undefined}
              />
            </Suspense>}
            {eventDialogOpen && <Suspense fallback={null}>
              <EventDialog
                key={`event-${selectedEvent?.id ?? `new-${newItemDialogKey}`}`}
                open
                onOpenChange={setEventDialogOpen}
                event={selectedEvent}
                customSubjects={customSubjects}
                availableSubjects={availableSubjects}
                timetableConfig={timetableConfig}
                initialDate={selectedEvent ? undefined : newItemInitialDate}
                onSubmit={
                  (selectedEvent
                    ? handleEditEvent
                    : handleCreateEvent) as unknown as EventDialogProps["onSubmit"]
                }
                onSubmitMultiple={handleCreateEvents}
                onDelete={selectedEvent ? handleDeleteEvent : undefined}
                onDuplicate={selectedEvent ? handleRepeatEvent : undefined}
              />
            </Suspense>}
            {settingsOpen && <Suspense fallback={null}>
              <ProjectDialog
                project={selectedProject}
                open
                onOpenChange={setSettingsOpen}
                onSubmitEdit={handleUpdateProject}
                onChangeFolder={handleChangeProjectFolder}
                customSubjects={customSubjects}
                availableSubjects={availableSubjects}
              />
            </Suspense>}
            {searchOpen && <Suspense fallback={null}>
              <GlobalSearch
              projects={projects}
              sessions={sessions}
              events={events}
              onSelectProject={handleSelectProject}
              onSelectSession={handleSelectSession}
              onSelectEvent={handleSelectEvent}
              onNewProject={handleNewProject}
              onNewSession={() => handleOpenNewSession()}
              onNewEvent={() => handleOpenNewEvent()}
              onGoHome={handleSelectHome}
              onGoTimetable={handleSelectTimetable}
              onGoAnalytics={handleSelectAnalytics}
              onGoSettings={handleSelectSettings}
              onOpenAiAssistant={handleOpenAiAssistant}
              onShowShortcuts={() => setShortcutsOpen(true)}
              open={searchOpen}
              onOpenChange={setSearchOpen}
              />
            </Suspense>}
            {shortcutsOpen && <Suspense fallback={null}>
              <KeyboardShortcutsDialog
                open
                onOpenChange={setShortcutsOpen}
              />
            </Suspense>}
            {exportOpen && <Suspense fallback={null}>
              <DataExport
                projects={projects}
                sessions={sessions}
                events={events}
                open
                onOpenChange={setExportOpen}
              />
            </Suspense>}
            {subjectsOpen && <Suspense fallback={null}>
              <CustomSubjects
                customSubjects={customSubjects}
                onSave={setCustomSubjects}
                open
                onOpenChange={setSubjectsOpen}
              />
            </Suspense>}
            {templateDialogOpen && <Suspense fallback={null}>
              <ProjectTemplateDialog
              open={templateDialogOpen}
              onOpenChange={setTemplateDialogOpen}
              templates={templates}
              onSaveAsTemplate={handleSaveAsTemplate}
              onLoadTemplate={handleLoadTemplate}
              onDeleteTemplate={handleDeleteTemplate}
              projectIdForSave={templateSaveProjectId}
              projectNameForSave={
                templateSaveProjectId
                  ? projects.find((p) => p.id === templateSaveProjectId)?.name
                  : undefined
              }
              />
            </Suspense>}
            {notionConflictDialogOpen && <Suspense fallback={null}>
              <NotionConflictDialog
                open
                onOpenChange={setNotionConflictDialogOpen}
                conflicts={notionConflicts}
                onResolve={handleResolveConflicts}
              />
            </Suspense>}
            <Toaster
              closeButton
              richColors
              duration={3500}
              visibleToasts={3}
              position="bottom-right"
              theme={resolvedDark ? "dark" : "light"}
            />
          </div>
        </ErrorBoundary>
      </MotionConfig>
    </TooltipProvider>
  );
}

export default memo(App);
