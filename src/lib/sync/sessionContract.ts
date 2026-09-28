export type StudySessionKind = "focus" | "exam" | "sac"
export type StudySessionState = "planned" | "running" | "paused" | "completed" | "cancelled"
export type StudySessionPhase = "focus" | "reading" | "writing"
export type StudySessionApp = "focal" | "examtrack" | "folio"
export type StudySessionAction =
  | "create" | "start" | "pause" | "resume" | "phase_change"
  | "save_progress" | "complete" | "cancel"

export interface StudySessionSegment {
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
  state: StudySessionState
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
  /** Server-clock estimate captured from a server anchor and monotonic time, never Date.now(). */
  occurred_at?: string | null
  /** Monotonic milliseconds since this session's previous lifecycle boundary. */
  elapsed_since_previous_ms?: number
}

export type StudySessionMutationReason =
  | "stale_revision" | "session_terminal" | "invalid_transition" | "not_found"
  | "active_session_exists" | "already_exists" | "already_running" | "already_paused"
  | "already_completed" | "already_cancelled" | null

export interface StudySessionMutationResult {
  ok: boolean
  applied: boolean
  reason: string | null
  server_now: string
  change_seq?: number
  session: CanonicalStudySession | null
}

const SESSION_KINDS = new Set<unknown>(["focus", "exam", "sac"])
const SESSION_STATES = new Set<unknown>(["planned", "running", "paused", "completed", "cancelled"])
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
    typeof value.id !== "string" || !SESSION_KINDS.has(value.kind) || !SESSION_STATES.has(value.state) ||
    !(value.phase === null || SESSION_PHASES.has(value.phase)) ||
    !Number.isSafeInteger(value.revision) || (value.revision as number) < 1 ||
    typeof value.title !== "string" || !nullableString(value.subject_id) || !SESSION_APPS.has(value.originating_app) ||
    typeof value.created_at !== "string" || typeof value.updated_at !== "string" || !nullableString(value.started_at) || !nullableString(value.paused_at) ||
    !nullableString(value.completed_at) || !nullableString(value.cancelled_at) ||
    !Number.isSafeInteger(value.accumulated_active_ms) || (value.accumulated_active_ms as number) < 0 ||
    !nullableString(value.segment_started_at) || !isRecord(value.metadata) || !Array.isArray(value.segments) ||
    (value.state === "running" && (value.started_at === null || value.segment_started_at === null)) ||
    (value.state === "paused" && (value.started_at === null || value.segment_started_at !== null)) ||
    (value.state === "completed" && value.completed_at === null) ||
    (value.state === "cancelled" && value.cancelled_at === null)
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
    state: value.state as StudySessionState,
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
  const currentSegmentMs = session.state === "running" && session.segment_started_at
    ? Math.max(0, estimatedServerNowMs - Date.parse(session.segment_started_at))
    : 0
  return session.accumulated_active_ms + (Number.isFinite(currentSegmentMs) ? currentSegmentMs : 0)
}

export function isStudySessionCommand(value: unknown): value is StudySessionCommand {
  if (!isRecord(value)) return false
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return typeof value.mutation_id === "string" && uuid.test(value.mutation_id) &&
    typeof value.session_id === "string" && value.session_id.length > 0 && value.session_id.length <= 160 &&
    Number.isSafeInteger(value.expected_revision) && (value.expected_revision as number) >= 0 &&
    typeof value.device_id === "string" && uuid.test(value.device_id) && SESSION_APPS.has(value.app) &&
    ["create", "start", "pause", "resume", "phase_change", "save_progress", "complete", "cancel"].includes(String(value.action)) &&
    (value.kind === undefined || SESSION_KINDS.has(value.kind)) &&
    (value.phase === undefined || SESSION_PHASES.has(value.phase)) &&
    (value.title === undefined || typeof value.title === "string" && value.title.length <= 512) &&
    (value.subject_id === undefined || value.subject_id === null || typeof value.subject_id === "string") &&
    (value.metadata === undefined || isRecord(value.metadata)) &&
    (value.occurred_at === undefined || value.occurred_at === null || typeof value.occurred_at === "string" && Number.isFinite(Date.parse(value.occurred_at))) &&
    (value.elapsed_since_previous_ms === undefined || Number.isSafeInteger(value.elapsed_since_previous_ms) && (value.elapsed_since_previous_ms as number) >= 0 && (value.elapsed_since_previous_ms as number) <= 604_800_000)
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
