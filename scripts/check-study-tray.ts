import assert from "node:assert/strict";
import { studyTrayItems } from "../src/features/timer/tray";
import { DEFAULT_SETTINGS, timerReducer, type TimerState } from "../src/features/timer/model";

const state: TimerState = {
  running: false, mode: "work", secondsLeft: 1500, totalSeconds: 1500,
  cycles: 0, studyOvertime: false, overtimeSeconds: 0, freeStudy: false, breakSeconds: 0,
};
const input = {
  state, settings: DEFAULT_SETTINGS,
  subjects: [{ id: "math", name: "Maths" }, { id: "custom:subject", name: "Custom subject" }],
  selectedSubjectIds: ["math"], activeSession: false, blocked: false,
};
const menu = (patch: Partial<typeof input> = {}) => studyTrayItems({ ...input, ...patch });
const item = (id: string, patch: Partial<typeof input> = {}) => {
  const result = menu(patch).find((entry) => entry.id === id);
  assert.ok(result, `Missing ${id}`);
  return result;
};
assert.equal(item("timer-free").enabled, true);
assert.equal(item("timer-subject:math").checked, true);
assert.equal(item("timer-subject:custom:subject").checked, false);
assert.equal(item("timer-free", { selectedSubjectIds: [] }).enabled, false);
assert.equal(item("timer-toggle", { selectedSubjectIds: ["deleted"] }).enabled, false);
assert.equal(item("timer-subject:custom:subject", { selectedSubjectIds: [] }).enabled, true);
assert.equal(item("timer-preset:standard").checked, true);
assert.equal(item("timer-preference:autoStartFocus").checked, false);
assert.equal(item("timer-duration:workMinutes:37", { settings: { ...DEFAULT_SETTINGS, workMinutes: 37 } }).checked, true);
assert.equal(item("timer-preference:autoStartFocus", { settings: { ...DEFAULT_SETTINGS, autoStartFocus: true } }).checked, true);

const active = { state: { ...state, running: true }, activeSession: true };
assert.equal(item("timer-free", active).enabled, false);
assert.equal(item("timer-toggle", active).label, "Pause timer");
assert.equal(item("timer-subject:custom:subject", active).enabled, true);
assert.equal(item("timer-preset:deep", active).enabled, false);
assert.equal(item("timer-duration:workMinutes:25", active).enabled, false);
assert.equal(item("timer-finish", active).enabled, true);
assert.equal(item("timer-toggle", { activeSession: true }).label, "Resume focus");

const free = timerReducer(state, { type: "START_FREE_STUDY", settings: DEFAULT_SETTINGS });
assert.equal(item("timer-toggle", { state: free, activeSession: true }).label, "Take a break");
const pausedFree = timerReducer(free, { type: "TOGGLE" });
assert.equal(item("timer-toggle", { state: pausedFree, activeSession: true }).label, "Resume free study");
for (const id of ["timer-add", "timer-skip", "timer-return"]) {
  assert.equal(item(id, { state: free, activeSession: true }).enabled, false);
}
const breakState = { ...state, running: true, mode: "break" as const, secondsLeft: 300, totalSeconds: 300 };
assert.equal(item("timer-overtime", { state: breakState }).enabled, true);
assert.equal(item("timer-skip", { state: breakState }).enabled, true);
assert.equal(item("timer-add", { state: breakState }).label, "Add 5 minutes to break");
assert.equal(item("timer-toggle", { state: { ...breakState, running: false }, selectedSubjectIds: [] }).enabled, true);
const overtime = timerReducer(breakState, { type: "START_STUDY_OVERTIME", settings: DEFAULT_SETTINGS });
assert.equal(item("timer-return", { state: overtime, activeSession: true }).enabled, true);
assert.equal(item("timer-overtime", { state: overtime, activeSession: true }).enabled, false);
for (const snapshot of [state, active.state, free, pausedFree, breakState, overtime]) {
  assert.ok(menu({ state: snapshot, blocked: true }).every((entry) => !entry.enabled));
}
assert.equal(new Set(menu().map((entry) => entry.id)).size, menu().length);
process.stdout.write("Study tray checks passed\n");
