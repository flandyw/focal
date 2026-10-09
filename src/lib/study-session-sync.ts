import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { AppData } from "./exam-data"
import { toast } from "sonner"
import { saveAppData } from "./storage"
import { supabase } from "./supabase"
import type { ExamTimerSession, FocusTimerSession, SacTimerSession } from "./ongoing-timers"
import { announce, backoffMs, classifyFailure, coalesced, onAnnounce, requestResult, transactionDone, withFlushLock } from "./outbox"
import type { PastStudyLog } from "./pastStudy"
import { adoptRemoteFocusSession, loadFocusSession } from "./study-timer"
import {
  estimateServerNow,
  isDeleted,
  isPaused,
  isRunning,
  observeServerClock,
  parseCanonicalStudySession,
  parseStudySessionMutationResult,
  studySessionActiveMilliseconds,
  type CanonicalStudySession,
  type StudySessionAction,
  type StudySessionCommand,
} from "./sync/sessionContract"

const OUTBOX_DB = "examtrack-sync"
const META_STORE = "sync-meta"
const TIMING_STORE = "session-timing"
const SESSION_OUTBOX = "session-outbox"
const DEVICE_KEY = "examtrack:study-session-device:v1"
const CURSOR_KEY = "examtrack:study-session-cursor:v1"

function guestPastStudy(): CanonicalStudySession[] {
  const value: unknown = JSON.parse(localStorage.getItem("examtrack:past-study:guest") ?? "[]")
  if (!Array.isArray(value)) throw new Error("Saved study data is unreadable; export it before resetting browser storage.")
  return value.map((item) => {
    const session = parseCanonicalStudySession(item)
    if (!session) throw new Error("Saved study data is unreadable; export it before resetting browser storage.")
    return session
  })
}

const GUEST_KEY = "examtrack:past-study:guest"
type Block = { start: string; end: string }

function saveGuest(sessions: CanonicalStudySession[]) {
  localStorage.setItem(GUEST_KEY, JSON.stringify(sessions))
}

const blocksOf = (session: CanonicalStudySession): Block[] =>
  session.segments.flatMap((segment) => segment.ended_at ? [{ start: segment.started_at, end: segment.ended_at }] : [])

/** Mirrors the server's block and completed bookkeeping for sessions that only exist in this browser. */
function guestApply(session: CanonicalStudySession, patch: { blocks?: Block[]; completed?: boolean }): CanonicalStudySession {
  const blocks = (patch.blocks ?? blocksOf(session)).toSorted((a, b) => Date.parse(a.start) - Date.parse(b.start))
  const completed = patch.completed ?? session.completed
  if (blocks.some((block, index) => !(Date.parse(block.end) > Date.parse(block.start)) || (index > 0 && Date.parse(block.start) < Date.parse(blocks[index - 1].end)))) {
    throw new Error("Study blocks must end after they start and must not overlap.")
  }
  if (completed && (!blocks.length || blocks.some((block) => Date.parse(block.end) > Date.now()))) {
    throw new Error("Study that has not finished yet cannot be marked done.")
  }
  return {
    ...session, completed, revision: session.revision + 1, updated_at: new Date().toISOString(),
    started_at: completed ? blocks[0].start : null, completed_at: completed ? blocks.at(-1)!.end : null,
    accumulated_active_ms: completed ? blocks.reduce((sum, block) => sum + Date.parse(block.end) - Date.parse(block.start), 0) : 0,
    segments: patch.blocks ? blocks.map((block) => ({ id: crypto.randomUUID(), session_id: session.id, started_at: block.start, ended_at: block.end, phase: "focus" as const, source_device_id: deviceId() })) : session.segments,
  }
}

function guestSession(id: string, fields: { title: string; subjectId?: string; blocks: Block[]; completed: boolean; metadata: Record<string, unknown> }): CanonicalStudySession {
  const now = new Date().toISOString()
  return guestApply({
    id, kind: "focus", completed: false, phase: "focus", revision: 0, title: fields.title, subject_id: fields.subjectId ?? null,
    originating_app: "examtrack", created_at: now, updated_at: now, started_at: null, paused_at: null, completed_at: null, cancelled_at: null,
    accumulated_active_ms: 0, segment_started_at: null, metadata: fields.metadata, segments: [],
  }, { blocks: fields.blocks, completed: fields.completed })
}

type TimerKind = "exam" | "sac" | "focus"
type TimerSession = ExamTimerSession | SacTimerSession | FocusTimerSession

let clockAnchor: ReturnType<typeof observeServerClock> = null
let outboxDatabase: Promise<IDBDatabase> | null = null

export function canonicalNow(): Date {
  const time = clockAnchor && typeof performance !== "undefined"
    ? estimateServerNow(clockAnchor, performance.now())
    : Date.now()
  return new Date(time)
}

export function saveTimerSessionChange(
  previous: ExamTimerSession | undefined,
  next: ExamTimerSession | undefined,
  kind: "exam",
  terminalAction?: "cancel" | "complete",
): Promise<ExamTimerSession | undefined>
export function saveTimerSessionChange(
  previous: SacTimerSession | undefined,
  next: SacTimerSession | undefined,
  kind: "sac",
  terminalAction?: "cancel" | "complete",
): Promise<SacTimerSession | undefined>
export function saveTimerSessionChange(
  previous: FocusTimerSession | undefined,
  next: FocusTimerSession | undefined,
  kind: "focus",
  terminalAction?: "cancel" | "complete",
): Promise<FocusTimerSession | undefined>
/**
 * One lifecycle action. The command is committed to the durable outbox first and the local timer
 * moves at once; delivery, retries and conflicts with other devices are the outbox's problem
 * (see `drainSessionQueue`). Signed out means local-only: the timer is the whole truth.
 *
 * The returned timer is the one the user asked for, with the revision the caller already had.
 * The server's row is adopted by the hook once every command queued for the session has been
 * answered, so a pending local move is never overwritten by an older server state.
 */
export async function saveTimerSessionChange(
  previous: TimerSession | undefined,
  next: TimerSession | undefined,
  kind: TimerKind,
  terminalAction?: "cancel" | "complete",
): Promise<TimerSession | undefined> {
  const session = next ?? previous
  if (!session) return undefined
  const id = session.id ?? crypto.randomUUID()
  const current = next ? { ...next, id } : session
  const accountId = await queueAccountId()
  if (!supabase || accountId === "guest") return next ? current : undefined
  const action = terminalAction ?? actionFor(previous, next, kind)
  await queueCommand(accountId, await buildCommand(previous, current, kind, action, id, accountId))
  return next ? current : undefined
}

/**
 * Rebuilds the local timer from the canonical row. The server owns the boundary times,
 * the revision and the running state; the metadata carries the fields only this client
 * knows about, so the two are merged rather than one overwriting the other.
 */
function projectTimerSession<T extends TimerSession>(canonical: CanonicalStudySession, current: T, kind: TimerKind): T {
  const stored = isRecord(canonical.metadata.examtrack) ? canonical.metadata.examtrack : {}
  const now = estimateNow()
  const subject = canonical.subject_id ?? (typeof stored.subject === "string" ? stored.subject : current.subject)
  const phase = kind === "exam" && canonical.phase ? { phase: canonical.phase === "writing" ? "writing" : "reading" } : {}
  return {
    ...current,
    ...(stored as object),
    ...phase,
    id: canonical.id,
    revision: canonical.revision,
    subject,
    title: canonical.title,
    startedAt: now - studySessionActiveMilliseconds(canonical, now),
    pausedAt: isPaused(canonical) ? now : undefined,
  } as T
}

/** The command did not apply, but the session is already where it would have put it. */
function alreadyDone(session: CanonicalStudySession, command: StudySessionCommand): boolean {
  switch (command.action) {
    case "start": case "resume": return isRunning(session)
    case "pause": return isPaused(session)
    case "complete": return session.completed
    case "cancel": return isDeleted(session)
    case "phase_change": return session.phase === command.phase
    // The row exists: a replay after its receipt was pruned, not a conflict.
    case "create": case "log": return true
    // An edit that did not apply is a conflict, never a success.
    case "save_progress": return false
  }
}

/** Pause, resume, complete or delete a session another device (or an earlier visit) started. */
export async function controlSession(
  session: CanonicalStudySession,
  action: Extract<StudySessionAction, "pause" | "resume" | "complete" | "cancel">,
): Promise<void> {
  const accountId = await queueAccountId()
  if (!supabase || accountId === "guest") throw new Error("Sign in to control a shared study session.")
  if ((await readQueue(accountId)).some((entry) => entry.sessionId === session.id)) {
    throw new Error("The last change to this session is still syncing.")
  }
  await queueCommand(accountId, {
    mutation_id: crypto.randomUUID(), session_id: session.id, expected_revision: session.revision,
    action, device_id: deviceId(), app: "examtrack", kind: session.kind, phase: session.phase ?? "focus",
    title: session.title, subject_id: session.subject_id ?? undefined, metadata: session.metadata,
    ...await captureCommandTiming(accountId, session.id, action),
  })
}

async function buildCommand(
  previous: TimerSession | undefined,
  current: TimerSession,
  kind: TimerKind,
  action: StudySessionAction,
  id: string,
  accountId: string,
): Promise<StudySessionCommand> {
  return {
    mutation_id: crypto.randomUUID(),
    session_id: id,
    // The same timer ID through start → pause → resume → complete. This is only the floor: the
    // outbox raises it to the newest revision it knows and counts the commands queued ahead.
    expected_revision: current.revision ?? previous?.revision ?? 0,
    action,
    device_id: deviceId(),
    app: "examtrack",
    kind,
    phase: phaseFor(current, kind),
    title: current.title,
    subject_id: current.subject,
    metadata: timerMetadata(current, kind, id),
    ...await captureCommandTiming(accountId, id, action),
  }
}

/* ------------------------------------------------------------------ */
/* the durable outbox                                                  */
/* ------------------------------------------------------------------ */

/**
 * Every session write is a command in IndexedDB before anything else happens to it, and leaves
 * only when the server has answered it. That makes four promises:
 *
 *  - Nothing is lost. A closed tab, a crash or a dead network leaves the command on disk; the
 *    next run sends it. Only a definite answer from the server removes it.
 *  - Nothing applies twice. The `mutation_id` is minted once and a command that may have
 *    reached the server is frozen (`sent`), so every retry is byte-identical and the server
 *    replays its stored answer instead of acting again.
 *  - Order holds per session. A session's commands go one at a time, oldest first, each
 *    expecting the revision the one before it produced. Different sessions never wait on each other.
 *  - Other devices win fairly. If the server's row moved on first, a lifecycle command (a
 *    transition) is retried against the new row under a fresh mutation and the server decides
 *    whether it still makes sense; an edit of values (blocks, completed) is never silently laid
 *    over another device's change, it is reported.
 */
interface Queued {
  seq?: number
  accountId: string
  sessionId: string
  command: StudySessionCommand
  /** An attempt may have reached the server, so the command must not change until it answers. */
  sent: boolean
  attempts: number
  /** Epoch ms; the command is not tried before this. */
  retryAt: number
  rebases: number
  queuedAt: number
}

const MAX_REBASES = 5
const LIFECYCLE_ACTIONS = new Set<StudySessionAction>(["start", "pause", "resume", "phase_change", "complete", "cancel"])

/** The signed-in account the mounted hook serves. Offline, auth.getSession() cannot be trusted to answer. */
let signedInAccount: string | null = null
/** Newest revision seen per session, from answers and from the feed. */
const knownRevisions = new Map<string, number>()
const revisionKey = (accountId: string, sessionId: string) => `${accountId}\u0000${sessionId}`

function noteRevisions(accountId: string, sessions: readonly CanonicalStudySession[]) {
  for (const session of sessions) {
    const key = revisionKey(accountId, session.id)
    if ((knownRevisions.get(key) ?? 0) < session.revision) knownRevisions.set(key, session.revision)
  }
}

async function queueAccountId(): Promise<string> {
  return signedInAccount ?? commandAccountId()
}

/** What the mounted hook does with the outbox's news. */
interface QueueSink {
  /** Rows the server returned for answered commands (applied or refused). */
  delivered(rows: CanonicalStudySession[]): Promise<void>
  rejected(message: string): void
}
let queueSink: QueueSink | null = null

async function queueStore(mode: IDBTransactionMode) {
  const transaction = (await openOutboxDatabase()).transaction(SESSION_OUTBOX, mode)
  return { transaction, store: transaction.objectStore(SESSION_OUTBOX) }
}

async function readQueue(accountId: string): Promise<Queued[]> {
  const { transaction, store } = await queueStore("readonly")
  const all = await requestResult(store.getAll() as IDBRequest<Queued[]>)
  await transactionDone(transaction)
  return all.filter((entry) => entry.accountId === accountId)
}

async function writeEntry(entry: Queued): Promise<void> {
  const { transaction, store } = await queueStore("readwrite")
  store.put(entry)
  await transactionDone(transaction)
}

/**
 * Freeze the entry before it is sent. Read-modify-write in one transaction: an edit that was
 * folded into this still-unsent entry a moment ago is in the copy returned here, not overwritten
 * by the older copy the drain scanned. Undefined when the entry is already gone.
 */
async function claimEntry(seq: number): Promise<Queued | undefined> {
  const { transaction, store } = await queueStore("readwrite")
  const fresh = await requestResult(store.get(seq) as IDBRequest<Queued | undefined>)
  if (fresh && !fresh.sent) store.put({ ...fresh, sent: true })
  await transactionDone(transaction)
  return fresh
}

async function deleteEntry(seq: number): Promise<void> {
  const { transaction, store } = await queueStore("readwrite")
  store.delete(seq)
  await transactionDone(transaction)
}

/** Write-ahead: resolves once the command is on disk, not once the server has seen it. */
async function enqueueCommand(accountId: string, command: StudySessionCommand): Promise<void> {
  const { transaction, store } = await queueStore("readwrite")
  const queued = (await requestResult(store.getAll() as IDBRequest<Queued[]>)).filter((entry) => entry.accountId === accountId)
  // The same command twice (a retried log or create) is one command.
  if (queued.some((entry) => entry.command.mutation_id === command.mutation_id)) return void await transactionDone(transaction)
  const ahead = queued.filter((entry) => entry.sessionId === command.session_id)
  const last = ahead.at(-1)
  if (last && !last.sent && last.command.action === "save_progress" && command.action === "save_progress") {
    // Two unsent edits of one session are one edit; the later fields win. Identity and position are the earlier command's.
    store.put({ ...last, command: { ...last.command, ...command, mutation_id: last.command.mutation_id, expected_revision: last.command.expected_revision } })
  } else {
    // A command applied by the server raises the revision by exactly one, so a chain of n queued
    // commands expects the newest known revision plus n.
    const base = Math.max(knownRevisions.get(revisionKey(accountId, command.session_id)) ?? 0, command.expected_revision)
    store.put({ accountId, sessionId: command.session_id, command: { ...command, expected_revision: base + ahead.length },
      sent: false, attempts: 0, retryAt: 0, rebases: 0, queuedAt: Date.now() } satisfies Queued)
  }
  await transactionDone(transaction)
}

/** The boundary happened now, whether or not the server has heard of it; the next command measures from here. */
async function queueCommand(accountId: string, command: StudySessionCommand): Promise<void> {
  await enqueueCommand(accountId, command)
  await commitCommandTiming(accountId, command.session_id, command.action)
  announce()
  await queueSink?.delivered([])
  requestFlush()
}

const flushSessionQueue = coalesced(async () => {
  const accountId = signedInAccount
  if (!accountId || !supabase) return
  scheduleWake(await withFlushLock(`focal-session-outbox:${accountId}`, () => drainSessionQueue(accountId)))
})

let wakeTimer: ReturnType<typeof setTimeout> | undefined
function scheduleWake(at: number | null) {
  clearTimeout(wakeTimer)
  if (at !== null) wakeTimer = setTimeout(requestFlush, Math.max(250, Math.min(60_000, at - Date.now())))
}

/** Start delivery. Safe to call from anywhere, any number of times. */
function requestFlush(): Promise<void> {
  return flushSessionQueue().catch((error: unknown) => console.error("Could not flush the study-session outbox:", error))
}

/**
 * Sends every due command, oldest first. Returns when nothing more can go now, with the time
 * the earliest held command becomes due (null when nothing is waiting).
 */
async function drainSessionQueue(accountId: string): Promise<number | null> {
  let wake: number | null = null
  const soonest = (at: number) => { wake = wake === null ? at : Math.min(wake, at) }
  for (;;) {
    if (signedInAccount !== accountId) return wake
    const now = Date.now()
    const waiting = new Set<string>()
    let entry: Queued | undefined
    wake = null
    for (const candidate of await readQueue(accountId)) {
      // A held command holds back everything after it in its own session, and only there.
      if (waiting.has(candidate.sessionId)) continue
      if (candidate.retryAt > now) { waiting.add(candidate.sessionId); soonest(candidate.retryAt); continue }
      entry = candidate
      break
    }
    if (!entry || !await deliver(accountId, entry, soonest)) return wake
  }
}

/** Sends one command and files the answer. False means stop draining: the network or the account is down. */
async function deliver(accountId: string, scanned: Queued, soonest: (at: number) => void): Promise<boolean> {
  const entry = await claimEntry(scanned.seq!)
  if (!entry) return true
  const { command } = entry
  let data: unknown = null
  let error: { message: string; code?: string } | null = null
  let status = 0
  try {
    ({ data, error, status } = await supabase!.rpc("study_session_mutate", { p_command: { ...command, expected_user_id: accountId } }))
  } catch (thrown) {
    error = { message: String(thrown) }
  }
  const result = error ? null : parseStudySessionMutationResult(data)
  if (error || !result) {
    const failure = error ? classifyFailure(status, error) : "retry"
    if (failure === "hold") { soonest(Date.now() + 15_000); return false }
    if (failure === "retry") {
      const attempts = entry.attempts + 1
      const retryAt = Date.now() + backoffMs(attempts)
      await writeEntry({ ...entry, sent: true, attempts, retryAt })
      soonest(retryAt)
      return status !== 0
    }
    // The server read the command and refused it for good (invalid blocks, bad timing...). Retrying cannot change that.
    console.error("The server refused a study-session command:", command, error)
    await deleteEntry(entry.seq!)
    queueSink?.rejected(`A change to "${command.title || "a study session"}" was refused: ${error!.message}`)
    await queueSink?.delivered([])
    announce()
    return true
  }
  clockAnchor = observeServerClock(result.server_now, performance.now())
  const session = result.session
  if (session) noteRevisions(accountId, [session])
  if (result.applied || (session && alreadyDone(session, command))) {
    await deleteEntry(entry.seq!)
  } else if (session && result.reason === "stale_revision" && LIFECYCLE_ACTIONS.has(command.action) && entry.rebases < MAX_REBASES) {
    // Another device moved the session on first. The user's move is a transition, not a value, so try
    // it on the row the server holds; the server judges whether it still makes sense. It is a new
    // request, so a new mutation. The old timing described a boundary on the old timeline.
    await writeEntry({ ...entry, sent: false, retryAt: 0, rebases: entry.rebases + 1,
      command: { ...command, mutation_id: crypto.randomUUID(), expected_revision: session.revision,
        occurred_at: undefined, elapsed_since_previous_ms: undefined } })
  } else {
    await deleteEntry(entry.seq!)
    queueSink?.rejected(refusalMessage(result.reason, command, session))
  }
  await queueSink?.delivered(session ? [session] : [])
  announce()
  return true
}

function refusalMessage(reason: string | null, command: StudySessionCommand, session: CanonicalStudySession | null): string {
  const name = `"${command.title || session?.title || "A study session"}"`
  if (reason === "session_terminal") return `${name} was deleted on another device.`
  if (reason === "not_found") return `${name} no longer exists.`
  return `${name} was changed on another device, so this change was not applied.`
}

/** What the screen shows: the server's sessions with this device's unanswered commands laid on top. */
function overlaySessions(canonical: ReadonlyMap<string, CanonicalStudySession>, queue: readonly Queued[]): CanonicalStudySession[] {
  const view = new Map(canonical)
  for (const { command } of queue) {
    const base = view.get(command.session_id)
    try {
      if (command.action === "create" || command.action === "log") {
        if (!base) view.set(command.session_id, guestSession(command.session_id, { title: command.title ?? "", subjectId: command.subject_id ?? undefined,
          blocks: command.blocks ?? [], completed: command.action === "log", metadata: command.metadata ?? {} }))
      } else if (base && command.action === "save_progress" && (command.blocks || command.completed !== undefined)) {
        view.set(base.id, guestApply(base, { blocks: command.blocks, completed: command.completed }))
      } else if (base && command.action === "cancel") {
        view.set(base.id, { ...base, cancelled_at: new Date().toISOString(), revision: base.revision + 1 })
      }
      // ponytail: timer lifecycle commands are not drawn onto the list; the timer screens run on their own
      // local state, and the list catches up when the command is answered.
    } catch {
      // A command the overlay cannot build is still sent; the server's answer is what counts.
    }
  }
  return [...view.values()].toSorted((left, right) => left.created_at.localeCompare(right.created_at))
}

function actionFor(previous: TimerSession | undefined, next: TimerSession | undefined, kind: TimerKind): StudySessionAction {
  if (!previous && next) return "start"
  if (previous && next) {
    if (previous.pausedAt === undefined && next.pausedAt !== undefined) return "pause"
    if (previous.pausedAt !== undefined && next.pausedAt === undefined) return "resume"
    if (phaseFor(previous, kind) !== phaseFor(next, kind)) return "phase_change"
  }
  return "save_progress"
}

function phaseFor(session: TimerSession, kind: TimerKind): "focus" | "reading" | "writing" {
  if (kind === "exam") return (session as ExamTimerSession).phase ?? "reading"
  return "focus"
}
function timerMetadata(session: TimerSession, kind: TimerKind, id: string): Record<string, unknown> {
  const details: Record<string, unknown> = { ...session }
  for (const key of ["id", "revision", "startedAt", "pausedAt", "pausedSeconds", "phase"]) delete details[key]
  const integrations = {
    examtrack: {
      type: "examtrack",
      id,
      kind,
      subject: session.subject,
      phase: phaseFor(session, kind),
    },
  }
  return {
    ...details,
    createdVia: "examtrack",
    description: `Logged by the Focal ${kind} timer.`,
    topics: [kind === "exam" ? "Exam practice" : kind === "sac" ? "SAC practice" : "Study block"],
    integrations,
    examtrack: details,
  }
}

function deviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = crypto.randomUUID()
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

type AccountSyncMeta = { key: string; accountId: string; cursor: number }
type SessionTiming = { key: string; accountId: string; sessionId: string; monotonicAt: number; timeOrigin: number; elapsedMs: number }
const metadataKey = (accountId: string) => `account:${accountId}`
const timingKey = (accountId: string, sessionId: string) => `${accountId}\u0000${sessionId}`

async function readSyncMeta(accountId: string): Promise<AccountSyncMeta> {
  const database = await openOutboxDatabase()
  const transaction = database.transaction(META_STORE, "readonly")
  const saved = await requestResult(transaction.objectStore(META_STORE).get(metadataKey(accountId)) as IDBRequest<AccountSyncMeta | undefined>)
  await transactionDone(transaction)
  if (saved) return saved
  let cursor = 0
  try {
    cursor = Math.max(0, Number(localStorage.getItem(`${CURSOR_KEY}:${accountId}`) ?? 0) || 0)
  } catch { /* A corrupt legacy cursor starts from a full snapshot. */ }
  const migrated = { key: metadataKey(accountId), accountId, cursor }
  await writeSyncMeta(migrated)
  localStorage.removeItem(`${CURSOR_KEY}:${accountId}`)
  return migrated
}

async function writeSyncMeta(meta: AccountSyncMeta): Promise<void> {
  const database = await openOutboxDatabase()
  const transaction = database.transaction(META_STORE, "readwrite")
  transaction.objectStore(META_STORE).put(meta)
  await transactionDone(transaction)
}

async function commandAccountId(): Promise<string> {
  if (!supabase) return "guest"
  const { data, error } = await supabase.auth.getSession()
  if (error) throw error
  // The last account that used this browser is not ownership proof for a new command.
  return data.session?.user.id ?? "guest"
}

/** Elapsed milliseconds since the last accepted boundary, capped at seven days. */
function elapsedSinceBoundary(
  prior: Pick<SessionTiming, "elapsedMs" | "monotonicAt" | "timeOrigin"> | undefined,
  monotonicAt: number,
  timeOrigin: number,
): number {
  const continuous = prior !== undefined && prior.timeOrigin === timeOrigin
  return Math.max(0, Math.min(604_800_000, Math.round((prior?.elapsedMs ?? 0) +
    (continuous ? Math.max(0, monotonicAt - prior!.monotonicAt) : 0))))
}

/**
 * Measure the boundary. This only reads the anchor: it is committed by `commitCommandTiming`
 * once the server has accepted the command, because a command that never left the device must
 * not move the anchor -- otherwise a retry five seconds later would report five seconds of a
 * thirty-minute run.
 */
async function captureCommandTiming(accountId: string, sessionId: string, action: StudySessionAction): Promise<Pick<StudySessionCommand, "occurred_at" | "elapsed_since_previous_ms">> {
  if (!( ["start", "pause", "resume", "phase_change", "complete", "cancel"] as StudySessionAction[]).includes(action)) return {}
  if (typeof performance === "undefined" || typeof indexedDB === "undefined") return {}
  const prior = await readCommandTiming(accountId, sessionId)
  const monotonicAt = performance.now()
  const timeOrigin = performance.timeOrigin
  const elapsed = elapsedSinceBoundary(prior, monotonicAt, timeOrigin)
  const occurredAt = clockAnchor ? new Date(estimateServerNow(clockAnchor, monotonicAt)).toISOString() : null
  return { occurred_at: occurredAt, elapsed_since_previous_ms: elapsed }
}

/** Called only after study_session_mutate accepted the command. */
async function commitCommandTiming(accountId: string, sessionId: string, action: StudySessionAction): Promise<void> {
  if (!( ["start", "pause", "resume", "phase_change", "complete", "cancel"] as StudySessionAction[]).includes(action)) return
  if (typeof performance === "undefined" || typeof indexedDB === "undefined") return
  const key = timingKey(accountId, sessionId)
  const database = await openOutboxDatabase()
  const transaction = database.transaction(TIMING_STORE, "readwrite")
  transaction.objectStore(TIMING_STORE).put({ key, accountId, sessionId, monotonicAt: performance.now(),
    timeOrigin: performance.timeOrigin, elapsedMs: 0 } satisfies SessionTiming)
  await transactionDone(transaction)
}

async function readCommandTiming(accountId: string, sessionId: string): Promise<SessionTiming | undefined> {
  if (typeof indexedDB === "undefined") return undefined
  const database = await openOutboxDatabase()
  const transaction = database.transaction(TIMING_STORE, "readonly")
  const stored = await requestResult(transaction.objectStore(TIMING_STORE).get(timingKey(accountId, sessionId)) as IDBRequest<SessionTiming | undefined>)
  await transactionDone(transaction)
  return stored
}

async function checkpointSessionTiming(accountId: string, sessionId: string): Promise<void> {
  if (typeof performance === "undefined") return
  const monotonicAt = performance.now()
  const timeOrigin = performance.timeOrigin
  const key = timingKey(accountId, sessionId)
  const database = await openOutboxDatabase()
  const transaction = database.transaction(TIMING_STORE, "readwrite")
  const store = transaction.objectStore(TIMING_STORE)
  const prior = await requestResult(store.get(key) as IDBRequest<SessionTiming | undefined>)
  if (prior) store.put({ ...prior, monotonicAt, timeOrigin,
    elapsedMs: Math.min(604_800_000, prior.elapsedMs + (prior.timeOrigin === timeOrigin ? Math.max(0, monotonicAt - prior.monotonicAt) : 0)) })
  await transactionDone(transaction)
}

/** Anchors the local clock to the server's boundary. Returns true when it wrote one. */
async function rememberCanonicalTiming(accountId: string, sessions: readonly CanonicalStudySession[]): Promise<boolean> {
  if (!clockAnchor || typeof performance === "undefined" || sessions.length === 0) return false
  const nowMono = performance.now()
  const timeOrigin = performance.timeOrigin
  const database = await openOutboxDatabase()
  const transaction = database.transaction(TIMING_STORE, "readwrite")
  const store = transaction.objectStore(TIMING_STORE)
  for (const session of sessions) {
    const boundary = session.timing_at ?? (isRunning(session) ? session.segment_started_at : session.paused_at)
    const elapsed = boundary ? Math.max(0, estimateServerNow(clockAnchor, nowMono) - Date.parse(boundary)) : 0
    store.put({ key: timingKey(accountId, session.id), accountId, sessionId: session.id,
      monotonicAt: nowMono - elapsed, timeOrigin, elapsedMs: 0 } satisfies SessionTiming)
  }
  await transactionDone(transaction)
  return true
}

function openOutboxDatabase(): Promise<IDBDatabase> {
  if (outboxDatabase) return outboxDatabase
  outboxDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open(OUTBOX_DB, 3)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: "key" })
      if (!database.objectStoreNames.contains(TIMING_STORE)) database.createObjectStore(TIMING_STORE, { keyPath: "key" })
      if (!database.objectStoreNames.contains(SESSION_OUTBOX)) database.createObjectStore(SESSION_OUTBOX, { keyPath: "seq", autoIncrement: true })
    }
    // A newer tab upgrading the schema must not wait on this one forever.
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); outboxDatabase = null }
      resolve(request.result)
    }
    request.onerror = () => reject(request.error ?? new Error("Could not open the local study-session outbox"))
  })
  return outboxDatabase
}

/**
 * The sync feed only carries sittings *forward* from a cursor, so a cursor that was ever
 * advanced past a sitting loses it for good: the calendar then shows an empty history and no
 * amount of polling brings the sittings back. With nothing in hand there is no tail to page
 * from, so read the whole state once. Only once: after that an empty history is a real one,
 * and re-snapshotting every poll would be a full-table read every fifteen seconds.
 *
 * ponytail: -1 asks the server for its materialized state instead of a log range. Upgrade
 * path if the server ever needs a cheaper "do you have any?" probe: add it there, not here.
 */
function readCursorFor(cursor: number, knownSessions: number, readWholeState: boolean) {
  return knownSessions === 0 && !readWholeState ? -1 : cursor
}

export function useStudySessionSync(
  userId: string | undefined,
  data: AppData,
  setData: Dispatch<SetStateAction<AppData>>,
): { sessions: CanonicalStudySession[]; queued: number; plan: (entries: Array<{ title: string; subjectId?: string; start: string; end: string; description?: string; topics?: string[] }>) => Promise<number>; control: (...args: Parameters<typeof controlSession>) => Promise<void>; log: (entry: PastStudyLog, id: string) => Promise<void>; edit: (session: CanonicalStudySession, patch: { blocks?: Block[]; completed?: boolean }) => Promise<void>; remove: (session: CanonicalStudySession) => Promise<void> } {
  const dataRef = useRef(data)
  useEffect(() => { dataRef.current = data }, [data])
  const initialized = useRef(false)
  const readWholeState = useRef(false)
  const canonicalSessions = useRef(new Map<string, CanonicalStudySession>())
  /** This account's unanswered commands. A session in here belongs to this device until they are answered. */
  const queue = useRef<Queued[]>([])
  const [sessions, setSessions] = useState<CanonicalStudySession[]>([])
  const [queued, setQueued] = useState(0)

  const render = useCallback(() => {
    setSessions(overlaySessions(canonicalSessions.current, queue.current))
    setQueued(queue.current.length)
  }, [])

  const acceptSessions = useCallback((incoming: readonly CanonicalStudySession[], replace = false) => {
    const next = replace ? new Map<string, CanonicalStudySession>() : new Map(canonicalSessions.current)
    for (const session of incoming) {
      const previous = next.get(session.id)
      if (!previous || previous.revision <= session.revision) next.set(session.id, session)
    }
    canonicalSessions.current = next
    if (userId) noteRevisions(userId, incoming)
    render()
  }, [userId, render])

  const refreshQueue = useCallback(async () => {
    queue.current = userId ? await readQueue(userId) : []
    render()
  }, [userId, render])

  useEffect(() => {
    if (!userId || !supabase) {
      initialized.current = false
      canonicalSessions.current = new Map()
      queue.current = []
      try { acceptSessions(guestPastStudy(), true) }
      catch (error) { console.error("Could not load past study:", error); setSessions([]) }
      return
    }
    canonicalSessions.current = new Map()
    queue.current = []
    readWholeState.current = false
    setSessions([])
    signedInAccount = userId
    let cancelled = false
    let pulling = false
    /** Server rows whose session has no unanswered local command become the local timer. */
    const adopt = async (rows: readonly CanonicalStudySession[]) => {
      const owned = new Set(queue.current.map((entry) => entry.sessionId))
      const settled = rows.filter((row) => !owned.has(row.id))
      if (settled.length === 0) return
      await rememberCanonicalTiming(userId, settled)
      const projected = await applyCanonicalSessions(settled, estimateNow(), dataRef.current)
      if (projected !== dataRef.current) {
        dataRef.current = projected
        saveAppData(projected)
        setData(projected)
      }
    }
    queueSink = {
      delivered: async (rows) => {
        if (cancelled) return
        acceptSessions(rows)
        await refreshQueue()
        // The newest row the feed or an answer has brought, not the one this answer carried: the feed
        // may have delivered a later revision while the session was held back.
        await adopt(rows.flatMap((row) => canonicalSessions.current.get(row.id) ?? []))
      },
      rejected: (message) => toast.error("A study change was not applied", { description: message }),
    }
    /** A timer that predates the outbox (or was started signed out) is not on the server: queue its start once. */
    const publishLocalTimer = async () => {
      const known = new Set([...canonicalSessions.current.keys(), ...queue.current.map((entry) => entry.sessionId)])
      const exam = dataRef.current.activeExamTimer
      const sac = dataRef.current.activeSacTimer
      try {
        if (exam?.id && !known.has(exam.id)) await saveTimerSessionChange(undefined, exam, "exam")
      } catch (error) { console.warn("Could not publish the running exam to Focal:", error) }
      try {
        if (sac?.id && !known.has(sac.id)) await saveTimerSessionChange(undefined, sac, "sac")
      } catch (error) { console.warn("Could not publish the running SAC to Focal:", error) }
    }
    const pull = async () => {
      if (pulling || cancelled) return
      pulling = true
      try {
        let cursor = (await readSyncMeta(userId)).cursor
        for (;;) {
          const { data: raw, error } = await supabase!.rpc("sync_read_changes", {
            p_after: readCursorFor(cursor, canonicalSessions.current.size, readWholeState.current),
            p_limit: 1000, p_expected_user_id: userId,
          })
          if (error) throw error
          if (!isRecord(raw) || typeof raw.head !== "number" || typeof raw.server_now !== "string") throw new Error("Malformed sync_read_changes response")
          if (raw.mode !== "snapshot" && raw.mode !== "changes") throw new Error("Malformed sync_read_changes mode")
          if (raw.mode === "snapshot") readWholeState.current = true
          clockAnchor = observeServerClock(raw.server_now, performance.now())
          const rows = raw.rows
          const sessions = Array.isArray(rows) ? rows.flatMap((item) => {
            if (!isRecord(item) || item.entity !== "study_sessions") return []
            const session = parseCanonicalStudySession(item.payload)
            return session ? [session] : []
          }) : []
          acceptSessions(sessions, raw.mode === "snapshot")
          await refreshQueue()
          await adopt(sessions)
          const page = raw.mode === "changes" && Array.isArray(raw.rows) ? raw.rows : []
          cursor = raw.mode === "snapshot" ? raw.head : page.reduce((highest, item) =>
            isRecord(item) && typeof item.seq === "number" ? Math.max(highest, item.seq) : highest, cursor)
          const meta = await readSyncMeta(userId)
          await writeSyncMeta({ ...meta, cursor })
          if (raw.mode === "snapshot" || cursor >= raw.head || page.length < 1000) break
        }
      } catch (error) {
        if (!cancelled) console.error("Could not pull shared study sessions:", error)
      } finally {
        pulling = false
      }
    }

    const start = async () => {
      // Commands left on disk by a closed tab or a dead connection go before anything else.
      await refreshQueue()
      void requestFlush()
      await pull()
      if (cancelled) return
      initialized.current = true
      await publishLocalTimer()
      await pull()
    }
    void start()

    const channel = supabase.channel(`focal-study-sessions-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sync_log", filter: `user_id=eq.${userId}` }, () => {
        window.dispatchEvent(new Event("examtrack:sync-wakeup"))
        void pull()
      })
      .subscribe()
    const onOnline = () => { void requestFlush(); void pull().then(() => publishLocalTimer()) }
    const onFocus = () => { void requestFlush(); void pull() }
    const checkpoint = () => {
      const current = dataRef.current
      for (const timer of [current.activeExamTimer, current.activeSacTimer]) {
        if (timer?.id && timer.pausedAt === undefined) void checkpointSessionTiming(userId, timer.id)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") { checkpoint(); onFocus() }
    }
    // Another tab queued, sent or settled something: look again.
    const stopAnnounce = onAnnounce(() => { void refreshQueue(); void pull(); void requestFlush() })
    // A refreshed token is what ends an auth hold.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "TOKEN_REFRESHED" || event === "SIGNED_IN") void requestFlush()
    })
    const timer = window.setInterval(onFocus, 15_000)
    const timingTimer = window.setInterval(checkpoint, 1_000)
    window.addEventListener("online", onOnline)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      initialized.current = false
      queueSink = null
      signedInAccount = null
      scheduleWake(null)
      stopAnnounce()
      subscription.unsubscribe()
      clearInterval(timer)
      clearInterval(timingTimer)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
      void supabase?.removeChannel(channel)
    }
  }, [userId, setData, acceptSessions, refreshQueue])

  /** Commit the command, show its effect, start delivery. Resolves when it is safe on disk. */
  async function submit(command: StudySessionCommand) {
    await queueCommand(userId!, command)
  }

  async function log(entry: PastStudyLog, id: string) {
    const metadata = { subjectIds: [entry.subjectId], reflection: { notes: entry.notes }, createdVia: "manual", schedule: { blocks: entry.blocks } }
    if (userId && supabase) {
      // The checks the server will make, made here first so a bad entry is a readable error now, not a rejection later.
      guestSession(id, { title: entry.title, subjectId: entry.subjectId, blocks: entry.blocks, completed: true, metadata })
      await submit({ mutation_id: id, session_id: id, expected_revision: 0,
        action: "log", app: "examtrack", kind: "focus", phase: "focus", device_id: deviceId(),
        title: entry.title, subject_id: entry.subjectId, metadata, blocks: entry.blocks })
    } else {
      const session = guestSession(id, { title: entry.title, subjectId: entry.subjectId, blocks: entry.blocks, completed: true, metadata })
      saveGuest([...guestPastStudy().filter((item) => item.id !== id), session])
      acceptSessions([session])
    }
  }

  /** Schedule study that has not happened yet: a session with times and `completed` false. */
  async function plan(entries: Array<{ title: string; subjectId?: string; start: string; end: string; description?: string; topics?: string[] }>) {
    const planned = entries.map((entry) => {
      const id = crypto.randomUUID()
      const blocks = [{ start: entry.start, end: entry.end }]
      const metadata = {
        subjectIds: entry.subjectId ? [entry.subjectId] : [], createdVia: "manual",
        description: entry.description, topics: entry.topics, schedule: { blocks },
      }
      return { entry, id, blocks, metadata, session: guestSession(id, { title: entry.title, subjectId: entry.subjectId, blocks, completed: false, metadata }) }
    })
    for (const { entry, id, blocks, metadata, session } of planned) {
      if (userId && supabase) {
        await submit({ mutation_id: id, session_id: id, expected_revision: 0,
          action: "create", app: "examtrack", kind: "focus", phase: "focus", device_id: deviceId(),
          title: entry.title, subject_id: entry.subjectId ?? null, metadata, blocks })
      } else {
        saveGuest([...guestPastStudy(), session])
        acceptSessions([session])
      }
    }
    return planned.length
  }

  /** Move or resize a session's blocks, or mark it done or not done. Any session that is not running. */
  async function edit(session: CanonicalStudySession, patch: { blocks?: Block[]; completed?: boolean }) {
    const next = guestApply(session, patch)
    if (!userId || !supabase) {
      saveGuest(guestPastStudy().map((item) => item.id === session.id ? next : item))
      return acceptSessions([next])
    }
    await submit({ mutation_id: crypto.randomUUID(), session_id: session.id,
      expected_revision: canonicalSessions.current.get(session.id)?.revision ?? session.revision,
      action: "save_progress", app: "examtrack", device_id: deviceId(), ...patch })
  }

  /** Delete a session: cancel it on the server (a tombstone every device sees), or drop it from this browser when signed out. */
  async function remove(session: CanonicalStudySession) {
    if (!userId || !supabase) {
      saveGuest(guestPastStudy().filter((item) => item.id !== session.id))
      return acceptSessions(guestPastStudy(), true)
    }
    // No timing fields: a boundary estimate has no meaning for a session that finished days ago.
    await submit({ mutation_id: crypto.randomUUID(), session_id: session.id,
      expected_revision: canonicalSessions.current.get(session.id)?.revision ?? session.revision,
      action: "cancel", app: "examtrack", device_id: deviceId() })
  }

  return { sessions, queued, plan, edit, remove, log, control: async (session, action) => {
    await controlSession(session, action)
    // Hold the caller's spinner until the server has answered, as long as it answers promptly.
    await requestFlush()
    if (userId && (await readQueue(userId)).some((entry) => entry.sessionId === session.id)) {
      toast("Saved on this device", { description: "It will sync when the connection is back." })
    }
  } }
}

function estimateNow(): number {
  return clockAnchor && typeof performance !== "undefined"
    ? estimateServerNow(clockAnchor, performance.now())
    : Date.now()
}

/** The server row is the timer. No pending window to reconcile: a local edit that has not
 * been accepted by the server is simply not the timer's state yet. */
async function applyCanonicalSessions(sessions: readonly CanonicalStudySession[], nowMs: number, current: AppData): Promise<AppData> {
  if (sessions.length === 0) return current
  let changed = false
  let next = current
  for (const session of sessions) {
    if (session.kind === "focus") {
      adoptRemoteFocusSessionChange(session, nowMs)
      continue
    }
    const sameExam = next.activeExamTimer?.id === session.id
    const sameSac = next.activeSacTimer?.id === session.id
    if (session.completed || isDeleted(session)) {
      if (sameExam) { next = { ...next, activeExamTimer: undefined }; changed = true }
      if (sameSac) { next = { ...next, activeSacTimer: undefined }; changed = true }
      continue
    }
    if (session.originating_app !== "examtrack" || (session.kind !== "exam" && session.kind !== "sac")) continue
    const elapsedMs = studySessionActiveMilliseconds(session, nowMs)
    const metadata = session.metadata
    const legacy = isRecord(metadata.legacy_metadata) ? metadata.legacy_metadata : metadata
    const examMetadata = isRecord(metadata.examtrack) ? metadata.examtrack : isRecord(legacy.examtrack) ? legacy.examtrack : legacy
    const prior = session.kind === "exam" ? next.activeExamTimer : next.activeSacTimer
    const priorSame = prior?.id === session.id ? prior : undefined
    if (session.kind === "exam") {
      const merged = { ...priorSame, ...examMetadata } as Partial<ExamTimerSession>
      if (typeof merged.examYear !== "number" || typeof merged.paper !== "string" || typeof merged.readingMinutes !== "number" || typeof merged.writingMinutes !== "number" || typeof merged.marks !== "number") continue
      const timer: ExamTimerSession = {
        ...(merged as ExamTimerSession), id: session.id, revision: session.revision,
        subject: session.subject_id ?? merged.subject ?? "", title: session.title,
        startedAt: nowMs - elapsedMs, pausedAt: isPaused(session) ? nowMs : undefined,
        pausedSeconds: merged.pausedSeconds ?? 0, phase: session.phase === "writing" ? "writing" : "reading",
      }
      if (!sameTimer(next.activeExamTimer, timer)) { next = { ...next, activeExamTimer: timer }; changed = true }
    } else {
      const merged = { ...priorSame, ...examMetadata } as Partial<SacTimerSession>
      if (typeof merged.provider !== "string" || typeof merged.unit !== "string" || typeof merged.scheduledAt !== "string" || typeof merged.durationMinutes !== "number" || typeof merged.maxScore !== "number") continue
      const timer: SacTimerSession = {
        ...(merged as SacTimerSession), id: session.id, revision: session.revision,
        subject: session.subject_id ?? merged.subject ?? "", title: session.title,
        startedAt: nowMs - elapsedMs, pausedAt: isPaused(session) ? nowMs : undefined,
        pausedSeconds: merged.pausedSeconds ?? 0,
      }
      if (!sameTimer(next.activeSacTimer, timer)) { next = { ...next, activeSacTimer: timer }; changed = true }
    }
  }
  return changed ? next : current
}

/** A remote change to this device's open focus session. The server row is the timer:
 *  it is adopted into the store here so the change survives a closed timer page, and
 *  the event moves a mounted timer's countdown and session mirror with it. Rows for
 *  sessions this device never opened are somebody else's timer and are left alone. */
function adoptRemoteFocusSessionChange(session: CanonicalStudySession, nowMs: number): void {
  const local = loadFocusSession()
  if (local?.id !== session.id || (session.revision ?? 0) <= (local.revision ?? 0)) return
  const closed = session.completed || isDeleted(session)
  const projected = closed ? undefined : projectTimerSession(session, local, "focus")
  adoptRemoteFocusSession(projected, nowMs)
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("focal-web:focus-session-remote", {
      detail: { id: session.id, session: projected },
    }))
  }
}

function sameTimer(first: TimerSession | undefined, second: TimerSession): boolean {
  if (!first) return false
  const firstPhase = "phase" in first ? first.phase : undefined
  const secondPhase = "phase" in second ? second.phase : undefined
  return first.id === second.id && first.revision === second.revision && first.startedAt === second.startedAt && first.pausedAt === second.pausedAt && firstPhase === secondPhase
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
