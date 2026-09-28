import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"

import {
  closeOpenBlock,
  countBlocksToday,
  getFocusSecondsToday,
  loadBlocks,
  loadOpenBlock,
  loadSettings,
  loadTimerState,
  saveBlocks,
  saveOpenBlock,
  saveSettings,
  saveTimerState,
  timerReducer,
  type FocusBlock,
  type OpenBlock,
  type TimerSettings,
  type TimerState,
} from "@/lib/study-timer"
import type { FocusTimerSession } from "@/lib/ongoing-timers"

const TICK_MS = 1000

type SessionSink = (
  previous: FocusTimerSession | undefined,
  next: FocusTimerSession | undefined,
  terminal?: "complete" | "cancel",
) => void

export interface StudyTimerEngine {
  state: TimerState
  settings: TimerSettings
  blocks: FocusBlock[]
  blocksToday: number
  focusSecondsToday: number
  progress: number
  updateSettings: (patch: Partial<TimerSettings>) => void
  toggle: () => void
  reset: () => void
  skipBreak: () => void
  addTime: (minutes: number) => void
  startOvertime: () => void
  startFreeStudy: () => void
  returnToBreak: () => void
}

function playChime() {
  if (typeof window === "undefined" || typeof AudioContext === "undefined") return
  try {
    const context = new AudioContext()
    const now = context.currentTime
    const voices: OscillatorNode[] = []
    for (const [index, frequency] of [660, 880].entries()) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      oscillator.frequency.value = frequency
      oscillator.type = "sine"
      gain.gain.setValueAtTime(0.0001, now + index * 0.18)
      gain.gain.exponentialRampToValueAtTime(0.2, now + index * 0.18 + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + index * 0.18 + 0.16)
      oscillator.connect(gain).connect(context.destination)
      oscillator.start(now + index * 0.18)
      oscillator.stop(now + index * 0.18 + 0.2)
      voices.push(oscillator)
    }
    voices.at(-1)?.addEventListener("ended", () => void context.close())
  } catch {
    // Audio is a nicety; a blocked or unavailable context never blocks the timer.
  }
}

function notify(title: string, body: string) {
  if (typeof Notification === "undefined" || Notification.permission !== "granted") return
  try {
    new Notification(title, { body, tag: "focal-study-timer" })
  } catch {
    // Some browsers only allow notifications from a service worker.
  }
}

export function requestTimerNotifications() {
  if (typeof Notification === "undefined") return Promise.resolve(false)
  if (Notification.permission === "granted") return Promise.resolve(true)
  if (Notification.permission === "denied") return Promise.resolve(false)
  return Notification.requestPermission().then((permission) => permission === "granted")
}

export function useStudyTimer({
  subject,
  intent,
  onSessionChange,
}: {
  subject: string
  intent: string
  onSessionChange?: SessionSink
}): StudyTimerEngine {
  const [settings, setSettings] = useState<TimerSettings>(loadSettings)
  const [state, dispatch] = useReducer(timerReducer, undefined, () => loadTimerState(loadSettings()))
  const [blocks, setBlocks] = useState<FocusBlock[]>(loadBlocks)
  const [now, setNow] = useState(() => Date.now())

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // `useState` gives the one stable ref object a lazy `useRef` initializer cannot.
  const [openBlockRef] = useState(() => ({ current: loadOpenBlock() as OpenBlock | null }))
  const sessionRef = useRef<FocusTimerSession | undefined>(undefined)
  const sinkRef = useRef(onSessionChange)
  sinkRef.current = onSessionChange

  const previousState = useRef(state)

  const emitSession = useCallback((next: FocusTimerSession | undefined, terminal?: "complete" | "cancel") => {
    const previous = sessionRef.current
    sessionRef.current = next
    sinkRef.current?.(previous, next, terminal)
  }, [])

  const openBlock = useCallback((source: OpenBlock["source"], cycleNumber: number) => {
    if (openBlockRef.current) return
    const block: OpenBlock = { cycleNumber, source, subject: subject.trim(), intent: intent.trim(), startedAt: Date.now() }
    openBlockRef.current = block
    saveOpenBlock(block)
  }, [subject, intent, openBlockRef])

  const closeBlock = useCallback((discard = false) => {
    const block = openBlockRef.current
    if (!block) return
    openBlockRef.current = null
    saveOpenBlock(null)
    if (discard) return
    setBlocks((current) => {
      const next = closeOpenBlock(block, Date.now(), current)
      saveBlocks(next)
      return next
    })
  }, [openBlockRef])

  /** The focus session mirrors one work block, so Focal's analytics count the
   *  same minutes the timer shows. */
  const syncSession = useCallback((previous: TimerState, next: TimerState, at: number) => {
    const settingsNow = settingsRef.current
    const wasWorking = previous.mode === "work" && !previous.studyOvertime
    const isWorking = next.mode === "work" && !next.studyOvertime
    const open = sessionRef.current

    if (isWorking && !wasWorking) {
      emitSession({
        subject: subject.trim(), provider: "Focal", title: intent.trim() || `${settingsNow.workMinutes} minute focus block`,
        cycleNumber: next.cycles + 1, workMinutes: settingsNow.workMinutes, startedAt: at, pausedSeconds: 0,
      })
      return
    }
    if (!isWorking && wasWorking && open) {
      emitSession(undefined, "complete")
      return
    }
    if (isWorking && open) {
      if (next.running && open.pausedAt !== undefined) {
        emitSession({ ...open, startedAt: open.startedAt + Math.max(0, at - open.pausedAt), pausedAt: undefined, pausedSeconds: open.pausedSeconds + Math.max(0, at - open.pausedAt) / 1000 })
      } else if (!next.running && open.pausedAt === undefined) {
        emitSession({ ...open, pausedAt: at })
      }
    }
  }, [emitSession, subject, intent])

  useEffect(() => {
    if (!state.running) return
    let last = performance.now()
    const interval = window.setInterval(() => {
      const current = performance.now()
      const seconds = Math.max(0, Math.round((current - last) / 1000))
      last = current
      if (seconds > 0) dispatch({ type: "TICK", settings: settingsRef.current, seconds })
    }, TICK_MS)
    return () => window.clearInterval(interval)
  }, [state.running])

  // Mode changes are the timer's only real events: they open a block, close
  // one, and hand the mirrored session its lifecycle change.
  useEffect(() => {
    if (state.studyOvertime) {
      if (state.freeStudy) openBlock("free-study", state.cycles)
      return
    }
    if (state.mode === "work") {
      if (state.running) openBlock("pomodoro", state.cycles + 1)
      return
    }
    closeBlock()
  }, [state.mode, state.running, state.studyOvertime, state.freeStudy, state.cycles, openBlock, closeBlock])

  useEffect(() => {
    if (state.studyOvertime) return
    syncSession(previousState.current, state, Date.now())
    previousState.current = state
  }, [state, syncSession])

  // Announce the transition that just happened, once, at the moment it lands.
  const announcedRef = useRef<string>("")
  useEffect(() => {
    const key = `${state.mode}:${state.cycles}:${state.studyOvertime}`
    if (state.secondsLeft > 1 || announcedRef.current === key) return
    announcedRef.current = key
    const label = state.mode === "work" ? "Focus block complete" : "Break over"
    if (settingsRef.current.soundEnabled) playChime()
    if (settingsRef.current.notificationsEnabled) {
      notify(label, state.mode === "work" ? "Time for a break. Stand up and look at something far away." : `Back to ${settingsRef.current.workMinutes} minutes of focus.`)
    }
  }, [state.mode, state.cycles, state.secondsLeft, state.studyOvertime])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    saveTimerState(state, Date.now())
  }, [state])

  // Re-render once a second so "focused for 24m" style labels stay honest.
  useEffect(() => {
    if (!state.running) return
    const interval = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [state.running])

  const updateSettings = useCallback((patch: Partial<TimerSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      dispatch({ type: "SYNC_SETTINGS", settings: next, previousSettings: current })
      return next
    })
  }, [])

  const blocksToday = useMemo(() => countBlocksToday(blocks, new Date(now)), [blocks, now])
  const focusSecondsToday = useMemo(() => getFocusSecondsToday(blocks, new Date(now)), [blocks, now])

  const progress = state.studyOvertime && state.freeStudy
    ? 1
    : state.studyOvertime
      ? 1
      : state.totalSeconds > 0
        ? Math.min(100, Math.max(0, ((state.totalSeconds - state.secondsLeft) / state.totalSeconds) * 100))
        : 0

  return {
    state,
    settings,
    blocks,
    blocksToday,
    focusSecondsToday,
    progress,
    updateSettings,
    toggle: () => dispatch({ type: "TOGGLE" }),
    reset: () => {
      closeBlock(true)
      emitSession(undefined, "cancel")
      dispatch({ type: "RESET", settings: settingsRef.current })
    },
    skipBreak: () => dispatch({ type: "SKIP_BREAK", settings: settingsRef.current }),
    addTime: (minutes) => dispatch({ type: "ADD_TIME", minutes }),
    startOvertime: () => dispatch({ type: "START_STUDY_OVERTIME", settings: settingsRef.current }),
    startFreeStudy: () => dispatch({ type: "START_FREE_STUDY", settings: settingsRef.current }),
    returnToBreak: () => dispatch({ type: "RETURN_TO_BREAK" }),
  }
}
