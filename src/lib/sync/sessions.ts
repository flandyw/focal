/**
 * Study sessions arrive as checkpoints from several clients, so the same sitting can
 * exist twice with different ids. These helpers fold them into one row and report the
 * duplicates as durable deletions, which is what keeps the log from growing a new row per
 * checkpoint.
 */
import { normalizeStudySession } from "@/lib/studySessions"
import type { StudySession } from "@/lib/types"
import type { StudySessionCommand } from "@/lib/sync/sessionContract"

export interface SharedTimerNotice { title: string; body: string }

/** Only lifecycle changes deserve an alert; frequent timer checkpoints do not. */
export function sharedTimerNotice(previous: StudySession | undefined, next: StudySession | undefined): SharedTimerNotice | null {
  const session = next ?? previous
  const source = session?.integrations?.examtrack ?? session?.integrations?.folio
  if (!session || !source) return null
  const app = source.type === "examtrack" ? "ExamTrack" : "Folio"
  const body = session.title
  if (!next) return previous?.execution.state === "in-progress" ? { title: `${app} timer discarded`, body } : null
  if (next.execution.state === "completed") {
    return previous?.execution.state === "in-progress" ? { title: `${app} timer finished`, body } : null
  }
  if (next.execution.state !== "in-progress") return null
  if (previous?.execution.state !== "in-progress") return { title: `${app} timer started`, body }

  const running = (item: StudySession) => {
    if (item.execution.state !== "in-progress") return false
    const phase = item.integrations?.examtrack?.phase ?? item.integrations?.folio?.phase
    const intervals = item.execution.intervals
    const last = intervals[intervals.length - 1]
    return phase ? phase !== "paused" : Boolean(last && !last.end)
  }
  if (running(previous) !== running(next)) {
    return { title: `${app} timer ${running(next) ? "resumed" : "paused"}`, body }
  }
  const before = previous.integrations?.examtrack?.phase ?? previous.integrations?.folio?.phase
  const after = next.integrations?.examtrack?.phase ?? next.integrations?.folio?.phase
  return before === "reading" && after === "writing" ? { title: `${app} writing time started`, body } : null
}

export function sessionDeletionIds(sessions: StudySession[], selected: StudySession[], ids: string[]): string[] {
  const targets = new Set(ids)
  const keys = new Set([...sessions, ...selected].filter((session) => targets.has(session.id)).map(sessionDuplicateKey))
  return [...new Set([...ids, ...sessions.filter((session) => keys.has(sessionDuplicateKey(session))).map((session) => session.id)])]
}

export function repairDuplicateSessions(raw: unknown[]): {
  sessions: StudySession[]
  duplicateIds: string[]
  duplicateNotionPageIds: string[]
} {
  const sessions = raw.map(normalizeStudySession).filter((session) => !session.deleted_at)
  const canonical = new Map<string, StudySession>()
  const duplicateIds: string[] = []
  const duplicateNotionPageIds: string[] = []

  for (const session of sessions) {
    const fingerprint = sessionDuplicateKey(session)
    const existing = canonical.get(fingerprint)
    if (!existing) {
      canonical.set(fingerprint, session)
      continue
    }

    const existingKey = sessionSortKey(existing)
    const incomingKey = sessionSortKey(session)
    const keepExisting = existingKey > incomingKey || (existingKey === incomingKey && existing.id <= session.id)
    const kept = keepExisting ? existing : session
    const duplicate = keepExisting ? session : existing
    canonical.set(fingerprint, mergeDuplicateSessionDetails(kept, duplicate))
    duplicateIds.push(duplicate.id)
    if (duplicate.source?.type === "notion") duplicateNotionPageIds.push(duplicate.source.id)
  }

  const keptById = new Map([...canonical.values()].map((session) => [session.id, session]))
  return {
    sessions: sessions.flatMap((session) => keptById.has(session.id) ? [keptById.get(session.id)!] : []),
    duplicateIds,
    duplicateNotionPageIds,
  }
}

export function sessionDuplicateKey(session: StudySession): string {
  // Folio/ExamTrack updates keep a stable source id even when an older client generated
  // a new local row id for each checkpoint. Treat those rows as one logical sitting.
  // Notion page ids are intentionally not used here: two pages can legitimately describe
  // the same-looking study block and are repaired by the existing fingerprint instead.
  const source = session.integrations?.folio ?? session.integrations?.examtrack
  if (source) return `external:${source.type}:${source.id}`
  // ponytail: repair the old Folio/Notion identity-loss loop only with an exact
  // millisecond start and Folio provenance. New clients use source ids above.
  if (session.last_modified_device_id === "folio-android" &&
      /^(Study|Exam practice) in Folio(?: ·|$)/.test(session.description ?? "")) {
    return JSON.stringify(["legacy-folio", session.title.trim(), [...session.subjectIds].sort(), session.startTime])
  }
  return JSON.stringify({
    title: session.title.trim(),
    projectId: session.projectId ?? null,
    subjectIds: [...session.subjectIds].sort(),
    startTime: session.startTime,
    endTime: session.endTime,
    status: session.status,
  })
}

function mergeDuplicateSessionDetails(kept: StudySession, duplicate: StudySession): StudySession {
  const keptRaw = JSON.parse(JSON.stringify(kept)) as Record<string, unknown>
  const duplicateHasBetterTimeline = kept.execution.state !== "completed" && executionQuality(duplicate) > executionQuality(kept)
  return normalizeStudySession({
    ...keptRaw,
    description: kept.description ?? duplicate.description,
    topics: [...new Set([...(kept.topics ?? []), ...(duplicate.topics ?? [])])],
    integrations: { ...duplicate.integrations, ...kept.integrations },
    schedule: duplicateHasBetterTimeline ? duplicate.schedule : kept.schedule,
    execution: duplicateHasBetterTimeline ? duplicate.execution : kept.execution,
    reflection: {
      notes: kept.reflection?.notes ?? duplicate.reflection?.notes,
      confidence: kept.reflection?.confidence ?? duplicate.reflection?.confidence,
      blockers: kept.reflection?.blockers ?? duplicate.reflection?.blockers,
      nextAction: kept.reflection?.nextAction ?? duplicate.reflection?.nextAction,
    },
    created_at: kept.created_at <= duplicate.created_at ? kept.created_at : duplicate.created_at,
    updated_at: (kept.updated_at ?? kept.created_at) >= (duplicate.updated_at ?? duplicate.created_at)
      ? kept.updated_at
      : duplicate.updated_at,
  })
}

function executionQuality(session: StudySession): number {
  const detailedIntervals = session.execution.intervals.filter((interval) => interval.source !== "imported").length
  const stateScore = session.execution.state === "completed" ? 2 : session.execution.state === "in-progress" ? 1 : 0
  return detailedIntervals * 100 + session.execution.intervals.length * 10 + stateScore
}

function sessionSortKey(session: StudySession): string {
  const localRank = session.createdVia === "notion" ? "1" : "0"
  return `${localRank}:${session.updated_at ?? session.created_at}:${session.created_at}`
}

export type SessionCommandTiming = Pick<StudySessionCommand, "occurred_at" | "elapsed_since_previous_ms">

/**
 * Measures one replayed boundary. `at` and `previousAt` are the stored wall-clock instants
 * of the boundary and of the boundary before it; `null` means the command is not a replayed
 * boundary and is stamped by the server at receipt instead.
 */
export type SessionTimingForAction = (
  action: StudySessionCommand["action"],
  at: number | null,
  previousAt: number | null,
) => SessionCommandTiming | undefined

/**
 * Timing for replayed boundaries, taken from the stored interval history. The gap between
 * two boundaries is exact, and that is what the server bills from. Only the first boundary
 * of a fresh replay needs an absolute placement, and `placeFirstBoundary` supplies it from a
 * server-clock estimate; without one the server anchors the replay at receipt time and the
 * exact gaps still keep every interval's length right.
 */
export function sessionReplayTiming(
  placeFirstBoundary: (boundaryAt: number) => string | null = () => null,
): SessionTimingForAction {
  return (_action, at, previousAt) => {
    if (at === null) return undefined
    if (previousAt !== null) {
      const gap = at - previousAt
      if (gap < 0 || gap > 604_800_000) {
        throw new Error("This offline timer boundary is outside the server's seven-day timing window")
      }
      return { elapsed_since_previous_ms: gap }
    }
    return { occurred_at: placeFirstBoundary(at), elapsed_since_previous_ms: 0 }
  }
}

/**
 * The commands implied by the difference between the server's last canonical row for a
 * session and the local record. This is a pure diff, not a queue: an empty list means the
 * server is already there, and sending the same commands twice is harmless, so an edit made
 * offline is published by the next sync pass with nothing to keep in step.
 *
 * The local intervals are the durable timer boundaries. When they can be matched against the
 * server's segments, only the missing boundaries are replayed -- one command each, carrying
 * their real elapsed timing -- so an offline pause -> resume -> pause bills the minutes that
 * were worked and not the whole span up to the reconnect. A final-state diff cannot do that:
 * it knows where the timer ended up, not where its boundaries were.
 */
export function sessionCommands(
  raw: StudySession,
  applied: { operation: string; payload: unknown; lamport: number } | undefined,
  deviceId: string,
  timingFor: SessionTimingForAction = sessionReplayTiming(),
): StudySessionCommand[] {
  const canonical = typeof applied?.payload === "object" && applied.payload !== null
    ? applied.payload as Record<string, unknown> : undefined
  if (applied?.operation === "delete") return []
  const session = normalizeStudySession(raw)
  const metadata = sessionMetadata(session)
  const desired = desiredState(session)
  const remoteState = canonicalState(canonical)
  const phase = phaseOf(session)
  const remotePhase = typeof canonical?.phase === "string" ? canonical.phase : undefined
  const revision = typeof canonical?.revision === "number" ? canonical.revision : applied?.lamport ?? 0
  if (!canonical && desired === "completed" && session.createdVia === "manual" &&
      session.execution.intervals.length > 0 && session.execution.intervals.every((interval) => interval.source === "manual" && interval.end)) {
    return [{ mutation_id: crypto.randomUUID(), session_id: session.id, expected_revision: 0,
      action: "log", device_id: deviceId, app: "focal", kind: "focus", phase: "focus", title: session.title,
      subject_id: session.subjectIds[0], metadata: metadata(),
      blocks: session.execution.intervals.map((interval) => ({ start: interval.start, end: interval.end! })) }]
  }
  const commands: StudySessionCommand[] = []
  let expected = revision
  let currentState = remoteState
  const append = (action: StudySessionCommand["action"], at: number | null = null, previousAt: number | null = null) => {
    const timing = at === null ? undefined : timingFor(action, at, previousAt)
    commands.push({ mutation_id: crypto.randomUUID(), session_id: session.id, expected_revision: expected++,
      action, device_id: deviceId, app: appOf(session), kind: kindOf(session), phase, title: session.title,
      subject_id: session.subjectIds[0] ?? null, metadata: metadata(), ...(timing ?? {}) })
    switch (action) {
      case "start":
      case "resume":
        currentState = "running"
        break
      case "pause":
        currentState = "paused"
        break
      case "complete":
        currentState = "completed"
        break
      case "cancel":
        currentState = "cancelled"
        break
      case "create":
        currentState = "planned"
        break
      default:
        break
    }
  }
  // The durable intervals carry the offline boundaries. Rebuild only what the server's
  // segments are missing, even when the final state happens to agree. A row without
  // segments may be a legacy or imported row: it gets the plain diff below instead.
  const intervals = session.execution.intervals
    .map((interval) => ({
      start: Date.parse(interval.start),
      end: interval.end === undefined ? undefined : Date.parse(interval.end),
    }))
  const measured = intervals.length > 0 &&
    intervals.every((interval) => Number.isFinite(interval.start) &&
      (interval.end === undefined || Number.isFinite(interval.end) && interval.end >= interval.start)) &&
    intervals.slice(1).every((next, index) => intervals[index].end !== undefined && next.start >= intervals[index].end)
  const segments = Array.isArray(canonical?.segments) ? canonical.segments : undefined
  // Only a plain focus session carries its boundaries in its intervals. Exam and SAC sittings
  // split them by phase too, and replaying those as pause/resume would mislabel every segment;
  // they need their own boundary records before they can be replayed like this.
  if (kindOf(session) === "focus" && measured && (canonical === undefined || segments !== undefined) &&
      remoteState !== "completed" && remoteState !== "cancelled") {
    const count = segments?.length ?? 0
    // Another client may have added segments this device has never seen in its intervals.
    // A final-state diff cannot reconcile two incompatible timelines safely.
    if (count > intervals.length || ((remoteState === "running" || remoteState === "paused") && count === 0)) {
      throw new Error("This session has server timer boundaries that do not match its local intervals")
    }
    let index = remoteState === undefined || remoteState === "planned" ? 0 : count - 1
    let boundary: number | null = remoteState === "running" ? intervals[index].start
      : remoteState === "paused" ? intervals[index].end ?? null
      : null
    if ((remoteState === "running" || remoteState === "paused") && boundary === null) {
      throw new Error("This session's last server boundary cannot be matched to a local interval")
    }
    if (remoteState === undefined || remoteState === "planned" || count > 0) {
      if (remoteState === undefined || remoteState === "planned") {
        append("start", intervals[0].start, null)
        boundary = intervals[0].start
      }
      while (index < intervals.length) {
        const interval = intervals[index]
        if (currentState === "running") {
          const end = interval.end
          if (end === undefined) break
          // A sitting finished at the end of its last interval closes on that boundary;
          // one finished after a pause owes a separate close below.
          const terminal = index === intervals.length - 1 &&
            (desired === "completed" || desired === "cancelled") && sessionEndedAt(session) === end
          if (terminal) {
            append(desired === "cancelled" ? "cancel" : "complete", end, boundary)
            return commands
          }
          append("pause", end, boundary)
          boundary = end
        }
        if (index === intervals.length - 1) break
        index += 1
        const start = intervals[index].start
        append("resume", start, boundary)
        boundary = start
      }
      if ((desired === "completed" || desired === "cancelled") &&
          currentState !== "completed" && currentState !== "cancelled") {
        append(desired === "cancelled" ? "cancel" : "complete", sessionEndedAt(session), boundary)
      }
      if (commands.length > 0) return commands
    }
  }
  // A session the server has never seen needs its whole history, because the state machine
  // cannot invent the segments a local record already contains.
  if (!remoteState) {
    if (desired === "cancelled") { append("create"); append("cancel"); return commands }
    if (desired === "planned") { append("create"); return commands }
    if (desired === "completed") {
      if (measuredMillis(session) > 0) append("start")
      else append("create")
      append("complete")
      return commands
    }
    append("start")
    if (desired === "paused") append("pause")
    return commands
  }
  if (remoteState === "completed" || remoteState === "cancelled") return commands
  if (desired === "cancelled") append("cancel")
  else if (desired === "completed" && remoteState !== "completed") append("complete")
  else if (desired === "running" && remoteState === "planned") append("start")
  else if (desired === "running" && remoteState === "paused") append("resume")
  else if (desired === "paused" && remoteState === "planned") { append("start"); append("pause") }
  else if (desired === "paused" && remoteState === "running") append("pause")
  // Only a known, different phase is worth a call: a row without one must not loop.
  else if (desired === remoteState && remotePhase !== undefined && remotePhase !== phase) append("phase_change")
  return commands
}

function desiredState(session: StudySession): "planned" | "running" | "paused" | "completed" | "cancelled" {
  if (session.deleted_at) return "cancelled"
  if (session.execution.state === "completed") return "completed"
  if (session.execution.state !== "in-progress") return "planned"
  // An open last segment is the timer running; a closed one is where it was last paused.
  const last = lastInterval(session)
  return last && !last.end ? "running" : "paused"
}

/** When the sitting really ended: the recorded completion, or the discard for a deletion. */
function sessionEndedAt(session: StudySession): number | null {
  const stamp = session.execution.state === "completed" ? session.execution.completedAt : session.deleted_at
  if (!stamp) return null
  const ended = Date.parse(stamp)
  return Number.isFinite(ended) ? ended : null
}

function canonicalState(canonical: Record<string, unknown> | undefined): string | undefined {
  return typeof canonical?.state === "string" ? canonical.state : undefined
}

function lastInterval(session: StudySession): { start: string; end?: string } | undefined {
  return session.execution.intervals[session.execution.intervals.length - 1]
}

function measuredMillis(session: StudySession): number {
  return session.execution.intervals.reduce((total, interval) =>
    total + Math.max(0, (new Date(interval.end ?? interval.start).getTime() - new Date(interval.start).getTime())), 0)
}

function phaseOf(session: StudySession): "focus" | "reading" | "writing" {
  const phase = session.integrations?.examtrack?.phase ?? session.integrations?.folio?.phase
  return phase === "reading" || phase === "writing" ? phase : "focus"
}

function appOf(session: StudySession): StudySessionCommand["app"] {
  return session.createdVia === "examtrack" ? "examtrack" : session.integrations?.folio ? "folio" : "focal"
}

function kindOf(session: StudySession): StudySessionCommand["kind"] {
  const kind = session.integrations?.examtrack?.kind ?? (session.integrations?.folio?.kind === "exam" ? "exam" : "focus")
  return kind === "exam" || kind === "sac" ? kind : "focus"
}

/** Everything the client owns, minus the fields the server derives from the commands. */
function sessionMetadata(session: StudySession): () => Record<string, unknown> {
  const raw = JSON.parse(JSON.stringify(session)) as Record<string, unknown>
  for (const field of ["execution", "status", "deleted_at", "activeDurations", "activeMillis", "startedAt",
    "pausedAt", "completedAt", "revision", "last_modified_device_id", "id"]) delete raw[field]
  return () => raw
}
