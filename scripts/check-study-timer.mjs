import {
  advanceTimer,
  closeRunningInterval,
  getActiveSessionSubjectIds,
  timerReducer,
} from "../src/features/timer/model.ts";
import { isTimerShortcutTarget } from "../src/components/timer/FocusView.tsx";
import {
  getPomodoroDescription,
  getPomodoroTitle,
} from "../src/lib/pomodoro.ts";

const settings = { workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 };
const runningWork = {
  running: true,
  mode: "work",
  secondsLeft: 10,
  cycles: 0,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
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
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
});
check(advanceTimer(runningWork, settings, 311), {
  running: false,
  mode: "work",
  secondsLeft: 1500,
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
});
const breakWithTimeUsed = {
  running: true,
  mode: "break",
  secondsLeft: 240,
  cycles: 1,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
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
  cycles: 0,
  studyOvertime: false,
  overtimeSeconds: 0,
  freeStudy: false,
}, { type: "START_FREE_STUDY", settings });
check(freeStudy, {
  running: true,
  mode: "break",
  secondsLeft: 300,
  cycles: 0,
  studyOvertime: true,
  overtimeSeconds: 0,
  freeStudy: true,
});
check(advanceTimer(freeStudy, settings, 90), {
  ...freeStudy,
  overtimeSeconds: 90,
});
check(timerReducer(freeStudy, { type: "TOGGLE" }), {
  ...freeStudy,
  running: false,
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
check(isTimerShortcutTarget({ tagName: "DIV" }), false);
check(getPomodoroTitle(["mm"], "Methods SAC 1"), "Methods SAC 1 — MCM · Focus");
check(getPomodoroDescription(25), "Pomodoro — 25m focused study");
