import type { StudySession } from "@/lib/types"

export const TIMER_SETTINGS_KEY = "focal-pomodoro-settings";
export const TIMER_STATE_KEY = "focal-pomodoro-state";
export const DEFAULT_SETTINGS = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  alertsEnabled: true,
  autoStartBreak: true,
  autoStartFocus: false,
  dailyGoal: 0,
};
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 180;
export const EXTRA_BREAK_MINUTES = 5;
export const MAX_DAILY_GOAL = 30;

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
] as const;

export function clampDailyGoal(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(MAX_DAILY_GOAL, Math.max(0, Math.round(value)));
}

export type TimerMode = "work" | "break" | "long-break";

export interface TimerSettings {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
  alertsEnabled: boolean;
  autoStartBreak: boolean;
  autoStartFocus: boolean;
  dailyGoal: number;
}

export interface TimerState {
  running: boolean;
  mode: TimerMode;
  secondsLeft: number;
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
  | { type: "ADD_BREAK_TIME"; minutes: number }
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
  cycles: number;
  studyOvertime?: boolean;
  overtimeSeconds?: number;
  freeStudy?: boolean;
  breakSeconds?: number;
  activeSessionId?: string | null;
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

export function formatTimer(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function parseSettings(value: string | null): TimerSettings {
  if (!value) return DEFAULT_SETTINGS;
  try {
    const parsed = JSON.parse(value) as Partial<TimerSettings>;
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
      alertsEnabled:
        typeof parsed.alertsEnabled === "boolean"
          ? parsed.alertsEnabled
          : DEFAULT_SETTINGS.alertsEnabled,
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
  return parseSettings(localStorage.getItem(TIMER_SETTINGS_KEY));
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
  let remaining = Math.max(0, Math.floor(elapsedSeconds));

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
      const mode = cycles % 4 === 0 ? "long-break" : "break";
      next = {
        running: settings.autoStartBreak,
        mode,
        secondsLeft: getDurationSeconds(mode, settings),
        cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      };
    } else {
      next = {
        running: settings.autoStartFocus,
        mode: "work",
        secondsLeft: getDurationSeconds("work", settings),
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
  const fallback: TimerState = {
    running: false,
    mode: "work",
    secondsLeft: getDurationSeconds("work", settings),
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
    const updatedAt =
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now();
    const cycles = Math.max(0, Math.round(parsed.cycles ?? 0));
    const studyOvertime = parsed.studyOvertime === true && mode !== "work";
    const freeStudy = studyOvertime && parsed.freeStudy === true;
    const elapsedSeconds = parsed.running || (freeStudy && parsed.running === false)
      ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))
      : 0;
    const overtimeSeconds = Math.max(
      0,
      Math.round(parsed.overtimeSeconds ?? 0),
    );
    const breakSeconds = Math.max(0, Math.round(parsed.breakSeconds ?? 0));

    if (studyOvertime) {
      return {
        running: parsed.running === true,
        mode,
        secondsLeft: Math.min(
          duration,
          Math.max(1, Math.round(parsed.secondsLeft ?? duration)),
        ),
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
        secondsLeft: Math.min(
          duration,
          Math.max(1, Math.round(parsed.secondsLeft ?? duration)),
        ),
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
      secondsLeft: Math.min(
        duration,
        Math.max(1, Math.round(parsed.secondsLeft ?? duration)),
      ),
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
    case "RESET":
      return {
        running: false,
        mode: "work",
        secondsLeft: getDurationSeconds("work", action.settings),
        cycles: 0,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      };
    case "SKIP_BREAK":
      if (state.mode === "work" || state.studyOvertime) return state;
      return {
        running: action.settings.autoStartFocus,
        mode: "work",
        secondsLeft: getDurationSeconds("work", action.settings),
        cycles: state.cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
        breakSeconds: 0,
      };
    case "ADD_BREAK_TIME":
      if (state.mode === "work" || state.studyOvertime) return state;
      return { ...state, secondsLeft: state.secondsLeft + action.minutes * 60 };
    case "START_STUDY_OVERTIME": {
      if (state.mode === "work") return state;
      const totalBreakSeconds = getDurationSeconds(state.mode, action.settings);
      const elapsedBreakSeconds = totalBreakSeconds - state.secondsLeft;
      return {
        ...state,
        running: true,
        studyOvertime: true,
        overtimeSeconds: elapsedBreakSeconds,
        freeStudy: false,
        breakSeconds: 0,
      };
    }
    case "START_FREE_STUDY":
      if (state.mode !== "work" || state.studyOvertime) return state;
      return {
        ...state,
        running: true,
        mode: "break",
        secondsLeft: getDurationSeconds("break", action.settings),
        studyOvertime: true,
        overtimeSeconds: 0,
        freeStudy: true,
        breakSeconds: 0,
      };
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
      return { ...state, secondsLeft };
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
    for (const interval of session.execution.intervals) {
      if (interval.source !== "pomodoro" || !interval.end) continue;
      const end = new Date(interval.end);
      if (!Number.isNaN(end.getTime()) && isSameLocalDay(end, now)) {
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
  let total = 0;
  for (const session of sessions) {
    for (const interval of session.execution.intervals) {
      if (interval.source !== "pomodoro" || !interval.end) continue;
      const start = new Date(interval.start);
      const end = new Date(interval.end);
      if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
        continue;
      }
      if (!isSameLocalDay(end, now)) continue;
      total += Math.max(0, (end.getTime() - start.getTime()) / 1000);
    }
  }
  return total;
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
