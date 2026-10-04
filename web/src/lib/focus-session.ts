import type { FocusTimerSession } from "./ongoing-timers"
import type { TimerState } from "./study-timer"

export type FocusSessionAction = "start" | "pause" | "resume" | "complete" | "update"

export interface FocusSessionDecision {
  action: FocusSessionAction
  /** The server-clock instant this boundary happened at. */
  at: number
}

/** How the block is filed on the server, decided once per decision. */
export interface FocusSessionIdentity {
  subject: string
  title: string
}

/**
 * A focus session is running exactly while the work timer is counting.
 *
 * `mode` on its own is not a clock: the timer sits on the focus screen, paused,
 * between every break. Treating that as a running session opens a session when
 * the page is opened and keeps it "running" through a break, so the block the
 * server bills and the block the user is looking at drift apart.
 */
export function isFocusCounting(state: TimerState): boolean {
  return (state.mode === "work" || state.mode === "free") && !state.studyOvertime && state.running
}

/** Whether the timer is a focus block at all, counting or not. */
function isFocusBlockState(state: TimerState): boolean {
  return (state.mode === "work" || state.mode === "free") && !state.studyOvertime
}

/**
 * The one lifecycle boundary the transition just crossed, or null when it
 * crossed none.
 *
 *     no session  + begins counting   -> start
 *     session     + running -> paused  -> pause
 *     session     + paused  -> running -> resume
 *     session     + leaves focus      -> complete
 *
 * Leaving focus is a completion and merely arriving at focus is not a start, so
 * the two cannot be confused -- and a timer parked on the focus screen between
 * breaks is not a session at all.
 */
export function decideFocusSession(
  previous: TimerState,
  next: TimerState,
  open: FocusTimerSession | undefined,
  identity: FocusSessionIdentity,
  at: number,
): FocusSessionDecision | null {
  const wasFocus = isFocusBlockState(previous)
  const isFocus = isFocusBlockState(next)
  const wasCounting = isFocusCounting(previous)
  const isCounting = isFocusCounting(next)

  if (wasFocus && !isFocus) return open ? { action: "complete", at } : null
  // Parked either side of the boundary: the user is looking at a stopped timer.
  if (!wasCounting && !isCounting) return null
  if (isCounting && !open) return { action: "start", at }
  if (!open) return null
  // A subject or intent corrected mid-block has to reach the server too, or the
  // session stays filed under whatever was picked when it began.
  if (open.subject !== identity.subject || open.title !== identity.title) return { action: "update", at }
  // The session may already carry this boundary: another device crossed it first and
  // the countdown is only catching up. Re-sending it would fight that device.
  if (isCounting && !wasCounting) return open.pausedAt !== undefined ? { action: "resume", at } : null
  if (!isCounting && wasCounting) return open.pausedAt === undefined ? { action: "pause", at } : null
  return null
}

/**
 * The one boundary still owed between the session and the countdown, if any.
 *
 * A reload mid-block, or a server row adopted after a refusal, leaves them
 * disagreeing with no transition left to notice it. Decisions are transitions;
 * this is the standing disagreement between two states.
 */
export function owedFocusBoundary(
  state: TimerState,
  open: FocusTimerSession | undefined,
  at: number,
): FocusSessionDecision | null {
  if (!open) return null
  if (!isFocusBlockState(state)) return { action: "complete", at }
  if (isFocusCounting(state)) return open.pausedAt === undefined ? null : { action: "resume", at }
  return open.pausedAt === undefined ? { action: "pause", at } : null
}

/* ------------------------------------------------------------------ */
/* the acknowledged mirror                                             */
/* ------------------------------------------------------------------ */

/**
 * Where a boundary goes. Returns what the *server* acknowledged -- `undefined`
 * means the session is closed there -- and throws when the command did not land.
 * A sink that swallows its failure is indistinguishable from a closed session,
 * which is how a failed Complete turns into a zombie timer on the server.
 */
export type FocusSessionSink = (
  previous: FocusTimerSession | undefined,
  next: FocusTimerSession | undefined,
  terminal?: "complete" | "cancel",
) => Promise<FocusTimerSession | undefined> | FocusTimerSession | undefined

/**
 * A command the server refused. It carries the row the server actually holds;
 * that row *is* the last acknowledged state, so the mirror adopts it and the
 * next attempt is built on the truth instead of a stale revision.
 */
export class SessionRefusedError<T = FocusTimerSession> extends Error {
  readonly canonical: T | undefined
  constructor(message: string, canonical: T | undefined) {
    super(message)
    this.name = "SessionRefusedError"
    this.canonical = canonical
  }
}

/**
 * One boundary the user crossed, kept until the server has taken it. `start`
 * carries its minted session, `update` the corrected identity; the rest are
 * lifecycle moves stamped with the wall time they happened at.
 */
export type FocusSessionBoundary =
  | { action: "start"; at: number; session: FocusTimerSession }
  | { action: "update"; at: number; identity: FocusSessionIdentity }
  | { action: "pause" | "resume" | "complete" | "cancel"; at: number }

export interface FocusSessionMirror {
  /** The last state the server acknowledged. Never the optimistic desired state. */
  acknowledged(): FocusTimerSession | undefined
  /** What the session becomes once every recorded boundary has landed: the basis
   *  the next boundary is decided against, so a burst of presses stays one
   *  coherent history instead of each press acting on stale knowledge. */
  projected(): FocusTimerSession | undefined
  /** Record a boundary. Boundaries go to the server in the order they were
   *  crossed, each built from the acknowledged state at send time, and a failed
   *  one is retried until the server takes it. */
  push(boundary: FocusSessionBoundary): void
  /** True while a command is on the wire: the lifecycle buttons are disabled. */
  busy(): boolean
  /** Adopt a row another device changed this session into. Only while no boundary is
   *  on its way: a boundary already crossed owns the session until the server answers,
   *  and it adopts the server's row through the refusal path instead. Returns whether
   *  the row was taken. */
  adopt(session: FocusTimerSession | undefined): boolean
  dispose(): void
}

/**
 * The focus session's synced lifecycle, transactional from the caller's side.
 *
 * `acknowledged()` only ever moves on a server answer, so a command is never
 * built on a wish: on a slow connection Start and Pause cannot race into a
 * stale `expected_revision`, and a failed Complete keeps the session alive here
 * to retry rather than silently orphaning a running timer on the server.
 * This is not a queue of work to replay later -- boundaries are the history the
 * user already crossed, sent once, in order.
 */
export function createFocusSessionMirror({
  sink,
  initial,
  onAcknowledged,
  onBusy,
  retryDelayMs = 2_000,
}: {
  sink: FocusSessionSink
  /** The persisted acknowledged session, so a reload mid-block keeps the same
   *  server session instead of minting a second one behind a zombie. */
  initial?: FocusTimerSession | undefined
  onAcknowledged?: (session: FocusTimerSession | undefined) => void
  onBusy?: (busy: boolean) => void
  retryDelayMs?: number
}): FocusSessionMirror {
  let acknowledged: FocusTimerSession | undefined = initial
  const boundaries: FocusSessionBoundary[] = []
  let busy = false
  let attempts = 0
  let disposed = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let draining: Promise<void> | null = null

  const setBusy = (next: boolean) => {
    if (busy === next) return
    busy = next
    onBusy?.(next)
  }

  const commit = (session: FocusTimerSession | undefined) => {
    acknowledged = session
    onAcknowledged?.(session)
  }

  const derive = (base: FocusTimerSession | undefined, boundary: FocusSessionBoundary): FocusTimerSession | undefined => {
    switch (boundary.action) {
      case "start":
        return boundary.session
      case "complete":
      case "cancel":
        return undefined
      case "update":
        return base ? { ...base, ...boundary.identity } : undefined
      case "pause":
        return base ? { ...base, pausedAt: boundary.at } : undefined
      case "resume": {
        if (!base) return undefined
        const gap = Math.max(0, boundary.at - (base.pausedAt ?? boundary.at))
        return { ...base, startedAt: base.startedAt + gap, pausedAt: undefined, pausedSeconds: base.pausedSeconds + gap / 1000 }
      }
    }
  }

  const scheduleRetry = () => {
    if (disposed || retryTimer !== null) return
    const delay = Math.min(30_000, retryDelayMs * 2 ** Math.min(attempts, 4))
    retryTimer = setTimeout(() => {
      retryTimer = null
      void drain()
    }, delay)
  }

  const drain = async () => {
    if (disposed || draining) return draining ?? undefined
    const run = (async () => {
      while (!disposed && boundaries.length > 0) {
        const head = boundaries[0]
        // A boundary that needs an open session is moot once the server has closed
        // it: a session closed here or on another device is never resurrected.
        if (head.action !== "start" && acknowledged === undefined) {
          boundaries.shift()
          continue
        }
        const previous = head.action === "start" ? undefined : acknowledged
        const next = derive(previous, head)
        setBusy(true)
        try {
          const saved = await sink(previous, next, head.action === "complete" || head.action === "cancel" ? head.action : undefined)
          commit(saved)
          boundaries.shift()
          attempts = 0
        } catch (error) {
          // A refusal carries the row the server holds; adopting it is what keeps
          // the retry from re-sending a revision the server has already moved past.
          const canonical = error instanceof SessionRefusedError ? error.canonical : undefined
          if (canonical) commit(canonical)
          attempts += 1
          setBusy(false)
          scheduleRetry()
          return
        }
      }
      setBusy(false)
    })()
    draining = run
    await run
    if (draining === run) draining = null
  }

  return {
    acknowledged: () => acknowledged,
    projected: () => boundaries.reduce<FocusTimerSession | undefined>((session, boundary) => derive(session, boundary), acknowledged),
    push: (boundary) => {
      if (disposed) return
      boundaries.push(boundary)
      void drain()
    },
    busy: () => busy,
    adopt: (session) => {
      if (boundaries.length > 0 || busy) return false
      commit(session)
      return true
    },
    dispose: () => {
      disposed = true
      if (retryTimer !== null) clearTimeout(retryTimer)
      retryTimer = null
    },
  }
}
