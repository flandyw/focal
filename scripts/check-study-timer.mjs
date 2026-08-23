import {
  advanceTimer,
  clampDailyGoal,
  clampLongBreakInterval,
  closeRunningInterval,
  countCompletedBlocksToday,
  formatFocusTime,
  getActiveSessionSubjectIds,
  getFocusSecondsToday,
  getSessionFocusSeconds,
  parseSettings,
  timerReducer,
} from "../src/features/timer/model.ts";
import { isTimerShortcutTarget } from "../src/components/timer/FocusView.tsx";
import {
  getPomodoroDescription,
  getPomodoroTitle,
} from "../src/lib/pomodoro.ts";

const settings = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  soundEnabled: true,
  notificationsEnabled: true,
  autoStartBreak: true,
  autoStartFocus: false,
  dailyGoal: 6,
};
const runningWork = {
  running: true,
  mode: "work",
  secondsLeft: 10,
  totalSeconds: 1500,
  cycles: 0,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
};

function check(actual, expected) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

check(advanceTimer(runningWork, settings, 3), {
  ...runningWork,
  secondsLeft: 7,
});
check(advanceTimer(runningWork, settings, 10), {
  running: true,
  mode: "break",
  secondsLeft: 300,
  totalSeconds: 300,
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
});
check(advanceTimer(runningWork, settings, 311), {
  running: false,
  mode: "work",
  secondsLeft: 1500,
  totalSeconds: 1500,
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
});
const breakWithTimeUsed = {
  running: true,
  mode: "break",
  secondsLeft: 240,
  totalSeconds: 300,
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
};
const studyOvertime = timerReducer(breakWithTimeUsed, {
  type: "START_STUDY_OVERTIME",
  settings,
});
check(studyOvertime, {
  ...breakWithTimeUsed,
  studyOvertime: true,
  overtimeSeconds: 60,
});
check(timerReducer(studyOvertime, { type: "RETURN_TO_BREAK" }), breakWithTimeUsed);
const freeStudy = timerReducer({
  running: false,
  mode: "work",
  secondsLeft: 1500,
  totalSeconds: 1500,
  cycles: 0,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
}, { type: "START_FREE_STUDY", settings });
check(freeStudy, {
  running: true,
  mode: "break",
  secondsLeft: 300,
  totalSeconds: 300,
  cycles: 0,
  studyOvertime: true,
  overtimeSeconds: 0,
  freeStudy: true,
  breakSeconds: 0,
});
check(advanceTimer(freeStudy, settings, 90), {
  ...freeStudy,
  overtimeSeconds: 90,
});
const pausedFreeStudy = timerReducer(freeStudy, { type: "TOGGLE" });
check(pausedFreeStudy, {
  ...freeStudy,
  running: false,
});
check(advanceTimer(pausedFreeStudy, settings, 45), {
  ...pausedFreeStudy,
  breakSeconds: 45,
});
check(timerReducer({ ...pausedFreeStudy, breakSeconds: 45 }, { type: "TOGGLE" }), {
  ...freeStudy,
  breakSeconds: 0,
});
check(closeRunningInterval([
  { start: "2026-07-12T10:00:00.000Z", end: "2026-07-12T10:05:00.000Z", source: "pomodoro" },
  { start: "2026-07-12T10:10:00.000Z", source: "pomodoro" },
], "2026-07-12T10:20:00.000Z"), [
  { start: "2026-07-12T10:00:00.000Z", end: "2026-07-12T10:05:00.000Z", source: "pomodoro" },
  { start: "2026-07-12T10:10:00.000Z", source: "pomodoro", end: "2026-07-12T10:20:00.000Z" },
]);
check(getActiveSessionSubjectIds("active", [
  { id: "other", subjectIds: ["english"] },
  { id: "active", subjectIds: ["methods", "physics"] },
]), ["methods", "physics"]);

check(isTimerShortcutTarget(null), false);
check(isTimerShortcutTarget({ tagName: "INPUT" }), true);
check(isTimerShortcutTarget({ tagName: "BUTTON" }), true);
check(isTimerShortcutTarget({ tagName: "SELECT" }), true);
check(isTimerShortcutTarget({ tagName: "DIV", isContentEditable: true }), true);
check(isTimerShortcutTarget({ tagName: "DIV" }), false);
check(getPomodoroTitle(["mm"], "Methods SAC 1"), "Methods SAC 1 — MCM · Focus");
check(getPomodoroDescription(25), "Pomodoro — 25m focused study");

// --- Auto-start preferences ---
check(advanceTimer(runningWork, { ...settings, autoStartBreak: false }, 10), {
  running: false,
  mode: "break",
  secondsLeft: 300,
  totalSeconds: 300,
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
});
const autoStartNextFocus = {
  ...settings,
  autoStartFocus: true,
};
check(advanceTimer(breakWithTimeUsed, autoStartNextFocus, 240), {
  running: true,
  mode: "work",
  secondsLeft: 1500,
  totalSeconds: 1500,
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
});
// A break that still has time left does not jump ahead when auto-start is on.
check(advanceTimer(breakWithTimeUsed, autoStartNextFocus, 60), {
  ...breakWithTimeUsed,
  secondsLeft: 180,
});
// Skipping a break with auto-start focus rolls straight into a running block.
check(timerReducer(breakWithTimeUsed, { type: "SKIP_BREAK", settings: autoStartNextFocus }), {
  running: true,
  mode: "work",
  secondsLeft: 1500,
  totalSeconds: 1500,
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
});
check(advanceTimer({ ...runningWork, cycles: 2 }, { ...settings, longBreakEvery: 3 }, 10), {
  running: true,
  mode: "long-break",
  secondsLeft: 900,
  totalSeconds: 900,
  cycles: 3,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
  breakSeconds: 0,
});
check(timerReducer(runningWork, { type: "ADD_TIME", minutes: 5 }), {
  ...runningWork,
  secondsLeft: 310,
  totalSeconds: 1800,
});
check(advanceTimer(runningWork, settings, Number.POSITIVE_INFINITY), runningWork);

// --- Daily goal helpers ---
check(clampDailyGoal(undefined), 0);
check(clampDailyGoal(-5), 0);
check(clampDailyGoal(40), 30);
check(clampDailyGoal(7), 7);
check(clampLongBreakInterval(undefined), 4);
check(clampLongBreakInterval(1), 2);
check(clampLongBreakInterval(20), 12);
check(parseSettings(JSON.stringify({
  workMinutes: 45,
  alertsEnabled: false,
  longBreakEvery: 6,
})), {
  workMinutes: 45,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 6,
  soundEnabled: false,
  notificationsEnabled: false,
  autoStartBreak: true,
  autoStartFocus: false,
  dailyGoal: 0,
});
check(formatFocusTime(0), "0m");
check(formatFocusTime(45 * 60), "45m");
check(formatFocusTime(75 * 60), "1h 15m");

function atLocal(hours, minutes, seconds) {
  const date = new Date();
  date.setHours(hours, minutes, seconds, 0);
  return date.toISOString();
}
// Build sessions entirely inside "today" so the check passes near midnight.
const todaySessions = [
  {
    id: "s1",
    execution: {
      state: "completed",
      intervals: [
        { start: atLocal(9, 0, 0), end: atLocal(9, 25, 0), source: "pomodoro", cycleNumber: 1 },
        { start: atLocal(9, 30, 0), end: atLocal(9, 55, 0), source: "pomodoro", cycleNumber: 2 },
        { start: atLocal(10, 0, 0), source: "pomodoro", cycleNumber: 3 }, // still running
      ],
    },
  },
  {
    id: "s2",
    execution: {
      state: "completed",
      intervals: [
        { start: atLocal(11, 0, 0), end: atLocal(11, 50, 0), source: "pomodoro", cycleNumber: 1 },
        { start: "2026-01-01T09:00:00.000Z", end: "2026-01-01T09:25:00.000Z", source: "pomodoro", cycleNumber: 1 }, // another day
      ],
    },
  },
];
const endOfToday = new Date();
endOfToday.setHours(23, 59, 59, 999);
check(countCompletedBlocksToday(todaySessions, endOfToday), 3);
check(getFocusSecondsToday(todaySessions, endOfToday), (25 + 25 + 50) * 60);
check(countCompletedBlocksToday([], new Date()), 0);
check(getFocusSecondsToday([], new Date()), 0);

const noon = new Date();
noon.setHours(12, 0, 0, 0);
const dayStart = new Date(noon);
dayStart.setHours(0, 0, 0, 0);
check(countCompletedBlocksToday([{
  id: "paused",
  execution: {
    state: "in-progress",
    intervals: [{ start: atLocal(10, 0, 0), end: atLocal(10, 10, 0), source: "pomodoro", cycleNumber: 1 }],
  },
}], noon), 0);
check(getFocusSecondsToday([{
  id: "open",
  execution: {
    state: "in-progress",
    intervals: [{ start: atLocal(11, 30, 0), source: "pomodoro", cycleNumber: 1 }],
  },
}], noon), 30 * 60);
check(getFocusSecondsToday([{
  id: "midnight",
  execution: {
    state: "completed",
    intervals: [{
      start: new Date(dayStart.getTime() - 30 * 60 * 1000).toISOString(),
      end: new Date(dayStart.getTime() + 30 * 60 * 1000).toISOString(),
      source: "pomodoro",
      cycleNumber: 1,
    }],
  },
}], noon), 30 * 60);
check(getSessionFocusSeconds({
  execution: {
    state: "in-progress",
    intervals: [
      { start: atLocal(10, 0, 0), end: atLocal(10, 20, 0), source: "pomodoro" },
      { start: atLocal(11, 30, 0), source: "pomodoro" },
    ],
  },
}, noon), 50 * 60);
