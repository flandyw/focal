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
  clampMinutes,
  closeRunningInterval,
  countCompletedBlocksToday,
  EXTRA_BREAK_MINUTES,
  formatFocusTime,
  formatTimer,
  getActiveSessionSubjectIds,
  getDurationSeconds,
  getFocusSecondsToday,
  getInitialSettings,
  getInitialState,
  MAX_DAILY_GOAL,
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

function readStoredSessionId() {
  try {
    const stored = localStorage.getItem(TIMER_STATE_KEY);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as Partial<StoredTimerState>;
    return typeof parsed.activeSessionId === "string"
      ? parsed.activeSessionId
      : null;
  } catch {
    return null;
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
  const [expanded, setExpanded] = useState(false);
  const [focusViewOpen, setFocusViewOpen] = useState(false);
  const [settings, setSettings] = useState<TimerSettings>(getInitialSettings);
  const [state, dispatch] = useReducer(timerReducer, settings, getInitialState);
  const [selectedSubjectIds, setSelectedSubjectIds] = useState<string[]>(() =>
    selectedProject?.subjectId ? [selectedProject.subjectId] : [],
  );
  const [focusProjectId, setFocusProjectId] = useState<string | undefined>(selectedProject?.id);
  const [focusProjectLabel, setFocusProjectLabel] = useState<string | undefined>(selectedProject?.name);
  const [focusIntent, setFocusIntent] = useState("");
  const [focusSessionId, setFocusSessionId] = useState<string | undefined>();
  const [activeSessionId, setActiveSessionId] = useState<string | null>(
    readStoredSessionId,
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

  const todayStats = useMemo(
    () => ({
      blocks: countCompletedBlocksToday(sessions, todayNow),
      seconds: getFocusSecondsToday(sessions, todayNow),
    }),
    [sessions, todayNow],
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
    setCachedPreference(TIMER_SETTINGS_KEY, JSON.stringify(settings), false);
    localStorage.setItem(
      TIMER_STATE_KEY,
      JSON.stringify({
        ...state,
        activeSessionId,
        updatedAt: Date.now(),
      } satisfies StoredTimerState),
    );
  }, [activeSessionId, settings, state]);

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
    if (!settingsRef.current.alertsEnabled) return;
    playTimerChime(kind);
    void notifyTimerBlock(
      kind === "focus" ? "Focus block complete" : "Break finished",
      kind === "focus" ? "Time for a break." : "Ready for the next focus block?",
    );
  }, []);

  const onTick = useCallback(() => {
    const now = Date.now();
    const elapsedSeconds = Math.floor((now - lastTickAtRef.current) / 1000);
    if (elapsedSeconds < 1) return;
    const current = stateRef.current;
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
        // the next block counts toward the calendar and daily goal. Skipping a
        // break never reaches this branch — it only ever starts a countdown.
        if (
          settingsRef.current.autoStartFocus &&
          !savingRef.current &&
          !activeSessionIdRef.current &&
          selectedSubjectIds.length > 0 &&
          !externalSession
        ) {
          void startSessionRef.current(settingsRef.current.workMinutes * 60);
        }
      }
    }
    lastTickAtRef.current += elapsedSeconds * 1000;
    dispatch({
      type: "TICK",
      settings: settingsRef.current,
      seconds: elapsedSeconds,
    });
  }, [announceBlockEnd, completeActiveSession, externalSession, selectedSubjectIds]);

  useEffect(() => {
    clearTimer();
    if (!state.running && !(state.freeStudy && state.studyOvertime)) return;
    lastTickAtRef.current = Date.now();
    intervalRef.current = setInterval(onTick, 250);
    return clearTimer;
  }, [clearTimer, onTick, state.freeStudy, state.running, state.studyOvertime]);

  const {
    running,
    mode,
    secondsLeft,
    cycles,
    studyOvertime,
    overtimeSeconds,
    freeStudy,
    breakSeconds,
  } = state;
  const isStudyOvertime = studyOvertime && mode !== "work";
  const isFreeStudy = freeStudy && isStudyOvertime;
  const isFocus = mode === "work" || (isStudyOvertime && (!isFreeStudy || running));
  const totalSeconds = getDurationSeconds(mode, settings);
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
    selectedSubjectIds.includes(subject.id),
  );
  const subjectLabel = selectedSubjects[0]?.shortCode ?? "Choose subject";
  const activeProjectId = focusProjectId;
  const canStartFocus = selectedSubjectIds.length > 0 && !saving && !externalSession;
  const timerActionLabel = saving
    ? "Saving…"
    : running
      ? "Pause"
      : activeSessionId
        ? isFreeStudy
          ? "Continue"
          : "Resume"
        : "Start focus";

  const updateDuration = (key: keyof TimerSettings, value: string) => {
    const nextValue = clampMinutes(Number(value));
    setSettings((current) => {
      const next = { ...current, [key]: nextValue };
      dispatch({ type: "SYNC_SETTINGS", settings: next, previousSettings: current });
      return next;
    });
  };

  const updatePreference = (patch: Partial<TimerSettings>) => {
    setSettings((current) => ({ ...current, ...patch }));
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

  const handleSubjectClick = (subjectId: string) => {
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
    void onUpdateSession(sessionId, { subjectIds: next }).then(() => {
      if (activeSessionRef.current) {
        activeSessionRef.current = { ...activeSessionRef.current, subjectIds: next };
      }
    }).catch((error: unknown) => {
      console.error("Failed to change focus subject:", error);
    });
  };

  const startSession = async (durationSeconds = secondsLeft) => {
    if (activeSessionIdRef.current || !canStartFocus) return false;
    const session = await onStartSession({
      subjectIds: selectedSubjectIds,
      durationSeconds,
      projectId: activeProjectId,
      sessionId: focusSessionId,
      cycleNumber: cycles + 1,
      intent: focusIntent,
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
    if (await completeActiveSession()) dispatch({ type: "RESET", settings });
  };

  const handleRecoveryDiscard = async () => {
    const sessionId = activeSessionIdRef.current;
    if (!sessionId || !onDeleteSession) return;
    try {
      await onDeleteSession(sessionId);
      activeSessionIdRef.current = null;
      activeSessionRef.current = null;
      setActiveSessionId(null);
      setRecoveryDialogOpen(false);
      dispatch({ type: "RESET", settings });
    } catch (error) {
      console.error("Failed to discard recovered focus session:", error);
    }
  };

  const handleSkipBreak = () => {
    dispatch({ type: "SKIP_BREAK", settings });
  };

  const handleMoreBreakTime = () => {
    dispatch({ type: "ADD_BREAK_TIME", minutes: EXTRA_BREAK_MINUTES });
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
          selectedSubjectIds={selectedSubjectIds}
          subjectLabel={subjectLabel}
          projectLabel={focusProjectLabel}
          intent={focusIntent}
          onSubjectClick={handleSubjectClick}
          onIntentChange={setFocusIntent}
          onSearch={onSearch}
          onSettings={onSettings}
          onToggle={handleToggle}
          onFinish={handleFinish}
          onReset={handleReset}
          onReturnToBreak={handleReturnToBreak}
          onSkipBreak={handleSkipBreak}
          onStartStudyOvertime={handleStartStudyOvertime}
          onStartFreeStudy={handleStartFreeStudy}
          onMoreBreakTime={handleMoreBreakTime}
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
          sessionId={activeSessionId ?? ""}
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
        sessionId={activeSessionId ?? ""}
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
                  ? running
                    ? "Logging"
                    : "Paused"
                  : mode === "work"
                    ? "Ready"
                    : "Not logged"}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {activeSessionId
                  ? running
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
                  selectedSubjectIds={selectedSubjectIds}
                  activeSessionId={null}
                  onSubjectClick={handleSubjectClick}
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
              <div className="grid grid-cols-2 gap-1.5">
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
              <div className="grid grid-cols-3 gap-1.5">
                <Button onClick={() => void handleToggle()} disabled={saving}>
                  {running ? <Pause /> : <Coffee />}
                  {running ? "Pause" : "Resume"}
                </Button>
                <Button variant="outline" onClick={handleSkipBreak}>
                  <SkipForward />
                  Skip
                </Button>
                <Button variant="outline" onClick={handleMoreBreakTime}>
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
                    <div className="grid grid-cols-3 gap-1">
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
                  htmlFor="timer-alerts"
                  className="flex cursor-pointer items-center gap-2 text-xs"
                >
                  <Checkbox
                    id="timer-alerts"
                    checked={settings.alertsEnabled}
                    onCheckedChange={(checked) =>
                      updatePreference({ alertsEnabled: checked === true })
                    }
                  />
                  Alert when a block ends
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
