import type { RealtimeChannel } from "@supabase/supabase-js"
import { supabase } from "@/lib/supabase/client"
import { isOperation, isSyncEntity } from "@/lib/sync/reduce"
import type { RemoteSyncChange, SyncChange, SyncRowState } from "@/lib/sync/types"

const PAGE_SIZE = 500

export interface ApplyReceipt {
  changeId: string
  seq: number
  replayed: boolean
}

export interface ReadResult {
  mode: "changes" | "snapshot"
  floor: number
  head: number
  changes: RemoteSyncChange[]
  rows: SyncRowState[]
}

/**
 * Publish a batch and get a receipt per change. The receipt's `seq` is what the change
 * was assigned by the log, which is also the version this device now holds for that row.
 */
export async function applyChanges(changes: readonly SyncChange[], clientId: string): Promise<{
  receipts: ApplyReceipt[]
  head: number
}> {
  if (!supabase) throw new Error("Supabase is not configured")
  const response = await supabase.rpc("sync_apply_changes", {
    p_changes: changes.map((change) => ({
      change_id: change.changeId,
      client_id: clientId,
      entity: change.entity,
      row_id: change.rowId,
      operation: change.operation,
      payload: change.payload ?? null,
      lamport: change.lamport,
    })),
  })
  if (response.error) throw response.error
  const result = isObject(response.data) ? response.data : {}
  const receipts = (Array.isArray(result.receipts) ? result.receipts : []).flatMap((receipt) => {
    if (!isObject(receipt) || typeof receipt.change_id !== "string") return []
    return [{
      changeId: receipt.change_id,
      seq: typeof receipt.seq === "number" ? receipt.seq : 0,
      replayed: receipt.replayed === true,
    }]
  })
  return { receipts, head: typeof result.head === "number" ? result.head : 0 }
}

/**
 * Read forward from a cursor. The server answers with either more log rows or the whole
 * materialized state, depending on whether the cursor is still tailable.
 */
export async function readChanges(cursor: number, limit = PAGE_SIZE): Promise<ReadResult> {
  if (!supabase) throw new Error("Supabase is not configured")
  const response = await supabase.rpc("sync_read_changes", { p_after: cursor, p_limit: limit })
  if (response.error) throw response.error
  const result = isObject(response.data) ? response.data : {}
  const rawRows = Array.isArray(result.rows) ? result.rows : []
  const mode = result.mode === "snapshot" ? "snapshot" : "changes"
  const changes = mode === "changes" ? rawRows.flatMap(parseChange) : []
  const rows = mode === "snapshot" ? rawRows.flatMap(parseRow) : []
  return {
    mode,
    floor: typeof result.floor === "number" ? result.floor : 0,
    head: typeof result.head === "number" ? result.head : 0,
    changes,
    rows,
  }
}

/**
 * A realtime message is a wakeup, not a payload. Anything can happen to it — dropped,
 * duplicated, reordered, or never delivered at all — so the only safe response is to read
 * from the cursor. Losing a message costs one poll interval and never a change.
 */
export function subscribeWakeup(userId: string, onWake: () => void): () => void {
  if (!supabase) return () => undefined
  let channel: RealtimeChannel | null = supabase
    .channel(`focal-sync-${userId}`)
    .on("postgres_changes", {
      event: "INSERT",
      schema: "public",
      table: "sync_log",
      filter: `user_id=eq.${userId}`,
    }, () => onWake())
    .subscribe((status) => {
      const state = String(status)
      if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") onWake()
    })
  return () => {
    const closing = channel
    channel = null
    if (closing) void supabase?.removeChannel(closing)
  }
}

function parseChange(value: unknown): RemoteSyncChange[] {
  if (!isObject(value)) return []
  if (!isSyncEntity(value.entity) || !isOperation(value.operation)) return []
  if (typeof value.seq !== "number" || !Number.isSafeInteger(value.seq)) return []
  if (typeof value.change_id !== "string" || typeof value.client_id !== "string") return []
  if (typeof value.row_id !== "string" || value.row_id.length === 0) return []
  if (value.operation === "put" && value.payload == null) return []
  return [{
    seq: value.seq,
    changeId: value.change_id,
    clientId: value.client_id,
    entity: value.entity,
    rowId: value.row_id,
    operation: value.operation,
    payload: value.payload ?? null,
    lamport: typeof value.lamport === "number" ? value.lamport : 0,
    createdAt: typeof value.created_at === "string" ? value.created_at : new Date(0).toISOString(),
  }]
}

function parseRow(value: unknown): SyncRowState[] {
  if (!isObject(value)) return []
  if (!isSyncEntity(value.entity) || !isOperation(value.operation)) return []
  if (typeof value.seq !== "number" || !Number.isSafeInteger(value.seq)) return []
  if (typeof value.row_id !== "string" || value.row_id.length === 0) return []
  if (value.operation === "put" && value.payload == null) return []
  return [{
    entity: value.entity,
    rowId: value.row_id,
    operation: value.operation,
    payload: value.payload ?? null,
    lamport: typeof value.lamport === "number" ? value.lamport : 0,
    clientId: typeof value.client_id === "string" ? value.client_id : "",
    seq: value.seq,
  }]
}

/** True when the failure is worth retrying on its own. */
export function isNetworkError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return error instanceof TypeError || message.includes("failed to fetch") || message.includes("network")
}

/** True when retrying cannot help: the request itself is wrong, or the user is not allowed. */
export function isPermanentError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return message.includes("permission denied")
    || message.includes("row-level security")
    || message.includes("row level security")
    || message.includes("not authorized")
    || message.includes("violates check constraint")
    || message.includes("duplicate key")
    || message.includes("invalid input value")
    || message.includes("pgrst")
    || message.includes("jwt")
}

/** Rate limits and server faults are worth retrying, just not immediately. */
export function isTransientError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase()
  return message.includes("rate limit")
    || message.includes("too many requests")
    || message.includes("429")
    || message.includes("timeout")
    || message.includes("service unavailable")
    || message.includes("502")
    || message.includes("503")
    || message.includes("504")
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (isObject(error) && typeof error.message === "string") return error.message
  return String(error)
}

export function describeSyncError(error: unknown): string {
  const message = errorMessage(error)
  if (message.includes("sync_apply_changes") || message.includes("sync_read_changes") || message.includes("schema cache")) {
    return "Sync is not installed on this Supabase project. Run supabase/migrations/0007_change_log.sql."
  }
  return message
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
