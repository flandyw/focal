import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { AppData } from "@/lib/exam-data"
import { saveAppData } from "@/lib/storage"
import { supabase } from "@/lib/supabase"
import { isExamTimerSession, isFocusTimerSession, isSacTimerSession, type ExamTimerSession, type FocusTimerSession, type SacTimerSession } from "@/lib/ongoing-timers"
import {
  estimateServerNow,
  isStudySessionCommand,
  observeServerClock,
  parseCanonicalStudySession,
  parseStudySessionMutationResult,
  studySessionActiveMilliseconds,
  type CanonicalStudySession,
  type StudySessionAction,
  type StudySessionCommand,
} from "../../../src/lib/sync/sessionContract"

const OUTBOX_DB = "examtrack-sync"
const OUTBOX_STORE = "study-session-commands"
const LEGACY_COMMAND_OUTBOX_KEY = "examtrack:study-session-outbox:v1"
const DEVICE_KEY = "examtrack:study-session-device:v1"
const OWNER_KEY = "examtrack:sync:owner:v1"
const CURSOR_KEY = "examtrack:study-session-cursor:v1"
const REVISION_KEY = "examtrack:study-session-revisions:v1"
const LEGACY_FOCAL_OUTBOX_KEY = "examtrack.focal-timer-outbox:v1"

type TimerKind = "exam" | "sac" | "focus"
type TimerSession = ExamTimerSession | SacTimerSession | FocusTimerSession
type PendingCommand = {
  queueId: string
  accountId: string
  command: StudySessionCommand
  localTimer?: TimerSession
  attempted: boolean
  queuedAt: number
}

let clockAnchor: ReturnType<typeof observeServerClock> = null
let flushTask: Promise<void> | null = null
let outboxDatabase: Promise<IDBDatabase> | null = null

export function canonicalNow(): Date {
  const time = clockAnchor && typeof performance !== "undefined"
    ? estimateServerNow(clockAnchor, performance.now())
    : Date.now()
  return new Date(time)
}

export function queueTimerSessionChange(
  previous: ExamTimerSession | undefined,
  next: ExamTimerSession | undefined,
  kind: "exam",
  terminalAction?: "cancel" | "complete",
): Promise<ExamTimerSession | undefined>
export function queueTimerSessionChange(
  previous: SacTimerSession | undefined,
  next: SacTimerSession | undefined,
  kind: "sac",
  terminalAction?: "cancel" | "complete",
): Promise<SacTimerSession | undefined>
export function queueTimerSessionChange(
  previous: FocusTimerSession | undefined,
  next: FocusTimerSession | undefined,
  kind: "focus",
  terminalAction?: "cancel" | "complete",
): Promise<FocusTimerSession | undefined>
export async function queueTimerSessionChange(
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
  const mutationId = crypto.randomUUID()
  const command: StudySessionCommand = {
    mutation_id: mutationId,
    session_id: id,
    expected_revision: current.revision ?? previous?.revision ?? 0,
    action,
    device_id: deviceId(),
    app: "examtrack",
    kind,
    phase: phaseFor(current, kind),
    title: current.title,
    subject_id: current.subject,
    metadata: timerMetadata(current, kind, id),
  }
  const accountId = localStorage.getItem(OWNER_KEY) ?? ""
  const entry: PendingCommand = { queueId: crypto.randomUUID(), accountId, command, localTimer: current, attempted: false, queuedAt: Date.now() }
  // Save progress is replaceable while it has not been sent; lifecycle commands remain ordered.
  await mutateOutbox((entries) => {
    if (action === "save_progress") {
      const index = entries.findLastIndex((item) => item.command.session_id === id && item.command.action === "save_progress" && !item.attempted)
      if (index >= 0) entries.splice(index, 1)
    }
    entries.push(entry)
    return entries
  })
  window.dispatchEvent(new Event("examtrack:study-session-outbox"))
  return next ? current : undefined
}

export async function queueCanonicalSessionAction(
  session: CanonicalStudySession,
  action: Extract<StudySessionAction, "pause" | "resume" | "complete" | "cancel">,
): Promise<void> {
  const command: StudySessionCommand = {
    mutation_id: crypto.randomUUID(), session_id: session.id, expected_revision: session.revision,
    action, device_id: deviceId(), app: "examtrack", kind: session.kind, phase: session.phase ?? "focus",
    title: session.title, subject_id: session.subject_id ?? undefined, metadata: session.metadata,
  }
  const entry: PendingCommand = {
    queueId: crypto.randomUUID(), accountId: localStorage.getItem(OWNER_KEY) ?? "", command,
    attempted: false, queuedAt: Date.now(),
  }
  await mutateOutbox((entries) => [...entries, entry])
  window.dispatchEvent(new Event("examtrack:study-session-outbox"))
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

function openOutboxDatabase(): Promise<IDBDatabase> {
  if (outboxDatabase) return outboxDatabase
  outboxDatabase = new Promise((resolve, reject) => {
    const request = indexedDB.open(OUTBOX_DB, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(OUTBOX_STORE, { keyPath: "queueId" })
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open the local study-session outbox"))
  })
  return outboxDatabase
}

function isPendingCommand(entry: unknown): entry is PendingCommand {
  return isRecord(entry) && typeof entry.queueId === "string" && typeof entry.accountId === "string" &&
    isStudySessionCommand(entry.command) && typeof entry.attempted === "boolean" && Number.isFinite(entry.queuedAt) &&
    (entry.localTimer === undefined || isExamTimerSession(entry.localTimer) || isSacTimerSession(entry.localTimer) || isFocusTimerSession(entry.localTimer))
}

async function readOutbox(): Promise<PendingCommand[]> {
  const database = await openOutboxDatabase()
  const transaction = database.transaction(OUTBOX_STORE, "readonly")
  const request = transaction.objectStore(OUTBOX_STORE).getAll()
  const [entries] = await Promise.all([requestResult(request), transactionDone(transaction)])
  return (entries as unknown[]).filter(isPendingCommand)
}

async function mutateOutbox(change: (entries: PendingCommand[]) => PendingCommand[]): Promise<void> {
  const database = await openOutboxDatabase()
  const transaction = database.transaction(OUTBOX_STORE, "readwrite")
  const store = transaction.objectStore(OUTBOX_STORE)
  const request = store.getAll()
  request.onsuccess = () => {
    const entries = (request.result as unknown[]).filter(isPendingCommand)
    store.clear()
    for (const entry of change(entries)) store.put(entry)
  }
  await transactionDone(transaction)
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

function readRevisions(userId: string): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(`${REVISION_KEY}:${userId}`) ?? "{}") as unknown
    return isRecord(value) ? Object.fromEntries(Object.entries(value).filter((entry): entry is [string, number] =>
      Number.isSafeInteger(entry[1]) && (entry[1] as number) >= 0)) : {}
  } catch {
    return {}
  }
}

async function restoreLegacyOutbox(): Promise<void> {
  const priorCommands = localStorage.getItem(LEGACY_COMMAND_OUTBOX_KEY)
  if (priorCommands) {
    try {
      const decoded: unknown = JSON.parse(priorCommands)
      if (Array.isArray(decoded)) {
        await mutateOutbox((entries) => [...entries, ...decoded.filter(isPendingCommand)])
        localStorage.removeItem(LEGACY_COMMAND_OUTBOX_KEY)
      }
    } catch (error) {
      console.error("Could not migrate queued study session commands:", error)
    }
  }
  const raw = localStorage.getItem(LEGACY_FOCAL_OUTBOX_KEY)
  if (!raw) return
  const entries = await readOutbox()
  try {
    const legacy = JSON.parse(raw) as Record<string, { nonce?: string; operation?: string; link?: Record<string, unknown> }>
    for (const item of Object.values(legacy)) {
      const link = item.link
      if (!link || typeof link.sessionId !== "string" || (link.kind !== "exam" && link.kind !== "sac")) continue
      const action: StudySessionAction = item.operation === "delete" ? "cancel" : item.operation === "completed" ? "complete" : item.operation === "paused" ? "pause" : "start"
      const mutationId = typeof item.nonce === "string" ? item.nonce : crypto.randomUUID()
      const kind = link.kind
      const sessionId = link.sessionId
      const localTimer: TimerSession = kind === "exam" ? {
        id: sessionId, subject: String(link.subject ?? ""), provider: "", title: String(link.title ?? "Exam"),
        examYear: new Date().getFullYear(), paper: "", readingMinutes: Math.max(0, Math.round(Number(link.readingSeconds ?? 0) / 60)),
        writingMinutes: Math.max(1, Math.round((Number(link.plannedSeconds ?? 3600) - Number(link.readingSeconds ?? 0)) / 60)),
        marks: 1, startedAt: Date.now(), pausedSeconds: 0,
        phase: link.phase === "writing" ? "writing" as const : "reading" as const,
      } as ExamTimerSession : {
        id: sessionId, subject: String(link.subject ?? ""), provider: "", title: String(link.title ?? "SAC"),
        unit: 1, scheduledAt: new Date().toISOString(), durationMinutes: Math.max(1, Math.round(Number(link.plannedSeconds ?? 3600) / 60)),
        maxScore: 1, startedAt: Date.now(), pausedSeconds: 0,
      } as SacTimerSession
      const command: StudySessionCommand = {
        mutation_id: mutationId, session_id: sessionId, expected_revision: 0, action, device_id: deviceId(),
        app: "examtrack", kind, phase: phaseFor(localTimer, kind),
        title: localTimer.title, subject_id: localTimer.subject,
        metadata: timerMetadata(localTimer, kind, sessionId),
      }
      if (isStudySessionCommand(command) && !entries.some((entry) => entry.command.mutation_id === mutationId)) {
        entries.push({ queueId: crypto.randomUUID(), accountId: localStorage.getItem(OWNER_KEY) ?? "", command, localTimer, attempted: false, queuedAt: Date.now() })
      }
    }
    await mutateOutbox((current) => [...current, ...entries.filter((entry) => !current.some((item) => item.command.mutation_id === entry.command.mutation_id))])
    localStorage.removeItem(LEGACY_FOCAL_OUTBOX_KEY)
  } catch (error) {
    console.error("Could not migrate queued legacy timer changes:", error)
  }
}

export function useStudySessionSync(
  userId: string | undefined,
  data: AppData,
  setData: Dispatch<SetStateAction<AppData>>,
): { sessions: CanonicalStudySession[]; control: typeof queueCanonicalSessionAction } {
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
    const cursorStorageKey = `${CURSOR_KEY}:${userId}`
    const pull = async () => {
      if (pulling || cancelled) return
      pulling = true
      try {
        let cursor = Number(localStorage.getItem(cursorStorageKey) ?? "0")
        for (;;) {
          const { data: raw, error } = await supabase!.rpc("sync_read_changes", { p_after: cursor, p_limit: 1000 })
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
          const projected = await applyCanonicalSessions(userId, sessions, estimateNow(), dataRef.current)
          if (projected !== dataRef.current) {
            dataRef.current = projected
            saveAppData(projected)
            setData(projected)
          }
          const page = raw.mode === "changes" && Array.isArray(raw.rows) ? raw.rows : []
          cursor = raw.mode === "snapshot" ? raw.head : page.reduce((highest, item) =>
            isRecord(item) && typeof item.seq === "number" ? Math.max(highest, item.seq) : highest, cursor)
          localStorage.setItem(cursorStorageKey, String(cursor))
          if (raw.mode === "snapshot" || cursor >= raw.head || page.length < 1000) break
        }
      } catch (error) {
        if (!cancelled) console.error("Could not pull shared study sessions:", error)
      } finally {
        pulling = false
      }
    }

    const flush = async () => {
      if (!initialized.current || cancelled || flushTask) return flushTask
      flushTask = (async () => {
        const revisions = readRevisions(userId)
        const queued = await readOutbox()
        const entries = queued.filter((entry) => entry.accountId === userId || entry.accountId === "").sort((a, b) => a.queuedAt - b.queuedAt)
        if (entries.some((entry) => entry.accountId === "")) {
          await mutateOutbox((all) => all.map((entry) => entry.accountId === "" ? { ...entry, accountId: userId } : entry))
        }
        for (let entry of entries) {
          if (cancelled) return
          let command = entry.command
          if (!entry.attempted) {
            command = { ...command, expected_revision: revisions[command.session_id] ?? command.expected_revision }
            entry = { ...entry, command, attempted: true }
            await replaceOutboxEntry(entry)
          }
          let staleRetries = 0
          for (;;) {
            const { data: raw, error } = await supabase!.rpc("study_session_mutate", { p_command: { ...command, device_id: deviceId() } })
            if (error) throw error
            const result = parseStudySessionMutationResult(raw)
            if (!result) throw new Error("Malformed study_session_mutate response")
            clockAnchor = observeServerClock(result.server_now, performance.now())
            if (result.session) {
              acceptSessions([result.session])
              revisions[result.session.id] = result.session.revision
              localStorage.setItem(`${REVISION_KEY}:${userId}`, JSON.stringify(revisions))
              const projected = await applyCanonicalSessions(userId, [result.session], estimateNow(), dataRef.current)
              if (projected !== dataRef.current) {
                dataRef.current = projected
                saveAppData(projected)
                setData(projected)
              }
            }
            if (result.reason === "stale_revision" && result.session && !actionSatisfied(command, result.session)) {
              command = { ...command, mutation_id: crypto.randomUUID(), expected_revision: result.session.revision }
              entry = { ...entry, command, attempted: false, queuedAt: Date.now() }
              await replaceOutboxEntry(entry)
              staleRetries += 1
              if (staleRetries < 3) {
                command = { ...command, expected_revision: result.session.revision }
                entry = { ...entry, command, attempted: true }
                await replaceOutboxEntry(entry)
                continue
              }
              window.setTimeout(() => void flush(), 1_000)
              break
            }
            if (!result.ok) console.warn("Study session command reconciled with server state:", result.reason)
            await removeOutboxEntry(entry.command.mutation_id)
            break
          }
        }
      })().catch((error) => {
        if (!cancelled) console.error("Could not flush queued study session commands:", error)
      }).finally(() => { flushTask = null })
      return flushTask
    }

    const start = async () => {
      await restoreLegacyOutbox()
      await pull()
      if (cancelled) return
      const restored = await restorePendingTimer(userId, dataRef.current)
      if (restored !== dataRef.current) {
        dataRef.current = restored
        saveAppData(restored)
        setData(restored)
      }
      await seedExistingTimer(userId, dataRef.current)
      initialized.current = true
      await flush()
      await pull()
    }
    void start()

    const channel = supabase.channel(`examtrack-study-sessions-${userId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sync_log", filter: `user_id=eq.${userId}` }, () => {
        window.dispatchEvent(new Event("examtrack:sync-wakeup"))
        void pull().then(() => flush())
      })
      .subscribe()
    const onOnline = () => void pull().then(() => flush())
    const onFocus = () => void pull().then(() => flush())
    const onVisibility = () => { if (document.visibilityState === "visible") onFocus() }
    const onQueued = () => void flush()
    const timer = window.setInterval(() => void pull().then(() => flush()), 15_000)
    window.addEventListener("online", onOnline)
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibility)
    window.addEventListener("examtrack:study-session-outbox", onQueued)
    return () => {
      cancelled = true
      initialized.current = false
      clearInterval(timer)
      window.removeEventListener("online", onOnline)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibility)
      window.removeEventListener("examtrack:study-session-outbox", onQueued)
      void supabase?.removeChannel(channel)
    }
  }, [userId, setData])

  return { sessions, control: queueCanonicalSessionAction }
}

function estimateNow(): number {
  return clockAnchor && typeof performance !== "undefined"
    ? estimateServerNow(clockAnchor, performance.now())
    : Date.now()
}

async function applyCanonicalSessions(userId: string, sessions: readonly CanonicalStudySession[], nowMs: number, current: AppData): Promise<AppData> {
  if (sessions.length === 0) return current
  const revisions = readRevisions(userId)
  const pendingIds = new Set((await readOutbox()).filter((entry) => entry.accountId === userId).map((entry) => entry.command.session_id))
  let changed = false
  let next = current
  for (const session of sessions) {
    revisions[session.id] = Math.max(revisions[session.id] ?? 0, session.revision)
    const pending = pendingIds.has(session.id)
    const sameExam = next.activeExamTimer?.id === session.id
    const sameSac = next.activeSacTimer?.id === session.id
    if (session.state === "completed" || session.state === "cancelled") {
      if (sameExam) { next = { ...next, activeExamTimer: undefined }; changed = true }
      if (sameSac) { next = { ...next, activeSacTimer: undefined }; changed = true }
      continue
    }
    if (pending && (sameExam || sameSac)) {
      if (sameExam && next.activeExamTimer!.revision !== session.revision) {
        next = { ...next, activeExamTimer: { ...next.activeExamTimer!, revision: session.revision } }
        changed = true
      }
      if (sameSac && next.activeSacTimer!.revision !== session.revision) {
        next = { ...next, activeSacTimer: { ...next.activeSacTimer!, revision: session.revision } }
        changed = true
      }
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
  localStorage.setItem(`${REVISION_KEY}:${userId}`, JSON.stringify(revisions))
  return changed ? next : current
}

async function restorePendingTimer(userId: string, data: AppData): Promise<AppData> {
  const pending = (await readOutbox()).filter((entry) => entry.accountId === userId).sort((a, b) => a.queuedAt - b.queuedAt)
  const latest = new Map<string, PendingCommand>()
  for (const entry of pending) latest.set(entry.command.session_id, entry)
  let next = data
  for (const entry of latest.values()) {
    if (entry.command.action === "cancel" || entry.command.action === "complete") {
      if (next.activeExamTimer?.id === entry.command.session_id) next = { ...next, activeExamTimer: undefined }
      if (next.activeSacTimer?.id === entry.command.session_id) next = { ...next, activeSacTimer: undefined }
    } else if (isExamTimerSession(entry.localTimer) && !sameTimer(next.activeExamTimer, entry.localTimer)) next = { ...next, activeExamTimer: entry.localTimer }
    else if (isSacTimerSession(entry.localTimer) && !sameTimer(next.activeSacTimer, entry.localTimer)) next = { ...next, activeSacTimer: entry.localTimer }
  }
  return next
}

async function seedExistingTimer(userId: string, data: AppData): Promise<void> {
  const revisions = readRevisions(userId)
  const queued = new Set((await readOutbox()).filter((entry) => entry.accountId === userId).map((entry) => entry.command.session_id))
  if (data.activeExamTimer && data.activeExamTimer.id && revisions[data.activeExamTimer.id] === undefined && !queued.has(data.activeExamTimer.id)) {
    await queueTimerSessionChange(undefined, data.activeExamTimer, "exam")
  }
  if (data.activeSacTimer && data.activeSacTimer.id && revisions[data.activeSacTimer.id] === undefined && !queued.has(data.activeSacTimer.id)) {
    await queueTimerSessionChange(undefined, data.activeSacTimer, "sac")
  }
}

async function replaceOutboxEntry(entry: PendingCommand): Promise<void> {
  await mutateOutbox((entries) => {
    const index = entries.findIndex((item) => item.queueId === entry.queueId)
    if (index < 0) entries.push(entry)
    else entries[index] = entry
    return entries
  })
}

async function removeOutboxEntry(mutationId: string): Promise<void> {
  await mutateOutbox((entries) => entries.filter((entry) => entry.command.mutation_id !== mutationId))
}

function actionSatisfied(command: StudySessionCommand, session: CanonicalStudySession): boolean {
  if (command.action === "start" || command.action === "resume") return session.state === "running"
  if (command.action === "pause") return session.state === "paused"
  if (command.action === "complete") return session.state === "completed"
  if (command.action === "cancel") return session.state === "cancelled"
  if (command.action === "phase_change") return session.phase === command.phase
  return command.action === "create"
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
