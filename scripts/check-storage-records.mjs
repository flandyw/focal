import { Database } from "bun:sqlite"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import {
  coreRecordKind,
  isCoreDataFile,
  parseStoredPayloads,
  prepareStoredRecords,
} from "../src/lib/storage/records.ts"

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const prepared = prepareStoredRecords([
  { id: "project-1", name: "Methods SAC" },
  { title: "Legacy row without an id" },
])
assert(prepared[0]?.id === "project-1", "record ids must be preserved")
assert(prepared[1]?.id === "legacy:1", "legacy rows need deterministic fallback ids")
assert(coreRecordKind("sessions.json") === "study_sessions", "session storage mapping changed")
assert(!isCoreDataFile("toString"), "inherited object properties must not pass as core data files")

const parsed = parseStoredPayloads([
  { payload: prepared[0].payload },
  { payload: "not-json" },
])
assert(parsed.length === 1, "one corrupt payload must not hide valid records")

const migrationSource = readFileSync("src-tauri/migrations/0001_local_database.sql", "utf8")
const migrationChecksum = createHash("sha384").update(`${migrationSource}        `).digest("hex")
assert(
  migrationChecksum === "d0cdde6e2ac639e0f491d2115fa805c22cfc79246991ab98a51058c6187ca96ffbe35a886ed3eb3e53f32029dc6a7cb7",
  "migration 1 is immutable; add a new migration version instead",
)

const database = new Database(":memory:")
database.exec(migrationSource)
database.query("insert into records (kind, id, payload, position) values (?, ?, ?, ?)")
  .run("projects", "project-1", JSON.stringify({
    id: "project-1",
    deadline: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-07-20T00:00:00.000Z",
  }), 0)
const indexed = database.query("select deadline, updated_at from records where kind = ? and id = ?")
  .get("projects", "project-1")
assert(indexed?.deadline === "2026-08-01T00:00:00.000Z", "deadline generated column is incorrect")
assert(indexed.updated_at === "2026-07-20T00:00:00.000Z", "updated_at generated column is incorrect")

let rejectedInvalidJson = false
try {
  database.query("insert into records (kind, id, payload, position) values (?, ?, ?, ?)")
    .run("events", "invalid", "not-json", 0)
} catch {
  rejectedInvalidJson = true
}
assert(rejectedInvalidJson, "database accepted an invalid JSON payload")

// Exercise the shipped acknowledgement predicate: native writes reorder JSON keys.
const outboxSource = readFileSync("src/lib/notion/outbox.ts", "utf8")
const predicateStart = outboxSource.indexOf("and not exists (", outboxSource.indexOf("JSON key order"))
const predicateEnd = outboxSource.indexOf("\n               )", predicateStart)
assert(predicateStart >= 0 && predicateEnd > predicateStart, "missing guarded Notion acknowledgement predicate")
const predicate = outboxSource.slice(predicateStart + 4, predicateEnd).replace(/\$\$\{operation \? 5 : 4\}/g, "$1")
database.query("insert into records (kind, id, payload, position) values ('events', 'ack', ?, 0)")
  .run('{"title":"New","id":"ack","reflection":{"notes":"Note"}}')
const matches = database.query(`select (${predicate}) as matches from records where id = 'ack'`)
assert(matches.get('{"id":"ack","title":"New","deleted_at":null,"reflection":{"notes":"Note"}}')?.matches === 1, "reordered keys and absent metadata must acknowledge")
assert(matches.get('{"id":"ack","title":"Old","reflection":{"notes":"Note"}}')?.matches === 0, "a stale acknowledgement must retain a newer intent")
assert(matches.get('{"id":"ack","title":"New","reflection":{"notes":null}}')?.matches === 0, "changed nested metadata must retain its intent")

database.exec(readFileSync("src-tauri/migrations/0007_session_intents.sql", "utf8"))
database.query("insert into session_outbox (account_id, session_id, intent_id, operation, payload) values ('a', 'session', 'new', 'put', '{}')").run()
const persistenceSource = readFileSync("src/lib/sync/persistence.ts", "utf8")
const acknowledgeSql = persistenceSource.match(/"delete from session_outbox where account_id = \$1 and session_id = \$2 and intent_id = \$3"/)?.[0].slice(1, -1)
assert(acknowledgeSql, "session receipts must check account, record, and intent identity")
const acknowledge = database.query(acknowledgeSql)
acknowledge.run("a", "session", "old")
assert(database.query("select count(*) as count from session_outbox").get().count === 1, "receipt for an old generation must retain a newer edit")
acknowledge.run("b", "session", "new")
assert(database.query("select count(*) as count from session_outbox").get().count === 1, "receipt from another account must not clear this intent")
acknowledge.run("a", "session", "new")
assert(database.query("select count(*) as count from session_outbox").get().count === 0, "matching receipt must acknowledge its intent")

// eslint-disable-next-line no-console
console.log("storage record checks passed")
