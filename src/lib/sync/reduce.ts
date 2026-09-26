/**
 * The pure core of sync protocol v3, and the only part of it that is worth testing
 * twice. Everything here is a total function of its arguments: no I/O, no clock, no
 * randomness. `scripts/check-sync-conformance.mjs` and Folio's `SyncConformanceTests`
 * run the same vectors against their own implementation, so a divergence between the
 * two clients fails a build instead of losing somebody's work.
 *
 * See `docs/sync-protocol.md` for the rules these functions implement.
 */
import { SYNC_ENTITIES, SYNC_TABLES, type RemoteSyncChange, type SyncChange, type SyncOperation, type SyncRowState, type SyncTable } from "@/lib/sync/types"

export type SyncDecision = "apply" | "own" | "stale" | "defer"

export interface ReduceInput {
  ownClientId: string
  cursor: number
  state: readonly SyncRowState[]
  /** `entity:rowId` keys with an unpublished local edit. */
  pending: readonly string[]
  changes: readonly RemoteSyncChange[]
}

export interface ReduceResult {
  state: SyncRowState[]
  cursor: number
  applied: RemoteSyncChange[]
  deferred: RemoteSyncChange[]
}

export function rowKey(entity: string, rowId: string): string {
  return `${entity}:${rowId}`
}

/**
 * Rules 5, 6 and 8, in that order: our own change is already on disk, a change we have
 * already surpassed is noise, and a change that collides with an unpublished local edit
 * is parked for the user rather than guessed at.
 */
export function decide(
  change: RemoteSyncChange,
  state: SyncRowState | undefined,
  pending: ReadonlySet<string>,
  ownClientId: string,
): SyncDecision {
  if (change.clientId === ownClientId) return "own"
  if (state && compareOrder(state.lamport, state.clientId, change.lamport, change.clientId) >= 0) return "stale"
  if (pending.has(rowKey(change.entity, change.rowId))) return "defer"
  return "apply"
}

/** Total order on versions: lamport first, client id as the tiebreak. Never a clock. */
export function compareOrder(
  leftLamport: number,
  leftClientId: string,
  rightLamport: number,
  rightClientId: string,
): number {
  if (leftLamport !== rightLamport) return leftLamport < rightLamport ? -1 : 1
  if (leftClientId === rightClientId) return 0
  return leftClientId < rightClientId ? -1 : 1
}

function toRowState(change: RemoteSyncChange): SyncRowState {
  return {
    entity: change.entity,
    rowId: change.rowId,
    operation: change.operation,
    payload: change.payload,
    lamport: change.lamport,
    clientId: change.clientId,
    seq: change.seq,
  }
}

function upsertRow(state: SyncRowState[], row: SyncRowState): void {
  const index = state.findIndex((existing) => existing.entity === row.entity && existing.rowId === row.rowId)
  if (index === -1) state.push(row)
  else state[index] = row
}

/**
 * Fold a batch of log rows into the applied state. The cursor advances past every row
 * in the batch, including the ones that were ignored: the log has been read, whatever
 * was decided about its contents. Deferred rows are the caller's problem to persist
 * first, because the cursor may not move past a change that is only in memory.
 */
export function reduceChanges(input: ReduceInput): ReduceResult {
  const state = input.state.map((row) => ({ ...row }))
  const pending = new Set(input.pending)
  const applied: RemoteSyncChange[] = []
  const deferred: RemoteSyncChange[] = []
  let cursor = input.cursor

  const ordered = [...input.changes].sort((left, right) => left.seq - right.seq)
  for (const change of ordered) {
    if (change.seq <= input.cursor) continue
    const current = state.find((row) => row.entity === change.entity && row.rowId === change.rowId)
    const decision = decide(change, current, pending, input.ownClientId)
    if (decision === "apply") {
      upsertRow(state, toRowState(change))
      applied.push(change)
    } else if (decision === "defer") {
      deferred.push(change)
    }
    cursor = Math.max(cursor, change.seq)
  }

  return { state, cursor, applied, deferred }
}

export interface SnapshotInput {
  pending: readonly string[]
  state: readonly SyncRowState[]
  rows: readonly SyncRowState[]
  head: number
}

/**
 * A snapshot is the whole materialized state, so it replaces what this device knew,
 * except for rows with an unpublished local edit: those exist only here, and letting the
 * snapshot overwrite them would silently discard work the user has not seen published.
 */
export function reduceSnapshot(input: SnapshotInput): ReduceResult {
  const pending = new Set(input.pending)
  const state = input.state.filter((row) => pending.has(rowKey(row.entity, row.rowId))).map((row) => ({ ...row }))
  for (const row of input.rows) {
    if (pending.has(rowKey(row.entity, row.rowId))) continue
    upsertRow(state, { ...row })
  }
  return { state, cursor: input.head, applied: [], deferred: [] }
}

/**
 * One queued change per row, keeping the highest version. A burst of edits to the same
 * row collapses to one publish, so the queue is bounded by dirty rows, not by typing.
 * Output keeps the queue's own order, which is oldest dirty row first.
 */
export function coalesceChanges(changes: readonly SyncChange[]): SyncChange[] {
  const newest = new Map<string, SyncChange>()
  for (const change of changes) {
    const key = rowKey(change.entity, change.rowId)
    const current = newest.get(key)
    if (!current || compareOrder(current.lamport, "", change.lamport, change.createdAt) < 0) {
      newest.set(key, change)
    }
  }
  return [...newest.values()]
}

/** 5s doubling to a 5 minute ceiling. Deterministic, so it can be asserted. */
export function retryDelayMs(attempts: number): number {
  if (attempts <= 0) return 0
  return Math.min(300_000, 5_000 * 2 ** Math.min(attempts - 1, 10))
}

export function isDue(change: Pick<SyncChange, "nextAttemptAt" | "blockedAt">, now: string): boolean {
  return !change.blockedAt && (!change.nextAttemptAt || change.nextAttemptAt <= now)
}

export function retryChange(change: SyncChange, error: string, now: string): SyncChange {
  const retryCount = change.retryCount + 1
  return {
    ...change,
    retryCount,
    lastError: error,
    nextAttemptAt: new Date(new Date(now).getTime() + retryDelayMs(retryCount)).toISOString(),
  }
}

export function retryOrBlockChange(
  change: SyncChange,
  error: string,
  now: string,
  maxRetries: number,
): SyncChange {
  const retried = retryChange(change, error, now)
  return retried.retryCount >= maxRetries
    ? { ...retried, nextAttemptAt: undefined, blockedAt: now }
    : retried
}

export function chunkItems<T>(items: readonly T[], size: number): T[][] {
  if (!Number.isSafeInteger(size) || size <= 0) throw new Error("Chunk size must be a positive integer")
  const chunks: T[][] = []
  for (let offset = 0; offset < items.length; offset += size) chunks.push(items.slice(offset, offset + size))
  return chunks
}

/** Newest version of each row in a log batch. Applied in sequence order, never batch order. */
export function latestChanges(changes: readonly RemoteSyncChange[]): RemoteSyncChange[] {
  const latest = new Map<string, RemoteSyncChange>()
  for (const change of changes) {
    const current = latest.get(rowKey(change.entity, change.rowId))
    if (!current || current.seq < change.seq) latest.set(rowKey(change.entity, change.rowId), change)
  }
  return [...latest.values()].sort((left, right) => left.seq - right.seq)
}

/** Anything the log may carry. Used when parsing; local writes still take a `SyncTable`. */
export function isSyncEntity(value: unknown): value is string {
  return typeof value === "string" && (SYNC_ENTITIES as readonly string[]).includes(value)
}

/** The seven entities this app stores locally, and therefore the only ones it writes. */
export function isSyncTable(value: unknown): value is SyncTable {
  return typeof value === "string" && (SYNC_TABLES as readonly string[]).includes(value)
}

export function isOperation(value: unknown): value is SyncOperation {
  return value === "put" || value === "delete"
}
