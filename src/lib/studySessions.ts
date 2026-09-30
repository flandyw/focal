import type {
  ConfidenceScore,
  ExamTrackSource,
  FolioSource,
  NotionSource,
  NotionSyncSnapshot,
  StudyInterval,
  StudySession,
  StudySessionExecution,
  StudySessionDraft,
  StudyTimeRange,
} from "@/lib/types"
import { VCE_SUBJECTS } from "@/lib/types"
import { studySubjectId } from "@/lib/studySubjects"
import { parseCanonicalStudySession } from "@/lib/sync/sessionContract"

export const STUDY_SESSION_SCHEMA_VERSION = 2 as const

export interface CreateStudySessionInput {
  projectId?: string
  subjectIds: string[]
  title: string
  description?: string
  topics?: string[]
  schedule: { blocks: StudyTimeRange[] }
  execution?: StudySessionExecution
  reflection?: StudySession["reflection"]
  createdVia?: StudySession["createdVia"]
  integrations?: StudySession["integrations"]
}

export interface StartPlannedStudySessionInput {
  startedAt: string
  cycleNumber: number
  subjectIds?: string[]
  projectId?: string
  intent?: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []
}

function confidenceScore(value: unknown): ConfidenceScore | undefined {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5 ? value : undefined
}

function timeRanges(value: unknown): StudyTimeRange[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.start !== "string" || typeof item.end !== "string") return []
    const start = new Date(item.start).getTime()
    const end = new Date(item.end).getTime()
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return []
    return [{ start: item.start, end: item.end }]
  })
}

function intervals(value: unknown, fallbackSource: StudyInterval["source"] = "imported"): StudyInterval[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!isRecord(item) || typeof item.start !== "string") return []
    const start = new Date(item.start).getTime()
    if (!Number.isFinite(start)) return []
    const rawEnd = optionalString(item.end)
    // A closed zero-length/corrupt interval must never become a running timer.
    if (rawEnd && (!Number.isFinite(new Date(rawEnd).getTime()) || new Date(rawEnd).getTime() < start)) return []
    const end = rawEnd
    const source = item.source === "manual" || item.source === "pomodoro" || item.source === "imported"
      ? item.source
      : fallbackSource
    return [{
      start: item.start,
      end,
      source,
      ...(typeof item.cycleNumber === "number" ? { cycleNumber: item.cycleNumber } : {}),
    }]
  })
}

function collectStudyTimeRanges(ranges: readonly StudyTimeRange[]): StudyTimeRange[] {
  const seen = new Set<string>()
  return ranges
    .filter((range) => {
      const start = new Date(range.start).getTime()
      const end = new Date(range.end).getTime()
      return Number.isFinite(start) && Number.isFinite(end) && end > start
    })
    .map((range) => ({ ...range }))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .filter((range) => {
      const key = `${new Date(range.start).getTime()}:${new Date(range.end).getTime()}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function collectStudyIntervals(items: readonly StudyInterval[]): StudyInterval[] {
  const seen = new Set<string>()
  return items
    .filter((interval) => Number.isFinite(new Date(interval.start).getTime()))
    .map((interval) => ({ ...interval }))
    .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime())
    .filter((interval) => {
      const key = `${new Date(interval.start).getTime()}:${interval.end ? new Date(interval.end).getTime() : "open"}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function latestValidTimestamp(values: readonly (string | undefined)[], fallback: string): string {
  let latest = fallback
  for (const value of values) {
    if (value && Number.isFinite(new Date(value).getTime()) && new Date(value).getTime() > new Date(latest).getTime()) {
      latest = value
    }
  }
  return latest
}

function validRange(start: string, end: string): StudyTimeRange {
  const startMs = new Date(start).getTime()
  const endMs = new Date(end).getTime()
  if (Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs) return { start, end }
  const safeStart = Number.isFinite(startMs) ? start : new Date().toISOString()
  return { start: safeStart, end: new Date(new Date(safeStart).getTime() + 60 * 60 * 1000).toISOString() }
}

function parseNotionSource(value: unknown): NotionSource | undefined {
  if (!isRecord(value) || value.type !== "notion" || typeof value.id !== "string") return undefined
  const snapshotEntries = isRecord(value.syncSnapshot) ? Object.entries(value.syncSnapshot) : []
  const syncSnapshot = snapshotEntries.length > 0 && snapshotEntries.every(
    ([, item]) => item === null || typeof item === "string" || typeof item === "boolean",
  )
    ? Object.fromEntries(snapshotEntries) as NotionSyncSnapshot
    : undefined
  return {
    type: "notion",
    id: value.id,
    url: optionalString(value.url),
    lastEditedTime: optionalString(value.lastEditedTime),
    kind: value.kind === "event" || value.kind === "session" ? value.kind : undefined,
    bodyHash: optionalString(value.bodyHash),
    syncSnapshot,
  }
}

function parseExamTrackSource(value: unknown): ExamTrackSource | undefined {
  if (
    !isRecord(value) || value.type !== "examtrack" || typeof value.id !== "string" ||
    (value.kind !== "exam" && value.kind !== "sac" && value.kind !== "focus") || typeof value.subject !== "string"
  ) return undefined
  return {
    type: "examtrack", id: value.id, kind: value.kind, subject: value.subject,
    phase: value.phase === "reading" || value.phase === "writing" || value.phase === "paused" ? value.phase : undefined,
    phaseBeforePause: value.phaseBeforePause === "reading" || value.phaseBeforePause === "writing" ? value.phaseBeforePause : undefined,
  }
}

function parseFolioSource(value: unknown): FolioSource | undefined {
  if (!isRecord(value) || value.type !== "folio" || typeof value.id !== "string" ||
    (value.kind !== "study" && value.kind !== "exam")) return undefined
  return {
    type: "folio", id: value.id, kind: value.kind, subject: optionalString(value.subject),
    phase: value.phase === "reading" || value.phase === "writing" || value.phase === "paused" ? value.phase : undefined,
    phaseBeforePause: value.phaseBeforePause === "reading" || value.phaseBeforePause === "writing" ? value.phaseBeforePause : undefined,
  }
}

function examTrackSubjectId(source?: ExamTrackSource): string | undefined {
  if (!source) return undefined
  // ponytail: Built-in VCE subjects share stable names; custom cross-app subjects
  // stay unassigned until both apps persist a shared subject id.
  const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "")
  const target = normalise(source.subject)
  return VCE_SUBJECTS.find((subject) =>
    normalise(subject.name) === target || normalise(subject.shortCode) === target
  )?.id
}

function inferCreatedVia(raw: Record<string, unknown>, notion?: NotionSource): StudySession["createdVia"] {
  if (raw.createdVia === "manual" || raw.createdVia === "planner" || raw.createdVia === "assistant" || raw.createdVia === "notion" || raw.createdVia === "examtrack") {
    return raw.createdVia
  }
  if (notion) return "notion"
  return "manual"
}

export function normalizeStudySession(raw: unknown): StudySession {
  const value = isRecord(raw) ? raw : {}
  const now = new Date().toISOString()
  const fallbackStart = optionalString(value.startTime) ?? now
  const fallbackStartMs = new Date(fallbackStart).getTime()
  const fallbackEnd = optionalString(value.endTime) ?? new Date(
    (Number.isFinite(fallbackStartMs) ? fallbackStartMs : new Date(now).getTime()) + 60 * 60 * 1000,
  ).toISOString()
  const legacyRanges = timeRanges(value.activeDurations)
  const scheduleValue = isRecord(value.schedule) ? value.schedule : undefined
  const scheduleBlocks = timeRanges(scheduleValue?.blocks)
  const schedule = {
    blocks: scheduleBlocks.length > 0
      ? scheduleBlocks
      : value.status === "planned" && legacyRanges.length > 0
        ? legacyRanges
        : [validRange(fallbackStart, fallbackEnd)],
  }

  const executionValue = isRecord(value.execution) ? value.execution : undefined
  const legacyPomodoro = stringValue(value.description).startsWith("Pomodoro —") || stringValue(value.notes).startsWith("Timer:")
  const state = executionValue?.state === "in-progress" || executionValue?.state === "completed" || executionValue?.state === "planned"
    ? executionValue.state
    : value.status === "in-progress" || value.status === "completed"
      ? value.status
      : "planned"
  const actualIntervals = intervals(
    executionValue?.intervals ?? (state === "planned" ? [] : legacyRanges),
    legacyPomodoro ? "pomodoro" : "imported",
  )
  const completedAt = optionalString(executionValue?.completedAt) ?? optionalString(value.completedAt)
  const execution: StudySessionExecution = state === "completed"
    ? {
        state,
        intervals: executionValue || actualIntervals.length > 0
          ? actualIntervals
          : [{ ...validRange(fallbackStart, fallbackEnd), source: legacyPomodoro ? "pomodoro" : "imported" }],
        completedAt: completedAt ?? schedule.blocks[schedule.blocks.length - 1].end,
        ...(typeof executionValue?.reportedMinutes === "number" ? { reportedMinutes: executionValue.reportedMinutes } : {}),
      }
    : state === "in-progress"
      ? { state, intervals: actualIntervals }
      : { state, intervals: [] }

  const reflectionValue = isRecord(value.reflection) ? value.reflection : undefined
  const reflection = {
    notes: optionalString(reflectionValue?.notes) ?? optionalString(value.notes),
    confidence: confidenceScore(reflectionValue?.confidence ?? value.confidence),
    blockers: optionalString(reflectionValue?.blockers) ?? optionalString(value.blockers),
    nextAction: optionalString(reflectionValue?.nextAction) ?? optionalString(value.nextAction),
  }
  const hasReflection = Object.values(reflection).some((item) => item !== undefined)
  const integrationsValue = isRecord(value.integrations) ? value.integrations : undefined
  const notion = parseNotionSource(integrationsValue?.notion ?? value.source)
  const examtrack = parseExamTrackSource(integrationsValue?.examtrack)
  const folio = parseFolioSource(integrationsValue?.folio)
  // Older web sessions (including cached rows) used display names instead of stable IDs.
  const rawSubjectIds = [...new Set(stringArray(value.subjectIds).map((id) => studySubjectId(id)))]
  const integratedSubjectId = rawSubjectIds.length === 0 ? examTrackSubjectId(examtrack) : undefined

  return {
    schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
    id: optionalString(value.id) ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    revision: Number.isSafeInteger(value.revision) && (value.revision as number) >= 0 ? value.revision as number : undefined,
    projectId: optionalString(value.projectId),
    subjectIds: integratedSubjectId ? [integratedSubjectId] : rawSubjectIds,
    title: optionalString(value.title) ?? "Study Session",
    description: optionalString(value.description),
    topics: stringArray(value.topics),
    schedule,
    execution,
    reflection: hasReflection ? reflection : undefined,
    createdVia: inferCreatedVia(value, notion),
    integrations: notion || examtrack || folio ? { notion, examtrack, folio } : undefined,
    created_at: optionalString(value.created_at) ?? now,
    updated_at: optionalString(value.updated_at) ?? now,
    deleted_at: typeof value.deleted_at === "string" || value.deleted_at === null ? value.deleted_at : null,
    last_modified_device_id: typeof value.last_modified_device_id === "string" || value.last_modified_device_id === null
      ? value.last_modified_device_id
      : null,
  }
}

/** Projects the server row into Focal's existing planner/history shape. */
export function studySessionFromCanonical(value: unknown): StudySession | null {
  const session = parseCanonicalStudySession(value)
  if (!session) return null
  const nested = isRecord(session.metadata.legacy_metadata) ? session.metadata.legacy_metadata : session.metadata
  const legacy = isRecord(nested) ? nested : {}
  const legacyIntegrations = isRecord(legacy.integrations) ? legacy.integrations : {}
  const subjectIds = stringArray(legacy.subjectIds)
  if (session.subject_id && subjectIds.length === 0) subjectIds.push(session.subject_id)
  const scheduleValue = isRecord(legacy.schedule) ? legacy.schedule : undefined
  const scheduleBlocks = timeRanges(scheduleValue?.blocks)
  const start = session.started_at ?? session.created_at
  const schedule = scheduleBlocks.length > 0
    ? { blocks: scheduleBlocks }
    : { blocks: [validRange(start, new Date(new Date(start).getTime() + 60 * 60 * 1000).toISOString())] }
  const intervals = session.segments.map((segment) => ({
    start: segment.started_at,
    ...(segment.ended_at ? { end: segment.ended_at } : {}),
    source: "imported" as const,
  }))
  const cancelled = session.state === "cancelled"
  const execution: StudySessionExecution = session.state === "planned" || cancelled
    ? { state: "planned", intervals: [] }
    : session.state === "completed"
      ? { state: "completed", intervals, completedAt: session.completed_at ?? session.updated_at ?? session.created_at }
      : { state: "in-progress", intervals }
  const integrations: Record<string, unknown> = { ...legacyIntegrations }
  if (session.originating_app === "examtrack") {
    // kind "focus" is the web study timer: same shared-timer slot as exam and SAC.
    integrations.examtrack = {
      ...(isRecord(legacyIntegrations.examtrack) ? legacyIntegrations.examtrack : {}),
      type: "examtrack", id: session.id, kind: session.kind, subject: session.subject_id ?? (session.kind === "focus" ? "Study" : "Exam"),
      ...(session.phase ? { phase: session.phase } : {}),
    }
  } else if (session.originating_app === "folio") {
    integrations.folio = {
      ...(isRecord(legacyIntegrations.folio) ? legacyIntegrations.folio : {}),
      type: "folio", id: session.id, kind: session.kind === "exam" || session.kind === "sac" ? "exam" : "study",
      subject: session.subject_id, ...(session.phase ? { phase: session.phase } : {}),
    }
  }
  return normalizeStudySession({
    ...legacy,
    id: session.id,
    revision: session.revision,
    subjectIds,
    title: session.title,
    schedule,
    execution,
    integrations,
    createdVia: session.originating_app === "examtrack" ? "examtrack" : legacy.createdVia,
    created_at: session.created_at,
    updated_at: session.updated_at ?? session.created_at,
    deleted_at: cancelled ? session.cancelled_at ?? session.updated_at ?? session.created_at : null,
  })
}

export function createStudySession(id: string, input: CreateStudySessionInput, now = new Date().toISOString()): StudySession {
  return normalizeStudySession({
    schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
    id,
    projectId: input.projectId,
    subjectIds: input.subjectIds,
    title: input.title,
    description: input.description,
    topics: input.topics,
    schedule: input.schedule,
    execution: input.execution ?? { state: "planned", intervals: [] },
    reflection: input.reflection,
    createdVia: input.createdVia ?? "manual",
    integrations: input.integrations,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  })
}

export function mergeStudySessionTimelines(sessions: readonly StudySession[]): {
  schedule: StudySession["schedule"]
  execution: StudySessionExecution
} {
  if (sessions.length < 2) throw new Error("At least two study sessions are required")

  const blocks = collectStudyTimeRanges(sessions.flatMap((session) => session.schedule.blocks))
  if (blocks.length === 0) throw new Error("Study sessions do not contain valid schedule blocks")

  const intervals = collectStudyIntervals(sessions.flatMap((session) => (
    session.execution.state === "planned" ? [] : session.execution.intervals
  )))
  if (sessions.every((session) => session.execution.state === "planned")) {
    return { schedule: { blocks }, execution: { state: "planned", intervals: [] } }
  }
  if (!sessions.every((session) => session.execution.state === "completed")) {
    return { schedule: { blocks }, execution: { state: "in-progress", intervals } }
  }

  const fallbackCompletedAt = [...intervals].reverse().find((interval) => interval.end)?.end
    ?? blocks[blocks.length - 1].end
  return {
    schedule: { blocks },
    execution: {
      state: "completed",
      intervals,
      completedAt: latestValidTimestamp(
        sessions.map((session) => session.execution.state === "completed" ? session.execution.completedAt : undefined),
        fallbackCompletedAt,
      ),
    },
  }
}

export function mergedStudySessionTitle(sessions: readonly StudySession[]): string {
  if (sessions.length < 2) throw new Error("At least two study sessions are required")

  const titles = [...new Set(sessions.map((session) => session.title.trim()).filter(Boolean))]
  if (titles.length === 0) return "Study Session"
  if (titles.length === 1) return titles[0]
  if (titles.length === 2) return `${titles[0]} / ${titles[1]}`
  return `${titles[0]} + ${titles.length - 1} more`
}

export function updateStudySession(session: StudySession, patch: Partial<Omit<StudySession, "id" | "created_at">>, now = new Date().toISOString()): StudySession {
  return normalizeStudySession({
    ...session, ...patch,
    reflection: { ...session.reflection, ...patch.reflection },
    updated_at: now,
  })
}

/** Form DTO boundary. Draft blocks are planned time unless completion is explicit. */
export function studySessionDraftInput(draft: StudySessionDraft): CreateStudySessionInput {
  const blocks = draft.activeDurations?.length ? draft.activeDurations : [{ start: draft.startTime, end: draft.endTime }]
  const state = draft.status ?? "planned"
  return {
    projectId: draft.projectId, subjectIds: draft.subjectIds, title: draft.title,
    description: draft.description, topics: draft.topics, schedule: { blocks },
    execution: state === "planned" ? { state, intervals: [] } : state === "completed"
      ? { state, intervals: blocks.map((block) => ({ ...block, source: "manual" })), completedAt: draft.completedAt ?? new Date().toISOString() }
      : { state, intervals: blocks.map((block) => ({ ...block, source: "manual" })) },
    reflection: { notes: draft.notes, confidence: draft.confidence, blockers: draft.blockers, nextAction: draft.nextAction },
    integrations: draft.source ? { notion: draft.source } : undefined,
  }
}

/** Notion/form partial DTO boundary; timer mutations never pass through this adapter. */
export function studySessionDraftPatch(session: StudySession, draft: Partial<StudySessionDraft>): Partial<StudySession> {
  const { startTime, endTime, status, activeDurations, completedAt, source, notes, confidence, blockers, nextAction, ...fields } = draft
  const blocks = activeDurations?.length && (status ?? session.execution.state) === "planned"
    ? activeDurations : session.schedule.blocks.map((block, index, all) => ({
      start: index === 0 ? startTime ?? block.start : block.start,
      end: index === all.length - 1 ? endTime ?? block.end : block.end,
    }))
  const state = status ?? session.execution.state
  const actual = activeDurations?.map((block) => ({ ...block, source: "manual" as const })) ?? session.execution.intervals
  const execution: StudySessionExecution = state === "planned" ? { state, intervals: [] }
    : state === "completed" ? { state, intervals: actual.length ? actual : blocks.map((block) => ({ ...block, source: "manual" })),
      completedAt: completedAt ?? (session.execution.state === "completed" ? session.execution.completedAt : new Date().toISOString()) }
      : { state, intervals: actual }
  const reflection = { ...("notes" in draft ? { notes } : {}), ...("confidence" in draft ? { confidence } : {}), ...("blockers" in draft ? { blockers } : {}), ...("nextAction" in draft ? { nextAction } : {}) }
  return {
    ...fields,
    ...(startTime || endTime || activeDurations && state === "planned" ? { schedule: { blocks } } : {}),
    ...(status !== undefined || activeDurations && state !== "planned" ? { execution } : {}),
    ...(Object.keys(reflection).length ? { reflection } : {}),
    ...(source ? { integrations: { ...session.integrations, notion: source } } : {}),
  }
}

export function startPlannedStudySession(
  session: StudySession,
  input: StartPlannedStudySessionInput,
): StudySession {
  if (session.execution.state !== "planned") {
    throw new Error("Only planned study sessions can be started")
  }

  const intent = input.intent?.trim();
  return updateStudySession(session, {
    projectId: input.projectId ?? session.projectId,
    subjectIds: input.subjectIds?.length ? input.subjectIds : session.subjectIds,
    title: intent && intent.length > 0 ? intent : session.title,
    execution: {
      state: "in-progress",
      intervals: [{
        start: input.startedAt,
        source: "pomodoro",
        cycleNumber: input.cycleNumber,
      }],
    },
  }, input.startedAt)
}

export function studySessionPayload(session: StudySession): Record<string, unknown> {
  return { ...normalizeStudySession(session) }
}
