import { openFocalDatabase } from "@/lib/storage/database"
import { isSyncEntity, isSyncTable } from "@/lib/sync/reduce"
import type { RemoteSyncChange, SyncChange, SyncOperation, SyncRowState, SyncTable } from "@/lib/sync/types"

type Database = Awaited<ReturnType<typeof openFocalDatabase>>

interface OutboxRow {
  change_id: string
  account_id: string
  entity: string
  row_id: string
  operation: string
  payload: string | null
  created_at: string
  lamport: number
  retry_count: number
  last_error: string | null
  next_attempt_at: string | null
  blocked_at: string | null
}

interface InboxRow {
  account_id: string
  entity: string
  row_id: string
  change_id: string
  client_id: string
  operation: string
  payload: string | null
  seq: number
  created_at: string
}

interface AppliedRow {
  entity: string
  row_id: string
  operation: string
  payload: string | null
  lamport: number
  client_id: string
  seq: number
}

interface CursorRow {
  cursor_seq: number
  lamport: number
}

/** The cursor key used before protocol v3. Read once, then retired. */
const LEGACY_CURSOR_KEY = "change-log-v1"

let lock: Promise<unknown> = Promise.resolve()

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = lock.then(operation, operation)
  lock = result.catch((error: unknown) => console.error("Failed to persist sync state:", error))
  return result
}

function nowIso(): string {
  return new Date().toISOString()
}

// ---------------------------------------------------------------------------
// Outbox
// ---------------------------------------------------------------------------

export async function readOutbox(accountId?: string): Promise<SyncChange[]> {
  await lock
  const database = await openFocalDatabase()
  return readOutboxUnlocked(database, accountId)
}

/**
 * The commit is the event: this is called from the same write path that saves the record,
 * so a local edit is durable and queued before the UI is told anything. The lamport comes
 * from the same durable counter, so a crash cannot reuse a version number.
 */
export function enqueueChange(
  accountId: string,
  entity: SyncTable,
  rowId: string,
  operation: SyncOperation,
  payload: unknown,
): Promise<SyncChange[]> {
  return serialized(async () => {
    const changeId = crypto.randomUUID()
    const createdAt = nowIso()
    const database = await openFocalDatabase()
    const ownerAccountId = accountId || (await readContextAccountId(database))
    const lamport = ownerAccountId ? await nextLamportUnlocked(database, ownerAccountId, createdAt) : 0
    await database.execute(
      `insert into sync_outbox (
         change_id, account_id, entity, row_id, operation, payload, created_at,
         retry_count, last_error, next_attempt_at, blocked_at, lamport
       ) values ($1, $2, $3, $4, $5, $6, $7, 0, null, null, null, $8)
       on conflict (account_id, entity, row_id) do update set
         change_id = excluded.change_id,
         operation = excluded.operation,
         payload = excluded.payload,
         created_at = excluded.created_at,
         lamport = excluded.lamport,
         retry_count = 0,
         last_error = null,
         next_attempt_at = null,
         blocked_at = null`,
      [changeId, ownerAccountId, entity, rowId, operation, payload === null ? null : JSON.stringify(payload), createdAt, lamport],
    )
    return readOutboxUnlocked(database, ownerAccountId)
  })
}

async function readOutboxUnlocked(database: Database, accountId?: string): Promise<SyncChange[]> {
  const rows = await database.select<OutboxRow[]>(
    `select change_id, account_id, entity, row_id, operation, payload, created_at, lamport,
            retry_count, last_error, next_attempt_at, blocked_at
       from sync_outbox
      ${accountId === undefined ? "" : "where account_id = $1"}
      order by created_at asc`,
    accountId === undefined ? [] : [accountId],
  )
  return rows.flatMap(parseOutboxRow)
}

function parseOutboxRow(row: OutboxRow): SyncChange[] {
  if (!isSyncTable(row.entity)) return []
  if (row.operation !== "put" && row.operation !== "delete") return []
  try {
    return [{
      changeId: row.change_id,
      entity: row.entity,
      rowId: row.row_id,
      operation: row.operation,
      payload: row.payload === null ? null : JSON.parse(row.payload) as unknown,
      createdAt: row.created_at,
      lamport: row.lamport,
      retryCount: row.retry_count,
      lastError: row.last_error ?? undefined,
      nextAttemptAt: row.next_attempt_at ?? undefined,
      blockedAt: row.blocked_at ?? undefined,
    }]
  } catch {
    return []
  }
}

/**
 * Claims changes made while signed out. Rows are only adopted when the previous owner is
 * the same account, so a shared machine cannot leak one account's queue into another's.
 */
export function activateOutboxAccount(accountId: string): Promise<void> {
  return serialized(async () => {
    const database = await openFocalDatabase()
    const context = await database.select<{ account_id: string; last_account_id: string }[]>(
      "select account_id, last_account_id from sync_local_context where singleton = 1",
    )
    const lastAccountId = context[0]?.last_account_id ?? ""
    const canClaimUnowned = accountId.length > 0 && (lastAccountId === "" || lastAccountId === accountId)
    if (canClaimUnowned) {
      const unowned = await database.select<OutboxRow[]>(
        `select change_id, account_id, entity, row_id, operation, payload, created_at, lamport,
                retry_count, last_error, next_attempt_at, blocked_at
           from sync_outbox
          where account_id = ''
          order by created_at asc`,
      )
      for (const change of unowned) {
        await database.execute(
          `delete from sync_outbox
            where account_id = $1 and entity = $2 and row_id = $3 and created_at <= $4`,
          [accountId, change.entity, change.row_id, change.created_at],
        )
        await database.execute(
          "update or ignore sync_outbox set account_id = $1 where change_id = $2 and account_id = ''",
          [accountId, change.change_id],
        )
        await database.execute("delete from sync_outbox where change_id = $1 and account_id = ''", [change.change_id])
      }
    }
    await database.execute(
      `update sync_local_context
          set account_id = case when $1 = '' then last_account_id else $1 end,
              last_account_id = case when $1 = '' then last_account_id else $1 end
        where singleton = 1`,
      [accountId],
    )
  })
}

async function readContextAccountId(database: Database): Promise<string> {
  const context = await database.select<{ account_id: string }[]>(
    "select account_id from sync_local_context where singleton = 1",
  )
  return context[0]?.account_id ?? ""
}

/** A change leaves the outbox only on a receipt, so a crash mid-push just resends it. */
export function finishFlush(accountId: string, processedIds: string[], retries: SyncChange[]): Promise<SyncChange[]> {
  return serialized(async () => {
    const database = await openFocalDatabase()
    for (const changeId of processedIds) {
      await database.execute("delete from sync_outbox where change_id = $1", [changeId])
    }
    for (const change of retries) {
      await database.execute(
        `update sync_outbox
            set retry_count = $2, last_error = $3, next_attempt_at = $4, blocked_at = $5
          where change_id = $1`,
        [
          change.changeId,
          change.retryCount,
          change.lastError ?? null,
          change.nextAttemptAt ?? null,
          change.blockedAt ?? null,
        ],
      )
    }
    return readOutboxUnlocked(database, accountId)
  })
}

export function removeOutboxChange(accountId: string, entity: SyncTable, rowId: string): Promise<void> {
  return serialized(async () => {
    await (await openFocalDatabase()).execute(
      "delete from sync_outbox where account_id = $1 and entity = $2 and row_id = $3",
      [accountId, entity, rowId],
    )
  })
}

/**
 * Applying a remote change writes the local record, and a remote write must not queue
 * itself. These two markers are deleted in the same statement that saves the record, so
 * the suppression can never outlive the write it was protecting.
 */
export function suppressRecordOutbox(
  records: { entity: "projects" | "events" | "study_sessions"; rowId: string; payload: unknown }[],
): Promise<void> {
  if (records.length === 0) return Promise.resolve()
  return serialized(async () => {
    const database = await openFocalDatabase()
    for (const record of records) {
      await database.execute(
        `insert into sync_record_suppress (entity, row_id, payload)
         values ($1, $2, $3)
         on conflict (entity, row_id) do update set payload = excluded.payload`,
        [record.entity, record.rowId, JSON.stringify(record.payload)],
      )
    }
  })
}

export function clearRecordOutboxSuppressions(
  records: { entity: "projects" | "events" | "study_sessions"; rowId: string; payload: unknown }[],
): Promise<void> {
  if (records.length === 0) return Promise.resolve()
  return serialized(async () => {
    const database = await openFocalDatabase()
    for (const record of records) {
      await database.execute(
        "delete from sync_record_suppress where entity = $1 and row_id = $2 and payload = $3",
        [record.entity, record.rowId, JSON.stringify(record.payload)],
      )
    }
  })
}

// ---------------------------------------------------------------------------
// Inbox: remote changes parked until the user resolves them
// ---------------------------------------------------------------------------

export async function readInbox(accountId: string): Promise<RemoteSyncChange[]> {
  await lock
  const rows = await (await openFocalDatabase()).select<InboxRow[]>(
    `select account_id, entity, row_id, change_id, client_id, operation, payload, seq, created_at
       from sync_inbox
      where account_id = $1
      order by seq asc`,
    [accountId],
  )
  return rows.flatMap(parseInboxRow)
}

export function deferInboxChanges(accountId: string, changes: readonly RemoteSyncChange[]): Promise<void> {
  if (changes.length === 0) return Promise.resolve()
  return serialized(async () => {
    const database = await openFocalDatabase()
    for (const change of changes) {
      await database.execute(
        `insert into sync_inbox (
           account_id, entity, row_id, change_id, client_id, operation, payload, seq, created_at
         ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (account_id, entity, row_id) do update set
           change_id = excluded.change_id,
           client_id = excluded.client_id,
           operation = excluded.operation,
           payload = excluded.payload,
           seq = excluded.seq,
           created_at = excluded.created_at
         where excluded.seq > sync_inbox.seq`,
        [
          accountId,
          change.entity,
          change.rowId,
          change.changeId,
          change.clientId,
          change.operation,
          change.payload == null ? null : JSON.stringify(change.payload),
          change.seq,
          change.createdAt,
        ],
      )
    }
  })
}

export function removeInboxChanges(accountId: string, changes: readonly RemoteSyncChange[]): Promise<void> {
  if (changes.length === 0) return Promise.resolve()
  return serialized(async () => {
    const database = await openFocalDatabase()
    for (const change of changes) {
      await database.execute(
        "delete from sync_inbox where account_id = $1 and entity = $2 and row_id = $3 and seq <= $4",
        [accountId, change.entity, change.rowId, change.seq],
      )
    }
  })
}

function parseInboxRow(row: InboxRow): RemoteSyncChange[] {
  if (!isSyncEntity(row.entity)) return []
  if (row.operation !== "put" && row.operation !== "delete") return []
  try {
    return [{
      seq: row.seq,
      changeId: row.change_id,
      clientId: row.client_id,
      entity: row.entity,
      rowId: row.row_id,
      operation: row.operation,
      payload: row.payload === null ? null : JSON.parse(row.payload) as unknown,
      lamport: 0,
      createdAt: row.created_at,
    }]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Cursor and lamport clock
// ---------------------------------------------------------------------------

export interface SyncCursorState {
  seq: number
  lamport: number
}

/**
 * Where this device has read to, and the largest version it has ever seen. The watermark
 * is what stops a slower device's old change from overwriting a newer local edit, so it
 * is raised on every pull as well as on every local write.
 */
export async function readCursor(accountId: string): Promise<SyncCursorState> {
  await lock
  const database = await openFocalDatabase()
  const rows = await database.select<CursorRow[]>(
    "select cursor_seq, lamport from sync_cursor where account_id = $1",
    [accountId],
  )
  if (rows[0]) return { seq: rows[0].cursor_seq, lamport: rows[0].lamport }
  const legacy = await readState<number>(`cursor:${accountId}:${LEGACY_CURSOR_KEY}`)
  return { seq: legacy ?? 0, lamport: 0 }
}

export function writeCursor(accountId: string, seq: number, lamport: number): Promise<void> {
  return serialized(async () => {
    await (await openFocalDatabase()).execute(
      `insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
       values ($1, $2, $3, $4)
       on conflict (account_id) do update set
         cursor_seq = greatest(sync_cursor.cursor_seq, excluded.cursor_seq),
         lamport = greatest(sync_cursor.lamport, excluded.lamport),
         updated_at = excluded.updated_at`,
      [accountId, seq, lamport, nowIso()],
    )
  })
}

async function nextLamportUnlocked(database: Database, accountId: string, at: string): Promise<number> {
  const rows = await database.select<{ lamport: number }[]>(
    `insert into sync_cursor (account_id, cursor_seq, lamport, updated_at)
     values ($1, 0, 1, $2)
     on conflict (account_id) do update
       set lamport = sync_cursor.lamport + 1, updated_at = excluded.updated_at
     returning lamport`,
    [accountId, at],
  )
  return rows[0]?.lamport ?? 1
}

// ---------------------------------------------------------------------------
// Applied state: the last version of each row this device knows about
// ---------------------------------------------------------------------------

export async function readApplied(accountId: string, entities?: readonly SyncTable[]): Promise<SyncRowState[]> {
  await lock
  const rows = await (await openFocalDatabase()).select<AppliedRow[]>(
    `select entity, row_id, operation, payload, lamport, client_id, seq
       from sync_applied
      where account_id = $1
        ${entities && entities.length > 0 ? `and entity in (${entities.map((_, index) => `$${index + 2}`).join(", ")})` : ""}
      order by seq asc`,
    entities && entities.length > 0 ? [accountId, ...entities] : [accountId],
  )
  return rows.flatMap(parseAppliedRow)
}

export function writeApplied(accountId: string, rows: readonly SyncRowState[]): Promise<void> {
  if (rows.length === 0) return Promise.resolve()
  return serialized(async () => {
    const database = await openFocalDatabase()
    for (const row of rows) {
      await database.execute(
        `insert into sync_applied (account_id, entity, row_id, operation, payload, lamport, client_id, seq, updated_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (account_id, entity, row_id) do update set
           operation = excluded.operation,
           payload = excluded.payload,
           lamport = excluded.lamport,
           client_id = excluded.client_id,
           seq = excluded.seq,
           updated_at = excluded.updated_at`,
        [
          accountId,
          row.entity,
          row.rowId,
          row.operation,
          row.payload === null ? null : JSON.stringify(row.payload),
          row.lamport,
          row.clientId,
          row.seq,
          nowIso(),
        ],
      )
    }
  })
}

export function removeApplied(accountId: string, keys: readonly { entity: string; rowId: string }[]): Promise<void> {
  if (keys.length === 0) return Promise.resolve()
  return serialized(async () => {
    const database = await openFocalDatabase()
    for (const key of keys) {
      await database.execute(
        "delete from sync_applied where account_id = $1 and entity = $2 and row_id = $3",
        [accountId, key.entity, key.rowId],
      )
    }
  })
}

function parseAppliedRow(row: AppliedRow): SyncRowState[] {
  if (!isSyncEntity(row.entity)) return []
  if (row.operation !== "put" && row.operation !== "delete") return []
  try {
    return [{
      entity: row.entity,
      rowId: row.row_id,
      operation: row.operation,
      payload: row.payload === null ? null : JSON.parse(row.payload) as unknown,
      lamport: row.lamport,
      clientId: row.client_id,
      seq: row.seq,
    }]
  } catch {
    return []
  }
}

// ---------------------------------------------------------------------------
// Free-form sync state (bootstrap marker, Notion bookkeeping)
// ---------------------------------------------------------------------------

export async function readState<T>(key: string): Promise<T | null> {
  await lock
  const rows = await (await openFocalDatabase()).select<{ value: string }[]>(
    "select value from sync_state where key = $1",
    [key],
  )
  if (!rows[0]) return null
  try {
    return JSON.parse(rows[0].value) as T
  } catch {
    return null
  }
}

export function writeState(key: string, value: unknown): Promise<void> {
  return serialized(async () => {
    await (await openFocalDatabase()).execute(
      `insert into sync_state (key, value, updated_at)
       values ($1, $2, $3)
       on conflict (key) do update set value = excluded.value, updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), nowIso()],
    )
  })
}
