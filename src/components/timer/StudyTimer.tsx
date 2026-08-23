import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { openUrl } from "@tauri-apps/plugin-opener";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  Coffee,
  ExternalLink,
  Flame,
  Maximize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  SkipForward,
  Timer,
} from "lucide-react";
import { FocusView } from "@/components/timer/FocusView";
import { DurationInputs } from "@/components/timer/DurationInputs";
import { RecoveryDialog } from "@/components/timer/RecoveryDialog";
import { SubjectPicker } from "@/components/timer/SubjectPicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  VCE_SUBJECTS,
  type Project,
  type StudySession,
  type Subject,
} from "@/lib/types";
import { cn } from "@/lib/utils";
import { setCachedPreference } from "@/lib/storage/preferences";
import {
  getActiveExamTrackTimer,
  getExamTrackElapsedSeconds,
  getExamTrackTimerUrl,
} from "@/lib/examtrack";
import {
  clampDailyGoal,
  clampLongBreakInterval,
  clampMinutes,
  closeRunningInterval,
  countCompletedBlocksToday,
  EXTRA_BREAK_MINUTES,
  formatFocusTime,
  formatTimer,
  getActiveSessionSubjectIds,
  getFocusSecondsToday,
  getInitialSettings,
  getInitialState,
  getSessionFocusSeconds,
  MAX_DAILY_GOAL,
  MAX_FOCUS_INTENT_LENGTH,
  MAX_LONG_BREAK_INTERVAL,
  MIN_LONG_BREAK_INTERVAL,
  TIMER_PRESETS,
  timerReducer,
  TIMER_SETTINGS_KEY,
  TIMER_STATE_KEY,
  type StoredTimerState,
  type TimerSettings,
} from "@/features/timer/model";
import { notifyTimerBlock, playTimerChime } from "@/lib/timerAlerts";

interface StudyTimerProps {
  isCollapsed?: boolean;
  onExpand?: () => void;
  customSubjects?: Subject[];
  availableSubjects?: Subject[];
  sessions?: StudySession[];
  selectedProject?: Project;
  onSearch?: () => void;
  onSettings?: () => void;
  onStartSession: (data: {
    subjectIds: string[];
    durationSeconds: number;
    projectId?: string;
    sessionId?: string;
    cycleNumber: number;
    intent?: string;
  }) => Promise<StudySession>;
  onUpdateSession: (
    id: string,
    updates: Partial<Omit<StudySession, "id" | "created_at">>,
  ) => Promise<void>;
  onDeleteSession?: (id: string) => Promise<void>;
}

function readStoredTimerMetadata() {
  const fallback = {
    activeSessionId: null as string | null,
    selectedSubjectIds: [] as string[],
    focusProjectId: undefined as string | undefined,
    focusProjectLabel: undefined as string | undefined,
    focusIntent: "",
  };
  try {
    const stored = localStorage.getItem(TIMER_STATE_KEY);
    if (!stored) return fallback;
    const parsed = JSON.parse(stored) as Partial<StoredTimerState>;
    return {
      activeSessionId: typeof parsed.activeSessionId === "string"
        ? parsed.activeSessionId
        : null,
      selectedSubjectIds: Array.isArray(parsed.selectedSubjectIds)
        ? [...new Set(parsed.selectedSubjectIds.filter((id): id is string => typeof id === "string"))]
        : [],
      focusProjectId: typeof parsed.focusProjectId === "string" ? parsed.focusProjectId : undefined,
      focusProjectLabel: typeof parsed.focusProjectLabel === "string" ? parsed.focusProjectLabel : undefined,
      focusIntent: typeof parsed.focusIntent === "string"
        ? parsed.focusIntent.slice(0, MAX_FOCUS_INTENT_LENGTH)
        : "",
    };
  } catch {
    return fallback;
  }
}

function closedBlocks(intervals: StudySession["execution"]["intervals"]) {
  return intervals.flatMap((interval) =>
    interval.end ? [{ start: interval.start, end: interval.end }] : [],
  );
}

const StudyTimerInner = memo(function StudyTimerInner({
  isCollapsed = false,
  onExpand,
  customSubjects = [],
  availableSubjects,
  sessions = [],
  selectedProject,
  onSearch,
  onSettings,
  onStartSession,
  onUpdateSession,
  onDeleteSession,
}: StudyTimerProps) {
  const storedMetadata = useMemo(readStoredTimerMetadata, []);
  const [expanded, setExpanded] = useState(false);
  const [focusViewOpen, setFocusViewOpen] = useState(false);
  const [settings, setSettings] = useState<TimerSettings>(getInitialSettings);
  const [state, dispatch] = useReducer(timerReducer, settings, getInitialState);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(() =>
    storedMetadata.selectedSubjectIds.length > 0
      ? storedMetadata.selectedSubjectIds
      : selectedProject?.subjectId
        ? [selectedProject.subjectId]
        : [],
  );
  const [focusProjectId, setFocusProjectId] = useState<string | undefined>(
    storedMetadata.focusProjectId ?? selectedProject?.id,
  );
  const [focusProjectLabel, setFocusProjectLabel] = useState<string | undefined>(
    storedMetadata.focusProjectLabel ?? selectedProject?.name,
  );
  const [focusIntent, setFocusIntent] = useState(storedMetadata.focusIntent);
  const [focusSessionId, setFocusSessionId] = useState<string | undefined>();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    storedMetadata.activeSessionId,
  );
  const [saving, setSaving] = useState(false);
  const [recoveryDialogOpen, setRecoveryDialogOpen] = useState(() => {
    try {
      const stored = localStorage.getItem(TIMER_STATE_KEY);
      if (!stored) return false;
      const parsed = JSON.parse(stored) as Partial<StoredTimerState>;
      return parsed.running === true && typeof parsed.activeSessionId === "string";
    } catch {
      return false;
    }
  });
  const externalSession = useMemo(
    () => getActiveExamTrackTimer(sessions),
    [sessions],
  );
  const [externalNow, setExternalNow] = useState(() => new Date());
  const [todayNow, setTodayNow] = useState(() => new Date());

  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeSessionIdRef = useRef(activeSessionId);
  const activeSessionRef = useRef<StudySession | null>(null);
  const stateRef = useRef(state);
  const settingsRef = useRef(settings);
  const lastTickAtRef = useRef(Date.now());
  const savingRef = useRef(false);
  const completionInFlightRef = useRef(false);
  const focusCloseButtonRef = useRef<HTMLButtonElement | null>(null);
  const titleBeforeTimerRef = useRef<string | null>(null);

  const subjects = useMemo(() => {
    const base = availableSubjects ?? [...VCE_SUBJECTS, ...customSubjects];
    const projectSubject = selectedProject?.subjectId
      ? [...VCE_SUBJECTS, ...customSubjects].find(
          (subject) => subject.id === selectedProject.subjectId,
        )
      : undefined;
    return projectSubject && !base.some((subject) => subject.id === projectSubject.id)
      ? [projectSubject, ...base]
      : base;
  }, [availableSubjects, customSubjects, selectedProject?.subjectId]);

  const validSelectedSubjectIds = useMemo(
    () => selectedSubjectIds.filter((id) => subjects.some((subject) => subject.id === id)),
    [selectedSubjectIds, subjects],
  );

  const todayStats = useMemo(
    () => ({
      blocks: countCompletedBlocksToday(sessions, todayNow),
      seconds: getFocusSecondsToday(sessions, todayNow),
    }),
    [sessions, todayNow],
  );
  const recoverySession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    if (!externalSession?.execution.intervals.some((interval) => !interval.end)) return;
    const timer = window.setInterval(() => setExternalNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, [externalSession]);

  useEffect(() => {
    const timer = window.setInterval(() => setTodayNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
    activeSessionRef.current = activeSessionId
      ? sessions.find((session) => session.id === activeSessionId) ??
        activeSessionRef.current
      : null;
    const restoredSubjects = getActiveSessionSubjectIds(activeSessionId, sessions);
    if (restoredSubjects?.length) setSelectedSubjectIds(restoredSubjects);
  }, [activeSessionId, sessions]);

  useEffect(() => {
    if (!externalSession || !activeSessionId || !state.running || savingRef.current) return;
    const session = activeSessionRef.current;
    if (!session) return;
    savingRef.current = true;
    setSaving(true);
    const end = new Date().toISOString();
    const intervals = closeRunningInterval(session.execution.intervals, end);
    const updates = {
      execution: { state: "in-progress", intervals } as const,
    };
    void onUpdateSession(session.id, updates).then(() => {
      activeSessionRef.current = { ...session, ...updates };
      dispatch({ type: "TOGGLE" });
    }).catch((error: unknown) => {
      console.error("Failed to pause Focal while ExamTrack timer started:", error);
    }).finally(() => {
      savingRef.current = false;
      setSaving(false);
    });
  }, [activeSessionId, externalSession, onUpdateSession, state.running]);

  useEffect(() => {
    if (!selectedProject?.subjectId || activeSessionIdRef.current) return;
    setSelectedSubjectIds([selectedProject.subjectId]);
    setFocusProjectId(selectedProject.id);
    setFocusProjectLabel(selectedProject.name);
  }, [selectedProject?.id, selectedProject?.name, selectedProject?.subjectId]);

  useEffect(() => {
    try {
      setCachedPreference(TIMER_SETTINGS_KEY, JSON.stringify(settings), false);
    } catch (error) {
      console.error("Failed to persist timer settings:", error);
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(
        TIMER_STATE_KEY,
        JSON.stringify({
          ...state,
          activeSessionId,
          selectedSubjectIds: validSelectedSubjectIds,
          focusProjectId,
          focusProjectLabel,
          focusIntent,
          updatedAt: Date.now(),
        } satisfies StoredTimerState),
      );
    } catch (error) {
      console.error("Failed to persist timer state:", error);
    }
  }, [activeSessionId, focusIntent, focusProjectId, focusProjectLabel, state, validSelectedSubjectIds]);

  const setFocusView = useCallback((open: boolean) => {
    setFocusViewOpen(open);
    if (!open) setFocusSessionId(undefined);
    window.dispatchEvent(
      new CustomEvent("focal-focus-mode-changed", { detail: { active: open } }),
    );
  }, []);

  useEffect(() => {
    const handleFocusRequest = (event: Event) => {
      const detail = (event as CustomEvent<{
        subjectIds?: string[];
        projectId?: string;
        projectLabel?: string;
        intent?: string;
        sessionId?: string;
      }>).detail;
      if (detail.subjectIds?.length) setSelectedSubjectIds(detail.subjectIds);
      setFocusProjectId(detail.projectId);
      setFocusProjectLabel(detail.projectLabel);
      setFocusIntent(detail.intent ?? "");
      setFocusSessionId(detail.sessionId);
      setFocusView(true);
    };
    window.addEventListener("focal-focus-request", handleFocusRequest);
    return () => window.removeEventListener("focal-focus-request", handleFocusRequest);
  }, [setFocusView]);

  const completeActiveSession = useCallback(
    async (endedAt = new Date()) => {
      const sessionId = activeSessionIdRef.current;
      if (!sessionId || completionInFlightRef.current) return false;
      const session =
        activeSessionRef.current ??
        sessions.find((item) => item.id === sessionId) ??
        null;
      if (!session) return false;

      completionInFlightRef.current = true;
      try {
        const end = endedAt.toISOString();
        const intervals = closeRunningInterval(session.execution.intervals, end);
        const blocks = closedBlocks(intervals);
        const updates = {
          ...(blocks.length > 0 ? { schedule: { blocks } } : {}),
          execution: {
            state: "completed",
            intervals,
            completedAt: end,
          } as const,
        } satisfies Partial<Omit<StudySession, "id" | "created_at">>;
        await onUpdateSession(sessionId, updates);
        activeSessionIdRef.current = null;
        activeSessionRef.current = null;
        setActiveSessionId(null);
        setRecoveryDialogOpen(false);
        return true;
      } catch (error) {
        console.error("Failed to finish focus session:", error);
        toast.error("Could not save the focus session");
        return false;
      } finally {
        completionInFlightRef.current = false;
      }
    },
    [onUpdateSession, sessions],
  );

  useEffect(() => {
    if (state.mode === "work" || state.studyOvertime || !activeSessionId) return;
    const session = sessions.find((item) => item.id === activeSessionId);
    if (!session) return;
    const scheduledEnd = session ? new Date(session.endTime) : null;
    void completeActiveSession(
      scheduledEnd && Number.isFinite(scheduledEnd.getTime()) && scheduledEnd < new Date()
        ? scheduledEnd
        : new Date(),
    );
  }, [activeSessionId, completeActiveSession, sessions, state.mode, state.studyOvertime]);

  const clearTimer = useCallback(() => {
    if (!intervalRef.current) return;
    clearInterval(intervalRef.current);
    intervalRef.current = null;
  }, []);

  // Populated on every render so onTick can start a logged session when an
  // auto-started focus block rolls in from a natural break end.
  const startSessionRef = useRef<(durationSeconds?: number) => Promise<boolean>>(
    () => Promise.resolve(false),
  );

  const announceBlockEnd = useCallback((kind: "focus" | "break") => {
    if (settingsRef.current.soundEnabled) playTimerChime(kind);
    if (settingsRef.current.notificationsEnabled) {
      void notifyTimerBlock(
        kind === "focus" ? "Focus block complete" : "Break finished",
        kind === "focus" ? "Time for a break." : "Ready for the next focus block?",
      );
    }
  }, []);

  const onTick = useCallback(() => {
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - lastTickAtRef.current) / 1000);
    if (elapsedSeconds < 1) return;
    const current = stateRef.current;
    let tickSettings = settingsRef.current;
    if (
      current.running &&
      !current.studyOvertime &&
      elapsedSeconds >= current.secondsLeft
    ) {
      if (current.mode === "work") {
        void completeActiveSession(
          new Date(lastTickAtRef.current + current.secondsLeft * 1000),
        );
        announceBlockEnd("focus");
      } else {
        announceBlockEnd("break");
        // Natural break end with auto-start focus: begin a logged session so
        // the next block counts toward the calendar and daily goal.
        if (settingsRef.current.autoStartFocus) {
          // Never let an automatically started countdown run without a matching
          // calendar session. If creation fails, the next focus block stays paused.
          tickSettings = { ...settingsRef.current, autoStartFocus: false };
          if (
            !savingRef.current &&
            !activeSessionIdRef.current &&
            validSelectedSubjectIds.length > 0 &&
            !externalSession
          ) {
            savingRef.current = true;
            setSaving(true);
            void startSessionRef.current(settingsRef.current.workMinutes * 60)
              .then((started) => {
                if (started) dispatch({ type: "TOGGLE" });
              })
              .catch((error: unknown) => {
                console.error("Failed to auto-start focus session:", error);
                toast.error("The next focus block is ready but could not start automatically");
              })
              .finally(() => {
                savingRef.current = false;
                setSaving(false);
              });
          }
        }
      }
    }
    lastTickAtRef.current += elapsedSeconds * 1000;
    dispatch({
      type: "TICK",
      settings: tickSettings,
      seconds: elapsedSeconds,
    });
  }, [announceBlockEnd, completeActiveSession, externalSession, validSelectedSubjectIds]);

  useEffect(() => {
    clearTimer();
    if (!state.running && !(state.freeStudy && state.studyOvertime)) return;
    lastTickAtRef.current = Date.now();
    intervalRef.current = setInterval(onTick, 250);
    return clearTimer;
  }, [clearTimer, onTick, state.freeStudy, state.running, state.studyOvertime]);

  useEffect(() => {
    const catchUp = () => {
      if (document.visibilityState === "visible") onTick();
    };
    document.addEventListener("visibilitychange", catchUp);
    window.addEventListener("focus", catchUp);
    return () => {
      document.removeEventListener("visibilitychange", catchUp);
      window.removeEventListener("focus", catchUp);
    };
  }, [onTick]);

  const {
    running,
    mode,
    secondsLeft,
    totalSeconds,
    cycles,
    studyOvertime,
    overtimeSeconds,
    freeStudy,
    breakSeconds,
  } = state;
  const isStudyOvertime = studyOvertime && mode !== "work";
  const isFreeStudy = freeStudy && isStudyOvertime;
  const isFocus = mode === "work" || (isStudyOvertime && (!isFreeStudy || running));
  const progress = isFreeStudy
    ? 0
    : isStudyOvertime
      ? 1
    : Math.min(1, Math.max(0, 1 - secondsLeft / totalSeconds));
  const progressPercent = Math.round(progress * 100);
  const studyTimeDisplay = isStudyOvertime
    ? `${isFreeStudy ? "" : "+"}${formatTimer(overtimeSeconds)}`
    : formatTimer(secondsLeft);
  const timeDisplay = isFreeStudy && !running
    ? formatTimer(breakSeconds)
    : studyTimeDisplay;
  const modeLabel = isFreeStudy
    ? running
      ? "Free study"
      : "Break"
    : isStudyOvertime
      ? "Extra focus"
      : mode === "work"
        ? "Focus"
        : mode === "long-break"
          ? "Long break"
          : "Break";
  const selectedSubjects = subjects.filter((subject) =>
    validSelectedSubjectIds.includes(subject.id),
  );
  const subjectLabel = selectedSubjects[0]?.shortCode ?? "Choose subject";
  const activeProjectId = focusProjectId;
  const canStartFocus = validSelectedSubjectIds.length > 0 && !saving && !externalSession;
  const timerActionLabel = saving
    ? "Saving…"
    : running
      ? "Pause"
      : activeSessionId
        ? isFreeStudy
          ? "Continue"
          : "Resume"
        : "Start focus";

  useEffect(() => {
    const timerIsRelevant = running || !!activeSessionId || mode !== "work";
    if (timerIsRelevant) {
      titleBeforeTimerRef.current ??= document.title;
      document.title = `${running || !activeSessionId ? timeDisplay : "Paused"} · ${subjectLabel} · Focal`;
    } else if (titleBeforeTimerRef.current) {
      document.title = titleBeforeTimerRef.current;
      titleBeforeTimerRef.current = null;
    }
  }, [activeSessionId, mode, running, subjectLabel, timeDisplay]);

  useEffect(() => () => {
    if (titleBeforeTimerRef.current) document.title = titleBeforeTimerRef.current;
  }, []);

  const updateDuration = (key: keyof TimerSettings, value: string) => {
    const nextValue = clampMinutes(Number(value));
    setSettings((current) => {
      const next = { ...current, [key]: nextValue };
      dispatch({ type: "SYNC_SETTINGS", settings: next, previousSettings: current });
      return next;
    });
  };

  const updatePreference = (patch: Partial<TimerSettings>) => {
    setSettings((current) => ({
      ...current,
      ...patch,
      ...(patch.longBreakEvery !== undefined
        ? { longBreakEvery: clampLongBreakInterval(patch.longBreakEvery) }
        : {}),
    }));
  };

  const applyPreset = (preset: (typeof TIMER_PRESETS)[number]) => {
    setSettings((current) => {
      const next = {
        ...current,
        workMinutes: preset.workMinutes,
        breakMinutes: preset.breakMinutes,
        longBreakMinutes: preset.longBreakMinutes,
      };
      dispatch({ type: "SYNC_SETTINGS", settings: next, previousSettings: current });
      return next;
    });
  };

  const isActivePreset = (preset: (typeof TIMER_PRESETS)[number]) =>
    settings.workMinutes === preset.workMinutes &&
    settings.breakMinutes === preset.breakMinutes &&
    settings.longBreakMinutes === preset.longBreakMinutes;

  const handleSubjectClick = async (subjectId: string) => {
    if (savingRef.current || !subjects.some((subject) => subject.id === subjectId)) return;
    const previous = selectedSubjectIds;
    const previousProjectId = focusProjectId;
    const previousProjectLabel = focusProjectLabel;
    const next = [subjectId];
    setSelectedSubjectIds(next);
    if (selectedProject?.subjectId === subjectId) {
      setFocusProjectId(selectedProject.id);
      setFocusProjectLabel(selectedProject.name);
    } else {
      setFocusProjectId(undefined);
      setFocusProjectLabel(undefined);
    }
    const sessionId = activeSessionIdRef.current;
    if (!sessionId) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await onUpdateSession(sessionId, { subjectIds: next });
      if (activeSessionRef.current) {
        activeSessionRef.current = { ...activeSessionRef.current, subjectIds: next };
      }
    } catch (error) {
      setSelectedSubjectIds(previous);
      setFocusProjectId(previousProjectId);
      setFocusProjectLabel(previousProjectLabel);
      console.error("Failed to change focus subject:", error);
      toast.error("Could not change the focus subject");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const startSession = async (durationSeconds = secondsLeft) => {
    if (activeSessionIdRef.current || !canStartFocus) return false;
    const session = await onStartSession({
      subjectIds: validSelectedSubjectIds,
      durationSeconds,
      projectId: activeProjectId,
      sessionId: focusSessionId,
      cycleNumber: cycles + 1,
      intent: focusIntent.trim().slice(0, MAX_FOCUS_INTENT_LENGTH),
    });
    activeSessionIdRef.current = session.id;
    activeSessionRef.current = session;
    setActiveSessionId(session.id);
    setFocusSessionId(undefined);
    return true;
  };

  useEffect(() => {
    startSessionRef.current = startSession;
  });

  const handleToggle = async () => {
    if (savingRef.current) return;

    if (!running && mode === "work" && !activeSessionIdRef.current) {
      if (!canStartFocus) {
        setExpanded(true);
        return;
      }
      savingRef.current = true;
      setSaving(true);
      try {
        if (await startSession()) dispatch({ type: "TOGGLE" });
      } catch (error) {
        console.error("Failed to start focus session:", error);
        toast.error("Could not start the focus session");
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
      return;
    }

    const session = activeSessionRef.current;
    if (session && (isFocus || isFreeStudy)) {
      savingRef.current = true;
      setSaving(true);
      try {
        const now = new Date();
        const nowIso = now.toISOString();
        const intervals = running
          ? closeRunningInterval(session.execution.intervals, nowIso)
          : [
              ...session.execution.intervals,
              {
                start: nowIso,
                source: "pomodoro" as const,
                cycleNumber: cycles + 1,
              },
            ];
        const blocks = [
          ...closedBlocks(intervals),
          ...(!running && !isFreeStudy
            ? [{
                start: nowIso,
                end: new Date(now.getTime() + secondsLeft * 1000).toISOString(),
              }]
            : []),
        ];
        const updates = {
          ...(blocks.length > 0 ? { schedule: { blocks } } : {}),
          execution: { state: "in-progress", intervals } as const,
        };
        await onUpdateSession(session.id, updates);
        activeSessionRef.current = { ...session, ...updates };
      } catch (error) {
        console.error(`Failed to ${running ? "pause" : "resume"} focus session:`, error);
        toast.error(`Could not ${running ? "pause" : "resume"} the focus session`);
        return;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    }
    dispatch({ type: "TOGGLE" });
  };

  const handleFinish = async () => {
    if (!activeSessionIdRef.current || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (await completeActiveSession()) dispatch({ type: "RESET", settings });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleReset = async () => {
    if (savingRef.current) return;
    if (activeSessionIdRef.current) {
      savingRef.current = true;
      setSaving(true);
      try {
        if (!(await completeActiveSession())) return;
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    }
    dispatch({ type: "RESET", settings });
  };

  const handleStartStudyOvertime = async () => {
    if (
      mode === "work" ||
      isStudyOvertime ||
      activeSessionIdRef.current ||
      !canStartFocus ||
      savingRef.current
    ) return;

    savingRef.current = true;
    setSaving(true);
    try {
      if (await startSession(settings.workMinutes * 60)) {
        dispatch({ type: "START_STUDY_OVERTIME", settings });
      }
    } catch (error) {
      console.error("Failed to keep focusing:", error);
      toast.error("Could not continue the focus session");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleStartFreeStudy = async () => {
    if (
      mode !== "work" ||
      activeSessionIdRef.current ||
      !canStartFocus ||
      savingRef.current
    ) return;

    savingRef.current = true;
    setSaving(true);
    try {
      if (await startSession(settings.workMinutes * 60)) {
        dispatch({ type: "START_FREE_STUDY", settings });
      }
    } catch (error) {
      console.error("Failed to start free study:", error);
      toast.error("Could not start free study");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleReturnToBreak = async () => {
    if (!isStudyOvertime || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      if (await completeActiveSession()) dispatch({ type: "RETURN_TO_BREAK" });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleRecoveryFinish = async () => {
    const completed = await completeActiveSession();
    if (completed) dispatch({ type: "RESET", settings });
    return completed;
  };

  const handleRecoveryDiscard = async () => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId || !onDeleteSession) return false;
    try {
      await onDeleteSession(sessionId);
      activeSessionIdRef.current = null;
      activeSessionRef.current = null;
      setActiveSessionId(null);
      setRecoveryDialogOpen(false);
      dispatch({ type: "RESET", settings });
      return true;
    } catch (error) {
      console.error("Failed to discard recovered focus session:", error);
      toast.error("Could not discard the recovered session");
      return false;
    }
  };

  const handleSkipBreak = async () => {
    const pausedSettings = { ...settings, autoStartFocus: false };
    if (!settings.autoStartFocus || !canStartFocus || savingRef.current) {
      dispatch({ type: "SKIP_BREAK", settings: pausedSettings });
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      if (await startSession(settings.workMinutes * 60)) {
        dispatch({ type: "SKIP_BREAK", settings });
      } else {
        dispatch({ type: "SKIP_BREAK", settings: pausedSettings });
      }
    } catch (error) {
      console.error("Failed to start focus after skipping the break:", error);
      toast.error("Break skipped; the next focus block is paused");
      dispatch({ type: "SKIP_BREAK", settings: pausedSettings });
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleAddTime = () => {
    dispatch({ type: "ADD_TIME", minutes: EXTRA_BREAK_MINUTES });
  };

  const focusPortal = focusViewOpen
    ? createPortal(
        <FocusView
          running={running}
          mode={mode}
          isStudyOvertime={isStudyOvertime}
          isFreeStudy={isFreeStudy}
          secondsLeft={secondsLeft}
          totalSeconds={totalSeconds}
          progress={progress}
          timeDisplay={timeDisplay}
          studyTimeDisplay={studyTimeDisplay}
          modeLabel={modeLabel}
          timerActionLabel={timerActionLabel}
          canStartFocus={canStartFocus}
          saving={saving}
          cycles={cycles}
          activeSessionId={activeSessionId}
          todayBlocks={todayStats.blocks}
          todaySeconds={todayStats.seconds}
          dailyGoal={settings.dailyGoal}
          subjects={subjects}
          selectedSubjectIds={validSelectedSubjectIds}
          subjectLabel={subjectLabel}
          projectLabel={focusProjectLabel}
          intent={focusIntent}
          onSubjectClick={handleSubjectClick}
          onIntentChange={(value) => setFocusIntent(value.slice(0, MAX_FOCUS_INTENT_LENGTH))}
          onSearch={onSearch}
          onSettings={onSettings}
          onToggle={handleToggle}
          onFinish={handleFinish}
          onReset={handleReset}
          onReturnToBreak={handleReturnToBreak}
          onSkipBreak={handleSkipBreak}
          onStartStudyOvertime={handleStartStudyOvertime}
          onStartFreeStudy={handleStartFreeStudy}
          onAddTime={handleAddTime}
          onManageSubjects={onSettings}
          onClose={() => setFocusView(false)}
          closeButtonRef={focusCloseButtonRef}
        />,
        document.body,
      )
    : null;

  if (externalSession) {
    const source = externalSession.integrations!.examtrack!;
    const externalRunning = externalSession.execution.state === "in-progress"
      && externalSession.execution.intervals.some((interval) => !interval.end);
    const elapsed = formatTimer(getExamTrackElapsedSeconds(externalSession, externalNow));
    const externalUrl = getExamTrackTimerUrl(source.kind);
    const openTimer = () => {
      if (externalUrl) void openUrl(externalUrl).catch((error) => console.error("Could not open ExamTrack timer:", error));
    };

    if (isCollapsed) {
      return (
        <div className="flex flex-col items-center gap-1 py-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onExpand}
            aria-label="Expand ExamTrack timer"
            title={`${source.kind === "exam" ? "Exam" : "SAC"} · ${elapsed}`}
          >
            <Timer />
          </Button>
          <Button variant="ghost" size="icon" onClick={openTimer} disabled={!externalUrl} aria-label="Open timer in ExamTrack">
            <ExternalLink />
          </Button>
        </div>
      );
    }

    return (
      <section className="min-w-0 border-t border-sidebar-border/70" aria-label="ExamTrack timer">
        <div className="space-y-3 p-3">
          <div className="flex items-center gap-2">
            <Badge variant={externalRunning ? "success" : "secondary"}>ExamTrack</Badge>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {externalRunning ? "Logging to Focal" : "Paused in ExamTrack"}
            </span>
          </div>
          <div>
            <p className="truncate text-sm font-medium">{externalSession.title}</p>
            <p className="mt-1 font-heading text-3xl font-semibold tabular-nums">{elapsed}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {source.kind === "exam" ? "Exam timer" : "SAC timer"} · {source.subject}
            </p>
          </div>
          <Button className="w-full" onClick={openTimer} disabled={!externalUrl}>
            <ExternalLink />
            Open in ExamTrack
          </Button>
        </div>
      </section>
    );
  }

  if (isCollapsed) {
    return (
      <>
        {focusPortal}
        <RecoveryDialog
          open={recoveryDialogOpen}
          onOpenChange={setRecoveryDialogOpen}
          sessionLabel={recoverySession?.title}
          elapsedLabel={recoverySession ? formatFocusTime(getSessionFocusSeconds(recoverySession, todayNow)) : undefined}
          ready={!!recoverySession}
          canDiscard={!!onDeleteSession}
          onResume={() => setRecoveryDialogOpen(false)}
          onFinish={handleRecoveryFinish}
          onDiscard={handleRecoveryDiscard}
        />
        <div className="flex flex-col items-center gap-1 py-1">
          <Button
            variant="ghost"
            size="icon"
            onClick={onExpand}
            aria-label="Expand focus timer"
            title={running ? `${timeDisplay} · ${subjectLabel}` : "Focus timer"}
          >
            <Timer />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setFocusView(true)}
            aria-label="Open focus view"
          >
            <Maximize2 />
          </Button>
        </div>
      </>
    );
  }

  return (
    <>
      {focusPortal}
      <RecoveryDialog
        open={recoveryDialogOpen}
        onOpenChange={setRecoveryDialogOpen}
        sessionLabel={recoverySession?.title}
        elapsedLabel={recoverySession ? formatFocusTime(getSessionFocusSeconds(recoverySession, todayNow)) : undefined}
        ready={!!recoverySession}
        canDiscard={!!onDeleteSession}
        onResume={() => setRecoveryDialogOpen(false)}
        onFinish={handleRecoveryFinish}
        onDiscard={handleRecoveryDiscard}
      />

      <section className="min-w-0 border-t border-sidebar-border/70" aria-label="Focus timer">
        <div className="flex items-center gap-1 p-2">
          <Button
            variant="ghost"
            className="min-w-0 flex-1 justify-start"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
          >
            <Timer />
            <span className="font-heading tabular-nums">
              {running || activeSessionId || mode !== "work" ? timeDisplay : "Focus"}
            </span>
            <span className="ml-auto truncate text-xs text-muted-foreground">
              {isFocus ? subjectLabel : modeLabel}
            </span>
            <ChevronDown className={cn("transition-transform", expanded && "rotate-180")} />
          </Button>
          <Button
            size="icon-xs"
            variant={running ? "outline" : "default"}
            onClick={() => void handleToggle()}
            disabled={saving || (isFocus && !canStartFocus && !activeSessionId)}
            aria-label={timerActionLabel}
          >
            {running ? <Pause /> : <Play />}
          </Button>
          <Button
            size="icon-xs"
            variant="ghost"
            onClick={() => setFocusView(true)}
            aria-label="Open focus view"
          >
            <Maximize2 />
          </Button>
        </div>

        {expanded && (
          <div className="space-y-3 px-3 pb-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant={activeSessionId ? "success" : "secondary"}>
                {activeSessionId
                  ? !isFocus
                    ? "Save pending"
                    : running
                      ? "Logging"
                      : "Paused"
                  : mode === "work"
                    ? "Ready"
                    : "Not logged"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {activeSessionId
                  ? !isFocus
                    ? "Retry saving the completed focus block"
                    : running
                      ? "Calendar is recording study time"
                      : "Calendar time is stopped"
                  : mode === "work"
                    ? "Starts a new calendar block"
                    : `Focus block ${cycles} saved`}
              </span>
            </div>

            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Flame className="h-3.5 w-3.5" />
                Today
              </span>
              <span className="tabular-nums">
                {todayStats.blocks} {todayStats.blocks === 1 ? "block" : "blocks"}
                {todayStats.seconds >= 60 && (
                  <span className="ml-1">· {formatFocusTime(todayStats.seconds)}</span>
                )}
              </span>
            </div>
            {settings.dailyGoal > 0 && (
              <div
                role="progressbar"
                aria-label="Daily goal progress"
                aria-valuemin={0}
                aria-valuemax={settings.dailyGoal}
                aria-valuenow={Math.min(todayStats.blocks, settings.dailyGoal)}
                className="h-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
                    todayStats.blocks >= settings.dailyGoal ? "bg-success" : "bg-primary",
                  )}
                  style={{
                    width: `${Math.min(100, (todayStats.blocks / settings.dailyGoal) * 100)}%`,
                  }}
                />
              </div>
            )}

            {mode === "work" && !activeSessionId && (
              <>
                <SubjectPicker
                  variant="sidebar"
                  subjects={subjects}
                  selectedSubjectIds={validSelectedSubjectIds}
                  activeSessionId={null}
                  disabled={saving}
                  onSubjectClick={handleSubjectClick}
                  onManageSubjects={onSettings}
                />
                <div className="space-y-1">
                  <span className="text-xs font-medium">Focus length</span>
                  <div className="grid grid-cols-3 gap-1">
                    {[25, 45, 60].map((minutes) => (
                      <Button
                        key={minutes}
                        size="xs"
                        variant={settings.workMinutes === minutes ? "secondary" : "outline"}
                        onClick={() => updateDuration("workMinutes", String(minutes))}
                      >
                        {settings.workMinutes === minutes && <Check />}
                        {minutes} min
                      </Button>
                    ))}
                  </div>
                  <Button
                    className="mt-1 w-full"
                    size="xs"
                    variant="outline"
                    onClick={() => void handleStartFreeStudy()}
                    disabled={!canStartFocus}
                  >
                    <Timer />
                    Free study · no time limit
                  </Button>
                </div>
              </>
            )}

            <div className="py-1 text-center">
              <p className="font-heading text-4xl font-semibold tabular-nums tracking-tight">
                {timeDisplay}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {modeLabel}
                {isFreeStudy && !running
                  ? ` · Study time ${studyTimeDisplay}`
                  : isFocus
                    ? ` · ${subjectLabel}`
                    : " · breaks stay off your calendar"}
              </p>
              <div
                role="progressbar"
                aria-label={`${modeLabel} progress`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={progressPercent}
                className="mt-3 h-1 overflow-hidden rounded-full bg-muted"
              >
                <div
                  className={cn(
                    "h-full rounded-full transition-[width] duration-1000 motion-reduce:transition-none",
                    isFocus ? "bg-primary" : "bg-success",
                  )}
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            </div>

            {isFocus ? (
              <div className={cn(
                "grid gap-1.5",
                activeSessionId && !isStudyOvertime ? "grid-cols-3" : "grid-cols-2",
              )}>
                <Button
                  className={activeSessionId ? "" : "col-span-2"}
                  onClick={() => void handleToggle()}
                  disabled={saving || (!activeSessionId && !canStartFocus)}
                >
                  {running ? <Pause /> : <Play />}
                  {timerActionLabel}
                </Button>
                {activeSessionId && (
                  <Button variant="outline" onClick={() => void handleFinish()} disabled={saving}>
                    <Check />
                    Finish
                  </Button>
                )}
                {activeSessionId && !isStudyOvertime && (
                  <Button variant="outline" onClick={handleAddTime} disabled={saving}>
                    <Plus />
                    {EXTRA_BREAK_MINUTES} min
                  </Button>
                )}
              </div>
            ) : isFreeStudy ? (
              <div className="grid grid-cols-2 gap-1.5">
                <Button onClick={() => void handleToggle()} disabled={saving}>
                  <Play />
                  Continue
                </Button>
                <Button variant="outline" onClick={() => void handleFinish()} disabled={saving}>
                  <Check />
                  Finish
                </Button>
              </div>
            ) : (
              <div className={cn("grid gap-1.5", activeSessionId ? "grid-cols-4" : "grid-cols-3")}>
                <Button onClick={() => void handleToggle()} disabled={saving}>
                  {running ? <Pause /> : <Coffee />}
                  {running ? "Pause" : "Resume"}
                </Button>
                {activeSessionId && (
                  <Button variant="outline" onClick={() => void handleFinish()} disabled={saving}>
                    <Check />
                    Save
                  </Button>
                )}
                <Button variant="outline" onClick={() => void handleSkipBreak()} disabled={saving}>
                  <SkipForward />
                  Skip
                </Button>
                <Button variant="outline" onClick={handleAddTime}>
                  <Plus />
                  {EXTRA_BREAK_MINUTES} min
                </Button>
              </div>
            )}

            <div className="flex items-center justify-between border-t pt-2">
              {!activeSessionId && mode === "work" ? (
                <details className="group flex-1">
                  <summary className="cursor-pointer list-none text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                    Custom durations
                  </summary>
                  <div className="space-y-2 pt-2">
                    <div className="grid grid-cols-2 gap-1">
                      {TIMER_PRESETS.map((preset) => (
                        <Button
                          key={preset.id}
                          size="xs"
                          variant={isActivePreset(preset) ? "secondary" : "outline"}
                          onClick={() => applyPreset(preset)}
                          title={preset.description}
                        >
                          {preset.label}
                        </Button>
                      ))}
                    </div>
                    <DurationInputs
                      variant="sidebar"
                      settings={settings}
                      onChange={updateDuration}
                    />
                  </div>
                </details>
              ) : (
                <span className="text-xs text-muted-foreground">Cycle {cycles + 1}</span>
              )}
              <Button
                size="xs"
                variant="ghost"
                onClick={() => void handleReset()}
                disabled={saving}
              >
                <RotateCcw />
                Reset
              </Button>
            </div>

            <details className="group">
              <summary className="cursor-pointer list-none text-xs text-muted-foreground [&::-webkit-details-marker]:hidden">
                Timer preferences
              </summary>
              <div className="space-y-2 pt-2">
                <label
                  htmlFor="timer-sound"
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    id="timer-sound"
                    checked={settings.soundEnabled}
                    onCheckedChange={(checked) => {
                      const enabled = checked === true;
                      updatePreference({ soundEnabled: enabled });
                      if (enabled) playTimerChime("break");
                    }}
                  />
                  Play a sound when a block ends
                </label>
                <label
                  htmlFor="timer-notifications"
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    id="timer-notifications"
                    checked={settings.notificationsEnabled}
                    onCheckedChange={(checked) =>
                      updatePreference({ notificationsEnabled: checked === true })
                    }
                  />
                  Show a desktop notification
                </label>
                <label
                  htmlFor="timer-auto-break"
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    id="timer-auto-break"
                    checked={settings.autoStartBreak}
                    onCheckedChange={(checked) =>
                      updatePreference({ autoStartBreak: checked === true })
                    }
                  />
                  Auto-start breaks
                </label>
                <label
                  htmlFor="timer-auto-focus"
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    id="timer-auto-focus"
                    checked={settings.autoStartFocus}
                    onCheckedChange={(checked) =>
                      updatePreference({ autoStartFocus: checked === true })
                    }
                  />
                  Auto-start next focus
                </label>
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                  <div>
                    <span className="text-xs font-medium">Long break cadence</span>
                    <p className="text-micro text-muted-foreground">After this many focus blocks</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => updatePreference({ longBreakEvery: settings.longBreakEvery - 1 })}
                      disabled={settings.longBreakEvery <= MIN_LONG_BREAK_INTERVAL}
                      aria-label="Decrease long break cadence"
                    >
                      −
                    </Button>
                    <span className="w-8 text-center text-sm font-medium tabular-nums">
                      {settings.longBreakEvery}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() => updatePreference({ longBreakEvery: settings.longBreakEvery + 1 })}
                      disabled={settings.longBreakEvery >= MAX_LONG_BREAK_INTERVAL}
                      aria-label="Increase long break cadence"
                    >
                      +
                    </Button>
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2 border-t pt-2">
                  <span className="text-xs font-medium">Daily goal</span>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() =>
                        updatePreference({
                          dailyGoal: clampDailyGoal(settings.dailyGoal - 1),
                        })
                      }
                      disabled={settings.dailyGoal <= 0}
                      aria-label="Decrease daily goal"
                    >
                      −
                    </Button>
                    <span className="w-8 text-center text-sm font-medium tabular-nums">
                      {settings.dailyGoal}
                    </span>
                    <Button
                      size="icon-xs"
                      variant="ghost"
                      onClick={() =>
                        updatePreference({
                          dailyGoal: clampDailyGoal(settings.dailyGoal + 1),
                        })
                      }
                      disabled={settings.dailyGoal >= MAX_DAILY_GOAL}
                      aria-label="Increase daily goal"
                    >
                      +
                    </Button>
                  </div>
                </div>
                <p className="text-micro text-muted-foreground">
                  0 = no goal. Blocks count closed focus blocks today.
                </p>
              </div>
            </details>
          </div>
        )}
      </section>
    </>
  );
});

export const StudyTimer = StudyTimerInner;
