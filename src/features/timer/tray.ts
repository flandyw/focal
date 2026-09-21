import type { Subject } from "@/lib/types";
import { TIMER_PRESETS, type TimerSettings, type TimerState } from "./model";

export interface TrayItem {
  id: string;
  label: string;
  enabled: boolean;
  checked?: boolean;
  group: "controls" | "subjects" | "presets" | "workMinutes" | "breakMinutes" | "longBreakMinutes" | "preferences";
}

export const TRAY_PREFERENCES = [
  ["soundEnabled", "Play completion sound"],
  ["notificationsEnabled", "Desktop notifications"],
  ["autoStartBreak", "Auto-start breaks"],
  ["autoStartFocus", "Auto-start next focus"],
] as const;

export function studyTrayItems({ state, settings, subjects, selectedSubjectIds, activeSession, blocked }: {
  state: TimerState;
  settings: TimerSettings;
  subjects: Pick<Subject, "id" | "name">[];
  selectedSubjectIds: string[];
  activeSession: boolean;
  blocked: boolean;
}): TrayItem[] {
  const available = !blocked;
  const hasSubject = subjects.some((subject) => selectedSubjectIds.includes(subject.id));
  const idle = !activeSession && !state.running && state.mode === "work";
  const overtime = state.studyOvertime && state.mode !== "work";
  const free = state.freeStudy && overtime;
  const onBreak = state.mode !== "work" && !overtime;
  const items: TrayItem[] = [
    { id: "timer-toggle", label: state.running ? free ? "Take a break" : "Pause timer" : free ? "Resume free study" : activeSession ? "Resume focus" : onBreak ? state.secondsLeft === state.totalSeconds ? "Start break" : "Resume break" : "Start focus", enabled: available && (state.running || activeSession || onBreak || hasSubject), group: "controls" },
    { id: "timer-free", label: "Start free study", enabled: available && idle && hasSubject, group: "controls" },
    { id: "timer-finish", label: "Finish study session", enabled: available && activeSession, group: "controls" },
    { id: "timer-overtime", label: "Keep focusing through break", enabled: available && onBreak && !activeSession && hasSubject, group: "controls" },
    { id: "timer-return", label: "Return to timed break", enabled: available && overtime && !free, group: "controls" },
    { id: "timer-skip", label: "Skip break", enabled: available && onBreak, group: "controls" },
    { id: "timer-add", label: onBreak ? "Add 5 minutes to break" : "Add 5 minutes to focus", enabled: available && !overtime, group: "controls" },
    { id: "timer-reset", label: "Reset timer", enabled: available, group: "controls" },
    ...subjects.map((subject): TrayItem => ({ id: `timer-subject:${subject.id}`, label: subject.name, checked: selectedSubjectIds.includes(subject.id), enabled: available, group: "subjects" })),
    ...TIMER_PRESETS.map((preset): TrayItem => ({
      id: `timer-preset:${preset.id}`, label: `${preset.label} (${preset.description} min)`,
      checked: settings.workMinutes === preset.workMinutes && settings.breakMinutes === preset.breakMinutes && settings.longBreakMinutes === preset.longBreakMinutes,
      enabled: available && idle, group: "presets",
    })),
  ];
  for (const [key, minutes] of [
    ["workMinutes", [15, 25, 30, 45, 50, 60, 90, 120]],
    ["breakMinutes", [3, 5, 10, 15]],
    ["longBreakMinutes", [10, 15, 20, 30]],
  ] as const) {
    for (const value of [...new Set<number>([...minutes, settings[key]])].sort((a, b) => a - b)) {
      items.push({ id: `timer-duration:${key}:${value}`, label: `${value} minutes`, checked: settings[key] === value, enabled: available && idle, group: key });
    }
  }
  for (const [key, label] of TRAY_PREFERENCES) {
    items.push({ id: `timer-preference:${key}`, label, checked: settings[key], enabled: available, group: "preferences" });
  }
  return items;
}
