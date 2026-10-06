import { formatTimer } from "./exam-timer"
import type { FocusTimerSession } from "./ongoing-timers"

export { formatTimer }

const SETTINGS_KEY = "examtrack:study-timer:settings:v1"
const STATE_KEY = "examtrack:study-timer:state:v1"
const BLOCKS_KEY = "examtrack:study-timer:blocks:v1"
const OPEN_BLOCK_KEY = "examtrack:study-timer:open-block:v1"
const FOCUS_SESSION_KEY = "examtrack:study-timer:focus-session:v1"

export const DEFAULT_SETTINGS = {
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  soundEnabled: true,
  notificationsEnabled: true,
  autoStartBreak: true,
  autoStartFocus: false,
  dailyGoal: 4,
}
const MIN_DURATION_MINUTES = 1
export const MAX_DURATION_MINUTES = 180
export const MAX_DAILY_GOAL = 30
export const MIN_LONG_BREAK_INTERVAL = 2
export const MAX_LONG_BREAK_INTERVAL = 12
const MAX_RESTORE_ELAPSED_SECONDS = 24 * 60 * 60
const MAX_STORED_BLOCKS = 400

export const TIMER_PRESETS = [
  { id: "standard", label: "Standard", description: "25 / 5 / 15", workMinutes: 25, breakMinutes: 5, longBreakMinutes: 15 },
  { id: "deep", label: "Deep work", description: "50 / 10 / 20", workMinutes: 50, breakMinutes: 10, longBreakMinutes: 20 },
  { id: "lightning", label: "Lightning", description: "15 / 3 / 10", workMinutes: 15, breakMinutes: 3, longBreakMinutes: 10 },
  { id: "exam", label: "Exam prep", description: "90 / 15 / 30", workMinutes: 90, breakMinutes: 15, longBreakMinutes: 30 },
] as const

export type TimerMode = "free" | "work" | "break" | "long-break"

export const MODE_LABEL: Record<TimerMode, string> = {
  free: "Free study",
  work: "Pomodoro",
  break: "Break",
  "long-break": "Long break",
}

export interface TimerSettings {
  workMinutes: number
  breakMinutes: number
  longBreakMinutes: number
  longBreakEvery: number
  soundEnabled: boolean
  notificationsEnabled: boolean
  autoStartBreak: boolean
  autoStartFocus: boolean
  dailyGoal: number
}

export interface TimerState {
  running: boolean
  mode: TimerMode
  secondsLeft: number
  totalSeconds: number
  cycles: number
  studyOvertime: boolean
  overtimeSeconds: number
  freeStudy: boolean
  breakSeconds: number
}

export type TimerAction =
  | { type: "TICK"; settings: TimerSettings; seconds: number }
  | { type: "SELECT_MODE"; mode: "free" | "work"; settings: TimerSettings }
  | { type: "TOGGLE" }
  | { type: "SET_RUNNING"; running: boolean }
  | { type: "RESET"; settings: TimerSettings }
  | { type: "SKIP_BREAK"; settings: TimerSettings }
  | { type: "ADD_TIME"; minutes: number }
  | { type: "START_STUDY_OVERTIME"; settings: TimerSettings }
  | { type: "START_FREE_STUDY"; settings: TimerSettings }
  | { type: "RETURN_TO_BREAK" }
  | { type: "END_FREE_STUDY"; settings: TimerSettings }
  | { type: "SYNC_SETTINGS"; settings: TimerSettings; previousSettings: TimerSettings }

type FocusBlockSource = "pomodoro" | "free-study"

export interface FocusBlock {
  id: string
  cycleNumber: number
  source: FocusBlockSource
  subject: string
  intent: string
  /** When the block first became active. Real wall time, never back-dated. */
  startedAt: number
  /** When the block was closed, paused or not. Real wall time. */
  endedAt: number
  /**
   * Billed study seconds: the wall time between the endpoints minus every pause.
   * Kept apart from `endedAt - startedAt` because a block that was paused is a
   * span, not a solid one, and squashing the pause out of the endpoints would
   * invent a start or end that never happened.
   */
  activeSeconds: number
}

export interface OpenBlock {
  cycleNumber: number
  source: FocusBlockSource
  subject: string
  intent: string
  startedAt: number
  /** Wall time already spent paused, in seconds. Never counts as study time. */
  pausedSeconds: number
  /** When the pause in progress began, if the block is paused right now. */
  pausedAt?: number
}

/* ------------------------------------------------------------------ */
/* storage                                                             */
/* ------------------------------------------------------------------ */

function readJson<T>(key: string): T | null {
  if (typeof localStorage === "undefined") return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeJson(key: string, value: unknown) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private browsing and full quotas must not stop the timer running.
  }
}

/* ------------------------------------------------------------------ */
/* validation                                                          */
/* ------------------------------------------------------------------ */

export function clampMinutes(value: unknown, fallback: number) {
  // A corrupt stored value must fall back to the default, not to a 1-minute block.
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback
  return Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, Math.round(value)))
}

function clampDailyGoal(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0
  return Math.min(MAX_DAILY_GOAL, Math.max(0, Math.round(value)))
}

export function clampLongBreakInterval(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_SETTINGS.longBreakEvery
  return Math.min(MAX_LONG_BREAK_INTERVAL, Math.max(MIN_LONG_BREAK_INTERVAL, Math.round(value)))
}

function isValidMode(mode: unknown): mode is TimerMode {
  return mode === "free" || mode === "work" || mode === "break" || mode === "long-break"
}

function safeNonNegativeInteger(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : fallback
}

function booleanOr(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function getDurationSeconds(mode: TimerMode, settings: TimerSettings) {
  if (mode === "free") return 0
  if (mode === "work") return settings.workMinutes * 60
  if (mode === "long-break") return settings.longBreakMinutes * 60
  return settings.breakMinutes * 60
}

function parseSettings(value: unknown): TimerSettings {
  const parsed = (typeof value === "string" ? safeParse(value) : value) as Partial<TimerSettings> | null
  if (!parsed || typeof parsed !== "object") return DEFAULT_SETTINGS
  return {
    workMinutes: clampMinutes(parsed.workMinutes, DEFAULT_SETTINGS.workMinutes),
    breakMinutes: clampMinutes(parsed.breakMinutes, DEFAULT_SETTINGS.breakMinutes),
    longBreakMinutes: clampMinutes(parsed.longBreakMinutes, DEFAULT_SETTINGS.longBreakMinutes),
    longBreakEvery: clampLongBreakInterval(parsed.longBreakEvery),
    soundEnabled: booleanOr(parsed.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
    notificationsEnabled: booleanOr(parsed.notificationsEnabled, DEFAULT_SETTINGS.notificationsEnabled),
    autoStartBreak: booleanOr(parsed.autoStartBreak, DEFAULT_SETTINGS.autoStartBreak),
    autoStartFocus: booleanOr(parsed.autoStartFocus, DEFAULT_SETTINGS.autoStartFocus),
    dailyGoal: clampDailyGoal(parsed.dailyGoal ?? DEFAULT_SETTINGS.dailyGoal),
  }
}

function safeParse(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

export function loadSettings() {
  return parseSettings(readJson<unknown>(SETTINGS_KEY))
}

export function saveSettings(settings: TimerSettings) {
  writeJson(SETTINGS_KEY, settings)
}

/* ------------------------------------------------------------------ */
/* state machine                                                       */
/* ------------------------------------------------------------------ */

/**
 * Walks a timer forward by `elapsedSeconds`, rolling through every mode
 * boundary it crosses. A single large tick (a throttled tab, a reload after
 * hours away) lands on exactly the state the clock would have reached.
 */
function advanceTimer(state: TimerState, settings: TimerSettings, elapsedSeconds: number): TimerState {
  let next = state
  let remaining = Number.isFinite(elapsedSeconds) ? Math.max(0, Math.floor(elapsedSeconds)) : 0

  if (next.mode === "free") return next.running ? { ...next, overtimeSeconds: next.overtimeSeconds + remaining } : next

  if (next.studyOvertime) {
    if (!next.running) return next
    return { ...next, overtimeSeconds: next.overtimeSeconds + remaining }
  }

  while (remaining > 0 && next.running) {
    if (remaining < next.secondsLeft) return { ...next, secondsLeft: next.secondsLeft - remaining }
    remaining -= next.secondsLeft
    if (next.mode === "work") {
      const cycles = next.cycles + 1
      const mode = cycles % settings.longBreakEvery === 0 ? "long-break" : "break"
      const totalSeconds = getDurationSeconds(mode, settings)
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
      }
    } else {
      const totalSeconds = getDurationSeconds("work", settings)
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
      }
    }
  }

  return next
}

export function timerReducer(state: TimerState, action: TimerAction): TimerState {
  switch (action.type) {
    case "SELECT_MODE":
      if (state.running || state.overtimeSeconds > 0 || state.secondsLeft < state.totalSeconds) return state
      return { running: false, mode: action.mode, secondsLeft: getDurationSeconds(action.mode, action.settings), totalSeconds: getDurationSeconds(action.mode, action.settings), cycles: 0, studyOvertime: false, overtimeSeconds: 0, freeStudy: action.mode === "free", breakSeconds: 0 }
    case "TICK":
      return advanceTimer(state, action.settings, action.seconds)
    case "TOGGLE":
      return { ...state, running: !state.running, breakSeconds: state.freeStudy ? 0 : state.breakSeconds }
    case "SET_RUNNING":
      // Another device moved the session, so the countdown follows it: a countdown
      // that disagrees with its session owes a boundary that would undo the change.
      return state.running === action.running
        ? state
        : { ...state, running: action.running, breakSeconds: state.freeStudy ? 0 : state.breakSeconds }
    case "RESET": {
      if (state.freeStudy) return { running: false, mode: "free", secondsLeft: 0, totalSeconds: 0, cycles: 0, studyOvertime: false, overtimeSeconds: 0, freeStudy: true, breakSeconds: 0 }
      const totalSeconds = getDurationSeconds("work", action.settings)
      return {
        running: false, mode: "work", secondsLeft: totalSeconds, totalSeconds, cycles: 0,
        studyOvertime: false, overtimeSeconds: 0, freeStudy: false, breakSeconds: 0,
      }
    }
    case "SKIP_BREAK":
      if (state.mode === "work" || state.mode === "free" || state.studyOvertime) return state
      return {
        running: action.settings.autoStartFocus,
        mode: "work",
        secondsLeft: getDurationSeconds("work", action.settings),
        totalSeconds: getDurationSeconds("work", action.settings),
        cycles: state.cycles,
        studyOvertime: false, overtimeSeconds: 0, freeStudy: false, breakSeconds: 0,
      }
    case "ADD_TIME": {
      if (state.studyOvertime || state.mode === "free") return state
      const extraSeconds = Math.max(0, Math.round(action.minutes * 60))
      const totalSeconds = Math.min(MAX_DURATION_MINUTES * 60, state.totalSeconds + extraSeconds)
      return { ...state, secondsLeft: Math.min(totalSeconds, state.secondsLeft + extraSeconds), totalSeconds }
    }
    case "START_STUDY_OVERTIME": {
      if (state.mode === "work" || state.mode === "free") return state
      return {
        ...state,
        running: true,
        studyOvertime: true,
        overtimeSeconds: Math.max(0, state.totalSeconds - state.secondsLeft),
        freeStudy: false,
        breakSeconds: 0,
      }
    }
    case "START_FREE_STUDY": {
      if (state.running || state.mode !== "work") return state
      return { ...state, running: true, mode: "free", secondsLeft: 0, totalSeconds: 0, studyOvertime: false, overtimeSeconds: 0, freeStudy: true, breakSeconds: 0 }
    }
    case "END_FREE_STUDY": {
      if (!state.freeStudy) return state
      return { running: false, mode: "free", secondsLeft: 0, totalSeconds: 0, cycles: 0, studyOvertime: false, overtimeSeconds: 0, freeStudy: true, breakSeconds: 0 }
    }
    case "RETURN_TO_BREAK":
      if (!state.studyOvertime) return state
      return { ...state, running: true, studyOvertime: false, overtimeSeconds: 0, freeStudy: false, breakSeconds: 0 }
    case "SYNC_SETTINGS": {
      if (state.mode === "free") return state
      const oldDuration = getDurationSeconds(state.mode, action.previousSettings)
      const nextDuration = getDurationSeconds(state.mode, action.settings)
      const secondsLeft = state.secondsLeft === oldDuration ? nextDuration : Math.min(state.secondsLeft, nextDuration)
      const totalSeconds = state.totalSeconds === oldDuration ? nextDuration : Math.max(secondsLeft, state.totalSeconds)
      return { ...state, secondsLeft, totalSeconds }
    }
    default:
      return state
  }
}

function freshState(): TimerState {
  return {
    running: false, mode: "free", secondsLeft: 0, totalSeconds: 0, cycles: 0,
    studyOvertime: false, overtimeSeconds: 0, freeStudy: true, breakSeconds: 0,
  }
}

export function loadTimerState(settings: TimerSettings, now = Date.now()): TimerState {
  const fallback = freshState()
  const parsed = readJson<Record<string, unknown>>(STATE_KEY)
  if (!parsed || typeof parsed !== "object") return fallback

  if (parsed.version !== 2 && !parsed.freeStudy && !parsed.running && !parsed.studyOvertime && parsed.secondsLeft === parsed.totalSeconds && !readJson(OPEN_BLOCK_KEY) && !readJson(FOCUS_SESSION_KEY)) return fallback
  const mode = isValidMode(parsed.mode) ? parsed.mode : fallback.mode
  if (mode === "free" || parsed.freeStudy === true) {
    return advanceTimer({ ...fallback, running: parsed.running === true, overtimeSeconds: safeNonNegativeInteger(parsed.overtimeSeconds) }, settings,
      parsed.running === true && typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt) ? Math.max(0, Math.floor((now - parsed.updatedAt) / 1000)) : 0)
  }

  const duration = getDurationSeconds(mode, settings)
  const updatedAt = typeof parsed.updatedAt === "number" && Number.isFinite(parsed.updatedAt)
    ? Math.min(now, parsed.updatedAt)
    : now
  const cycles = safeNonNegativeInteger(parsed.cycles)
  const totalSeconds = Math.min(MAX_DURATION_MINUTES * 60, Math.max(duration, safeNonNegativeInteger(parsed.totalSeconds, duration)))
  const secondsLeft = Math.min(totalSeconds, Math.max(1, safeNonNegativeInteger(parsed.secondsLeft, duration)))
  const running = parsed.running === true
  const studyOvertime = parsed.studyOvertime === true && mode !== "work"
  const overtimeSeconds = safeNonNegativeInteger(parsed.overtimeSeconds)
  const breakSeconds = safeNonNegativeInteger(parsed.breakSeconds)

  // A timer left running keeps counting while the tab is closed, but never
  // more than a day: a week-old tab must not roll through a week of cycles.
  const elapsedSeconds = running
    ? Math.min(MAX_RESTORE_ELAPSED_SECONDS, Math.max(0, Math.floor((now - updatedAt) / 1000)))
    : 0

  if (studyOvertime) {
    return {
      running, mode, secondsLeft, totalSeconds, cycles, studyOvertime,
      overtimeSeconds: running ? overtimeSeconds + elapsedSeconds : overtimeSeconds,
      freeStudy: false,
      breakSeconds,
    }
  }

  const restored: TimerState = {
    running, mode, secondsLeft, totalSeconds, cycles,
    studyOvertime: false, overtimeSeconds: 0, freeStudy: false, breakSeconds: 0,
  }
  return running ? advanceTimer(restored, settings, elapsedSeconds) : restored
}

export function saveTimerState(state: TimerState, now = Date.now()) {
  writeJson(STATE_KEY, { ...state, version: 2, updatedAt: now })
}

/* ------------------------------------------------------------------ */
/* block log                                                           */
/* ------------------------------------------------------------------ */

function isFocusBlock(value: unknown): value is FocusBlock {
  if (!value || typeof value !== "object") return false
  const block = value as Record<string, unknown>
  return typeof block.id === "string" &&
    Number.isFinite(block.cycleNumber) &&
    (block.source === "pomodoro" || block.source === "free-study") &&
    typeof block.subject === "string" &&
    typeof block.intent === "string" &&
    Number.isFinite(block.startedAt) &&
    Number.isFinite(block.endedAt)
}

function toFocusBlock(value: unknown): FocusBlock | null {
  if (!isFocusBlock(value)) return null
  const block = value as unknown as Record<string, unknown>
  const startedAt = block.startedAt as number
  const endedAt = block.endedAt as number
  // Blocks written before the split carry no active time, and their span was
  // already the billed span, so the span is the honest reading of them.
  const activeSeconds = Number.isFinite(block.activeSeconds)
    ? Math.max(0, Math.round(block.activeSeconds as number))
    : Math.max(0, Math.round((endedAt - startedAt) / 1000))
  return {
    id: block.id as string,
    cycleNumber: block.cycleNumber as number,
    source: block.source as FocusBlockSource,
    subject: block.subject as string,
    intent: block.intent as string,
    startedAt,
    endedAt,
    activeSeconds,
  }
}

export function loadBlocks(): FocusBlock[] {
  const stored = readJson<unknown>(BLOCKS_KEY)
  if (!Array.isArray(stored)) return []
  return stored.map(toFocusBlock).filter((block): block is FocusBlock => block !== null)
}

export function saveBlocks(blocks: FocusBlock[]) {
  writeJson(BLOCKS_KEY, blocks.slice(-MAX_STORED_BLOCKS))
}

export function loadOpenBlock(): OpenBlock | null {
  const stored = readJson<Record<string, unknown>>(OPEN_BLOCK_KEY)
  if (!stored || typeof stored !== "object") return null
  const source = stored.source === "free-study" ? "free-study" : "pomodoro"
  if (!Number.isFinite(stored.startedAt) || !Number.isFinite(stored.cycleNumber)) return null
  return {
    cycleNumber: Math.round(stored.cycleNumber as number),
    source,
    subject: typeof stored.subject === "string" ? stored.subject : "",
    intent: typeof stored.intent === "string" ? stored.intent : "",
    startedAt: stored.startedAt as number,
    pausedSeconds: safeNonNegativeInteger(stored.pausedSeconds),
    ...(Number.isFinite(stored.pausedAt) ? { pausedAt: stored.pausedAt as number } : {}),
  }
}

export function saveOpenBlock(block: OpenBlock | null) {
  if (block) writeJson(OPEN_BLOCK_KEY, block)
  else if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(OPEN_BLOCK_KEY)
    } catch {
      // Nothing to do: the open block is rebuilt from the next mode change.
    }
  }
}

/** The focus session the server last acknowledged. Persisted so a reload mid-block
 *  keeps the same server session instead of minting a second one beside a zombie. */
export function loadFocusSession(): FocusTimerSession | undefined {
  const stored = readJson<Record<string, unknown>>(FOCUS_SESSION_KEY)
  if (!stored || typeof stored !== "object") return undefined
  if (typeof stored.id !== "string" || typeof stored.subject !== "string" ||
      typeof stored.title !== "string" || !Number.isFinite(stored.startedAt) ||
      !Number.isFinite(stored.workMinutes) || !Number.isFinite(stored.pausedSeconds)) return undefined
  return {
    id: stored.id,
    ...(Number.isSafeInteger(stored.revision) ? { revision: stored.revision as number } : {}),
    subject: stored.subject,
    provider: typeof stored.provider === "string" ? stored.provider : "Focal",
    title: stored.title,
    ...(Number.isFinite(stored.cycleNumber) ? { cycleNumber: stored.cycleNumber as number } : {}),
    ...(typeof stored.intent === "string" ? { intent: stored.intent } : {}),
    workMinutes: stored.workMinutes as number,
    startedAt: stored.startedAt as number,
    ...(Number.isFinite(stored.pausedAt) ? { pausedAt: stored.pausedAt as number } : {}),
    pausedSeconds: stored.pausedSeconds as number,
  }
}

export function saveFocusSession(session: FocusTimerSession | undefined) {
  if (session) writeJson(FOCUS_SESSION_KEY, session)
  else if (typeof localStorage !== "undefined") {
    try {
      localStorage.removeItem(FOCUS_SESSION_KEY)
    } catch {
      // Nothing to do: a session that is closed here is rebuilt from the next block.
    }
  }
}

/** Another device moved this session on the server. The row is the timer now: it is
 *  stored here and the persisted countdown is moved to match, because a countdown that
 *  disagrees with its session immediately owes a boundary that would undo the change.
 *  A mounted timer follows through the `focal-web:focus-session-remote` event; this is
 *  what makes the change survive a reload with the timer page closed. */
export function adoptRemoteFocusSession(session: FocusTimerSession | undefined, now = Date.now()) {
  saveFocusSession(session)
  const state = loadTimerState(loadSettings(), now)
  const counting = session !== undefined && session.pausedAt === undefined
  if (state.mode === "free" && !session) {
    saveTimerState(timerReducer(state, { type: "END_FREE_STUDY", settings: loadSettings() }), now)
  } else if ((state.mode === "work" || state.mode === "free") && !state.studyOvertime && state.running !== counting) {
    saveTimerState({ ...state, running: counting }, now)
  }
}

/** Closes the in-flight block into the log. The endpoints are the real wall clock: the block
 *  began when it was first started and ends when it was closed, pause or no pause. The billed
 *  study time is reported separately in `activeSeconds`, so the history shows when the work
 *  happened and the totals show how long it was. An open block that ran backwards (a clock
 *  change, a stale tab) is still kept, clamped to a real duration. */
export function closeOpenBlock(block: OpenBlock, endedAt: number, blocks: FocusBlock[]): FocusBlock[] {
  const startedAt = Math.min(block.startedAt, endedAt)
  // Paused time is not study time, and Supabase's session segments already say so.
  const pausedMs = block.pausedSeconds * 1000 + (block.pausedAt === undefined ? 0 : Math.max(0, endedAt - block.pausedAt))
  const activeSeconds = Math.max(0, Math.round((endedAt - startedAt - pausedMs) / 1000))
  return [
    ...blocks,
    {
      id: typeof crypto === "undefined" ? `${startedAt}-${endedAt}` : crypto.randomUUID(),
      cycleNumber: block.cycleNumber,
      source: block.source,
      subject: block.subject,
      intent: block.intent,
      startedAt,
      endedAt,
      activeSeconds,
    },
  ].slice(-MAX_STORED_BLOCKS)
}

function isSameLocalDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

export function countBlocksToday(blocks: FocusBlock[], now = new Date()) {
  return blocks.filter((block) => isSameLocalDay(new Date(block.endedAt), now)).length
}

/** A block is counted on the day it ended, which is the day its last minute of work was
 *  spent, and contributes the time actually worked. A block still open has not been closed
 *  yet, so it contributes nothing here; the running clock is the readout's job. */
export function getFocusSecondsToday(blocks: FocusBlock[], now = new Date()) {
  return blocks.reduce(
    (total, block) => isSameLocalDay(new Date(block.endedAt), now) ? total + block.activeSeconds : total,
    0,
  )
}

export function formatFocusTime(seconds: number) {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const minutes = Math.floor((safe % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}
