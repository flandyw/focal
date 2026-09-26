import { chunkItems, latestChanges, retryChange, retryOrBlockChange } from "../src/lib/sync/reduce"
import { repairDuplicateSessions, sessionDeletionIds } from "../src/lib/sync/sessions"
import { normalizeStudySession } from "../src/lib/studySessions"
import type { RemoteSyncChange, SyncChange } from "../src/lib/sync/types"

interface BunSqliteDatabase {
  exec(sql: string): void
  run(sql: string, values: unknown[]): void
  query(sql: string): { all(): unknown[] }
  close(): void
}

interface BunSqliteModule {
  Database: new (path: string) => BunSqliteDatabase
}

function assertEqual(actual: unknown, expected: unknown, message: string): void {
  const actualJson = JSON.stringify(actual)
  const expectedJson = JSON.stringify(expected)
  if (actualJson !== expectedJson) throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`)
}

function remote(overrides: Partial<RemoteSyncChange>): RemoteSyncChange {
  return {
    seq: 1,
    changeId: crypto.randomUUID(),
    clientId: "device-1",
    entity: "events",
    rowId: "event-1",
    operation: "put",
    payload: { id: "event-1", title: "Event" },
    lamport: 1,
    createdAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  }
}

assertEqual(
  latestChanges([
    remote({ seq: 1, payload: { title: "old" } }),
    remote({ seq: 3, payload: null, operation: "delete" }),
    remote({ rowId: "event-2", seq: 2, payload: { title: "other" } }),
  ]).map((change) => [change.rowId, change.operation, change.seq]),
  [["event-2", "put", 2], ["event-1", "delete", 3]],
  "log sequence order must deterministically reduce each row",
)
assertEqual(chunkItems([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]], "sync pushes must use bounded batches")

const queued: SyncChange = {
  changeId: "change-1",
  entity: "events",
  rowId: "event-1",
  operation: "put",
  payload: { id: "event-1" },
  createdAt: "2026-07-20T00:00:00.000Z",
  lamport: 1,
  retryCount: 0,
}
assertEqual(
  retryChange(queued, "offline", "2026-07-20T00:00:00.000Z"),
  { ...queued, retryCount: 1, lastError: "offline", nextAttemptAt: "2026-07-20T00:00:05.000Z" },
  "failed immutable changes must remain queued with bounded backoff",
)
assertEqual(
  retryOrBlockChange({ ...queued, retryCount: 7 }, "invalid payload", "2026-07-20T00:00:00.000Z", 8).blockedAt,
  "2026-07-20T00:00:00.000Z",
  "deterministic poison rows must stop retrying after the configured ceiling",
)

const duplicateBase = {
  schemaVersion: 2 as const,
  subjectIds: ["mm"],
  title: "Focus",
  topics: [],
  schedule: { blocks: [{ start: "2026-07-20T01:00:00.000Z", end: "2026-07-20T01:30:00.000Z" }] },
  execution: { state: "completed" as const, intervals: [], completedAt: "2026-07-20T01:30:00.000Z" },
  createdVia: "notion" as const,
  created_at: "2026-07-20T02:00:00.000Z",
  updated_at: "2026-07-20T02:00:00.000Z",
}
const repaired = repairDuplicateSessions([
  { ...duplicateBase, id: "session-b", integrations: { notion: { type: "notion", id: "page-b", kind: "session" } } },
  { ...duplicateBase, id: "session-a", integrations: { notion: { type: "notion", id: "page-a", kind: "session" } } },
])
assertEqual(repaired.sessions.map((session) => session.id), ["session-a"], "duplicate repair must choose one stable canonical session")
assertEqual(repaired.duplicateIds, ["session-b"], "duplicate repair must emit durable deletion ids")
assertEqual(repaired.duplicateNotionPageIds, ["page-b"], "duplicate repair must retain orphan Notion pages for cleanup")

const folioCheckpoints = repairDuplicateSessions([
  { ...duplicateBase, id: "folio-old", title: "PE Focus", updated_at: "2026-07-20T02:01:00.000Z", integrations: { folio: { type: "folio", id: "folio-session", kind: "study" } } },
  { ...duplicateBase, id: "folio-new", title: "PE Focus", updated_at: "2026-07-20T02:02:00.000Z", integrations: { folio: { type: "folio", id: "folio-session", kind: "study" } } },
])
assertEqual(folioCheckpoints.sessions.map((session) => session.id), ["folio-new"], "Folio checkpoints must collapse by their stable integration id")
assertEqual(folioCheckpoints.duplicateIds, ["folio-old"], "Folio checkpoint cleanup must remove the stale local row")

const legacyCheckpoints = Array.from({ length: 366 }, (_, i) => ({
  ...duplicateBase, id: `checkpoint-${i}`, last_modified_device_id: "folio-android",
  description: "Exam practice in Folio · exam · paused",
  schedule: { blocks: [{ start: "2026-09-24T09:08:46.155Z", end: new Date(Date.UTC(2026, 8, 25, 0, i)).toISOString() }] },
  integrations: { notion: { type: "notion", id: `page-${i}`, kind: "session" } },
}))
const legacyRepair = repairDuplicateSessions(legacyCheckpoints)
assertEqual(legacyRepair.sessions.length, 1, "changing checkpoint end times must not create separate Folio sittings")
assertEqual(legacyRepair.duplicateIds.length, 365, "all historical copies must get durable deletes")
assertEqual(legacyRepair.duplicateNotionPageIds.length, 365, "every duplicate mirror must be archived")
assertEqual(sessionDeletionIds(legacyCheckpoints.map(normalizeStudySession), legacyRepair.sessions, [legacyRepair.sessions[0].id]).length,
  366, "discard must delete every persisted copy, including ones hidden by UI repair")
assertEqual(repairDuplicateSessions([
  legacyCheckpoints[0],
  { ...legacyCheckpoints[1], schedule: { blocks: [{ start: "2026-09-24T09:08:46.156Z", end: "2026-09-25T01:00:00.000Z" }] } },
]).sessions.length, 2, "separate Folio sittings must survive repair")

const remoteMigration = await fetch(new URL("../supabase/migrations/0004_rebuild_sync_as_change_log.sql", import.meta.url)).then((response) => response.text())
for (const required of [
  "drop table if exists public.study_sessions",
  "create table public.sync_changes",
  "create table public.sync_change_receipts",
  "reject_replayed_focal_sync_change_before_insert",
  "compact_focal_sync_changes_after_insert",
  "enable row level security",
  "alter publication supabase_realtime add table public.sync_changes",
]) {
  if (!remoteMigration.includes(required)) throw new Error(`Supabase sync rebuild is missing: ${required}`)
}

const finalMigration = await fetch(new URL("../supabase/migrations/0005_finalize_sync_rebuild.sql", import.meta.url)).then((response) => response.text())
for (const required of [
  "drop function if exists public.set_updated_at() cascade",
  "revoke all on public.sync_change_receipts",
  "Legacy Focal sync tables still exist",
  "Focal sync idempotency or compaction trigger is missing",
  "sync_changes is missing from the Realtime publication",
  "append-only security model",
]) {
  if (!finalMigration.includes(required)) throw new Error(`Supabase sync finalization is missing: ${required}`)
}

const reliabilityMigration = await fetch(new URL("../supabase/migrations/0006_sync_reliability.sql", import.meta.url)).then((response) => response.text())
for (const required of [
  "operation = 'delete' and (payload is null",
  "sync_change_receipts_accepted_idx",
  "prune_old_focal_sync_receipts",
]) {
  if (!reliabilityMigration.includes(required)) throw new Error(`Supabase reliability migration is missing: ${required}`)
}

const localMigration = await fetch(new URL("../src-tauri/migrations/0002_rebuild_sync_outbox.sql", import.meta.url)).then((response) => response.text())
for (const required of [
  "drop table if exists sync_outbox",
  "operation in ('put', 'delete')",
  "account_id text not null default ''",
  "sync_outbox_delete_local_record_after_insert",
  "sync_outbox_delete_local_record_after_update",
  "create table sync_state",
]) {
  if (!localMigration.includes(required)) throw new Error(`Local sync rebuild is missing: ${required}`)
}

// @ts-expect-error Bun provides this test-only module; the browser app deliberately omits Bun types.
const sqliteModule = await import("bun:sqlite") as unknown as BunSqliteModule
const localDatabase = new sqliteModule.Database(":memory:")
localDatabase.exec(await fetch(new URL("../src-tauri/migrations/0001_local_database.sql", import.meta.url)).then((response) => response.text()))
localDatabase.run(
  "insert into records (kind, id, payload, position) values (?, ?, ?, ?)",
  ["events", "deleted-event", JSON.stringify({ id: "deleted-event" }), 0],
)
localDatabase.exec(localMigration)
localDatabase.run(
  `insert into sync_outbox (change_id, entity, row_id, operation, payload, created_at)
   values (?, ?, ?, ?, ?, ?)`,
  ["delete-change", "events", "deleted-event", "delete", null, "2026-07-20T00:00:00.000Z"],
)
assertEqual(
  localDatabase.query("select id from records where id = 'deleted-event'").all(),
  [],
  "persisting a delete must atomically remove its local record",
)
localDatabase.run(
  `insert into sync_outbox (change_id, account_id, entity, row_id, operation, payload, created_at)
   values (?, ?, ?, ?, ?, ?, ?)`,
  ["account-a-change", "account-a", "events", "shared-row", "put", JSON.stringify({ id: "shared-row" }), "2026-07-20T00:00:01.000Z"],
)
localDatabase.run(
  `insert into sync_outbox (change_id, account_id, entity, row_id, operation, payload, created_at)
   values (?, ?, ?, ?, ?, ?, ?)`,
  ["account-b-change", "account-b", "events", "shared-row", "put", JSON.stringify({ id: "shared-row" }), "2026-07-20T00:00:02.000Z"],
)
assertEqual(
  localDatabase.query("select account_id from sync_outbox where row_id = 'shared-row' order by account_id").all(),
  [{ account_id: "account-a" }, { account_id: "account-b" }],
  "pending changes for different Supabase accounts must remain isolated",
)

const localReliabilityMigration = await fetch(new URL("../src-tauri/migrations/0003_sync_reliability.sql", import.meta.url)).then((response) => response.text())
for (const required of [
  "alter table sync_outbox add column blocked_at",
  "create table sync_inbox",
  "last_account_id text not null default ''",
  "create trigger records_enqueue_sync_after_insert",
  "create table notion_outbox",
]) {
  if (!localReliabilityMigration.includes(required)) throw new Error(`Local reliability migration is missing: ${required}`)
}
localDatabase.run(
  `insert into preferences (key, value, syncable, updated_at) values (?, ?, ?, ?)`,
  ["focal-notion-data-source-id", JSON.stringify("database"), 1, "2026-07-20T00:00:00.000Z"],
)
localDatabase.run(
  "insert into records (kind, id, payload, position) values (?, ?, ?, ?)",
  ["events", "pre-upgrade-event", JSON.stringify({ id: "pre-upgrade-event", title: "Existing" }), 0],
)
const localChangeLogMigration = await fetch(new URL("../src-tauri/migrations/0004_change_log.sql", import.meta.url)).then((response) => response.text())
for (const required of [
  "alter table sync_outbox add column lamport",
  "create table if not exists sync_cursor",
  "create table if not exists sync_applied",
  "alter table sync_inbox rename column revision to seq",
]) {
  if (!localChangeLogMigration.includes(required)) throw new Error(`Local change-log migration is missing: ${required}`)
}

localDatabase.exec(localReliabilityMigration)
localDatabase.run("update sync_local_context set account_id = ? where singleton = 1", ["account-a"])
assertEqual(
  localDatabase.query("select operation from notion_outbox where local_id = 'pre-upgrade-event'").all(),
  [{ operation: "upsert" }],
  "the reliability migration must backfill existing Notion-eligible records",
)

// v3 renames the log vocabulary and rebuilds the enqueue triggers, so the durable-behaviour
// fixtures below run against the current schema rather than the one they were written for.
localDatabase.exec(localChangeLogMigration)
const persistenceSource = await fetch(new URL("../src/lib/sync/persistence.ts", import.meta.url)).then((response) => response.text())
const cursorSql = /`([^`]+)`/.exec(persistenceSource.slice(persistenceSource.indexOf("export function writeCursor")))?.[1]
if (!cursorSql) throw new Error("Could not find production cursor SQL")
for (const [seq, lamport] of [[10, 20], [5, 15], [11, 18]]) {
  localDatabase.run(cursorSql.replace(/\$[1-4]/g, "?"), ["cursor-regression", seq, lamport, "2026-09-26T00:00:00.000Z"])
}
assertEqual(localDatabase.query("select cursor_seq, lamport from sync_cursor where account_id = 'cursor-regression'").all(),
  [{ cursor_seq: 11, lamport: 20 }], "production sync cursor SQL must run on SQLite and never move either watermark backwards")
localDatabase.run(
  "insert into records (kind, id, payload, position) values (?, ?, ?, ?)",
  ["events", "atomic-event", JSON.stringify({ id: "atomic-event", title: "Atomic" }), 0],
)
assertEqual(
  localDatabase.query("select account_id, operation from sync_outbox where row_id = 'atomic-event'").all(),
  [{ account_id: "account-a", operation: "put" }],
  "a durable record upsert must atomically create its Supabase outbox intent",
)
const firstLamport = (localDatabase.query("select lamport from sync_outbox where row_id = 'atomic-event'").all() as { lamport: number }[])[0]
assertEqual(
  firstLamport.lamport >= 1,
  true,
  "a queued record change must carry a lamport from the durable clock",
)
assertEqual(
  localDatabase.query("select cursor_seq from sync_cursor where account_id = 'account-a'").all(),
  [{ cursor_seq: 0 }],
  "enqueuing a local change must not move the read cursor",
)
localDatabase.run(
  "insert into records (kind, id, payload, position) values (?, ?, ?, ?)",
  ["events", "later-event", JSON.stringify({ id: "later-event" }), 1],
)
const laterLamport = (localDatabase.query("select lamport from sync_outbox where row_id = 'later-event'").all() as { lamport: number }[])[0]
assertEqual(
  laterLamport.lamport > firstLamport.lamport,
  true,
  "each queued change must get a strictly newer version than the last",
)
assertEqual(
  (localDatabase.query("select lamport from sync_cursor where account_id = 'account-a'").all() as { lamport: number }[])[0].lamport,
  laterLamport.lamport,
  "the per-account clock must survive the enqueue so versions never repeat",
)
assertEqual(
  localDatabase.query("select operation from notion_outbox where local_id = 'atomic-event'").all(),
  [{ operation: "upsert" }],
  "a Notion-eligible record write must atomically create its Notion outbox intent",
)
const remotePayload = JSON.stringify({ id: "remote-event", title: "Remote" })
localDatabase.run(
  "insert into sync_record_suppress (entity, row_id, payload) values (?, ?, ?)",
  ["events", "remote-event", remotePayload],
)
localDatabase.run(
  "insert into records (kind, id, payload, position) values (?, ?, ?, ?)",
  ["events", "remote-event", remotePayload, 2],
)
assertEqual(
  localDatabase.query("select change_id from sync_outbox where row_id = 'remote-event'").all(),
  [],
  "applying a remote record must not echo it back into the local outbox",
)
localDatabase.run(
  `insert into sync_inbox (
     account_id, entity, row_id, change_id, client_id, operation, payload, seq, created_at
   ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ["account-a", "events", "deferred-event", "remote-1", "device-b", "put", remotePayload, 10, "2026-07-20T00:00:00.000Z"],
)
localDatabase.run(
  `insert into sync_inbox (
     account_id, entity, row_id, change_id, client_id, operation, payload, seq, created_at
   ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
   on conflict (account_id, entity, row_id) do update set
     change_id = excluded.change_id, seq = excluded.seq
   where excluded.seq > sync_inbox.seq`,
  ["account-a", "events", "deferred-event", "remote-2", "device-b", "put", remotePayload, 12, "2026-07-20T00:00:01.000Z"],
)
assertEqual(
  localDatabase.query("select change_id, seq from sync_inbox where row_id = 'deferred-event'").all(),
  [{ change_id: "remote-2", seq: 12 }],
  "the durable inbox must retain the newest skipped remote sequence",
)
const linkedPayload = JSON.stringify({
  id: "linked-event",
  title: "Linked",
  source: { type: "notion", id: "notion-page", kind: "event" },
})
localDatabase.run(
  "insert into records (kind, id, payload, position) values (?, ?, ?, ?)",
  ["events", "linked-event", linkedPayload, 3],
)
localDatabase.run(
  `insert into sync_outbox (
     change_id, account_id, entity, row_id, operation, payload, created_at, lamport
   ) values (?, ?, ?, ?, ?, ?, ?, ?)
   on conflict (account_id, entity, row_id) do update set
     change_id = excluded.change_id,
     operation = excluded.operation,
     payload = excluded.payload,
     created_at = excluded.created_at,
     lamport = excluded.lamport`,
  [
    "linked-delete",
    "account-a",
    "events",
    "linked-event",
    "delete",
    JSON.stringify({ notion: { pageId: "notion-page", kind: "event", dataSourceId: "database" } }),
    "2026-07-20T00:00:00.000Z",
    99,
  ],
)
assertEqual(
  localDatabase.query("select operation, page_id from notion_outbox where local_id = 'linked-event'").all(),
  [{ operation: "archive", page_id: "notion-page" }],
  "a Supabase tombstone must atomically create the matching Notion archive intent",
)
localDatabase.run(
  "insert into records (kind, id, payload, position) values (?, ?, ?, ?)",
  ["events", "linked-event", linkedPayload, 3],
)
assertEqual(
  localDatabase.query("select operation, page_id from notion_outbox where local_id = 'linked-event'").all(),
  [{ operation: "upsert", page_id: "notion-page" }],
  "restoring a linked item must atomically cancel its pending Notion archive",
)
assertEqual(
  localDatabase.query("select id from records where id = 'linked-event'").all(),
  [{ id: "linked-event" }],
  "a queued delete must still remove the local record, and a restore must bring it back",
)
localDatabase.run(
  "insert into records (kind, id, payload, position) values (?, ?, ?, ?)",
  ["events", "requeued-delete", JSON.stringify({ id: "requeued-delete" }), 4],
)
localDatabase.run(
  `insert into sync_outbox (change_id, account_id, entity, row_id, operation, payload, created_at, lamport)
   values (?, ?, ?, ?, ?, ?, ?, ?)
   on conflict (account_id, entity, row_id) do update set
     change_id = excluded.change_id, operation = excluded.operation, payload = excluded.payload,
     created_at = excluded.created_at, lamport = excluded.lamport`,
  ["v3-delete", "account-a", "events", "requeued-delete", "delete", null, "2026-07-20T00:00:00.000Z", 100],
)
assertEqual(
  localDatabase.query("select id from records where id = 'requeued-delete'").all(),
  [],
  "a queued delete must still remove the local record in the same statement",
)
localDatabase.run(
  `insert into sync_applied (account_id, entity, row_id, operation, payload, lamport, client_id, seq, updated_at)
   values (?, ?, ?, ?, ?, ?, ?, ?, ?)
   on conflict (account_id, entity, row_id) do update set
     lamport = excluded.lamport, seq = excluded.seq`,
  ["account-a", "events", "applied-event", "put", remotePayload, 12, "device-b", 40, "2026-07-20T00:00:00.000Z"],
)
localDatabase.run(
  `insert into sync_applied (account_id, entity, row_id, operation, payload, lamport, client_id, seq, updated_at)
   values (?, ?, ?, ?, ?, ?, ?, ?, ?)
   on conflict (account_id, entity, row_id) do update set
     operation = excluded.operation, payload = excluded.payload,
     lamport = excluded.lamport, client_id = excluded.client_id, seq = excluded.seq`,
  ["account-a", "events", "applied-event", "put", remotePayload, 3, "device-a", 41, "2026-07-20T00:00:00.000Z"],
)
assertEqual(
  localDatabase.query("select lamport, client_id, seq from sync_applied where row_id = 'applied-event'").all(),
  [{ lamport: 3, client_id: "device-a", seq: 41 }],
  "applied state must round-trip the version reduce decided on, not re-decide it here",
)
// The guards below used to live in one 950-line file. They now live in the module that owns
// each behaviour, so an assertion failure points at the thing that actually broke.
const guards: [string, string[]][] = [
  ["../src/lib/sync/engine.ts", [
    "conflict.table !== table || conflict.rowId !== rowId",
    "stopWakeup = subscribeWakeup(userId",
    "await removeInboxChanges(accountId, [parkedChange])",
  ]],
  ["../src/lib/sync/applier.ts", [
    "finally {\n    await clearRecordOutboxSuppressions(putRecords)",
    "typeof settings.ollama_model === \"string\"",
  ]],
  ["../src/lib/sync/transport.ts", [
    "rpc(\"sync_apply_changes\"",
    "rpc(\"sync_read_changes\"",
    "A realtime message is a wakeup, not a payload",
  ]],
  ["../src/lib/sync/reduce.ts", [
    "if (state && compareOrder(state.lamport, state.clientId, change.lamport, change.clientId) >= 0) return \"stale\"",
  ]],
]
for (const [file, required] of guards) {
  const source = await fetch(new URL(file, import.meta.url))
    .then((response) => response.text())
    .then((text) => text.replace(/\r\n/g, "\n"))
  for (const fragment of required) {
    if (!source.includes(fragment)) throw new Error(`Sync reliability guard is missing from ${file}: ${fragment}`)
  }
}

const changeLogMigration = await fetch(new URL("../supabase/migrations/0007_change_log.sql", import.meta.url)).then((response) => response.text())
for (const required of [
  "create table if not exists public.sync_log",
  "create table if not exists public.sync_state",
  "create table if not exists public.sync_floors",
  "create view public.sync_changes as",
  "instead of insert on public.sync_changes",
  "create or replace function public.sync_apply_changes",
  "create or replace function public.sync_read_changes",
  "sync_log_state_after_insert",
  "compact_sync_log_after_insert",
  "Focal sync v3 tables or the compatibility view are missing",
]) {
  if (!changeLogMigration.includes(required)) throw new Error(`Supabase change-log migration is missing: ${required}`)
}


localDatabase.close()
console.warn("sync change-log self-check passed")
