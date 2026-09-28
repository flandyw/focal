import type { FocusTimerSession } from "@/lib/ongoing-timers"
import type { TimerState } from "@/lib/study-timer"

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
  return state.mode === "work" && !state.studyOvertime && state.running
}

/** Whether the timer is a focus block at all, counting or not. */
function isFocusBlockState(state: TimerState): boolean {
  return state.mode === "work" && !state.studyOvertime
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
  if (isCounting && !wasCounting) return { action: "resume", at }
  if (!isCounting && wasCounting) return { action: "pause", at }
  return null
}
