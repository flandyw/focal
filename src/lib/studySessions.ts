import type {
  ConfidenceScore,
  ExamTrackSource,
  NotionSource,
  NotionSyncSnapshot,
  StudyInterval,
  StudySession,
  StudySessionExecution,
  StudySessionStatus,
  StudyTimeRange,
} from "@/lib/types"
import { VCE_SUBJECTS } from "@/lib/types"

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

type LegacyStudySessionPatch = Partial<Omit<StudySession, "id" | "created_at">> & {
  startTime?: string
  endTime?: string
  status?: StudySessionStatus
  notes?: string
  confidence?: ConfidenceScore
  blockers?: string
  nextAction?: string
  activeDurations?: StudyTimeRange[]
  completedAt?: string
  source?: NotionSource
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
    const end = rawEnd && Number.isFinite(new Date(rawEnd).getTime()) && new Date(rawEnd).getTime() > start
      ? rawEnd
      : undefined
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

function statusFor(execution: StudySessionExecution): StudySessionStatus {
  return execution.state
}

function legacyActiveDurations(session: StudySession): StudyTimeRange[] | undefined {
  if (session.execution.state === "planned") return session.schedule.blocks
  const closed = session.execution.intervals.flatMap((interval) => interval.end
    ? [{ start: interval.start, end: interval.end }]
    : [])
  return closed.length > 0 ? closed : undefined
}

function canonicalSession(session: StudySession): Record<string, unknown> {
  return {
    schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
    id: session.id,
    projectId: session.projectId,
    subjectIds: session.subjectIds,
    title: session.title,
    description: session.description,
    topics: session.topics,
    schedule: session.schedule,
    execution: session.execution,
    reflection: session.reflection,
    createdVia: session.createdVia,
    integrations: session.integrations,
    created_at: session.created_at,
    updated_at: session.updated_at,
    deleted_at: session.deleted_at,
    last_modified_device_id: session.last_modified_device_id,
  }
}

function attachCompatibilityView(session: StudySession): StudySession {
  const firstBlock = () => session.schedule.blocks[0]
  const lastBlock = () => session.schedule.blocks[session.schedule.blocks.length - 1]
  const aliases: PropertyDescriptorMap = {
    startTime: { enumerable: true, get: () => firstBlock().start },
    endTime: { enumerable: true, get: () => lastBlock().end },
    status: { enumerable: true, get: () => statusFor(session.execution) },
    notes: { enumerable: true, get: () => session.reflection?.notes },
    confidence: { enumerable: true, get: () => session.reflection?.confidence },
    blockers: { enumerable: true, get: () => session.reflection?.blockers },
    nextAction: { enumerable: true, get: () => session.reflection?.nextAction },
    activeDurations: { enumerable: true, get: () => legacyActiveDurations(session) },
    completedAt: {
      enumerable: true,
      get: () => session.execution.state === "completed" ? session.execution.completedAt : undefined,
    },
    source: { enumerable: true, get: () => session.integrations?.notion },
    toJSON: { enumerable: false, value: () => canonicalSession(session) },
  }
  Object.defineProperties(session, aliases)
  return session
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
    (value.kind !== "exam" && value.kind !== "sac") || typeof value.subject !== "string"
  ) return undefined
  return { type: "examtrack", id: value.id, kind: value.kind, subject: value.subject }
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
        intervals: actualIntervals.length > 0
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
  const rawSubjectIds = stringArray(value.subjectIds)
  const integratedSubjectId = rawSubjectIds.length === 0 ? examTrackSubjectId(examtrack) : undefined

  return attachCompatibilityView({
    schemaVersion: STUDY_SESSION_SCHEMA_VERSION,
    id: optionalString(value.id) ?? `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    projectId: optionalString(value.projectId),
    subjectIds: integratedSubjectId ? [integratedSubjectId] : rawSubjectIds,
    title: optionalString(value.title) ?? "Study Session",
    description: optionalString(value.description),
    topics: stringArray(value.topics),
    schedule,
    execution,
    reflection: hasReflection ? reflection : undefined,
    createdVia: inferCreatedVia(value, notion),
    integrations: notion || examtrack ? { notion, examtrack } : undefined,
    created_at: optionalString(value.created_at) ?? now,
    updated_at: optionalString(value.updated_at) ?? now,
    deleted_at: typeof value.deleted_at === "string" || value.deleted_at === null ? value.deleted_at : null,
    last_modified_device_id: typeof value.last_modified_device_id === "string" || value.last_modified_device_id === null
      ? value.last_modified_device_id
      : null,
  } as StudySession)
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

export function updateStudySession(session: StudySession, patch: LegacyStudySessionPatch, now = new Date().toISOString()): StudySession {
  const raw = canonicalSession(session)
  const nextSchedule = patch.schedule ?? session.schedule
  const start = patch.startTime ?? nextSchedule.blocks[0]?.start ?? session.startTime
  const end = patch.endTime ?? nextSchedule.blocks[nextSchedule.blocks.length - 1]?.end ?? session.endTime
  const requestedState = patch.execution?.state ?? patch.status ?? session.execution.state
  const legacyIntervals = patch.activeDurations
    ? patch.activeDurations.map((range) => ({ ...range, source: "manual" as const }))
    : undefined
  const currentIntervals = session.execution.state === "planned" ? [] : session.execution.intervals
  const nextIntervals = patch.execution?.intervals ?? legacyIntervals ?? currentIntervals
  const execution: StudySessionExecution = requestedState === "completed"
    ? {
        state: "completed",
        intervals: nextIntervals,
        completedAt: patch.completedAt
          ?? (patch.execution?.state === "completed" ? patch.execution.completedAt : undefined)
          ?? (session.execution.state === "completed" ? session.execution.completedAt : now),
        ...(patch.execution?.state === "completed" && patch.execution.reportedMinutes !== undefined
          ? { reportedMinutes: patch.execution.reportedMinutes }
          : {}),
      }
    : requestedState === "in-progress"
      ? { state: "in-progress", intervals: nextIntervals }
      : { state: "planned", intervals: [] }
  const reflectionPatch = patch.reflection ?? {}
  const reflection = {
    notes: "notes" in patch ? patch.notes : "notes" in reflectionPatch ? reflectionPatch.notes : session.reflection?.notes,
    confidence: "confidence" in patch ? patch.confidence : "confidence" in reflectionPatch ? reflectionPatch.confidence : session.reflection?.confidence,
    blockers: "blockers" in patch ? patch.blockers : "blockers" in reflectionPatch ? reflectionPatch.blockers : session.reflection?.blockers,
    nextAction: "nextAction" in patch ? patch.nextAction : "nextAction" in reflectionPatch ? reflectionPatch.nextAction : session.reflection?.nextAction,
  }

  return normalizeStudySession({
    ...raw,
    ...patch,
    schedule: patch.schedule ?? {
      blocks: patch.activeDurations && requestedState === "planned"
        ? patch.activeDurations
        : nextSchedule.blocks.map((block, index, blocks) => ({
            start: index === 0 ? start : block.start,
            end: index === blocks.length - 1 ? end : block.end,
          })),
    },
    execution,
    reflection,
    integrations: patch.integrations ?? (patch.source ? { notion: patch.source } : session.integrations),
    updated_at: now,
  })
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
  return canonicalSession(normalizeStudySession(session))
}
