import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react"

import {
  closeOpenBlock,
  countBlocksToday,
  getFocusSecondsToday,
  loadBlocks,
  loadFocusSession,
  loadOpenBlock,
  loadSettings,
  loadTimerState,
  saveBlocks,
  saveFocusSession,
  saveOpenBlock,
  saveSettings,
  saveTimerState,
  timerReducer,
  type FocusBlock,
  type OpenBlock,
  type TimerSettings,
  type TimerState,
} from "@/lib/study-timer"
import {
  createFocusSessionMirror,
  decideFocusSession,
  owedFocusBoundary,
  type FocusSessionMirror,
  type FocusSessionSink,
} from "@/lib/focus-session"
import { canonicalNow } from "@/lib/study-session-sync"
import type { FocusTimerSession } from "@/lib/ongoing-timers"

const TICK_MS = 1000

/** Server-anchored epoch ms. Immune to a device clock that is minutes out,
 *  which is what makes a logged block's duration trustworthy. */
const serverNow = () => canonicalNow().getTime()

export interface StudyTimerEngine {
  state: TimerState
  settings: TimerSettings
  blocks: FocusBlock[]
  blocksToday: number
  focusSecondsToday: number
  progress: number
  /** A lifecycle command is on the wire: its buttons are disabled until the
   *  server has answered, so one boundary cannot overtake another. */
  sessionBusy: boolean
  updateSettings: (patch: Partial<TimerSettings>) => void
  selectMode: (mode: "free" | "work") => void
  toggle: () => void
  reset: () => void
  skipBreak: () => void
  addTime: (minutes: number) => void
  startOvertime: () => void
  startFreeStudy: () => void
  finishFreeStudy: () => void
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
  enabled = true,
}: {
  subject: string
  intent: string
  onSessionChange?: FocusSessionSink
  enabled?: boolean
}): StudyTimerEngine {
  const [settings, setSettings] = useState<TimerSettings>(loadSettings)
  const [state, dispatch] = useReducer(timerReducer, undefined, () => loadTimerState(loadSettings()))
  const [blocks, setBlocks] = useState<FocusBlock[]>(loadBlocks)
  const [now, setNow] = useState(() => Date.now())

  const settingsRef = useRef(settings)
  settingsRef.current = settings
  // `useState` gives the one stable ref object a lazy `useRef` initializer cannot.
  const [openBlockRef] = useState(() => ({ current: loadOpenBlock() as OpenBlock | null }))
  const sinkRef = useRef(onSessionChange)
  sinkRef.current = onSessionChange

  // The synced lifecycle of the focus session. Its acknowledged state only moves on a
  // server answer, every boundary is sent in the order it was crossed and retried until
  // the server takes it, so no command is ever built on a revision the server has already
  // moved past and no failed Complete can strand a running timer on the server.
  const [sessionBusy, setSessionBusy] = useState(false)
  const [sessionMirror] = useState<FocusSessionMirror>(() => createFocusSessionMirror({
    sink: (previous, next, terminal) => sinkRef.current?.(previous, next, terminal),
    initial: loadFocusSession(),
    onAcknowledged: saveFocusSession,
    onBusy: setSessionBusy,
  }))

  const previousState = useRef(state)

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

  // Another device moved this session (a pause, resume, or finish from the Focal
  // desktop app). The row is the timer now, so the countdown follows it: a countdown
  // that disagrees with its session owes a boundary that would undo the change.
  useEffect(() => {
    const onRemoteChange = (event: Event) => {
      const { id, session } = (event as CustomEvent<{ id: string; session: FocusTimerSession | undefined }>).detail
      if (sessionMirror.acknowledged()?.id !== id && session?.id !== id) return
      if (!sessionMirror.adopt(session)) return
      const timer = previousState.current
      // Outside a focus block the countdown is a break, not the session; the standing
      // disagreement between a break and an open session is owedFocusBoundary's job.
      if ((timer.mode !== "work" && timer.mode !== "free") || timer.studyOvertime) return
      if (!session && timer.mode === "free") {
        closeBlock(serverNow())
        dispatch({ type: "END_FREE_STUDY", settings: settingsRef.current })
      } else dispatch({ type: "SET_RUNNING", running: session !== undefined && session.pausedAt === undefined })
    }
    window.addEventListener("examtrack:focus-session-remote", onRemoteChange)
    return () => window.removeEventListener("examtrack:focus-session-remote", onRemoteChange)
  }, [sessionMirror, closeBlock])

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
    const identity = { subject: subject.trim(), title: intent.trim() || (next.mode === "free" ? "Free study" : `${settingsNow.workMinutes} minute focus block`) }
    // Boundaries are decided against the projected session: the acknowledged one plus
    // the boundaries still on their way. A Start and a Pause pressed on a slow connection
    // then form one coherent history instead of two commands fighting over one revision.
    const decision = decideFocusSession(previous, next, sessionMirror.projected(), identity, at)
      // No transition was crossed, but a reload mid-block or a server row adopted after a
      // refusal can still leave the session and the countdown disagreeing.
      ?? owedFocusBoundary(next, sessionMirror.projected(), at)
    if (!decision) return
    switch (decision.action) {
      case "start":
        // The id is minted here, not by the server: one focus block is one canonical session for
        // its whole start -> pause -> resume -> complete life, on every client.
        sessionMirror.push({
          action: "start", at: decision.at,
          session: {
            id: crypto.randomUUID(), ...identity, provider: "Focal", cycleNumber: next.cycles + 1,
            workMinutes: settingsNow.workMinutes, startedAt: decision.at, pausedSeconds: 0,
          },
        })
        return
      case "update":
        sessionMirror.push({ action: "update", at: decision.at, identity })
        return
      default:
        sessionMirror.push({ action: decision.action, at: decision.at })
    }
  }, [sessionMirror, subject, intent])

  useEffect(() => {
    if (!enabled || !state.running) return
    let last = performance.now()
    const interval = window.setInterval(() => {
      const current = performance.now()
      const seconds = Math.max(0, Math.round((current - last) / 1000))
      last = current
      if (seconds > 0) dispatch({ type: "TICK", settings: settingsRef.current, seconds })
    }, TICK_MS)
    return () => window.clearInterval(interval)
  }, [enabled, state.running])

  // Both study modes use the same logged start/pause/resume/finish lifecycle.
  // Server-clock stamps keep devices with different clocks in agreement.
  useEffect(() => {
    const at = serverNow()
    if (!enabled) {
      pauseBlock(false, at)
      if (state.running) dispatch({ type: "SET_RUNNING", running: false })
      return
    }
    if (state.studyOvertime || state.mode === "free") {
      // Pomodoro overtime begins after its block has closed; free study owns a block.
      if (state.freeStudy) {
        // Keep pause/resume inside one free-study block, with pauses excluded.
        if (openBlockRef.current?.source !== "free-study") closeBlock(at)
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
  }, [enabled, state.mode, state.running, state.studyOvertime, state.freeStudy, state.cycles, openBlock, closeBlock, pauseBlock, openBlockRef])

  // Reconcile the logged session with either timer mode after every state change.
  useEffect(() => {
    if (!enabled) return
    syncSession(previousState.current, state, serverNow())
    previousState.current = state
  }, [enabled, state, syncSession])

  useEffect(() => () => sessionMirror.dispose(), [sessionMirror])

  // Announce the transition that just happened, once, at the moment it lands.
  const announcedRef = useRef<string>("")
  useEffect(() => {
    if (!enabled) return
    const key = `${state.mode}:${state.cycles}:${state.studyOvertime}`
    if (state.mode === "free" || state.studyOvertime || state.secondsLeft > 1 || announcedRef.current === key) return
    announcedRef.current = key
    const label = state.mode === "work" ? "Focus block complete" : "Break over"
    if (settingsRef.current.soundEnabled) playChime()
    if (settingsRef.current.notificationsEnabled) {
      notify(label, state.mode === "work" ? "Time for a break. Stand up and look at something far away." : `Back to ${settingsRef.current.workMinutes} minutes of focus.`)
    }
  }, [enabled, state.mode, state.cycles, state.secondsLeft, state.studyOvertime])

  useEffect(() => {
    saveSettings(settings)
  }, [settings])

  useEffect(() => {
    saveTimerState(state, Date.now())
  }, [state])

  // Re-render once a second so "focused for 24m" style labels stay honest.
  useEffect(() => {
    if (!enabled || !state.running) return
    const interval = window.setInterval(() => setNow(Date.now()), 15_000)
    return () => window.clearInterval(interval)
  }, [enabled, state.running])

  const updateSettings = useCallback((patch: Partial<TimerSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...patch }
      dispatch({ type: "SYNC_SETTINGS", settings: next, previousSettings: current })
      return next
    })
  }, [])

  const blocksToday = useMemo(() => countBlocksToday(blocks, new Date(now)), [blocks, now])
  const focusSecondsToday = useMemo(() => getFocusSecondsToday(blocks, new Date(now)), [blocks, now])

  // Only Pomodoro has measurable progress towards an end.
  const progress = state.studyOvertime || state.mode === "free"
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
    sessionBusy,
    updateSettings,
    selectMode: (mode) => {
      if (state.running || openBlockRef.current) return
      dispatch({ type: "SELECT_MODE", mode, settings: settingsRef.current })
    },
    toggle: () => dispatch({ type: "TOGGLE" }),
    reset: () => {
      closeBlock(serverNow(), true)
      // The cancel is recorded before the countdown resets, so the transition the effect
      // sees projects a closed session and cannot pause what was just discarded.
      sessionMirror.push({ action: "cancel", at: serverNow() })
      dispatch({ type: "RESET", settings: settingsRef.current })
    },
    skipBreak: () => dispatch({ type: "SKIP_BREAK", settings: settingsRef.current }),
    addTime: (minutes) => dispatch({ type: "ADD_TIME", minutes }),
    startOvertime: () => dispatch({ type: "START_STUDY_OVERTIME", settings: settingsRef.current }),
    startFreeStudy: () => dispatch({ type: "START_FREE_STUDY", settings: settingsRef.current }),
    finishFreeStudy: () => {
      closeBlock(serverNow())
      sessionMirror.push({ action: "complete", at: serverNow() })
      dispatch({ type: "END_FREE_STUDY", settings: settingsRef.current })
    },
    returnToBreak: () => dispatch({ type: "RETURN_TO_BREAK" }),
  }
}
