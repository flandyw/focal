import type { StudySession } from "@/lib/types"

export const TIMER_SETTINGS_KEY = "focal-pomodoro-settings";
export const TIMER_STATE_KEY = "focal-pomodoro-state";
export const DEFAULT_SETTINGS = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
};
export const MIN_DURATION_MINUTES = 1;
export const MAX_DURATION_MINUTES = 180;
export const EXTRA_BREAK_MINUTES = 5;

export type TimerMode = "work" | "break" | "long-break";

export interface TimerSettings {
  workMinutes: number;
  breakMinutes: number;
  longBreakMinutes: number;
}

export interface TimerState {
  running: boolean;
  mode: TimerMode;
  secondsLeft: number;
  cycles: number;
  studyOvertime: boolean;
  overtimeSeconds: number;
  freeStudy: boolean;
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
        running: true,
        mode,
        secondsLeft: getDurationSeconds(mode, settings),
        cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
      };
    } else {
      return {
        running: false,
        mode: "work",
        secondsLeft: getDurationSeconds("work", settings),
        cycles: next.cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
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
  };

  try {
    const stored = localStorage.getItem(TIMER_STATE_KEY);
    if (!stored) return fallback;

    const parsed = JSON.parse(stored) as Partial<StoredTimerState>;
    const mode = isValidMode(parsed.mode) ? parsed.mode : fallback.mode;
    const duration = getDurationSeconds(mode, settings);
    const updatedAt =
      typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now();
    const elapsedSeconds = parsed.running
      ? Math.max(0, Math.floor((Date.now() - updatedAt) / 1000))
      : 0;
    const cycles = Math.max(0, Math.round(parsed.cycles ?? 0));
    const studyOvertime = parsed.studyOvertime === true && mode !== "work";
    const freeStudy = studyOvertime && parsed.freeStudy === true;
    const overtimeSeconds = Math.max(
      0,
      Math.round(parsed.overtimeSeconds ?? 0),
    );

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
      return { ...state, running: !state.running };
    case "RESET":
      return {
        running: false,
        mode: "work",
        secondsLeft: getDurationSeconds("work", action.settings),
        cycles: 0,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
      };
    case "SKIP_BREAK":
      if (state.mode === "work" || state.studyOvertime) return state;
      return {
        running: false,
        mode: "work",
        secondsLeft: getDurationSeconds("work", action.settings),
        cycles: state.cycles,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
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
      };
    case "RETURN_TO_BREAK":
      if (!state.studyOvertime) return state;
      return {
        ...state,
        running: true,
        studyOvertime: false,
        overtimeSeconds: 0,
        freeStudy: false,
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
