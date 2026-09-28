/**
 * The sync engine: session lifecycle, one push loop, one pull loop, and the status the
 * UI shows. It owns no protocol knowledge — ordering and merge rules live in `reduce.ts`,
 * the network in `transport.ts`, local projection in `applier.ts`, mirrors in `sinks.ts`.
 *
 * Two invariants hold the whole thing together:
 *   1. Nothing here awaits the network before a local write is durable. The UI reads
 *      local state and only ever hears about sync afterwards.
 *   2. There is exactly one push and one pull in flight per account, and both re-run if
 *      work arrived while they were running.
 */
import type { Session } from "@supabase/supabase-js"
import { getTimetableConfig } from "@/lib/settings"
import { enqueueNotionArchive } from "@/lib/notion/outbox"
import { supabase } from "@/lib/supabase/client"
import { applyRemoteEntries, collectUserSettings, readCurrentLocalValue } from "@/lib/sync/applier"
import { openFocalDatabase, withWriteLock, mutatePersistedArray } from "@/lib/storage/database"
import { getDeviceId } from "@/lib/sync/device"
import {
  emitLocalDataChanged,
  readLocalDataArray,
  readLocalStorageArray,
  SYNC_DATA_FILES,
} from "@/lib/sync/localData"
import {
  activateOutboxAccount,
  deferInboxChanges,
  enqueueChange,
  finishFlush,
  readApplied,
  readCursor,
  readInbox,
  readOutbox,
  readState,
  removeApplied,
  removeInboxChanges,
  removeOutboxChange,
  stageChange,
  writeApplied,
  writeCursor,
  writeState,
} from "@/lib/sync/persistence"
import {
  chunkItems,
  coalesceChanges,
  compareOrder,
  isDue,
  latestChanges,
  isSyncTable,
  reduceChanges,
  reduceSnapshot,
  retryOrBlockChange,
  rowKey,
} from "@/lib/sync/reduce"
import { getNotionDeleteMetadata, notionDeletePayload, recordNotionUpsertIntent } from "@/lib/sync/sinks"
import { repairDuplicateSessions, sessionCommands } from "@/lib/sync/sessions"
import {
  applyChanges,
  applyStudySessionCommand,
  describeSyncError,
  errorMessage,
  isNetworkError,
  isPermanentError,
  readChanges,
  subscribeWakeup,
} from "@/lib/sync/transport"
import {
  isStudySessionCommand,
  type CanonicalStudySession,
  type StudySessionCommand,
} from "@/lib/sync/sessionContract"
import {
  EMPTY_METRICS,
  type LocalRecord,
  type RemoteSyncChange,
  type SyncChange,
  type SyncMetrics,
  type SyncOperation,
  type SyncRowState,
  type SyncStatusSnapshot,
  type SyncTable,
  type SyncConflictItem,
} from "@/lib/sync/types"
import type { CalendarEvent, Project, StudySession, Subject } from "@/lib/types"

const MAX_RETRIES = 8
const PUSH_BATCH_SIZE = 100
const NOTION_UNDO_DELAY_MS = 8_000

/** Poll cadence. A dropped realtime ping costs at most one of these, never a change. */
const POLL_ACTIVE_MS = 1_000
const POLL_IDLE_MS = 15_000
const POLL_HIDDEN_MS = 60_000
const ACTIVE_WINDOW_MS = 30_000

interface SyncTask {
  accountId: string
  epoch: number
  rerunRequested: boolean
  promise: Promise<void>
}

let currentSession: Session | null = null
let currentDeviceId: string | null = null
let syncEpoch = 0
let flushTask: SyncTask | null = null
let pullTask: SyncTask | null = null
let stopWakeup: (() => void) | null = null
let pollTimer: ReturnType<typeof setTimeout> | null = null
let lastLocalChangeAt = 0
let detachEnvironmentListeners: (() => void) | null = null

let snapshot: SyncStatusSnapshot = {
  status: "signed-out",
  pendingCount: 0,
  error: null,
  lastSuccessfulSyncAt: null,
  details: null,
  tableStats: null,
  failedItems: null,
  conflicts: null,
  isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
  metrics: { ...EMPTY_METRICS },
}

const listeners = new Set<(status: SyncStatusSnapshot) => void>()

function emitStatus(update: Partial<SyncStatusSnapshot>): void {
  snapshot = { ...snapshot, ...update }
  listeners.forEach((listener) => listener(snapshot))
}

function emitMetrics(update: Partial<SyncMetrics>): void {
  emitStatus({ metrics: { ...snapshot.metrics, ...update } })
}

export function subscribeSyncStatus(listener: (status: SyncStatusSnapshot) => void): () => void {
  listeners.add(listener)
  listener(snapshot)
  return () => listeners.delete(listener)
}

export async function setSyncSession(session: Session | null): Promise<void> {
  const epoch = ++syncEpoch
  currentSession = session
  try {
    await activateOutboxAccount(session?.user.id ?? "")
    if (epoch !== syncEpoch) return
    stopRemoteSync()
    if (epoch !== syncEpoch) return
  } catch (error) {
    if (epoch !== syncEpoch) return
    const message = describeSyncError(error)
    emitStatus({ status: "error", error: message, details: message })
    return
  }

  if (!session || !supabase) {
    emitStatus({
      status: "signed-out",
      pendingCount: (await readOutbox()).length,
      error: null,
      details: null,
      tableStats: null,
      failedItems: null,
      conflicts: null,
    })
    return
  }

  try {
    currentDeviceId = await getDeviceId()
    if (epoch !== syncEpoch) return
    emitStatus({ status: "syncing", error: null, details: "Repairing local data…" })
    await repairLocalSessionDuplicates(session.user.id)
    if (epoch !== syncEpoch) return
    // Pull before publishing anything: a new device must not overwrite an account that
    // already has data with its own empty or default state.
    await pullRemoteChanges()
    if (epoch !== syncEpoch) return
    await bootstrapLocalState(session.user.id, epoch)
    if (epoch !== syncEpoch) return
    await flushQueue()
    if (epoch !== syncEpoch) return
    await pullRemoteChanges()
    if (epoch !== syncEpoch) return
    await repairLocalSessionDuplicates(session.user.id)
    if (epoch !== syncEpoch) return
    await flushQueue()
    if (epoch !== syncEpoch) return
    startRemoteSync(session.user.id)
  } catch (error) {
    if (epoch !== syncEpoch) return
    const message = describeSyncError(error)
    emitStatus({ status: "error", error: message, details: message })
  }
}

function startRemoteSync(userId: string): void {
  stopWakeup?.()
  stopWakeup = subscribeWakeup(userId, () => {
    // A wakeup only means "read from your cursor". It never carries a payload.
    void pullRemoteChanges()
    schedulePoll()
  })
  attachEnvironmentListeners()
  schedulePoll()
}

function stopRemoteSync(): void {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
  stopWakeup?.()
  stopWakeup = null
  detachEnvironmentListeners?.()
  detachEnvironmentListeners = null
  lastLocalChangeAt = 0
}

function pollIntervalMs(): number {
  if (typeof document !== "undefined" && document?.visibilityState === "hidden") return POLL_HIDDEN_MS
  return Date.now() - lastLocalChangeAt < ACTIVE_WINDOW_MS ? POLL_ACTIVE_MS : POLL_IDLE_MS
}

function schedulePoll(): void {
  if (pollTimer) clearTimeout(pollTimer)
  if (!currentSession) return
  pollTimer = setTimeout(() => {
    void pullRemoteChanges()
      .catch((error: unknown) => emitStatus({ error: describeSyncError(error) }))
      .finally(schedulePoll)
  }, pollIntervalMs())
}

/** Focus, visibility and connectivity are the moments a stale cursor is cheapest to fix. */
function attachEnvironmentListeners(): void {
  if (detachEnvironmentListeners) return
  const wake = () => {
    void pullRemoteChanges()
    schedulePoll()
  }
  const onVisibility = () => {
    if (typeof document === "undefined" || document.visibilityState === "visible") wake()
  }
  const onOnline = () => {
    emitStatus({ isOnline: true })
    // Everything the network ate while it was down is still queued. Push and pull both.
    void flushQueue().then(() => pullRemoteChanges())
    schedulePoll()
  }
  const onOffline = () => emitStatus({ isOnline: false })
  window.addEventListener("focus", wake)
  window.addEventListener("online", onOnline)
  window.addEventListener("offline", onOffline)
  if (typeof document !== "undefined") document.addEventListener("visibilitychange", onVisibility)
  detachEnvironmentListeners = () => {
    window.removeEventListener("focus", wake)
    window.removeEventListener("online", onOnline)
    window.removeEventListener("offline", onOffline)
    if (typeof document !== "undefined") document.removeEventListener("visibilitychange", onVisibility)
  }
}

// ---------------------------------------------------------------------------
// Local writes
// ---------------------------------------------------------------------------

/**
 * SIMPLEST IS LAW: the outbox is a failure log, not a holding pen. A local write is pushed
 * to the log straight away; only a change the server refuses (or the network eats) goes to
 * the durable queue for the push loop to retry. Nothing waits for a poll.
 */
async function pushOrQueue(
  accountId: string,
  table: SyncTable,
  rowId: string,
  operation: SyncOperation,
  payload: unknown,
): Promise<SyncChange[]> {
  const change = await stageChange(accountId, table, rowId, operation, payload)
  const deviceId = currentDeviceId ?? await getDeviceId()
  if (currentSession && supabase) {
    try {
      const { receipts } = await applyChanges([change], deviceId, currentSession.user.id)
      const receipt = receipts.find((item) => item.changeId === change.changeId)
      if (receipt) {
        // The receipt's seq is the newest version this device knows for the row, so the pull
        // of this very change is not mistaken for somebody else's newer edit.
        await writeApplied(currentSession.user.id, [{
          entity: change.entity, rowId: change.rowId, operation: change.operation, payload: change.payload,
          lamport: change.lamport, clientId: deviceId, seq: receipt.seq,
        }])
        return readOutbox(currentSession.user.id)
      }
    } catch {
      // Offline, signed out mid-write, or the server said no: the queue takes it from here.
    }
  }
  return enqueueChange(accountId, table, rowId, operation, payload)
}

export async function recordLocalUpsert(
  table: SyncTable,
  payload: LocalRecord,
  accountId = currentSession?.user.id ?? "",
): Promise<void> {
  const rowId = localRowId(table, payload)
  if (table === "study_sessions") {
    // A session is published straight to the server state machine. Nothing is queued: the next
    // sync pass re-derives the commands from this record, so an offline edit is sent as soon
    // as the network is back.
    markLocalChange()
    if (currentSession) void publishSession(rowId, currentSession.user.id, currentDeviceId ?? await getDeviceId())
    return
  }
  const queue = await pushOrQueue(accountId, table, rowId, "put", sanitizePayload(table, payload))
  await recordNotionUpsertIntent(table, rowId, payload)
  markLocalChange()
  emitQueuedStatus(queue, `${table.replace(/_/g, " ")} saved locally`)
  if (currentSession) void flushQueue()
}

export async function recordLocalSoftDelete(
  table: SyncTable,
  rowId: string,
  accountId = currentSession?.user.id ?? "",
): Promise<void> {
  const fileName = SYNC_DATA_FILES[table]
  if (fileName) await withWriteLock(fileName, () => deleteLocalRecord(table, rowId, accountId))
  else await deleteLocalRecord(table, rowId, accountId)
}

async function deleteLocalRecord(table: SyncTable, rowId: string, accountId: string): Promise<void> {
  const current = await readCurrentLocalValue(table, rowId)
  const deletePayload = notionDeletePayload(table, rowId, current)
  let queue: SyncChange[]
  if (table === "study_sessions") {
    // Nothing queues a cancel any more (migration 0006), so say it to the server directly.
    // If this fails, the next sync pass still knows: the record is gone, the applied row is not.
    await (await openFocalDatabase()).execute("delete from records where kind = 'study_sessions' and id = $1", [rowId])
    if (currentSession) void publishSession(rowId, accountId, currentDeviceId ?? await getDeviceId())
    queue = await readOutbox(accountId)
  } else {
    queue = await pushOrQueue(accountId, table, rowId, "delete", deletePayload)
  }
  const notion = getNotionDeleteMetadata(deletePayload)
  if (notion) {
    await enqueueNotionArchive(
      notion.dataSourceId,
      notion.kind,
      rowId,
      notion.pageId,
      new Date(Date.now() + NOTION_UNDO_DELAY_MS).toISOString(),
    )
  }
  markLocalChange()
  emitQueuedStatus(queue, `${table.replace(/_/g, " ")} deletion saved locally`)
  if (currentSession) void flushQueue()
}

function markLocalChange(): void {
  lastLocalChangeAt = Date.now()
  schedulePoll()
}

function emitQueuedStatus(queue: SyncChange[], details: string): void {
  emitStatus({
    status: currentSession ? "pending" : "signed-out",
    pendingCount: queue.length,
    error: null,
    details,
  })
}

export function notifyUserSettingsChanged(): void {
  void recordLocalUpsert("user_settings", collectUserSettings())
}

export async function rememberDuplicateNotionPages(pageIds: readonly string[]): Promise<void> {
  if (pageIds.length === 0) return
  const existing = await readState<string[]>("notion:duplicate-pages") ?? []
  await writeState("notion:duplicate-pages", [...new Set([...existing, ...pageIds])])
}

// ---------------------------------------------------------------------------
// Manual actions
// ---------------------------------------------------------------------------

export async function retrySync(): Promise<void> {
  if (!currentSession) return
  emitStatus({ status: "syncing", error: null, details: "Retrying sync…" })
  await flushQueue()
  await pullRemoteChanges()
}

export async function pullNow(): Promise<void> {
  if (!currentSession) return emitStatus({ status: "error", error: "Not signed in", details: "Sign in to pull changes" })
  await pullRemoteChanges()
}

export async function pushNow(): Promise<void> {
  if (!currentSession) return emitStatus({ status: "error", error: "Not signed in", details: "Sign in to push changes" })
  await flushQueue()
}

export async function forcePushAndMerge(): Promise<void> {
  await enqueueAllLocalData()
  await flushQueue()
  await pullRemoteChanges()
}

export async function forcePushAndOverwrite(): Promise<void> {
  await enqueueMissingRemoteDeletes()
  await enqueueAllLocalData()
  await flushQueue()
}

export function clearFailedItems(): void {
  emitStatus({ failedItems: null, error: null })
}

export async function retryFailedItem(table: SyncTable, rowId: string): Promise<void> {
  const value = await readCurrentLocalValue(table, rowId)
  if (value === undefined) await recordLocalSoftDelete(table, rowId)
  else await recordLocalUpsert(table, value)
}

export async function dropQueueItem(table: SyncTable, rowId: string): Promise<void> {
  const accountId = currentSession?.user.id ?? ""
  await removeOutboxChange(accountId, table, rowId)
  const queue = await readOutbox(accountId)
  emitStatus({
    pendingCount: queue.length,
    failedItems: snapshot.failedItems?.filter((item) => item.table !== table || item.rowId !== rowId) ?? null,
  })
  await pullRemoteChanges()
}

/** Take the other device's version: the local edit is discarded and the parked change applied. */
export async function resolveConflictAcceptRemote(table?: SyncTable, rowId?: string): Promise<void> {
  const accountId = currentSession?.user.id ?? ""
  if (table && rowId) {
    await removeOutboxChange(accountId, table, rowId)
    const parked = (await readInbox(accountId)).filter((change) => change.entity === table && change.rowId === rowId)
    const parkedChange = parked[parked.length - 1]
    if (parkedChange) {
      const applied = (await readApplied(accountId, [table])).find((row) => row.rowId === rowId)
      // A newer version may have arrived while this one sat parked. Applying it would be a
      // downgrade, so the newer version wins and the parked change is simply retired.
      const stale = applied !== undefined &&
        compareOrder(applied.lamport, applied.clientId, parkedChange.lamport, parkedChange.clientId) > 0
      if (!stale) {
        const entry: SyncRowState = {
          entity: parkedChange.entity,
          rowId: parkedChange.rowId,
          operation: parkedChange.operation,
          payload: parkedChange.payload,
          lamport: parkedChange.lamport,
          clientId: parkedChange.clientId,
          seq: parkedChange.seq,
        }
        await applyRemoteEntries([entry])
        await writeApplied(accountId, [entry])
      }
      await removeInboxChanges(accountId, [parkedChange])
    }
    emitStatus({ conflicts: snapshot.conflicts?.filter((item) => item.table !== table || item.rowId !== rowId) ?? null })
  }
  await pullRemoteChanges()
}

export async function resolveConflictKeepLocal(table: SyncTable, rowId: string): Promise<void> {
  await retryFailedItem(table, rowId)
}

export function dismissConflict(table: SyncTable, rowId: string): void {
  const conflicts = snapshot.conflicts?.filter((conflict) => conflict.table !== table || conflict.rowId !== rowId)
  emitStatus({ conflicts: conflicts?.length ? conflicts : null })
}

export function clearConflicts(): void {
  emitStatus({ conflicts: null })
}

// ---------------------------------------------------------------------------
// First sync for a newly linked account
// ---------------------------------------------------------------------------

async function bootstrapLocalState(accountId: string, epoch: number): Promise<void> {
  const key = `bootstrap:${accountId}:change-log-v1`
  if (await readState<boolean>(key)) return
  if (epoch !== syncEpoch) return
  emitStatus({ status: "syncing", details: "Preparing the first clean sync…" })
  await enqueueAllLocalData(accountId, epoch)
  if (epoch !== syncEpoch) return
  await writeState(key, true)
}

async function enqueueAllLocalData(accountId = currentSession?.user.id ?? "", epoch = syncEpoch): Promise<void> {
  const [projects, events, sessions] = await Promise.all([
    readLocalDataArray<Project>("projects.json"),
    readLocalDataArray<CalendarEvent>("events.json"),
    readLocalDataArray<StudySession>("sessions.json"),
  ])
  if (epoch !== syncEpoch) return
  const pendingDeletes = new Set((await readOutbox(accountId))
    .filter((change) => change.operation === "delete")
    .map((change) => rowKey(change.entity, change.rowId)))
  for (const project of projects) {
    if (epoch !== syncEpoch) return
    if (!pendingDeletes.has(rowKey("projects", project.id))) await recordLocalUpsert("projects", project, accountId)
  }
  for (const event of events) {
    if (epoch !== syncEpoch) return
    if (!pendingDeletes.has(rowKey("events", event.id))) await recordLocalUpsert("events", event, accountId)
  }
  const canonicalSessions = new Set((await readApplied(accountId, ["study_sessions"])).map((row) => row.rowId))
  const queuedCommands = (await readOutbox(accountId))
    .filter((change) => change.entity === "study_session_commands")
    .flatMap((change) => {
      const payload = change.payload
      const normalized = typeof payload === "object" && payload !== null ? { ...payload, device_id: currentDeviceId } : payload
      return isStudySessionCommand(normalized) ? [normalized.session_id] : []
    })
  for (const session of sessions) {
    if (epoch !== syncEpoch) return
    if (!canonicalSessions.has(session.id) && !queuedCommands.includes(session.id)
      && !pendingDeletes.has(rowKey("study_sessions", session.id))) {
      await publishSession(session.id, accountId, currentDeviceId ?? await getDeviceId())
    }
  }
  for (const subject of readLocalStorageArray<Subject>("focal-custom-subjects")) await recordLocalUpsert("custom_subjects", subject, accountId)
  for (const subjectId of readLocalStorageArray<string>("focal-hidden-subjects")) await recordLocalUpsert("hidden_subjects", subjectId, accountId)
  await recordLocalUpsert("timetable_config", getTimetableConfig(), accountId)
  await recordLocalUpsert("user_settings", collectUserSettings(), accountId)
}

async function repairLocalSessionDuplicates(accountId = currentSession?.user.id ?? ""): Promise<void> {
  const raw = await readLocalDataArray<unknown>("sessions.json")
  const repair = repairDuplicateSessions(raw)
  if (repair.duplicateIds.length === 0) return

  for (const id of repair.duplicateIds) await recordLocalSoftDelete("study_sessions", id, accountId)
  await mutatePersistedArray("sessions.json", (current) => repairDuplicateSessions(current).sessions)
  await rememberDuplicateNotionPages(repair.duplicateNotionPageIds)
  emitLocalDataChanged("study_sessions")
  emitStatus({
    status: currentSession ? "pending" : "signed-out",
    details: `Removed ${repair.duplicateIds.length} duplicate study session${repair.duplicateIds.length === 1 ? "" : "s"}`,
  })
}

// ---------------------------------------------------------------------------
// Sessions: direct writes to the server state machine
// ---------------------------------------------------------------------------

/**
 * Publish one local session by sending the commands the server is missing. Nothing is stored
 * on the way out: the commands are re-derived from the record and the last canonical row on
 * every pass, so a lost request costs one round trip and a failure is simply retried.
 */
async function publishSession(rowId: string, accountId: string, deviceId: string): Promise<void> {
  if (!supabase || !currentSession) return
  const record = await readCurrentLocalValue("study_sessions", rowId)
  const applied = (await readApplied(accountId, ["study_sessions"])).find((row) => row.rowId === rowId)
  if (record === undefined) {
    // The record is gone locally: the server still needs to hear about it once.
    if (!applied || applied.operation === "delete") return
    await sendSessionCommands([{ mutation_id: crypto.randomUUID(), session_id: rowId,
      expected_revision: applied.lamport, action: "cancel", device_id: deviceId, app: "focal",
      kind: kindOfCanonical(applied.payload), phase: "focus", title: sessionTitle(applied.payload),
      subject_id: null, metadata: {} }], accountId, deviceId)
    return
  }
  const commands = sessionCommands(record as StudySession, applied, deviceId)
  if (!commands.length) return
  await sendSessionCommands(commands, accountId, deviceId)
}

/** Every local session with a difference from the server. Cheap: the diff is a local compare. */
async function publishAllSessions(accountId: string, deviceId: string, epoch: number): Promise<void> {
  if (!supabase || !currentSession) return
  const applied = new Map((await readApplied(accountId, ["study_sessions"])).map((row) => [row.rowId, row]))
  const records = await readLocalDataArray<StudySession>("sessions.json")
  for (const record of records) {
    if (epoch !== syncEpoch) return
    const commands = sessionCommands(record, applied.get(record.id), deviceId)
    if (!commands.length) continue
    try {
      await sendSessionCommands(commands, accountId, deviceId)
    } catch (error) {
      emitStatus({ status: "pending", details: "A study session could not be sent. It stays saved on this device and is retried automatically." })
      throw error
    }
  }
}

async function sendSessionCommands(
  commands: readonly StudySessionCommand[],
  accountId: string,
  deviceId: string,
): Promise<void> {
  for (const command of commands) {
    let current = command
    let rebases = 0
    for (;;) {
      const result = await applyStudySessionCommand(current, deviceId, accountId)
      if (result.session) {
        // The canonical row is this device's newest version of the session, so a pull of our own
        // change cannot look like somebody else's newer edit.
        await writeApplied(accountId, [{ entity: "study_sessions", rowId: result.session.id,
          operation: "put", payload: result.session, lamport: result.session.revision,
          clientId: deviceId, seq: 0 }])
      }
      const stale = result.reason === "stale_revision" && result.session
      if (!stale) {
        if (result.reason === "session_terminal" || result.reason === "not_found" ||
            result.reason === "invalid_transition") return
        if (!result.ok) throw new Error(`study_session_mutate failed: ${result.reason ?? "server_unavailable"}`)
        break
      }
      const session = result.session!
      if (session.state === "completed" || session.state === "cancelled" || sessionActionSatisfied(current, session)) return
      if (rebases++ >= 2) throw new Error("This study session kept changing on another device. Try again in a moment.")
      current = { ...current, mutation_id: crypto.randomUUID(), expected_revision: session.revision }
    }
  }
}

function sessionActionSatisfied(command: StudySessionCommand, session: CanonicalStudySession): boolean {
  if (command.action === "start" || command.action === "resume") return session.state === "running"
  if (command.action === "pause") return session.state === "paused"
  if (command.action === "complete") return session.state === "completed"
  if (command.action === "cancel") return session.state === "cancelled"
  if (command.action === "phase_change") return session.phase === command.phase
  return command.action === "create"
}

function kindOfCanonical(payload: unknown): StudySessionCommand["kind"] {
  const kind = (payload as { kind?: unknown } | undefined)?.kind
  return kind === "exam" || kind === "sac" ? kind : "focus"
}

function sessionTitle(payload: unknown): string {
  const title = (payload as { title?: unknown } | undefined)?.title
  return typeof title === "string" ? title : "Study session"
}

// ---------------------------------------------------------------------------
// Push
// ---------------------------------------------------------------------------

async function flushQueue(): Promise<void> {
  const session = currentSession
  const deviceId = currentDeviceId
  const epoch = syncEpoch
  if (!session || !deviceId || !supabase) return
  const accountId = session.user.id
  const existing = flushTask
  if (existing) {
    if (existing.accountId === accountId && existing.epoch === epoch) {
      existing.rerunRequested = true
      return existing.promise
    }
    try {
      await existing.promise
    } catch {
      // The current account still gets its own attempt below.
    }
    if (epoch !== syncEpoch || currentSession?.user.id !== accountId) return
    return flushQueue()
  }

  const task: SyncTask = { accountId, epoch, rerunRequested: false, promise: Promise.resolve() }
  task.promise = (async () => {
    do {
      task.rerunRequested = false
      await flushQueueInternal(session, deviceId, epoch)
    } while (task.rerunRequested && epoch === syncEpoch && currentSession?.user.id === accountId)
  })().finally(() => {
    if (flushTask === task) flushTask = null
  })
  flushTask = task
  return task.promise
}

async function flushQueueInternal(session: Session, deviceId: string, epoch: number): Promise<void> {
  if (!supabase) return
  const startedAt = Date.now()
  const queue = await readOutbox(session.user.id)
  if (epoch !== syncEpoch) return
  const now = new Date().toISOString()
  // Coalescing here as well as in the queue keeps a burst of typing to one round trip.
  const due = coalesceChanges(queue.filter((change) => isDue(change, now)))
  const blocked = queue.filter((change) => Boolean(change.blockedAt))

  // Sessions are published directly and leave no queue entry behind, so an empty outbox is the
  // normal case -- and exactly the case where a failed direct publish would never be retried.
  let sessionError: unknown = null
  try {
    await publishAllSessions(session.user.id, deviceId, epoch)
  } catch (error) {
    sessionError = error
  }

  if (due.length === 0) {
    emitStatus({
      status: sessionError || blocked.length > 0 ? "error" : queue.length === 0 ? "synced" : "pending",
      pendingCount: queue.length,
      error: sessionError ? describeSyncError(sessionError) : blocked[0]?.lastError ?? null,
      details: sessionError
        ? "A study session could not be sent. It stays saved on this device and is retried automatically."
        : blocked.length > 0
        ? `${blocked.length} change${blocked.length === 1 ? "" : "s"} need attention`
        : queue.length === 0
          ? "All changes synced"
          : `${queue.length} change${queue.length === 1 ? "" : "s"} waiting to retry`,
      failedItems: blocked.map((change) => ({
        table: change.entity,
        rowId: change.rowId,
        error: change.lastError ?? "Sync failed",
      })),
    })
    return
  }

  emitStatus({
    status: "syncing",
    pendingCount: queue.length,
    error: null,
    details: `Pushing ${due.length} change${due.length === 1 ? "" : "s"}…`,
  })


  const published = new Map<string, { change: SyncChange; seq: number }>()
  const processedIds: string[] = []
  const retries: SyncChange[] = []
  const errors: unknown[] = sessionError ? [sessionError] : []
  const reconciliations: SyncConflictItem[] = []
  emitMetrics({ pushAttempts: snapshot.metrics.pushAttempts + 1 })

  const genericChanges = due.filter((change) => change.entity !== "study_session_commands")

  for (const batch of chunkItems(genericChanges, PUSH_BATCH_SIZE)) {
    if (epoch !== syncEpoch) break
    try {
      const { receipts } = await applyChanges(batch, deviceId, session.user.id)
      for (const receipt of receipts) {
        const change = batch.find((candidate) => candidate.changeId === receipt.changeId)
        if (change) {
          published.set(receipt.changeId, { change, seq: receipt.seq })
          processedIds.push(receipt.changeId)
        }
      }
      for (const change of batch) {
        if (receipts.some((receipt) => receipt.changeId === change.changeId)) continue
        // A receipt is the only proof the log took the change. No receipt, no removal.
        errors.push(new Error(`No receipt for ${change.entity}/${change.rowId}`))
        retries.push(...batch.map((candidate) => retryOrBlockChange(candidate, errorMessage(errors[0]), now, MAX_RETRIES)))
        break
      }
    } catch (error) {
      errors.push(error)
      const message = describeSyncError(error)
      // A batch that is too large or badly shaped can be narrowed; a dead network cannot.
      if (batch.length > 1 && !isPermanentError(error) && !isNetworkError(error)) {
        const midpoint = Math.ceil(batch.length / 2)
        for (const half of [batch.slice(0, midpoint), batch.slice(midpoint)]) {
          try {
            const { receipts } = await applyChanges(half, deviceId, session.user.id)
            for (const receipt of receipts) {
              const change = half.find((candidate) => candidate.changeId === receipt.changeId)
              if (change) {
                published.set(receipt.changeId, { change, seq: receipt.seq })
                processedIds.push(receipt.changeId)
              }
            }
          } catch (splitError) {
            errors.push(splitError)
            retries.push(...half.map((change) => retryOrBlockChange(change, describeSyncError(splitError), now, MAX_RETRIES)))
          }
        }
        continue
      }
      retries.push(...batch.map((change) => retryOrBlockChange(change, message, now, MAX_RETRIES)))
    }
  }

  const next = await finishFlush(session.user.id, processedIds, retries)
  // A published change is now the newest version this device knows for that row. Recording
  // the receipt's sequence is what stops an older remote change from overwriting it later.
  await writeApplied(session.user.id, [...published.values()].filter(({ change }) => change.entity !== "study_session_commands").map(({ change, seq }) => ({
    entity: change.entity,
    rowId: change.rowId,
    operation: change.operation,
    payload: change.payload,
    lamport: change.lamport,
    clientId: deviceId,
    seq,
  })))
  if (epoch !== syncEpoch) return

  const lastPushMs = Date.now() - startedAt
  emitMetrics({ lastPushMs, failures: snapshot.metrics.failures + errors.length })
  const blockedAfter = next.filter((change) => Boolean(change.blockedAt))

  if (errors.length > 0) {
    emitStatus({
      status: "error",
      pendingCount: next.length,
      error: describeSyncError(errors[0]),
      details: blockedAfter.length > 0
        ? `${blockedAfter.length} change${blockedAfter.length === 1 ? "" : "s"} need attention`
        : `${next.length} change${next.length === 1 ? "" : "s"} retained for retry`,
      tableStats: statsFor([...published.values()].map((entry) => entry.change), "pushed"),
      failedItems: blockedAfter.map((change) => ({
        table: change.entity,
        rowId: change.rowId,
        error: change.lastError ?? "Sync failed",
      })),
      conflicts: reconciliations.length > 0 ? [...(snapshot.conflicts ?? []), ...reconciliations] : snapshot.conflicts,
      isOnline: !errors.some((error) => error instanceof TypeError),
    })
    return
  }

  emitStatus({
    status: next.length === 0 ? "synced" : "pending",
    pendingCount: next.length,
    error: null,
    lastSuccessfulSyncAt: new Date().toISOString(),
    details: `Synced ${published.size} change${published.size === 1 ? "" : "s"}`,
    tableStats: statsFor([...published.values()].map((entry) => entry.change), "pushed"),
    failedItems: null,
    conflicts: reconciliations.length > 0 ? [...(snapshot.conflicts ?? []), ...reconciliations] : snapshot.conflicts,
    isOnline: true,
  })
}

// ---------------------------------------------------------------------------
// Pull
// ---------------------------------------------------------------------------

async function pullRemoteChanges(): Promise<void> {
  const session = currentSession
  const epoch = syncEpoch
  if (!session || !supabase) return
  const accountId = session.user.id
  const existing = pullTask
  if (existing) {
    if (existing.accountId === accountId && existing.epoch === epoch) {
      existing.rerunRequested = true
      return existing.promise
    }
    try {
      await existing.promise
    } catch {
      // The current account still gets its own pull below.
    }
    if (epoch !== syncEpoch || currentSession?.user.id !== accountId) return
    return pullRemoteChanges()
  }

  const task: SyncTask = { accountId, epoch, rerunRequested: false, promise: Promise.resolve() }
  task.promise = (async () => {
    do {
      task.rerunRequested = false
      await pullRemoteChangesInternal(session, epoch)
    } while (task.rerunRequested && epoch === syncEpoch && currentSession?.user.id === accountId)
  })().finally(() => {
    if (pullTask === task) pullTask = null
  })
  pullTask = task
  return task.promise
}

async function pullRemoteChangesInternal(session: Session, epoch: number): Promise<void> {
  if (!supabase) return
  const startedAt = Date.now()
  const accountId = session.user.id
  emitStatus({ status: "syncing", error: null, details: "Pulling remote changes…" })

  try {
    const cursor = await readCursor(accountId)
    const result = await readChanges(cursor.seq, accountId)
    if (epoch !== syncEpoch) return

    const queue = await readOutbox(accountId)
    const pending = queue.map((change) => rowKey(change.entity, change.rowId))
    const applied = await applyPulledResult(accountId, cursor, result, pending)
    if (epoch !== syncEpoch) return

    // The lamport watermark rises with everything this device has seen, so a change from a
    // slower device can never win against a newer local edit.
    const lamport = Math.max(cursor.lamport, highestLamport(result.changes), highestLamport(result.rows))
    await writeCursor(accountId, result.mode === "snapshot" ? result.head : Math.max(cursor.seq, applied.cursor), lamport)
    if (epoch !== syncEpoch) return

    const remaining = await readOutbox(accountId)
    const lastPullMs = Date.now() - startedAt
    emitMetrics({
      lastPullMs,
      cursorLag: Math.max(0, result.head - (result.mode === "snapshot" ? result.head : applied.cursor)),
      snapshots: snapshot.metrics.snapshots + (result.mode === "snapshot" ? 1 : 0),
    })
    emitStatus({
      status: applied.deferred.length > 0 || remaining.length > 0 ? "pending" : "synced",
      pendingCount: remaining.length,
      error: null,
      lastSuccessfulSyncAt: new Date().toISOString(),
      details: applied.deferred.length > 0
        ? `${applied.deferred.length} remote change${applied.deferred.length === 1 ? "" : "s"} waiting for resolution`
        : result.mode === "snapshot"
          ? "Rebuilt local data from the server"
          : result.changes.length === 0
            ? "Remote data is current"
            : `Pulled ${result.changes.length} change${result.changes.length === 1 ? "" : "s"}`,
      tableStats: statsFor(applied.applied, "pulled"),
      conflicts: applied.deferred.map((change) => ({
        table: change.entity,
        rowId: change.rowId,
        localUpdatedAt: null,
        remoteUpdatedAt: change.createdAt,
        remoteDeviceId: change.clientId,
        label: change.rowId,
      })),
      isOnline: true,
    })
  } catch (error) {
    if (epoch !== syncEpoch) return
    const queue = await readOutbox(accountId)
    emitStatus({
      status: "error",
      pendingCount: queue.length,
      error: describeSyncError(error),
      details: "Remote data is unchanged. Focal will retry.",
      isOnline: !(error instanceof TypeError),
    })
  }
}

interface AppliedPull {
  applied: RemoteSyncChange[]
  deferred: RemoteSyncChange[]
  cursor: number
}

async function applyPulledResult(
  accountId: string,
  cursor: { seq: number; lamport: number },
  result: Awaited<ReturnType<typeof readChanges>>,
  pending: readonly string[],
): Promise<AppliedPull> {
  const appliedState = await readApplied(accountId)
  const stateForEntities = appliedState

  if (result.mode === "snapshot") {
    const reduced = reduceSnapshot({ pending, state: stateForEntities, rows: result.rows, head: result.head })
    const keep = new Set(reduced.state.map((row) => rowKey(row.entity, row.rowId)))
    const dropped = appliedState.filter((row) => !keep.has(rowKey(row.entity, row.rowId)))
    await removeApplied(accountId, dropped)
    await writeApplied(accountId, reduced.state)
    // The reduced state, not the server's rows: for a row that still has a queued local edit
    // the reduced entry is the local version, and applying the server's older one would
    // undo work the user has not seen published.
    await applyRemoteEntries(reduced.state)
    return { applied: [], deferred: [], cursor: result.head }
  }

  const parked = await readInbox(accountId)
  const changes = latestChanges([...parked, ...result.changes])
  const reduced = reduceChanges({
    ownClientId: currentDeviceId ?? "",
    cursor: cursor.seq,
    state: stateForEntities,
    pending,
    changes,
  })
  const deferred = reduced.deferred.filter((change) => !parked.some((existing) => existing.changeId === change.changeId))
  // A parked change must be durable before the cursor moves past it, or a crash loses it.
  await deferInboxChanges(accountId, deferred)
  await writeApplied(accountId, reduced.state)
  await applyRemoteEntries(reduced.applied.map(toRowState), stopWakeup !== null)
  await removeInboxChanges(accountId, reduced.applied)
  return { applied: reduced.applied, deferred, cursor: reduced.cursor }
}

function highestLamport(entries: readonly { lamport: number }[]): number {
  return entries.reduce((highest, entry) => Math.max(highest, entry.lamport), 0)
}

function toRowState(change: RemoteSyncChange): SyncRowState {  return {
    entity: change.entity,
    rowId: change.rowId,
    operation: change.operation,
    payload: change.payload,
    lamport: change.lamport,
    clientId: change.clientId,
    seq: change.seq,
  }
}

/** Queues a delete for every remote row this device does not have. Used by the overwrite action. */
async function enqueueMissingRemoteDeletes(): Promise<void> {
  const session = currentSession
  const epoch = syncEpoch
  if (!session || !supabase) return
  const cursor = await readCursor(session.user.id)
  const result = await readChanges(cursor.seq, session.user.id)
  if (epoch !== syncEpoch) return
  for (const change of latestChanges(result.changes)) {
    // The log may carry entities this app does not store. Skipping them is not a loss: a
    // snapshot will bring them if this app ever gains them.
    if (!isSyncTable(change.entity)) continue
    if (change.operation === "delete") continue
    if (await readCurrentLocalValue(change.entity, change.rowId) === undefined) {
      if (epoch !== syncEpoch) return
      await recordLocalSoftDelete(change.entity, change.rowId, session.user.id)
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function localRowId(table: SyncTable, payload: LocalRecord): string {
  if (table === "custom_subjects") return (payload as { id: string }).id
  if (table === "hidden_subjects") return payload as string
  if (table === "timetable_config") return "timetable_config"
  if (table === "user_settings") return "user_settings"
  const id = (payload as { id?: unknown }).id
  if (typeof id !== "string" || id.length === 0) throw new Error(`${table} record is missing an id`)
  return id
}

function sanitizePayload(table: SyncTable, payload: LocalRecord): unknown {
  if (table === "user_settings") return { ...(payload as unknown as Record<string, unknown>), openrouter_api_key: "", notion_token: "" }
  return JSON.parse(JSON.stringify(payload)) as unknown
}

function statsFor(changes: readonly { entity: string }[], field: "pushed" | "pulled"): SyncStatusSnapshot["tableStats"] {
  if (changes.length === 0) return null
  const counts = new Map<string, number>()
  for (const change of changes) counts.set(change.entity, (counts.get(change.entity) ?? 0) + 1)
  return [...counts].map(([table, count]) => ({ table, [field]: count, failed: 0 }))
}
