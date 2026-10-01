import type { AppData } from "@/lib/exam-data"
import { EMPTY_APP_DATA, migrateAppData } from "@/lib/exam-data"
import { isExamDifficultySettings } from "@/lib/exam-difficulty"
import { isExamProgression } from "@/lib/exam-progression"
import { EMPTY_LEARNING_WORKSPACE, mergeLearningWorkspace, migrateLearningWorkspace } from "@/lib/learning-workspace"
import { migrateSacRecords } from "@/lib/sac"
import { supabase } from "@/lib/supabase"

const DB_NAME = "examtrack-app-sync"
const DB_VERSION = 1
const OUTBOX = "outbox"
const ROWS = "rows"
const META = "meta"
const APP_ENTITIES = new Set(["attempts", "mistakes", "user_state"])
const EPOCH = "1970-01-01T00:00:00.000Z"
const OWNER_META_KEY = "owner"
const TOMBSTONE_KEY = "examtrack:sync:tombstones:v1"

type Entity = "attempts" | "mistakes" | "user_state"
type Operation = "put" | "delete"
type AppRow = { entity: Entity; rowId: string; operation: Operation; payload: unknown }
type AppliedRow = AppRow & { key: string; accountId: string; seq: number; lamport: number; clientId: string; updatedAt: string }
type PendingRow = AppRow & {
  changeId: string
  accountId: string
  expectedSeq: number
  basePayload: unknown
  lamport: number
  attempted: boolean
  queuedAt: number
}
type AccountMeta = { key: string; accountId: string; cursor: number; head: number; lamport: number; bootstrapped: boolean }
type OwnerMeta = { key: string; accountId: string }
type VersionedChange = {
  seq: number; change_id: string; client_id: string; entity: string; row_id: string
  operation: Operation; payload: unknown; lamport: number; updated_at: string
}

let database: Promise<IDBDatabase> | null = null

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function appSyncDeviceId(): string {
  const key = "examtrack:study-session-device:v1"
  let value = localStorage.getItem(key)
  if (!value) {
    value = crypto.randomUUID()
    localStorage.setItem(key, value)
  }
  return value
}

function openDatabase(): Promise<IDBDatabase> {
  if (database) return database
  database = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(OUTBOX)) db.createObjectStore(OUTBOX, { keyPath: "changeId" })
      if (!db.objectStoreNames.contains(ROWS)) db.createObjectStore(ROWS, { keyPath: "key" })
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Could not open the Focal sync database"))
  })
  return database
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error("Local sync storage request failed"))
  })
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onabort = transaction.onerror = () => reject(transaction.error ?? new Error("Local sync transaction failed"))
  })
}

const accountMetaKey = (accountId: string) => `account:${accountId}`

/** IDB survives localStorage clearing, so an account switch cannot expose the prior app snapshot. */
export async function associateAppSyncAccount(accountId: string, legacyOwner: string | null): Promise<string | null> {
  const db = await openDatabase()
  const transaction = db.transaction(META, "readwrite")
  const store = transaction.objectStore(META)
  const saved = await requestResult(store.get(OWNER_META_KEY) as IDBRequest<OwnerMeta | undefined>)
  const previous = saved?.accountId ?? legacyOwner
  store.put({ key: OWNER_META_KEY, accountId } satisfies OwnerMeta)
  await transactionDone(transaction)
  return previous
}

const rowKey = (accountId: string, entity: string, rowId: string) => `${accountId}\u0000${entity}\u0000${rowId}`
const logicalKey = (entity: string, rowId: string) => `${entity}:${rowId}`

function defaultMeta(accountId: string): AccountMeta {
  return { key: accountMetaKey(accountId), accountId, cursor: 0, head: 0, lamport: 0, bootstrapped: false }
}

export function rowsFromAppData(data: AppData): AppRow[] {
  const rows: AppRow[] = [
    ...data.attempts.map((item) => ({ entity: "attempts" as const, rowId: item.id, operation: "put" as const, payload: item })),
    ...data.mistakes.map((item) => ({ entity: "mistakes" as const, rowId: item.id, operation: "put" as const, payload: item })),
  ]
  const state: Array<[string, unknown, string]> = [
    ["examProgression", data.examProgression, data.examProgression?.updatedAt ?? EPOCH],
    ["trackedExamIds", data.trackedExamIds, data.trackedExamIdsUpdatedAt],
    ["completedExamIds", data.completedExamIds, data.completedExamIdsUpdatedAt],
    ["subjects", data.subjects, data.subjectsUpdatedAt],
    ["sacRecords", data.sacRecords, data.sacRecordsUpdatedAt],
    ["mistakeInsights", data.mistakeInsights, data.mistakeInsights?.questionsGeneratedAt ?? data.mistakeInsights?.generatedAt ?? EPOCH],
    ["alternativeMistakeDeck", data.alternativeMistakeDeck, data.alternativeMistakeDeck?.updatedAt ?? EPOCH],
    ["examDifficulty", data.examDifficulty, data.examDifficulty?.updatedAt ?? EPOCH],
    ["atarEstimates", data.atarEstimates, data.atarEstimatesUpdatedAt],
    ["learning", data.learning, data.learning.updatedAt],
  ]
  for (const [rowId, value, updatedAt] of state) {
    if (value === undefined || value === null || (updatedAt === EPOCH && isDefaultValue(value))) continue
    rows.push({ entity: "user_state", rowId, operation: "put", payload: { value, updated_at: updatedAt } })
  }
  return rows
}

function isDefaultValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  return sameValue(value, EMPTY_LEARNING_WORKSPACE)
}

export function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length && first.every((value, index) => sameValue(value, second[index]))
  }
  if (!isRecord(first) || !isRecord(second)) return false
  const firstKeys = Object.keys(first).toSorted()
  const secondKeys = Object.keys(second).toSorted()
  return firstKeys.length === secondKeys.length && firstKeys.every((key, index) => key === secondKeys[index] && sameValue(first[key], second[key]))
}

export function diffAppData(previous: AppData, next: AppData): AppRow[] {
  const before = new Map(rowsFromAppData(previous).map((row) => [logicalKey(row.entity, row.rowId), row]))
  const after = new Map(rowsFromAppData(next).map((row) => [logicalKey(row.entity, row.rowId), row]))
  const changes: AppRow[] = []
  for (const [key, oldRow] of before) {
    const newRow = after.get(key)
    if (!newRow) changes.push({ ...oldRow, operation: "delete", payload: null })
    else if (!sameValue(oldRow.payload, newRow.payload)) changes.push(newRow)
  }
  for (const [key, row] of after) if (!before.has(key)) changes.push(row)
  return changes
}

export async function queueAppChanges(accountId: string, changes: readonly AppRow[]): Promise<void> {
  if (!changes.length) return
  const db = await openDatabase()
  const transaction = db.transaction([OUTBOX, ROWS, META], "readwrite")
  const outbox = transaction.objectStore(OUTBOX)
  const applied = transaction.objectStore(ROWS)
  const metadata = transaction.objectStore(META)
  const [allPending, allRows, savedMeta] = await Promise.all([
    requestResult(outbox.getAll() as IDBRequest<PendingRow[]>),
    requestResult(applied.getAll() as IDBRequest<AppliedRow[]>),
    requestResult(metadata.get(accountMetaKey(accountId)) as IDBRequest<AccountMeta | undefined>),
  ])
  const pending = allPending.filter((item) => item.accountId === accountId)
  const appliedRows = new Map(allRows.filter((item) => item.accountId === accountId).map((row) => [logicalKey(row.entity, row.rowId), row]))
  let meta = savedMeta ?? defaultMeta(accountId)
  for (const change of changes) {
    const key = logicalKey(change.entity, change.rowId)
    const existing = pending.filter((item) => logicalKey(item.entity, item.rowId) === key)
    const unattempted = [...existing].reverse().find((item) => !item.attempted)
    const base = unattempted ?? existing.at(-1)
    const canonical = appliedRows.get(key)
    const queued: PendingRow = {
      ...change,
      changeId: crypto.randomUUID(),
      accountId,
      expectedSeq: base?.expectedSeq ?? canonical?.seq ?? 0,
      basePayload: base?.basePayload ?? (canonical?.operation === "put" ? canonical.payload : null),
      lamport: ++meta.lamport,
      attempted: false,
      queuedAt: Date.now(),
    }
    if (unattempted) outbox.delete(unattempted.changeId)
    outbox.put(queued)
    pending.push(queued)
  }
  metadata.put(meta)
  await transactionDone(transaction)
}

export async function appSyncHealth(accountId: string): Promise<{ cursor: number; head: number; pending: number; oldestPendingAt: number | null }> {
  const db = await openDatabase()
  const transaction = db.transaction([OUTBOX, META], "readonly")
  const [outbox, meta] = await Promise.all([
    requestResult(transaction.objectStore(OUTBOX).getAll() as IDBRequest<PendingRow[]>),
    requestResult(transaction.objectStore(META).get(accountMetaKey(accountId)) as IDBRequest<AccountMeta | undefined>),
  ])
  await transactionDone(transaction)
  const pending = outbox.filter((entry) => entry.accountId === accountId)
  return { cursor: meta?.cursor ?? 0, head: meta?.head ?? 0, pending: pending.length,
    oldestPendingAt: pending.length ? Math.min(...pending.map((item) => item.queuedAt)) : null }
}

export async function syncAppData(data: AppData, userId: string, deviceId = appSyncDeviceId()): Promise<AppData> {
  if (!supabase || !userId) return data
  return synchronize(data, userId, deviceId)
}

async function synchronize(data: AppData, userId: string, deviceId: string): Promise<AppData> {
  await pull(userId)
  let meta = await readMeta(userId)
  if (!meta.bootstrapped) {
    await bootstrap(data, userId)
    meta = await readMeta(userId)
  }
  for (let pass = 0; pass < 4; pass++) {
    const pending = await readOutbox(userId)
    if (!pending.length) break
    await flush(pending, userId, deviceId)
  }
  await pull(userId)
  // ponytail: no localStorage write here; the caller owns persistence, and a late projection must not clobber newer state.
  return projectAppRows(data, userId)
}

async function pull(userId: string): Promise<void> {
  if (!supabase) return
  let meta = await readMeta(userId)
  let cursor = meta.cursor
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const { data, error } = await supabase.rpc("sync_read_changes", {
      p_after: cursor, p_limit: 500, p_expected_user_id: userId,
    })
    if (error) throw error
    if (!isRecord(data) || !Array.isArray(data.rows) || typeof data.head !== "number" || (data.mode !== "changes" && data.mode !== "snapshot"))
      throw new Error("Malformed sync_read_changes response")
    const rows = data.rows.flatMap(parseChange)
    if (rows.length !== data.rows.length) throw new Error("Malformed sync feed row")
    cursor = data.mode === "snapshot" ? data.head : rows.reduce((value, row) => Math.max(value, row.seq), cursor)
    await persistFeedPage(userId, rows, cursor, data.head, data.mode === "snapshot")
    meta = await readMeta(userId)
    if (data.mode === "snapshot" || cursor >= data.head || rows.length < 500) break
  }
}

export function parseChange(raw: unknown): VersionedChange[] {
  // The cursor tails the shared feed, including Folio notebooks. Filter entities only when storing rows.
  if (!isRecord(raw) || typeof raw.entity !== "string" ||
    (raw.operation !== "put" && raw.operation !== "delete") ||
    typeof raw.row_id !== "string" || !raw.row_id || !Number.isSafeInteger(raw.seq) ||
    !Number.isSafeInteger(raw.lamport) || typeof raw.client_id !== "string") return []
  if (raw.operation === "put" && raw.payload == null) return []
  return [{ seq: raw.seq as number, change_id: typeof raw.change_id === "string" ? raw.change_id : "",
    client_id: raw.client_id, entity: raw.entity, row_id: raw.row_id, operation: raw.operation,
    payload: raw.payload ?? null, lamport: raw.lamport as number,
    updated_at: typeof raw.updated_at === "string" ? raw.updated_at : typeof raw.created_at === "string" ? raw.created_at : "" }]
}

async function persistFeedPage(accountId: string, changes: VersionedChange[], cursor: number, head: number, replace: boolean): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction([ROWS, META], "readwrite")
  const rows = transaction.objectStore(ROWS)
  const metadata = transaction.objectStore(META)
  const [allRows, savedMeta] = await Promise.all([
    requestResult(rows.getAll() as IDBRequest<AppliedRow[]>),
    requestResult(metadata.get(accountMetaKey(accountId)) as IDBRequest<AccountMeta | undefined>),
  ])
  const byKey = new Map(allRows.filter((item) => item.accountId === accountId).map((row) => [row.key, row]))
  if (replace) {
    for (const row of byKey.values()) rows.delete(row.key)
    byKey.clear()
  }
  for (const change of changes.toSorted((a, b) => a.seq - b.seq)) {
    if (!APP_ENTITIES.has(change.entity)) continue
    const key = rowKey(accountId, change.entity, change.row_id)
    const current = byKey.get(key)
    if (current && compareVersion(current, change) >= 0) continue
    const applied: AppliedRow = { key, accountId, entity: change.entity as Entity, rowId: change.row_id,
      operation: change.operation, payload: change.payload, seq: change.seq, lamport: change.lamport,
      clientId: change.client_id, updatedAt: change.updated_at }
    byKey.set(key, applied)
    rows.put(applied)
  }
  const meta = savedMeta ?? defaultMeta(accountId)
  const largestLamport = Math.max(meta.lamport, ...changes.map((change) => change.lamport), 0)
  metadata.put({ ...meta, cursor, head, lamport: largestLamport })
  await transactionDone(transaction)
}

function compareVersion(left: Pick<AppliedRow, "lamport" | "clientId">, right: Pick<VersionedChange, "lamport" | "client_id">): number {
  if (left.lamport !== right.lamport) return left.lamport < right.lamport ? -1 : 1
  if (left.clientId === right.client_id) return 0
  return left.clientId < right.client_id ? -1 : 1
}

async function bootstrap(data: AppData, accountId: string): Promise<void> {  const db = await openDatabase()
  const read = db.transaction([ROWS], "readonly")
  const rows = await requestResult(read.objectStore(ROWS).getAll() as IDBRequest<AppliedRow[]>)
  await transactionDone(read)
  const canonical = new Map(rows.filter((row) => row.accountId === accountId).map((row) => [logicalKey(row.entity, row.rowId), row]))
  const local = rowsFromAppData(data)
  const toQueue: AppRow[] = []
  for (const row of local) {
    const remote = canonical.get(logicalKey(row.entity, row.rowId))
    if (!remote) { toQueue.push(row); continue }
    if (remote.operation === "delete") {
      if (legacyStamp(row) > remote.updatedAt) toQueue.push(row)
      continue
    }
    if (legacyStamp(row) > remote.updatedAt) toQueue.push(row)
  }
  for (const [kind, tombstones] of Object.entries(readLegacyTombstones())) {
    if (kind !== "attempts" && kind !== "mistakes") continue
    for (const [id, deletedAt] of Object.entries(tombstones)) {
      const remote = canonical.get(logicalKey(kind, id))
      if (!remote || remote.operation !== "delete") {
        const remoteStamp = remote?.updatedAt ?? ""
        if (!remote || deletedAt > remoteStamp) toQueue.push({ entity: kind, rowId: id, operation: "delete", payload: null })
      }
    }
  }
  await queueAppChanges(accountId, toQueue)
  const meta = await readMeta(accountId)
  await writeMeta({ ...meta, bootstrapped: true })
}

function readLegacyTombstones(): Record<string, Record<string, string>> {
  try {
    const value = JSON.parse(localStorage.getItem(TOMBSTONE_KEY) ?? "{}") as unknown
    return isRecord(value) ? value as Record<string, Record<string, string>> : {}
  } catch { return {} }
}

/**
 * A delete is final until something newer than it lands. The projection drops any row the
 * user deleted on this device, so no stale server copy or late sync page can bring it back;
 * an undo elsewhere (a remote write stamped after the delete) still wins.
 */
export function isTombstoned(entity: Entity, rowId: string, rowUpdatedAt: string, tombstones: Record<string, Record<string, string>>): boolean {
  const deletedAt = tombstones[entity]?.[rowId]
  return typeof deletedAt === "string" && deletedAt > rowUpdatedAt
}

/**
 * SIMPLEST IS LAW: the outbox is a failure log, not a holding pen. Every change goes to the
 * server immediately; only what the server refuses is queued for the retry loop. This is why
 * a delete can never be overtaken by a stale projection — the row is gone server-side and
 * gone from the applied-rows store in the same call.
 */
export async function pushAppChanges(accountId: string, changes: readonly AppRow[]): Promise<void> {
  if (!changes.length) return
  if (!supabase) return queueAppChanges(accountId, changes)
  const failed: AppRow[] = []
  for (const change of changes) {
    try {
      await pushRowNow(accountId, change)
    } catch {
      failed.push(change)
    }
  }
  await queueAppChanges(accountId, failed)
}

/** Publish one change and record it as applied. Throws when the server will not take it. */
async function pushRowNow(accountId: string, change: AppRow): Promise<void> {
  if (!supabase) throw new Error("Supabase is not configured")
  const db = await openDatabase()
  const read = db.transaction([ROWS], "readonly")
  const rows = await requestResult(read.objectStore(ROWS).getAll() as IDBRequest<AppliedRow[]>)
  await transactionDone(read)
  const current = rows.find((row) => row.accountId === accountId &&
    logicalKey(row.entity, row.rowId) === logicalKey(change.entity, change.rowId))
  const deviceId = appSyncDeviceId()
  const changeId = crypto.randomUUID()
  const { data, error } = await supabase.rpc("sync_apply_changes", {
    p_expected_user_id: accountId,
    p_changes: [{ change_id: changeId, client_id: deviceId, entity: change.entity, row_id: change.rowId,
      operation: change.operation, payload: change.operation === "put" ? change.payload : null,
      expected_seq: current?.seq ?? 0 }],
  })
  if (error) throw error
  const receipt = isRecord(data) && Array.isArray(data.receipts)
    ? data.receipts.find((item) => isRecord(item) && item.change_id === changeId) : undefined
  const seq = isRecord(receipt) && typeof receipt.seq === "number" ? receipt.seq : (current?.seq ?? 0) + 1
  const write = db.transaction([ROWS], "readwrite")
  write.objectStore(ROWS).put({ key: rowKey(accountId, change.entity, change.rowId), accountId,
    entity: change.entity, rowId: change.rowId, operation: change.operation, payload: change.payload,
    seq, lamport: Math.max(0, current?.lamport ?? 0) + 1, clientId: deviceId,
    updatedAt: new Date().toISOString() } satisfies AppliedRow)
  await transactionDone(write)
}

function legacyStamp(row: AppRow | AppliedRow): string {
  if (row.entity === "user_state") {
    return isRecord(row.payload) && typeof row.payload.updated_at === "string" ? row.payload.updated_at : ""
  }
  return isRecord(row.payload) && typeof row.payload.updatedAt === "string" ? row.payload.updatedAt : ""
}

async function flush(changes: PendingRow[], accountId: string, deviceId: string): Promise<void> {
  if (!supabase) return
  const db = await openDatabase()
  const transaction = db.transaction([OUTBOX], "readwrite")
  const store = transaction.objectStore(OUTBOX)
  for (const change of changes) store.put({ ...change, attempted: true })
  await transactionDone(transaction)
  const { data, error } = await supabase.rpc("sync_apply_changes", {
    p_expected_user_id: accountId,
    p_changes: changes.map((change) => ({
      change_id: change.changeId, client_id: deviceId, entity: change.entity, row_id: change.rowId,
      operation: change.operation, payload: change.payload, expected_seq: change.expectedSeq,
    })),
  })
  if (error) throw error
  if (!isRecord(data) || !Array.isArray(data.receipts) || !Array.isArray(data.stale)) throw new Error("Malformed sync_apply_changes response")
  const receipts = data.receipts.flatMap((item) => isRecord(item) && typeof item.change_id === "string" ? [item.change_id] : [])
  await removeOutbox(accountId, receipts)
  for (const item of data.stale) {
    if (!isRecord(item) || typeof item.change_id !== "string") throw new Error("Malformed stale sync result")
    const stale = changes.find((change) => change.changeId === item.change_id)
    if (!stale) continue
    const current = isRecord(item.current) ? parseAppliedRow(accountId, item.current) : null
    await rebaseOutbox(stale, current)
  }
}

function parseAppliedRow(accountId: string, raw: Record<string, unknown>): AppliedRow | null {
  if (!APP_ENTITIES.has(String(raw.entity)) || (raw.operation !== "put" && raw.operation !== "delete") ||
    typeof raw.row_id !== "string" || !Number.isSafeInteger(raw.seq) || !Number.isSafeInteger(raw.lamport) || typeof raw.client_id !== "string") return null
  return { key: rowKey(accountId, String(raw.entity), raw.row_id), accountId, entity: raw.entity as Entity,
    rowId: raw.row_id, operation: raw.operation, payload: raw.payload ?? null, seq: raw.seq as number,
    lamport: raw.lamport as number, clientId: raw.client_id,
    updatedAt: typeof raw.updated_at === "string" ? raw.updated_at : "" }
}

async function rebaseOutbox(change: PendingRow, remote: AppliedRow | null): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction([OUTBOX, ROWS, META], "readwrite")
  const outbox = transaction.objectStore(OUTBOX)
  const rows = transaction.objectStore(ROWS)
  const metadata = transaction.objectStore(META)
  const [allOutbox, metaValue] = await Promise.all([
    requestResult(outbox.getAll() as IDBRequest<PendingRow[]>),
    requestResult(metadata.get(accountMetaKey(change.accountId)) as IDBRequest<AccountMeta | undefined>),
  ])
  const currentPayload = remote?.operation === "put" ? remote.payload : null
  const remoteDeleted = remote?.operation === "delete"
  if (change.operation === "delete" && remoteDeleted) {
    outbox.delete(change.changeId)
    await transactionDone(transaction)
    return
  }
  const merged = change.operation === "delete" ? null : mergeConcurrentValue(change.entity, change.rowId, change.basePayload, change.payload, currentPayload)
  if (change.operation === "put" && sameValue(merged, currentPayload)) {
    outbox.delete(change.changeId)
    if (remote) rows.put(remote)
    await transactionDone(transaction)
    return
  }
  const meta = metaValue ?? defaultMeta(change.accountId)
  const rebased: PendingRow = {
    ...change, changeId: crypto.randomUUID(), expectedSeq: remote?.seq ?? 0,
    basePayload: currentPayload, payload: merged, lamport: ++meta.lamport, attempted: false, queuedAt: Date.now(),
  }
  outbox.delete(change.changeId)
  outbox.put(rebased)
  if (remote) rows.put(remote)
  metadata.put(meta)
  await transactionDone(transaction)
  const laterSameRow = allOutbox.find((entry) => entry.changeId !== change.changeId &&
    entry.accountId === change.accountId && entry.entity === change.entity && entry.rowId === change.rowId)
  if (laterSameRow) await rebaseOutbox(laterSameRow, remote)
}

function mergeConcurrentValue(entity: Entity, rowId: string, base: unknown, local: unknown, remote: unknown): unknown {
  if (entity === "user_state" && rowId === "learning" &&
    isRecord(base) && isRecord(local) && isRecord(remote) &&
    isRecord(base.value) && isRecord(local.value) && isRecord(remote.value)) {
    return { ...remote, value: mergeLearningWorkspace(local.value as never, remote.value as never) }
  }
  if (entity === "mistakes" && isRecord(base) && isRecord(local) && isRecord(remote)) {
    const merged = mergeObject(base, local, remote)
    if (Array.isArray(base.reviewHistory) && Array.isArray(local.reviewHistory) && Array.isArray(remote.reviewHistory)) {
      const reviews = new Map<string, unknown>()
      for (const entry of [...remote.reviewHistory, ...local.reviewHistory]) {
        if (isRecord(entry) && typeof entry.id === "string") reviews.set(entry.id, entry)
      }
      merged.reviewHistory = [...reviews.values()]
    }
    return merged
  }
  if (isRecord(base) && isRecord(local) && isRecord(remote)) return mergeObject(base, local, remote)
  return sameValue(remote, base) ? local : remote
}

function mergeObject(base: Record<string, unknown>, local: Record<string, unknown>, remote: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
    const before = base[key]
    const localValue = local[key]
    const remoteValue = remote[key]
    if (sameValue(localValue, before)) {
      if (remoteValue !== undefined) merged[key] = remoteValue
    } else if (sameValue(remoteValue, before)) {
      if (localValue !== undefined) merged[key] = localValue
    } else if (remoteValue !== undefined) merged[key] = remoteValue
  }
  return merged
}

async function removeOutbox(accountId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  const db = await openDatabase()
  const transaction = db.transaction([OUTBOX], "readwrite")
  const store = transaction.objectStore(OUTBOX)
  const all = await requestResult(store.getAll() as IDBRequest<PendingRow[]>)
  const owned = new Set(all.filter((entry) => entry.accountId === accountId && ids.includes(entry.changeId)).map((entry) => entry.changeId))
  for (const id of owned) store.delete(id)
  await transactionDone(transaction)
}

async function readOutbox(accountId: string): Promise<PendingRow[]> {
  const db = await openDatabase()
  const transaction = db.transaction([OUTBOX], "readonly")
  const entries = await requestResult(transaction.objectStore(OUTBOX).getAll() as IDBRequest<PendingRow[]>)
  await transactionDone(transaction)
  return entries.filter((entry) => entry.accountId === accountId).toSorted((a, b) => a.lamport - b.lamport || a.queuedAt - b.queuedAt)
}

async function readMeta(accountId: string): Promise<AccountMeta> {
  const db = await openDatabase()
  const transaction = db.transaction([META], "readonly")
  const meta = await requestResult(transaction.objectStore(META).get(accountMetaKey(accountId)) as IDBRequest<AccountMeta | undefined>)
  await transactionDone(transaction)
  return meta ?? defaultMeta(accountId)
}

async function writeMeta(meta: AccountMeta): Promise<void> {
  const db = await openDatabase()
  const transaction = db.transaction([META], "readwrite")
  transaction.objectStore(META).put(meta)
  await transactionDone(transaction)
}

async function projectAppRows(data: AppData, accountId: string): Promise<AppData> {
  const db = await openDatabase()
  const transaction = db.transaction([ROWS, OUTBOX], "readonly")
  const [allRows, allPending] = await Promise.all([
    requestResult(transaction.objectStore(ROWS).getAll() as IDBRequest<AppliedRow[]>),
    requestResult(transaction.objectStore(OUTBOX).getAll() as IDBRequest<PendingRow[]>),
  ])
  await transactionDone(transaction)
  const pendingKeys = new Set(allPending.filter((entry) => entry.accountId === accountId).map((entry) => logicalKey(entry.entity, entry.rowId)))
  const tombstones = readLegacyTombstones()
  const rows = allRows.filter((row) => row.accountId === accountId && !pendingKeys.has(logicalKey(row.entity, row.rowId)))
  const byEntity = (entity: Entity) => rows.filter((row) => row.entity === entity)
  const live = (entity: Entity) => (row: AppliedRow) => row.operation === "put" && !isTombstoned(entity, row.rowId, row.updatedAt, tombstones)
  const remoteAttempts = byEntity("attempts").filter(live("attempts")).map((row) => row.payload)
  const remoteMistakes = byEntity("mistakes").filter(live("mistakes")).map((row) => row.payload)
  const localPending = rowsFromAppData(data).filter((row) => pendingKeys.has(logicalKey(row.entity, row.rowId)))
  const attempts = [
    ...remoteAttempts,
    ...localPending.filter((row) => row.entity === "attempts" && row.operation === "put").map((row) => row.payload),
  ]
  const mistakes = [
    ...remoteMistakes,
    ...localPending.filter((row) => row.entity === "mistakes" && row.operation === "put").map((row) => row.payload),
  ]
  const migrated = migrateAppData({ ...EMPTY_APP_DATA, attempts, mistakes })
  if (!migrated) throw new Error("Synced attempts or mistakes failed validation")

  const state = new Map<string, { value: unknown; updatedAt: string; seq: number }>()
  for (const row of byEntity("user_state").toSorted((a, b) => a.seq - b.seq)) {
    if (row.operation === "delete") { state.delete(row.rowId); continue }
    if (row.rowId === "user_state" && isRecord(row.payload)) {
      for (const [key, value] of Object.entries(row.payload)) {
        if (key.endsWith("UpdatedAt") || key === "activeExamTimer" || key === "activeSacTimer") continue
        const marker = row.payload[`${key}UpdatedAt`]
        state.set(key, { value, updatedAt: typeof marker === "string" ? marker : "", seq: row.seq })
      }
    } else if (isRecord(row.payload) && "value" in row.payload) {
      state.set(row.rowId, { value: row.payload.value, updatedAt: typeof row.payload.updated_at === "string" ? row.payload.updated_at : "", seq: row.seq })
    }
  }
  for (const item of localPending) {
    if (item.entity !== "user_state") continue
    if (item.operation === "delete") state.delete(item.rowId)
    else if (isRecord(item.payload) && "value" in item.payload)
      state.set(item.rowId, { value: item.payload.value, updatedAt: typeof item.payload.updated_at === "string" ? item.payload.updated_at : "", seq: Number.MAX_SAFE_INTEGER })
  }
  const value = (key: string) => state.get(key)?.value
  const stamp = (key: string) => state.get(key)?.updatedAt || EPOCH
  const trackedExamIds = stringArray(value("trackedExamIds"))
  const completedExamIds = stringArray(value("completedExamIds"))
  const subjects = stringArray(value("subjects"))
  const sacRecords = migrateSacRecords(value("sacRecords")) ?? []
  const remoteInsights = migrateAppData({ ...EMPTY_APP_DATA, mistakeInsights: value("mistakeInsights") })?.mistakeInsights
  const remoteDeck = migrateAppData({ ...EMPTY_APP_DATA, alternativeMistakeDeck: value("alternativeMistakeDeck") })?.alternativeMistakeDeck
  const remoteAtarEstimates = migrateAppData({ ...EMPTY_APP_DATA, atarEstimates: value("atarEstimates") })?.atarEstimates ?? []
  const remoteProgression = value("examProgression")
  const remoteDifficulty = value("examDifficulty")
  return {
    ...data,
    attempts: mergePendingCollection(migrated.attempts, localPending, "attempts"),
    mistakes: mergePendingCollection(migrated.mistakes, localPending, "mistakes"),
    examProgression: isExamProgression(remoteProgression) ? remoteProgression : undefined,
    trackedExamIds, trackedExamIdsUpdatedAt: stamp("trackedExamIds"),
    completedExamIds, completedExamIdsUpdatedAt: stamp("completedExamIds"),
    subjects, subjectsUpdatedAt: stamp("subjects"),
    sacRecords, sacRecordsUpdatedAt: stamp("sacRecords"),
    mistakeInsights: remoteInsights,
    alternativeMistakeDeck: remoteDeck,
    examDifficulty: isExamDifficultySettings(remoteDifficulty) ? remoteDifficulty : undefined,
    atarEstimates: remoteAtarEstimates, atarEstimatesUpdatedAt: stamp("atarEstimates"),
    learning: migrateLearningWorkspace(value("learning")),
  }
}

function mergePendingCollection<T extends { id: string }>(remote: T[], pending: AppRow[], entity: "attempts" | "mistakes"): T[] {
  const result = new Map(remote.map((item) => [item.id, item]))
  for (const row of pending) {
    if (row.entity !== entity) continue
    if (row.operation === "delete") result.delete(row.rowId)
    else if (isRecord(row.payload) && typeof row.payload.id === "string") result.set(row.rowId, row.payload as T)
  }
  return [...result.values()]
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string") ? value : []
}

export function recordLocalChanges(previous: AppData, next: AppData, now = new Date().toISOString()): void {
  try {
    const raw = localStorage.getItem(TOMBSTONE_KEY)
    const tombstones = (raw ? JSON.parse(raw) : { attempts: {}, mistakes: {} }) as Record<string, Record<string, string>>
    for (const entity of ["attempts", "mistakes"] as const) {
      const previousIds = new Set(previous[entity].map((item) => item.id))
      const nextIds = new Set(next[entity].map((item) => item.id))
      for (const id of previousIds) if (!nextIds.has(id)) tombstones[entity][id] = now
      for (const id of nextIds) if (!previousIds.has(id)) delete tombstones[entity][id]
    }
    localStorage.setItem("examtrack:sync:tombstones:v1", JSON.stringify(tombstones))
  } catch {
    // ponytail: localStorage tombstones are only a bootstrap bridge; IndexedDB is authoritative after sign-in.
  }
}

export function mergeMistakeConflict(base: unknown, local: unknown, remote: unknown): unknown {
  return mergeConcurrentValue("mistakes", "", base, local, remote)
}
