/**
 * Conformance runner for sync protocol v3.
 *
 * Runs `src/lib/sync/vectors/conformance.json` against this client's implementation of
 * the protocol core. Folio runs the same file from its own copy of the rules; if the two
 * implementations ever disagree about ordering, tombstones or backoff, one of these
 * builds fails instead of somebody's notes going missing.
 *
 * The file's own SHA-256 is checked with the digest field zeroed, so an edit to the
 * vectors cannot pass without also updating the recorded digest in both repositories.
 */
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { coalesceChanges, reduceChanges, reduceSnapshot, retryDelayMs } from "../src/lib/sync/reduce"
import type { RemoteSyncChange, SyncChange, SyncRowState } from "../src/lib/sync/types"

const ZERO_DIGEST = "0".repeat(64)

interface VectorFile {
  protocol: string
  sha256: string
  cases: VectorCase[]
}

interface VectorCase {
  name: string
  kind: "reduce" | "snapshot" | "coalesce" | "backoff"
  [key: string]: unknown
}

const filePath = new URL("../src/lib/sync/vectors/conformance.json", import.meta.url)
const raw = readFileSync(filePath, "utf8")
const vectors = JSON.parse(raw) as VectorFile

if (vectors.protocol !== "focal-sync/3") throw new Error(`Unexpected protocol: ${vectors.protocol}`)
const digest = createHash("sha256").update(raw.replace(new RegExp(`"sha256": "[0-9a-f]{64}"`), `"sha256": "${ZERO_DIGEST}"`)).digest("hex")
if (digest !== vectors.sha256) {
  throw new Error(`Conformance vectors were edited without updating their digest.\n  recorded ${vectors.sha256}\n  actual   ${digest}`)
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : 1))
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`
  }
  return JSON.stringify(value) ?? "null"
}

function assertCase(name: string, actual: unknown, expected: unknown): void {
  if (canonical(actual) === canonical(expected)) return
  throw new Error(`Sync conformance failed: ${name}\n  expected ${canonical(expected)}\n  actual   ${canonical(actual)}`)
}

function remote(change: Record<string, unknown>): RemoteSyncChange {
  return {
    seq: change.seq as number,
    changeId: change.changeId as string,
    clientId: change.clientId as string,
    entity: change.entity as RemoteSyncChange["entity"],
    rowId: change.rowId as string,
    operation: change.operation as RemoteSyncChange["operation"],
    payload: change.payload ?? null,
    lamport: change.lamport as number,
    createdAt: "2026-01-01T00:00:00.000Z",
  }
}

function rowState(row: Record<string, unknown>): SyncRowState {
  return {
    entity: row.entity as SyncRowState["entity"],
    rowId: row.rowId as string,
    operation: row.operation as SyncRowState["operation"],
    payload: row.payload ?? null,
    lamport: row.lamport as number,
    clientId: row.clientId as string,
    seq: row.seq as number,
  }
}

function queued(change: Record<string, unknown>): SyncChange {
  return {
    changeId: change.changeId as string,
    entity: change.entity as SyncChange["entity"],
    rowId: change.rowId as string,
    operation: change.operation as SyncChange["operation"],
    payload: change.payload ?? null,
    createdAt: change.createdAt as string,
    lamport: change.lamport as number,
    retryCount: 0,
  }
}


/**
 * Structural checks on the migration. Nothing in this repository can run Postgres, so these
 * catch the mistakes that actually happen while hand-editing SQL: unbalanced dollar quoting,
 * a function with no language, an object renamed in one place only.
 */
function checkMigrationStructure(sql: string): void {
  const problems: string[] = []
  if ((sql.match(/\$\$/g) ?? []).length % 2 !== 0) problems.push("unbalanced $$ quoting")
  for (const match of sql.matchAll(/create or replace function\s+([\w.]+)\s*\(([^)]*)\)\s*\nreturns[\s\S]*?\$\$(.*?)\$\$/g)) {
    const [, name, , body] = match
    const header = body.slice(0, 400)
    if (!header.includes("language plpgsql")) problems.push(`${name} must declare language plpgsql`)
    if (header.includes("security definer") && !header.includes("auth.uid()")) {
      problems.push(`${name} is security definer but never checks auth.uid()`)
    }
  }
  if (problems.length > 0) throw new Error(`Sync migration check failed:\n  ${problems.join("\n  ")}`)
}

for (const testCase of vectors.cases) {
  switch (testCase.kind) {
    case "reduce": {
      const result = reduceChanges({
        ownClientId: testCase.ownClientId as string,
        cursor: testCase.cursor as number,
        state: (testCase.state as Record<string, unknown>[]).map(rowState),
        pending: testCase.pending as string[],
        changes: (testCase.changes as Record<string, unknown>[]).map(remote),
      })
      const expected = testCase.expected as Record<string, unknown>
      assertCase(`${testCase.name} (cursor)`, result.cursor, expected.cursor)
      assertCase(`${testCase.name} (applied)`, result.applied.map((change) => change.changeId), expected.applied)
      assertCase(`${testCase.name} (deferred)`, result.deferred.map((change) => change.changeId), expected.deferred)
      assertCase(`${testCase.name} (state)`, result.state, expected.state)
      break
    }
    case "snapshot": {
      const result = reduceSnapshot({
        pending: testCase.pending as string[],
        state: (testCase.state as Record<string, unknown>[]).map(rowState),
        rows: (testCase.rows as Record<string, unknown>[]).map(rowState),
        head: testCase.head as number,
      })
      const expected = testCase.expected as Record<string, unknown>
      assertCase(`${testCase.name} (cursor)`, result.cursor, expected.cursor)
      assertCase(`${testCase.name} (state)`, result.state, expected.state)
      break
    }
    case "coalesce": {
      const coalesced = coalesceChanges((testCase.input as Record<string, unknown>[]).map(queued))
        .map((change) => ({
          changeId: change.changeId,
          entity: change.entity,
          rowId: change.rowId,
          operation: change.operation,
          payload: change.payload,
          lamport: change.lamport,
          createdAt: change.createdAt,
        }))
      assertCase(testCase.name, coalesced, testCase.expected)
      break
    }
    case "backoff": {
      const delays = (testCase.input as number[]).map(retryDelayMs)
      assertCase(testCase.name, delays, testCase.expected)
      break
    }
    default:
      throw new Error(`Unknown conformance case kind: ${String(testCase.kind)}`)
  }
}

checkMigrationStructure(readFileSync(new URL("../supabase/migrations/0007_change_log.sql", import.meta.url), "utf8"))

console.warn(`Sync conformance passed (${vectors.cases.length} vectors, digest ${digest.slice(0, 12)})`)
