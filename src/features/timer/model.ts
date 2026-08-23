import type { StudySession } from "@/lib/types"

export const TIMER_SETTINGS_KEY = "focal-pomodoro-settings";
export const TIMER_STATE_KEY = "focal-pomodoro-state";
export const DEFAULT_SETTINGS = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  soundEnabled: true,
  notificationsEnabled: true,
  autoStartBreak: true,
  autoStartFocus: false,
  dailyGoal: 0,
};
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 180;
export const EXTRA_BREAK_MINUTES = 5;
export const MAX_DAILY_GOAL = 30;
export const MAX_FOCUS_INTENT_LENGTH = 120;
export const MIN_LONG_BREAK_INTERVAL = 2;
export const MAX_LONG_BREAK_INTERVAL = 12;
const MAX_RESTORE_ELAPSED_SECONDS = 24 * 60 * 60;

export const TIMER_PRESETS = [
  {
    id: "standard",
    label: "Standard",
    description: "25 / 5 / 15",
    workMinutes: 25,
    breakMinutes: 5,
    longBreakMinutes: 15,
  },
  {
    id: "deep",
    label: "Deep work",
    description: "50 / 10 / 20",
    workMinutes: 50,
    breakMinutes: 10,
    longBreakMinutes: 20,
  },
  {
    id: "lightning",
    label: "Lightning",
    description: "15 / 3 / 10",
    workMinutes: 15,
    breakMinutes: 3,
    longBreakMinutes: 10,
  },
  {
    id: "exam",
    label: "Exam prep",
    description: "90 / 15 / 30",
    workMinutes: 90,
    breakMinutes: 15,
    longBreakMinutes: 30,
  },
] as const;

export function clampDailyGoal(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_DAILY_GOAL, Math.max(0, Math.round(value)));
}

export function clampLongBreakInterval(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_SETTINGS.longBreakEvery;
  }
  return Math.min(
    MAX_LONG_BREAK_INTERVAL,
    Math.max(MIN_LONG_BREAK_INTERVAL, Math.round(value)),
  );
}

export type TimerMode = "work" | "break" | "long-break";

export interface TimerSettings {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  soundEnabled: boolean;
  notificationsEnabled: boolean;
  autoStartBreak: boolean;
  autoStartFocus: boolean;
  dailyGoal: number;
}

export interface TimerState {
  running: boolean;
  mode: TimerMode;
  secondsLeft: number;
  totalSeconds: number;
  cycles: number;
  studyOvertime: boolean;
  overtimeSeconds: number;
  freeStudy: boolean;
  breakSeconds: number;
}

export type TimerAction =
  | { type: "TICK"; settings: TimerSettings; seconds: number }
  | { type: "TOGGLE" }
  | { type: "RESET"; settings: TimerSettings }
  | { type: "SKIP_BREAK"; settings: TimerSettings }
  | { type: "ADD_TIME"; minutes: number }
  | { type: "START_STUDY_OVERTIME"; settings: TimerSettings }
  | { type: "START_FREE_STUDY"; settings: TimerSettings }
  | { type: "RETURN_TO_BREAK" }
  | {
      type: "SYNC_SETTINGS";
      settings: TimerSettings;
      previousSettings: TimerSettings;
    };

export interface StoredTimerState {
  running: boolean;
  mode: TimerMode;
  secondsLeft: number;
  totalSeconds?: number;
  cycles: number;
  studyOvertime?: boolean;
  overtimeSeconds?: number;
  freeStudy?: boolean;
  breakSeconds?: number;
  activeSessionId?: string | null;
  selectedSubjectIds?: string[];
  focusProjectId?: string;
  focusProjectLabel?: string;
  focusIntent?: string;
  updatedAt: number;
}

export function getDurationSeconds(mode: TimerMode, settings: TimerSettings) {
  if (mode === "work") return settings.workMinutes * 60;
  if (mode === "long-break") return settings.longBreakMinutes * 60;
  return settings.breakMinutes * 60;
}

export function clampMinutes(value: number) {
  if (!Number.isFinite(value)) return MIN_DURATION_MINUTES;
  return Math.min(
    MAX_DURATION_MINUTES,
    Math.max(MIN_DURATION_MINUTES, Math.round(value)),
  );
}

function safeNonNegativeInteger(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.round(value))
    : fallback;
}

export function formatTimer(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function parseSettings(value: string | null): TimerSettings {
  if (!value) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(value) as Partial<TimerSettings> & {
      alertsEnabled?: boolean;
    };
    const legacyAlerts = typeof parsed.alertsEnabled === "boolean"
      ? parsed.alertsEnabled
      : undefined;
    return {
      workMinutes: clampMinutes(
        parsed.workMinutes ?? DEFAULT_SETTINGS.workMinutes,
      ),
      breakMinutes: clampMinutes(
        parsed.breakMinutes ?? DEFAULT_SETTINGS.breakMinutes,
      ),
      longBreakMinutes: clampMinutes(
        parsed.longBreakMinutes ?? DEFAULT_SETTINGS.longBreakMinutes,
      ),
      longBreakEvery: clampLongBreakInterval(parsed.longBreakEvery),
      soundEnabled: typeof parsed.soundEnabled === "boolean"
        ? parsed.soundEnabled
        : legacyAlerts ?? DEFAULT_SETTINGS.soundEnabled,
      notificationsEnabled: typeof parsed.notificationsEnabled === "boolean"
        ? parsed.notificationsEnabled
        : legacyAlerts ?? DEFAULT_SETTINGS.notificationsEnabled,
      autoStartBreak:
        typeof parsed.autoStartBreak === "boolean"
          ? parsed.autoStartBreak
          : DEFAULT_SETTINGS.autoStartBreak,
      autoStartFocus:
        typeof parsed.autoStartFocus === "boolean"
          ? parsed.autoStartFocus
          : DEFAULT_SETTINGS.autoStartFocus,
      dailyGoal: clampDailyGoal(parsed.dailyGoal),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function getInitialSettings() {
  try {
    return parseSettings(localStorage.getItem(TIMER_SETTINGS_KEY));
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function isValidMode(mode: unknown): mode is TimerMode {
  return mode === "work" || mode === "break" || mode === "long-break";
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for the runnable timer self-check
export function advanceTimer(
  state: TimerState,
  settings: TimerSettings,
  elapsedSeconds: number,
): TimerState {
  let next = state;
  let remaining = Number.isFinite(elapsedSeconds)
    ? Math.max(0, Math.floor(elapsedSeconds))
    : 0;

  if (next.studyOvertime) {
    if (next.freeStudy && !next.running) {
      return { ...next, breakSeconds: next.breakSeconds + remaining };
    }
    if (!next.running) return next;
    return { ...next, overtimeSeconds: next.overtimeSeconds + remaining };
  }

  while (remaining > 0 && next.running) {
    if (remaining < next.secondsLeft) {
      return { ...next, secondsLeft: next.secondsLeft - remaining };
    }

    remaining -= next.secondsLeft;
    if (next.mode === "work") {
      const cycles = next.cycles + 1;
      const mode = cycles % settings.longBreakEvery === 0 ? "long-break" : "break";
      const totalSeconds = getDurationSeconds(mode, settings);
      next = {
        running: settings.autoStartBreak,
        mode,
        secondsLeft: totalSeconds,
        totalSeconds,
        cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      };
    } else {
      const totalSeconds = getDurationSeconds("work", settings);
      next = {
        running: settings.autoStartFocus,
        mode: "work",
        secondsLeft: totalSeconds,
        totalSeconds,
        cycles: next.cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      };
    }
  }

  return next;
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for the runnable timer self-check
export function closeRunningInterval(
  intervals: StudySession["execution"]["intervals"],
  end: string,
) {
  return intervals.map((interval, index, items) =>
    index === items.length - 1 && !interval.end ? { ...interval, end } : interval,
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for the runnable timer self-check
export function getActiveSessionSubjectIds(
  activeSessionId: string | null,
  sessions: StudySession[],
) {
  return sessions.find((session) => session.id === activeSessionId)?.subjectIds;
}

export function getInitialState(settings: TimerSettings): TimerState {
  const workSeconds = getDurationSeconds("work", settings);
  const fallback: TimerState = {
    running: false,
    mode: "work",
    secondsLeft: workSeconds,
    totalSeconds: workSeconds,
    cycles: 0,
    studyOvertime: false,
    overtimeSeconds: 0,
    freeStudy: false,
    breakSeconds: 0,
  };

  try {
    const stored = localStorage.getItem(TIMER_STATE_KEY);
    if (!stored) return fallback;

    const parsed = JSON.parse(stored) as Partial<StoredTimerState>;
    const mode = isValidMode(parsed.mode) ? parsed.mode : fallback.mode;
    const duration = getDurationSeconds(mode, settings);
    const now = Date.now();
    const updatedAt = typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
      ? Math.min(now, parsed.updatedAt)
      : now;
    const cycles = safeNonNegativeInteger(parsed.cycles);
    const studyOvertime = parsed.studyOvertime === true && mode !== "work";
    const freeStudy = studyOvertime && parsed.freeStudy === true;
    const elapsedSeconds = parsed.running || (freeStudy && parsed.running === false)
      ? Math.min(
          MAX_RESTORE_ELAPSED_SECONDS,
          Math.max(0, Math.floor((now - updatedAt) / 1000)),
        )
      : 0;
    const totalSeconds = Math.min(
      MAX_DURATION_MINUTES * 60,
      Math.max(duration, safeNonNegativeInteger(parsed.totalSeconds, duration)),
    );
    const secondsLeft = Math.min(
      totalSeconds,
      Math.max(1, safeNonNegativeInteger(parsed.secondsLeft, duration)),
    );
    const overtimeSeconds = safeNonNegativeInteger(parsed.overtimeSeconds);
    const breakSeconds = safeNonNegativeInteger(parsed.breakSeconds);

    if (studyOvertime) {
      return {
        running: parsed.running === true,
        mode,
        secondsLeft,
        totalSeconds,
        cycles,
        studyOvertime: true,
        overtimeSeconds: parsed.running
          ? overtimeSeconds + elapsedSeconds
          : overtimeSeconds,
        freeStudy,
        breakSeconds: freeStudy && parsed.running === false
          ? breakSeconds + elapsedSeconds
          : breakSeconds,
      };
    }

    if (parsed.running) {
      return advanceTimer({
        running: true,
        mode,
        secondsLeft,
        totalSeconds,
        cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      }, settings, elapsedSeconds);
    }

    return {
      running: false,
      mode,
      secondsLeft,
      totalSeconds,
      cycles,
      studyOvertime: false,
      overtimeSeconds: 0,
      freeStudy: false,
      breakSeconds: 0,
    };
  } catch {
    return fallback;
  }
}

export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case "TICK":
      return advanceTimer(state, action.settings, action.seconds);
    case "TOGGLE":
      return {
        ...state,
        running: !state.running,
        breakSeconds: state.freeStudy ? 0 : state.breakSeconds,
      };
    case "RESET": {
      const totalSeconds = getDurationSeconds("work", action.settings);
      return {
        running: false,
        mode: "work",
        secondsLeft: totalSeconds,
        totalSeconds,
        cycles: 0,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      };
    }
    case "SKIP_BREAK":
      if (state.mode === "work" || state.studyOvertime) return state;
      return {
        running: action.settings.autoStartFocus,
        mode: "work",
        secondsLeft: getDurationSeconds("work", action.settings),
        totalSeconds: getDurationSeconds("work", action.settings),
        cycles: state.cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      };
    case "ADD_TIME": {
      if (state.studyOvertime) return state;
      const extraSeconds = Math.max(0, Math.round(action.minutes * 60));
      const totalSeconds = Math.min(
        MAX_DURATION_MINUTES * 60,
        state.totalSeconds + extraSeconds,
      );
      return {
        ...state,
        secondsLeft: Math.min(totalSeconds, state.secondsLeft + extraSeconds),
        totalSeconds,
      };
    }
    case "START_STUDY_OVERTIME": {
      if (state.mode === "work") return state;
      const elapsedBreakSeconds = Math.max(0, state.totalSeconds - state.secondsLeft);
      return {
        ...state,
        running: true,
        studyOvertime: true,
        overtimeSeconds: elapsedBreakSeconds,
        freeStudy: false,
        breakSeconds: 0,
      };
    }
    case "START_FREE_STUDY": {
      if (state.mode !== "work" || state.studyOvertime) return state;
      const totalSeconds = getDurationSeconds("break", action.settings);
      return {
        ...state,
        running: true,
        mode: "break",
        secondsLeft: totalSeconds,
        totalSeconds,
        studyOvertime: true,
        overtimeSeconds: 0,
        freeStudy: true,
        breakSeconds: 0,
      };
    }
    case "RETURN_TO_BREAK":
      if (!state.studyOvertime) return state;
      return {
        ...state,
        running: true,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      };
    case "SYNC_SETTINGS": {
      const oldDuration = getDurationSeconds(
        state.mode,
        action.previousSettings,
      );
      const nextDuration = getDurationSeconds(state.mode, action.settings);
      const secondsLeft =
        state.secondsLeft === oldDuration
          ? nextDuration
          : Math.min(state.secondsLeft, nextDuration);
      const totalSeconds = state.totalSeconds === oldDuration
        ? nextDuration
        : Math.max(secondsLeft, state.totalSeconds);
      return { ...state, secondsLeft, totalSeconds };
    }
    default:
      return state;
  }
}

function isSameLocalDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for the runnable timer self-check
export function countCompletedBlocksToday(
  sessions: StudySession[],
  now = new Date(),
) {
  const seen = new Set<string>();
  for (const session of sessions) {
    if (session.execution.state !== "completed") continue;
    for (const interval of session.execution.intervals) {
      if (interval.source !== "pomodoro" || !interval.end) continue;
      const end = new Date(interval.end);
      if (!Number.isNaN(end.getTime()) && end <= now && isSameLocalDay(end, now)) {
        seen.add(`${session.id}:${interval.cycleNumber ?? 0}`);
      }
    }
  }
  return seen.size;
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for the runnable timer self-check
export function getFocusSecondsToday(
  sessions: StudySession[],
  now = new Date(),
) {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(dayStart);
  dayEnd.setDate(dayEnd.getDate() + 1);
  let total = 0;
  for (const session of sessions) {
    for (const interval of session.execution.intervals) {
      if (interval.source !== "pomodoro") continue;
      const start = new Date(interval.start);
      const end = interval.end
        ? new Date(interval.end)
        : session.execution.state === "in-progress"
          ? now
          : null;
      if (!end) continue;
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        continue;
      }
      const clippedStart = Math.max(start.getTime(), dayStart.getTime());
      const clippedEnd = Math.min(end.getTime(), dayEnd.getTime(), now.getTime());
      total += Math.max(0, (clippedEnd - clippedStart) / 1000);
    }
  }
  return total;
}

export function getSessionFocusSeconds(session: StudySession, now = new Date()) {
  return session.execution.intervals.reduce((total, interval) => {
    if (interval.source !== "pomodoro") return total;
    const start = new Date(interval.start).getTime();
    const end = interval.end ? new Date(interval.end).getTime() : now.getTime();
    return Number.isFinite(start) && Number.isFinite(end)
      ? total + Math.max(0, end - start) / 1000
      : total;
  }, 0);
}

// eslint-disable-next-line react-refresh/only-export-components -- exported for the runnable timer self-check
export function formatFocusTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}m`;
}
