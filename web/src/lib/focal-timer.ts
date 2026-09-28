import { focalSupabase } from "@/lib/focal-supabase"

export type FocalTimerKind = "exam" | "sac"

export type FocalTimerLink = {
  sessionId: string
  kind: FocalTimerKind
  subject: string
  title: string
  plannedSeconds: number
  readingSeconds?: number
  phase?: "reading" | "writing" | "paused"
  phaseBeforePause?: "reading" | "writing"
  createdAt: string
  intervals: { start: string; end?: string }[]
}

type FocalTimerOperation = "in-progress" | "completed" | "delete"
type PendingTimerChange = {
  nonce: string
  link: FocalTimerLink
  operation: FocalTimerOperation
  changedAt: string
}

export type SharedFocalSessionChange = {
  change_id: string
  device_id: string
  row_id: string
  operation: "put" | "delete"
  payload: Record<string, unknown> | null
  revision: number
}

export type SharedFocalTimerState = {
  status: "deleted" | "completed" | "paused" | "running"
  phase?: "reading" | "writing" | "paused"
  phaseBeforePause?: "reading" | "writing"
  intervals: { start: string; end?: string }[]
}

const OUTBOX_KEY = "examtrack.focal-timer-outbox:v1"
let flushTask: Promise<void> | null = null

export function isFocalTimerLink(value: unknown): value is FocalTimerLink {
  if (!value || typeof value !== "object") return false
  const link = value as Partial<FocalTimerLink>
  return typeof link.sessionId === "string" && (link.kind === "exam" || link.kind === "sac") &&
    typeof link.subject === "string" && typeof link.title === "string" &&
    typeof link.plannedSeconds === "number" && Number.isFinite(link.plannedSeconds) &&
    typeof link.createdAt === "string" && Array.isArray(link.intervals) &&
    link.intervals.every((interval) => Boolean(interval) && typeof interval === "object" &&
      typeof interval.start === "string" && (interval.end === undefined || typeof interval.end === "string"))
}

export async function readSharedFocalSessionChange(userId: string, sessionId: string): Promise<SharedFocalSessionChange | null> {
  if (!focalSupabase) return null
  const { data, error } = await focalSupabase.from("sync_changes")
    .select("change_id,device_id,row_id,operation,payload,revision")
    .eq("user_id", userId).eq("entity", "study_sessions").eq("row_id", sessionId)
    .order("revision", { ascending: false }).limit(1)
  if (error) throw error
  const row = data?.[0] as SharedFocalSessionChange | undefined
  return row ?? null
}

export function parseSharedFocalTimerState(change: SharedFocalSessionChange): SharedFocalTimerState | null {
  if (change.operation === "delete") return { status: "deleted", intervals: [] }
  const payload = change.payload
  if (!payload || typeof payload !== "object") return null
  const execution = payload.execution && typeof payload.execution === "object"
    ? payload.execution as Record<string, unknown>
    : {}
  const integrations = payload.integrations && typeof payload.integrations === "object"
    ? payload.integrations as Record<string, unknown>
    : {}
  const source = integrations.examtrack && typeof integrations.examtrack === "object"
    ? integrations.examtrack as Record<string, unknown>
    : integrations.folio && typeof integrations.folio === "object"
      ? integrations.folio as Record<string, unknown>
      : {}
  const phase = source.phase === "reading" || source.phase === "writing" || source.phase === "paused"
    ? source.phase
    : undefined
  const phaseBeforePause = source.phaseBeforePause === "reading" || source.phaseBeforePause === "writing"
    ? source.phaseBeforePause
    : undefined
  const intervals = Array.isArray(execution.intervals)
    ? execution.intervals.flatMap((value) => {
        if (!value || typeof value !== "object") return []
        const interval = value as Record<string, unknown>
        if (typeof interval.start !== "string" || !Number.isFinite(new Date(interval.start).getTime())) return []
        const end = typeof interval.end === "string" && Number.isFinite(new Date(interval.end).getTime()) ? interval.end : undefined
        return [{ start: interval.start, ...(end ? { end } : {}) }]
      })
    : []
  if (execution.state === "completed") return { status: "completed", phase, phaseBeforePause, intervals }
  if (execution.state !== "in-progress") return null
  const paused = phase === "paused" || (!phase && Boolean(intervals.at(-1)?.end))
  return { status: paused ? "paused" : "running", phase, phaseBeforePause, intervals }
}

function readOutbox(): Record<string, PendingTimerChange> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(OUTBOX_KEY) ?? "{}")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, PendingTimerChange] => {
      const value = entry[1] as Partial<PendingTimerChange>
      return typeof value?.nonce === "string" && isFocalTimerLink(value.link) &&
        (value.operation === "in-progress" || value.operation === "completed" || value.operation === "delete") &&
        typeof value.changedAt === "string"
    }))
  } catch {
    return {}
  }
}

function writeOutbox(outbox: Record<string, PendingTimerChange>) {
  localStorage.setItem(OUTBOX_KEY, JSON.stringify(outbox))
}

export function createFocalTimerLink(
  kind: FocalTimerKind,
  subject: string,
  title: string,
  plannedSeconds: number,
  now = new Date(),
  readingSeconds = 0,
): FocalTimerLink {
  const createdAt = now.toISOString()
  return {
    sessionId: crypto.randomUUID(),
    kind,
    subject: subject.trim(),
    title: title.trim(),
    plannedSeconds: Math.max(60, Math.round(plannedSeconds)),
    readingSeconds: Math.max(0, Math.round(readingSeconds)),
    phase: readingSeconds > 0 ? "reading" : "writing",
    createdAt,
    intervals: readingSeconds > 0 ? [] : [{ start: createdAt }],
  }
}

export function pauseFocalTimer(link: FocalTimerLink, now = new Date()): FocalTimerLink {
  const end = now.toISOString()
  return {
    ...link,
    intervals: link.intervals.map((interval, index) =>
      index === link.intervals.length - 1 && !interval.end ? { ...interval, end } : interval
    ),
    phaseBeforePause: link.phase === "reading" || link.phase === "writing" ? link.phase : "writing",
    phase: "paused",
  }
}

export function resumeFocalTimer(link: FocalTimerLink, now = new Date()): FocalTimerLink {
  const phase = link.phaseBeforePause ?? (link.kind === "exam" && link.readingSeconds ? "reading" : "writing")
  const intervals = phase === "reading" || link.intervals.some((interval) => !interval.end)
    ? link.intervals
    : [...link.intervals, { start: now.toISOString() }]
  return { ...link, intervals, phase, phaseBeforePause: undefined }
}

export function setFocalTimerPhase(link: FocalTimerLink, phase: "reading" | "writing", now = new Date()): FocalTimerLink {
  if (link.phase === phase) return link
  const end = now.toISOString()
  let intervals = link.intervals.map((interval, index) =>
    index === link.intervals.length - 1 && !interval.end ? { ...interval, end } : interval
  )
  if (phase === "writing" && !intervals.some((interval) => !interval.end)) {
    intervals = [...intervals, { start: end }]
  }
  return { ...link, intervals, phase, phaseBeforePause: undefined }
}

async function sendTimerChange(change: PendingTimerChange): Promise<boolean> {
  if (!focalSupabase) return false
  const { data: { session } } = await focalSupabase.auth.getSession()
  if (!session) return false
  const { link, operation } = change
  const now = new Date(change.changedAt)
  const completedLink = operation === "completed" ? pauseFocalTimer(link, now) : link
  const completedAt = completedLink.intervals[completedLink.intervals.length - 1]?.end ?? change.changedAt
  const payload = operation === "delete" ? null : {
    schemaVersion: 2,
    id: link.sessionId,
    subjectIds: [],
    title: `${link.kind === "exam" ? "Timed exam" : "Timed SAC"} · ${link.title}`,
    description: `Logged by the ExamTrack ${link.kind} timer${link.phase ? ` · ${link.phase}` : ""}.`,
    topics: [link.kind === "exam" ? "Exam practice" : "SAC practice"],
    schedule: {
      blocks: [{
        start: link.createdAt,
        end: new Date(new Date(link.createdAt).getTime() + link.plannedSeconds * 1000).toISOString(),
      }],
    },
    execution: operation === "completed"
      ? { state: "completed", intervals: completedLink.intervals.map((interval) => ({ ...interval, source: "imported" })), completedAt }
      : { state: "in-progress", intervals: link.intervals.map((interval) => ({ ...interval, source: "imported" })) },
    createdVia: "examtrack",
    integrations: { examtrack: {
      type: "examtrack", id: link.sessionId, kind: link.kind, subject: link.subject,
      phase: operation === "completed" ? link.phase : link.phase,
      phaseBeforePause: link.phaseBeforePause,
    } },
    created_at: link.createdAt,
    updated_at: change.changedAt,
    deleted_at: null,
    last_modified_device_id: "examtrack-web",
  }
  const { error } = await focalSupabase.from("sync_changes").insert({
    user_id: session.user.id,
    change_id: change.nonce,
    device_id: "examtrack-web",
    entity: "study_sessions",
    row_id: link.sessionId,
    operation: operation === "delete" ? "delete" : "put",
    payload,
  })
  if (error && error.code !== "23505") {
    console.error("Could not sync timer with Focal:", error)
    return false
  }
  return true
}

export async function flushFocalTimerOutbox(): Promise<void> {
  if (flushTask) return flushTask
  flushTask = (async () => {
    for (;;) {
      const entries = Object.values(readOutbox())
      if (entries.length === 0) return
      let sent = 0
      for (const change of entries) {
        if (!(await sendTimerChange(change))) continue
        const current = readOutbox()
        if (current[change.link.sessionId]?.nonce === change.nonce) {
          delete current[change.link.sessionId]
          writeOutbox(current)
        }
        sent += 1
      }
      if (sent === 0) return
    }
  })().catch((error) => {
    // Keep the durable outbox intact for the next connection attempt.
    console.error("Could not flush Focal timer sync:", error)
  }).finally(() => {
    flushTask = null
  })
  return flushTask
}

export async function publishFocalTimer(
  link: FocalTimerLink,
  operation: FocalTimerOperation,
  now = new Date(),
): Promise<boolean> {
  const outbox = readOutbox()
  const pending = outbox[link.sessionId]
  if (pending && pending.changedAt > now.toISOString()) {
    await flushFocalTimerOutbox()
    return !(link.sessionId in readOutbox())
  }
  outbox[link.sessionId] = {
    nonce: crypto.randomUUID(),
    link,
    operation,
    changedAt: now.toISOString(),
  }
  try {
    writeOutbox(outbox)
  } catch (error) {
    console.error("Could not queue Focal timer sync:", error)
    return false
  }
  await flushFocalTimerOutbox()
  return !(link.sessionId in readOutbox())
}
