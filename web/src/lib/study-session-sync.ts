import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { AppData } from "@/lib/exam-data"
import { saveAppData } from "@/lib/storage"
import { supabase } from "@/lib/supabase"
import type { ExamTimerSession, FocusTimerSession, SacTimerSession } from "@/lib/ongoing-timers"
import {
  estimateServerNow,
  observeServerClock,
  parseCanonicalStudySession,
  parseStudySessionMutationResult,
  studySessionActiveMilliseconds,
  type CanonicalStudySession,
  type StudySessionAction,
  type StudySessionCommand,
  type StudySessionMutationResult,
} from "../../../src/lib/sync/sessionContract"

const OUTBOX_DB = "examtrack-sync"
const META_STORE = "sync-meta"
const TIMING_STORE = "session-timing"
const DEVICE_KEY = "examtrack:study-session-device:v1"
const CURSOR_KEY = "examtrack:study-session-cursor:v1"

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
 * One lifecycle action, one call, one answer. The server state machine is the only queue:
 * the canonical session comes back in the response, and a failure is reported to the user
 * rather than parked in a local outbox for later replay. Signed out means local-only.
 *
 * The result is always what the *server* did. Blending the requested state into the server's
 * revision would let a rejected command masquerade as an applied one, which is how a timer
 * ends up reading `paused` in the browser and `running` on the server.
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
  const action = terminalAction ?? actionFor(previous, next, kind)
  const command = await buildCommand(previous, current, kind, action, id)
  const result = await publishCommand(command)
  // No account, no server, so there is nothing to reconcile against and the local
  // timer is the whole truth.
  if (!result) return next ? current : undefined
  return reconcileSessionResult(result, command, current, next !== undefined, kind)
}

/**
 * Turns a server answer into the local session, or throws because the answer refused it.
 *
 * Three outcomes, and no fourth:
 *   - the command was applied          -> the server's row, projected
 *   - it was not applied, but the row  -> the server's row, projected
 *     is already in the state asked for
 *   - neither                         -> the command was refused; report it
 *
 * Blending the requested state into the server's revision is what this replaces. That
 * produced a timer reading `paused` in the browser while the server still counted it as
 * `running`, and the next cursor pull snapped the readout forward by however long the
 * disagreement had lasted.
 */
export function reconcileSessionResult<T extends TimerSession>(
  result: StudySessionMutationResult,
  command: StudySessionCommand,
  current: T,
  keepOpen: boolean,
  kind: TimerKind,
): T | undefined {
  const canonical = result.session
  if (!canonical) throw new Error("The server sent a session response with no session")
  if (!result.applied && !actionSatisfied(canonical, command)) {
    throw new Error(`This timer changed on another device (${result.reason ?? "unknown"}).`)
  }
  // A closing command has no session left to hand back, and neither has one that somebody
  // else closed. The cursor pull brings the closed row in either way.
  if (!keepOpen || canonical.state === "completed" || canonical.state === "cancelled") return undefined
  return projectTimerSession(canonical, current, kind)
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
    pausedAt: canonical.state === "paused" ? now : undefined,
  } as T
}

/** Did the command fail only because the session had already been put in the state it wanted? */
function actionSatisfied(session: CanonicalStudySession, command: StudySessionCommand): boolean {
  if (command.action === "start" || command.action === "resume") return session.state === "running"
  if (command.action === "pause") return session.state === "paused"
  if (command.action === "complete") return session.state === "completed"
  if (command.action === "cancel") return session.state === "cancelled"
  if (command.action === "phase_change") return session.phase === command.phase
  // `create` and `save_progress` carry no lifecycle claim, so there is nothing to contradict.
  return true
}

export async function controlSession(
  session: CanonicalStudySession,
  action: Extract<StudySessionAction, "pause" | "resume" | "complete" | "cancel">,
): Promise<void> {
  const accountId = await commandAccountId()
  const command: StudySessionCommand = {
    mutation_id: crypto.randomUUID(), session_id: session.id, expected_revision: session.revision,
    action, device_id: deviceId(), app: "examtrack", kind: session.kind, phase: session.phase ?? "focus",
    title: session.title, subject_id: session.subject_id ?? undefined, metadata: session.metadata,
    ...await captureCommandTiming(accountId, session.id, action),
  }
  const result = await publishCommand(command)
  if (result && !result.applied && result.session && !actionSatisfied(result.session, command)) {
    throw new Error(`This timer changed on another device (${result.reason ?? "unknown"}).`)
  }
}

export async function buildCommand(
  previous: TimerSession | undefined,
  current: TimerSession,
  kind: TimerKind,
  action: StudySessionAction,
  id: string,
): Promise<StudySessionCommand> {
  const accountId = await commandAccountId()
  return {
    mutation_id: crypto.randomUUID(),
    session_id: id,
    // The same timer ID through start → pause → resume → complete, versioned only by the
    // revision the server last handed back.
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

/** The only write path for a session. Throws with a readable message so the UI can say so.
 *  Returns null when there is no server to answer, and the full verdict otherwise. */
async function publishCommand(command: StudySessionCommand): Promise<StudySessionMutationResult | null> {
  const accountId = await commandAccountId()
  if (!supabase || accountId === "guest") return null
  const { data, error } = await supabase.rpc("study_session_mutate", {
    p_command: { ...command, expected_user_id: accountId },
  })
  if (error) throw new Error(error.message)
  const result = parseStudySessionMutationResult(data)
  if (!result) throw new Error("The server sent an unreadable session response")
  clockAnchor = observeServerClock(result.server_now, performance.now())
  // The boundary is real now, so it may move the local anchor -- but the server's own boundary
  // is the better anchor, so it wins when there is one. Only a command the server accepted
  // moved a real boundary, so a rejected one leaves the anchor where it was.
  const sessions = result.applied && result.session ? [result.session] : []
  const anchored = await rememberCanonicalTiming(accountId, sessions)
  if (!anchored && result.applied) await commitCommandTiming(accountId, command.session_id, command.action)
  return result
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
export function elapsedSinceBoundary(
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
    const boundary = session.timing_at ?? (session.state === "running" ? session.segment_started_at : session.paused_at)
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
    const request = indexedDB.open(OUTBOX_DB, 2)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(META_STORE)) database.createObjectStore(META_STORE, { keyPath: "key" })
      if (!database.objectStoreNames.contains(TIMING_STORE)) database.createObjectStore(TIMING_STORE, { keyPath: "key" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open the local study-session outbox"))
  })
  return outboxDatabase
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Local outbox read failed"))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Local outbox transaction failed"))
  })
}

export function useStudySessionSync(
  userId: string | undefined,
  data: AppData,
  setData: Dispatch<SetStateAction<AppData>>,
): { sessions: CanonicalStudySession[]; control: typeof controlSession } {
  const dataRef = useRef(data)
  dataRef.current = data
  const initialized = useRef(false)
  const canonicalSessions = useRef(new Map<string, CanonicalStudySession>())
  const [sessions, setSessions] = useState<CanonicalStudySession[]>([])

  const acceptSessions = (incoming: readonly CanonicalStudySession[], replace = false) => {
    const next = replace ? new Map<string, CanonicalStudySession>() : new Map(canonicalSessions.current)
    for (const session of incoming) {
      const previous = next.get(session.id)
      if (!previous || previous.revision <= session.revision) next.set(session.id, session)
    }
    canonicalSessions.current = next
    setSessions([...next.values()].toSorted((left, right) => left.created_at.localeCompare(right.created_at)))
  }

  useEffect(() => {
    if (!userId || !supabase) {
      initialized.current = false
      canonicalSessions.current = new Map()
      setSessions([])
      return
    }
    canonicalSessions.current = new Map()
    setSessions([])
    let cancelled = false
    let pulling = false
    /** Offline start, back online: publish the timer the user is looking at. One call, no queue. */
    const publishLocalTimer = async () => {
      const known = new Set(canonicalSessions.current.keys())
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
            p_after: cursor, p_limit: 1000, p_expected_user_id: userId,
          })
          if (error) throw error
          if (!isRecord(raw) || typeof raw.head !== "number" || typeof raw.server_now !== "string") throw new Error("Malformed sync_read_changes response")
          if (raw.mode !== "snapshot" && raw.mode !== "changes") throw new Error("Malformed sync_read_changes mode")
          clockAnchor = observeServerClock(raw.server_now, performance.now())
          const rows = raw.rows
          const sessions = Array.isArray(rows) ? rows.flatMap((item) => {
            if (!isRecord(item) || item.entity !== "study_sessions") return []
            const session = parseCanonicalStudySession(item.payload)
            return session ? [session] : []
          }) : []
          acceptSessions(sessions, raw.mode === "snapshot")
          await rememberCanonicalTiming(userId, sessions)
          const projected = await applyCanonicalSessions(sessions, estimateNow(), dataRef.current)
          if (projected !== dataRef.current) {
            dataRef.current = projected
            saveAppData(projected)
            setData(projected)
          }
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
      await pull()
      if (cancelled) return
      initialized.current = true
      // A timer that was started offline is not on the server yet. Publishing it once is the
      // whole reconciliation story: no queue, no replay, just "tell the server what I have".
      await publishLocalTimer()
      await pull()
    }
    void start()

    const channel = supabase.channel(`examtrack-study-sessions-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sync_log", filter: `user_id=eq.${userId}` }, () => {
        window.dispatchEvent(new Event("examtrack:sync-wakeup"))
        void pull()
      })
      .subscribe()
    const onOnline = () => void pull().then(() => publishLocalTimer())
    const onFocus = () => void pull()
    const checkpoint = () => {
      const current = dataRef.current
      for (const timer of [current.activeExamTimer, current.activeSacTimer]) {
        if (timer?.id && timer.pausedAt === undefined) void checkpointSessionTiming(userId, timer.id)
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === "visible") { checkpoint(); onFocus() }
    }
    const timer = window.setInterval(() => void pull(), 15_000)
    const timingTimer = window.setInterval(checkpoint, 1_000)
    window.addEventListener("online", onOnline)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      cancelled = true
      initialized.current = false
      clearInterval(timer)
      clearInterval(timingTimer)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
      void supabase?.removeChannel(channel)
    }
  }, [userId, setData])

  return { sessions, control: controlSession }
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
    const sameExam = next.activeExamTimer?.id === session.id
    const sameSac = next.activeSacTimer?.id === session.id
    if (session.state === "completed" || session.state === "cancelled") {
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
        startedAt: nowMs - elapsedMs, pausedAt: session.state === "paused" ? nowMs : undefined,
        pausedSeconds: merged.pausedSeconds ?? 0, phase: session.phase === "writing" ? "writing" : "reading",
      }
      if (!sameTimer(next.activeExamTimer, timer)) { next = { ...next, activeExamTimer: timer }; changed = true }
    } else {
      const merged = { ...priorSame, ...examMetadata } as Partial<SacTimerSession>
      if (typeof merged.provider !== "string" || typeof merged.unit !== "string" || typeof merged.scheduledAt !== "string" || typeof merged.durationMinutes !== "number" || typeof merged.maxScore !== "number") continue
      const timer: SacTimerSession = {
        ...(merged as SacTimerSession), id: session.id, revision: session.revision,
        subject: session.subject_id ?? merged.subject ?? "", title: session.title,
        startedAt: nowMs - elapsedMs, pausedAt: session.state === "paused" ? nowMs : undefined,
        pausedSeconds: merged.pausedSeconds ?? 0,
      }
      if (!sameTimer(next.activeSacTimer, timer)) { next = { ...next, activeSacTimer: timer }; changed = true }
    }
  }
  return changed ? next : current
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
