type StudySessionKind = "focus" | "exam" | "sac"
type StudySessionPhase = "focus" | "reading" | "writing"
// ponytail: "examtrack" is the historical app id for Focal Web. It is frozen: Folio and the
// web build send it, and Postgres rows already store it.
type StudySessionApp = "focal" | "examtrack" | "folio"
export type StudySessionAction =
  | "log" | "create" | "start" | "pause" | "resume" | "phase_change"
  | "save_progress" | "complete" | "cancel"

interface StudySessionSegment {
  id: string
  session_id: string
  started_at: string
  ended_at: string | null
  phase: StudySessionPhase | null
  source_device_id: string | null
}

export interface CanonicalStudySession {
  id: string
  kind: StudySessionKind
  /** The study happened. The only lifecycle fact besides `cancelled_at` (deleted); everything else is derived. */
  completed: boolean
  phase: StudySessionPhase | null
  revision: number
  title: string
  subject_id: string | null
  originating_app: StudySessionApp
  created_at: string
  updated_at: string
  started_at: string | null
  paused_at: string | null
  completed_at: string | null
  cancelled_at: string | null
  accumulated_active_ms: number
  segment_started_at: string | null
  timing_at?: string | null
  metadata: Record<string, unknown>
  segments: StudySessionSegment[]
}

export interface StudySessionCommand {
  mutation_id: string
  session_id: string
  expected_revision: number
  action: StudySessionAction
  device_id: string
  app: StudySessionApp
  kind?: StudySessionKind
  phase?: StudySessionPhase
  title?: string
  subject_id?: string | null
  metadata?: Record<string, unknown>
  /** Explicit time blocks, accepted by log, create and save_progress. They replace the session's blocks and are refused while it is running. */
  blocks?: { start: string; end: string }[]
  /** save_progress only: mark the session done or not done. Done blocks must already have finished. */
  completed?: boolean
  /** Server-clock estimate captured from a server anchor and monotonic time, never Date.now(). */
  occurred_at?: string | null
  /** Monotonic milliseconds since this session's previous lifecycle boundary. */
  elapsed_since_previous_ms?: number
}

export type StudySessionEdit = Pick<StudySessionCommand, "title" | "subject_id" | "metadata" | "blocks" | "completed">

export interface StudySessionMutationResult {
  ok: boolean
  applied: boolean
  reason: string | null
  server_now: string
  change_seq?: number
  session: CanonicalStudySession | null
}

const SESSION_KINDS = new Set<unknown>(["focus", "exam", "sac"])
const SESSION_PHASES = new Set<unknown>(["focus", "reading", "writing"])
const SESSION_APPS = new Set<unknown>(["focal", "examtrack", "folio"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string"
}

export function parseCanonicalStudySession(value: unknown): CanonicalStudySession | null {
  if (!isRecord(value)) return null
  if (
    typeof value.id !== "string" || !SESSION_KINDS.has(value.kind) || typeof value.completed !== "boolean" ||
    !(value.phase === null || SESSION_PHASES.has(value.phase)) ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
    typeof value.title !== "string" || !nullableString(value.subject_id) || !SESSION_APPS.has(value.originating_app) ||
    typeof value.created_at !== "string" || typeof value.updated_at !== "string" || !nullableString(value.started_at) || !nullableString(value.paused_at) ||
    !nullableString(value.completed_at) || !nullableString(value.cancelled_at) ||
    !Number.isSafeInteger(value.accumulated_active_ms) || (value.accumulated_active_ms as number) < 0 ||
    !nullableString(value.segment_started_at) || !isRecord(value.metadata) || !Array.isArray(value.segments) ||
    (value.segment_started_at !== null && value.started_at === null) ||
    (value.completed === true && value.completed_at === null)
  ) return null

  const segments: StudySessionSegment[] = []
  for (const raw of value.segments) {
    if (!isRecord(raw) || typeof raw.id !== "string" || typeof raw.session_id !== "string" ||
        typeof raw.started_at !== "string" || !nullableString(raw.ended_at) ||
        !(raw.phase === null || SESSION_PHASES.has(raw.phase)) || !nullableString(raw.source_device_id)) return null
    const startedAt = Date.parse(raw.started_at)
    const endedAt = raw.ended_at === null ? null : Date.parse(raw.ended_at)
    if (!Number.isFinite(startedAt) || (endedAt !== null && (!Number.isFinite(endedAt) || endedAt <= startedAt))) return null
    segments.push({
      id: raw.id,
      session_id: raw.session_id,
      started_at: raw.started_at,
      ended_at: raw.ended_at,
      phase: raw.phase as StudySessionPhase | null,
      source_device_id: raw.source_device_id,
    })
  }

  return {
    id: value.id,
    kind: value.kind as StudySessionKind,
    completed: value.completed,
    phase: value.phase as StudySessionPhase | null,
    revision: value.revision as number,
    title: value.title,
    subject_id: value.subject_id,
    originating_app: value.originating_app as StudySessionApp,
    created_at: value.created_at,
    updated_at: value.updated_at,
    started_at: value.started_at,
    paused_at: value.paused_at,
    completed_at: value.completed_at,
    cancelled_at: value.cancelled_at,
    accumulated_active_ms: value.accumulated_active_ms as number,
    segment_started_at: value.segment_started_at,
    ...(nullableString(value.timing_at) ? { timing_at: value.timing_at } : {}),
    metadata: value.metadata,
    segments,
  }
}

/** A timer is running while it has an open interval. */
export const isRunning = (session: CanonicalStudySession) => session.segment_started_at !== null && session.cancelled_at === null
/** Paused: started, stopped, and not finished. */
export const isPaused = (session: CanonicalStudySession) =>
  session.segment_started_at === null && session.paused_at !== null && !session.completed && session.cancelled_at === null
/** Scheduled study has not started; its segments describe planned time, never worked time. */
export const isPlanned = (session: CanonicalStudySession) =>
  !session.completed && session.cancelled_at === null && session.started_at === null &&
  session.segment_started_at === null && session.paused_at === null

/** Finished focus study that was actually timed can be continued: `resume` reopens it with its earlier time kept. */
export const canContinue = (session: CanonicalStudySession) =>
  session.kind === "focus" && session.completed && session.cancelled_at === null &&
  session.segment_started_at === null && session.started_at !== null && session.completed_at !== null

/** Deleted sessions are kept as tombstones so every device learns of the removal. */
export const isDeleted = (session: CanonicalStudySession) => session.cancelled_at !== null

/** The subject studied from `at` until the next switch. Saved in order as `metadata.subjectSwitches`. */
export interface SubjectSwitch { at: string; subjectId: string }

/** A session studies one subject at a time; switching subject mid-session is recorded here, and `subject_id` is always the
 *  latest subject. A list whose last subject is not `subject_id` was overruled by a client that only edits `subject_id`. */
export function studySessionSwitches(session: Pick<CanonicalStudySession, "subject_id" | "metadata">): SubjectSwitch[] {
  const legacy = isRecord(session.metadata.legacy_metadata) ? session.metadata.legacy_metadata : {}
  const raw = session.metadata.subjectSwitches ?? legacy.subjectSwitches
  const switches = (Array.isArray(raw) ? raw : []).flatMap((item) =>
    isRecord(item) && typeof item.at === "string" && Number.isFinite(Date.parse(item.at)) && typeof item.subjectId === "string" && item.subjectId.trim()
      ? [{ at: item.at, subjectId: item.subjectId }] : []).toSorted((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return session.subject_id && switches.at(-1)?.subjectId === session.subject_id ? switches : []
}

/** Cuts blocks where the subject switched, so every piece has one subject. Time before the first switch takes its subject. */
export function studySessionSubjectSpans<T extends { start: string; end: string }>(
  session: Pick<CanonicalStudySession, "subject_id" | "metadata">, blocks: readonly T[],
): Array<T & { subjectId: string | null }> {
  const switches = studySessionSwitches(session)
  if (!switches.length) return blocks.map((block) => ({ ...block, subjectId: session.subject_id }))
  const subjectAt = (ms: number) => (switches.findLast((item) => Date.parse(item.at) <= ms) ?? switches[0]).subjectId
  return blocks.flatMap((block) => {
    const start = Date.parse(block.start), end = Date.parse(block.end)
    const points = [block.start, ...switches.map((item) => item.at).filter((at) => Date.parse(at) > start && Date.parse(at) < end), block.end]
    const pieces: Array<T & { subjectId: string | null }> = []
    for (let index = 1; index < points.length; index++) {
      const subjectId = subjectAt(Date.parse(points[index - 1]))
      const last = pieces.at(-1)
      if (last?.subjectId === subjectId) last.end = points[index]
      else pieces.push({ ...block, start: points[index - 1], end: points[index], subjectId })
    }
    return pieces
  })
}

/** Every subject a session's blocks cover, in the order they were studied. */
export function studySessionSubjects(session: Pick<CanonicalStudySession, "subject_id" | "metadata" | "segments">): string[] {
  const blocks = session.segments.map((segment) => ({ start: segment.started_at,
    end: segment.ended_at ?? new Date(Math.max(Date.now(), Date.parse(segment.started_at))).toISOString() }))
  const ids = studySessionSubjectSpans(session, blocks).flatMap((piece) => piece.subjectId ? [piece.subjectId] : [])
  return [...new Set(ids.length ? ids : session.subject_id ? [session.subject_id] : [])]
}

/** Records a switch to `subjectId` at `at`. A change within a minute of the last one corrects it rather than ending it. */
export function withSubjectSwitch(switches: readonly SubjectSwitch[], at: string, subjectId: string): SubjectSwitch[] {
  const last = switches.at(-1)
  const kept = last && Date.parse(at) - Date.parse(last.at) < 60_000 ? switches.slice(0, -1) : [...switches]
  return kept.at(-1)?.subjectId === subjectId ? kept : [...kept, { at, subjectId }]
}

/** Original intent survives replacing a plan's segments with actual timer intervals. */
export function studySessionPlan(session: CanonicalStudySession) {
  const legacy = isRecord(session.metadata.legacy_metadata) ? session.metadata.legacy_metadata : {}
  const metadata = { ...legacy, ...session.metadata }
  const schedule = isRecord(metadata.schedule) && Array.isArray(metadata.schedule.blocks) ? metadata.schedule.blocks : []
  const candidates = isPlanned(session) && session.segments.length
    ? session.segments.map((segment) => ({ start: segment.started_at, end: segment.ended_at })) : schedule
  const blocks = candidates.flatMap((block) => {
    if (!isRecord(block) || typeof block.start !== "string" || typeof block.end !== "string") return []
    const start = Date.parse(block.start), end = Date.parse(block.end)
    return Number.isFinite(start) && Number.isFinite(end) && end > start && end - start <= 86_400_000
      ? [{ start: block.start, end: block.end }] : []
  }).toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))
  return { blocks, milliseconds: blocks.reduce((sum, block) => sum + Date.parse(block.end) - Date.parse(block.start), 0),
    description: typeof metadata.description === "string" ? metadata.description : "",
    topics: Array.isArray(metadata.topics) ? [...new Set(metadata.topics.filter((topic): topic is string => typeof topic === "string" && !!topic.trim()))] : [] }
}

/** Uses only a server timestamp and a monotonic clock; system wall-clock skew is irrelevant. */
export interface ServerClockAnchor {
  serverNowMs: number
  monotonicNowMs: number
}

export function observeServerClock(serverNow: string, monotonicNowMs: number): ServerClockAnchor | null {
  const serverNowMs = Date.parse(serverNow)
  return Number.isFinite(serverNowMs) && Number.isFinite(monotonicNowMs)
    ? { serverNowMs, monotonicNowMs }
    : null
}

export function estimateServerNow(anchor: ServerClockAnchor, monotonicNowMs: number): number {
  return anchor.serverNowMs + Math.max(0, monotonicNowMs - anchor.monotonicNowMs)
}

export function studySessionActiveMilliseconds(session: CanonicalStudySession, estimatedServerNowMs: number): number {
  const currentSegmentMs = session.segment_started_at
    ? Math.max(0, estimatedServerNowMs - Date.parse(session.segment_started_at))
    : 0
  return session.accumulated_active_ms + (Number.isFinite(currentSegmentMs) ? currentSegmentMs : 0)
}

export function parseStudySessionMutationResult(value: unknown): StudySessionMutationResult | null {
  if (!isRecord(value) || typeof value.ok !== "boolean" || typeof value.applied !== "boolean" ||
      typeof value.server_now !== "string") return null
  const session = value.session === null ? null : parseCanonicalStudySession(value.session)
  if (value.session !== null && session === null) return null
  return {
    ok: value.ok,
    applied: value.applied,
    reason: typeof value.reason === "string" || value.reason === null ? value.reason : null,
    server_now: value.server_now,
    ...(Number.isSafeInteger(value.change_seq) ? { change_seq: value.change_seq as number } : {}),
    session,
  }
}
