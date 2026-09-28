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
import { decideFocusSession } from "@/lib/focus-session"
import { canonicalNow } from "@/lib/study-session-sync"

const TICK_MS = 1000

/** Server-anchored epoch ms. Immune to a device clock that is minutes out,
 *  which is what makes a logged block's duration trustworthy. */
const serverNow = () => canonicalNow().getTime()

/** Returns the session the server acknowledged, so its id and revision stay ours. */
type SessionSink = (
  previous: FocusTimerSession | undefined,
  next: FocusTimerSession | undefined,
  terminal?: "complete" | "cancel",
) => Promise<FocusTimerSession | undefined> | void

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

  // The sink is a network call, so these are serialised: a pause must never overtake its start.
  const sessionQueue = useRef<Promise<unknown>>(Promise.resolve())
  const emitSession = useCallback((next: FocusTimerSession | undefined, terminal?: "complete" | "cancel") => {
    const previous = sessionRef.current
    sessionRef.current = next
    sessionQueue.current = sessionQueue.current.catch(() => {}).then(async () => {
      try {
        const saved = await sinkRef.current?.(previous, next, terminal)
        if (terminal) return
        // The server's row is the truth, on the first start as much as any other: the
        // pre-server object carries no revision, and the next command built on it is stale
        // the moment the server has handed one back.
        if (saved) sessionRef.current = saved
      } catch {
        // The sink has already told the user the command did not land. Local state is
        // what they asked for, and the next boundary is built from it.
      }
    })
  }, [])

  const openBlock = useCallback((source: OpenBlock["source"], cycleNumber: number, at: number) => {
    if (openBlockRef.current) return
    const block: OpenBlock = { cycleNumber, source, subject: subject.trim(), intent: intent.trim(), startedAt: at, pausedSeconds: 0 }
    openBlockRef.current = block
    saveOpenBlock(block)
  }, [subject, intent, openBlockRef])

  const closeBlock = useCallback((at: number, discard = false) => {
    const block = openBlockRef.current
    if (!block) return
    openBlockRef.current = null
    saveOpenBlock(null)
    if (discard) return
    setBlocks((current) => {
      const next = closeOpenBlock(block, at, current)
      saveBlocks(next)
      return next
    })
  }, [openBlockRef])

  /** Pausing must not inflate the block: the log and Supabase's session
   *  segments both bill running seconds only. */
  const pauseBlock = useCallback((running: boolean, at: number) => {
    const block = openBlockRef.current
    if (!block) return
    const next = running
      ? { ...block, pausedSeconds: block.pausedSeconds + Math.max(0, at - (block.pausedAt ?? at)) / 1000, pausedAt: undefined }
      : block.pausedAt === undefined ? { ...block, pausedAt: at } : block
    if (next === block) return
    openBlockRef.current = next
    saveOpenBlock(next)
  }, [openBlockRef])

  /** The focus session mirrors one work block, so Focal's analytics count the
   *  same minutes the timer shows. */
  const syncSession = useCallback((previous: TimerState, next: TimerState, at: number) => {
    const settingsNow = settingsRef.current
    const identity = { subject: subject.trim(), title: intent.trim() || `${settingsNow.workMinutes} minute focus block` }
    const open = sessionRef.current
    const decision = decideFocusSession(previous, next, open, identity, at)
    if (!decision) return
    switch (decision.action) {
      case "start":
        // The id is minted here, not by the server: one focus block is one canonical session for
        // its whole start -> pause -> resume -> complete life, on every client.
        emitSession({
          id: crypto.randomUUID(), ...identity, provider: "Focal", cycleNumber: next.cycles + 1,
          workMinutes: settingsNow.workMinutes, startedAt: at, pausedSeconds: 0,
        })
        return
      case "complete":
        emitSession(undefined, "complete")
        return
      case "update":
        emitSession({ ...open!, ...identity })
        return
      case "pause":
        emitSession({ ...open!, pausedAt: at })
        return
      case "resume": {
        const gap = Math.max(0, at - (open!.pausedAt ?? at))
        emitSession({ ...open!, startedAt: open!.startedAt + gap, pausedAt: undefined, pausedSeconds: open!.pausedSeconds + gap / 1000 })
        return
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
  // one, and hand the mirrored session its lifecycle change. Every stamp comes
  // from the server clock, so a device with the wrong time still logs real
  // durations.
  useEffect(() => {
    const at = serverNow()
    if (state.studyOvertime) {
      // Free study is unbilled, so a pause in it costs nothing to record. Plain
      // overtime only ever begins from a break, which already closed its block.
      if (state.freeStudy) {
        if (state.running) openBlock("free-study", state.cycles, at)
        pauseBlock(state.running, at)
      }
      return
    }
    if (state.mode === "work") {
      // A block begins when the timer starts counting, not when the page happens to be
      // showing a focus timer: opening the screen mid-break must not log a block.
      // `openBlock` is a no-op while one is already open, so this doubles as the
      // resume path that banks the pause.
      if (state.running) openBlock("pomodoro", state.cycles + 1, at)
      pauseBlock(state.running, at)
      return
    }
    closeBlock(at)
  }, [state.mode, state.running, state.studyOvertime, state.freeStudy, state.cycles, openBlock, closeBlock, pauseBlock])

  useEffect(() => {
    if (state.studyOvertime) return
    syncSession(previousState.current, state, serverNow())
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

  // Free study has no defined length, so it draws an empty meter; plain
  // overtime is past its line and draws a full one.
  const progress = state.studyOvertime
    ? state.freeStudy ? 0 : 1
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
      closeBlock(serverNow(), true)
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
