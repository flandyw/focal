import { openFocalDatabase } from "@/lib/storage/database"

export type NotionIntentKind = "event" | "session"
export type NotionIntentOperation = "upsert" | "archive"

export interface NotionIntent {
  dataSourceId: string
  kind: NotionIntentKind
  localId: string
  operation: NotionIntentOperation
  pageId?: string
  createdAt: string
  notBefore?: string
  retryCount: number
  lastError?: string
  nextAttemptAt?: string
}

interface NotionIntentRow {
  data_source_id: string
  kind: string
  local_id: string
  operation: string
  page_id: string | null
  created_at: string
  not_before: string | null
  retry_count: number
  last_error: string | null
  next_attempt_at: string | null
}

let lock: Promise<unknown> = Promise.resolve()

function serialized<T>(operation: () => Promise<T>): Promise<T> {
  const result = lock.then(operation, operation)
  lock = result.catch((error: unknown) => console.error("Failed to persist Notion sync intent:", error))
  return result
}

export function notionIntentDue(intent: Pick<NotionIntent, "notBefore" | "nextAttemptAt">, now: string): boolean {
  return (!intent.notBefore || intent.notBefore <= now)
    && (!intent.nextAttemptAt || intent.nextAttemptAt <= now)
}

export function retryNotionIntent(intent: NotionIntent, error: string, now: string): NotionIntent {
  const retryCount = intent.retryCount + 1
  return {
    ...intent,
    retryCount,
    lastError: error,
    nextAttemptAt: new Date(
      new Date(now).getTime() + Math.min(300_000, 5_000 * 2 ** Math.max(0, retryCount - 1)),
    ).toISOString(),
  }
}

export function enqueueNotionUpsert(
  dataSourceId: string,
  kind: NotionIntentKind,
  localId: string,
  pageId?: string,
): Promise<void> {
  return upsertIntent({
    dataSourceId,
    kind,
    localId,
    operation: "upsert",
    pageId,
    createdAt: new Date().toISOString(),
    retryCount: 0,
  })
}

export function enqueueNotionArchive(
  dataSourceId: string,
  kind: NotionIntentKind,
  localId: string,
  pageId: string,
  notBefore: string,
): Promise<void> {
  return upsertIntent({
    dataSourceId,
    kind,
    localId,
    operation: "archive",
    pageId,
    createdAt: new Date().toISOString(),
    notBefore,
    retryCount: 0,
  })
}

export async function readNotionIntents(dataSourceId: string): Promise<NotionIntent[]> {
  await lock
  const rows = await (await openFocalDatabase()).select<NotionIntentRow[]>(
    `select data_source_id, kind, local_id, operation, page_id, created_at,
            not_before, retry_count, last_error, next_attempt_at
       from notion_outbox
      where data_source_id = $1 or operation = 'archive'
      order by created_at asc`,
    [dataSourceId],
  )
  return rows.flatMap(parseIntentRow)
}

export function clearNotionIntent(
  dataSourceId: string,
  kind: NotionIntentKind,
  localId: string,
  operation?: NotionIntentOperation,
  expectedRecord?: unknown,
): Promise<void> {
  return serialized(async () => {
    const expectedPayload = expectedRecord === undefined ? undefined : JSON.stringify(expectedRecord)
    await (await openFocalDatabase()).execute(
      `delete from notion_outbox
        where data_source_id = $1 and kind = $2 and local_id = $3
          ${operation ? "and operation = $4" : ""}
          ${expectedPayload === undefined
            ? ""
            : `and exists (
                 select 1 from records
                  where records.kind = '${kind === "event" ? "events" : "study_sessions"}'
                    and records.id = $3
                    -- JSON key order is not identity; native writes reorder keys.
                    -- Optional top-level nulls and absent fields normalize identically.
                    and not exists (
                      select fullkey, type, atom from json_tree(records.payload)
                       where not (type = 'null' and parent = 0)
                      except
                      select fullkey, type, atom from json_tree($${operation ? 5 : 4})
                       where not (type = 'null' and parent = 0)
                    )
                    and not exists (
                      select fullkey, type, atom from json_tree($${operation ? 5 : 4})
                       where not (type = 'null' and parent = 0)
                      except
                      select fullkey, type, atom from json_tree(records.payload)
                       where not (type = 'null' and parent = 0)
                    )
               )`}`,
      [
        dataSourceId,
        kind,
        localId,
        ...(operation ? [operation] : []),
        ...(expectedPayload === undefined ? [] : [expectedPayload]),
      ],
    )
  })
}

export function persistRetriedNotionIntent(intent: NotionIntent): Promise<void> {
  return upsertIntent(intent)
}

function upsertIntent(intent: NotionIntent): Promise<void> {
  return serialized(async () => {
    await (await openFocalDatabase()).execute(
      `insert into notion_outbox (
         data_source_id, kind, local_id, operation, page_id, created_at,
         not_before, retry_count, last_error, next_attempt_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       on conflict (data_source_id, kind, local_id) do update set
         operation = excluded.operation,
         page_id = excluded.page_id,
         created_at = excluded.created_at,
         not_before = excluded.not_before,
         retry_count = excluded.retry_count,
         last_error = excluded.last_error,
         next_attempt_at = excluded.next_attempt_at`,
      [
        intent.dataSourceId,
        intent.kind,
        intent.localId,
        intent.operation,
        intent.pageId ?? null,
        intent.createdAt,
        intent.notBefore ?? null,
        intent.retryCount,
        intent.lastError ?? null,
        intent.nextAttemptAt ?? null,
      ],
    )
  })
}

function parseIntentRow(row: NotionIntentRow): NotionIntent[] {
  if (row.kind !== "event" && row.kind !== "session") return []
  if (row.operation !== "upsert" && row.operation !== "archive") return []
  return [{
    dataSourceId: row.data_source_id,
    kind: row.kind,
    localId: row.local_id,
    operation: row.operation,
    pageId: row.page_id ?? undefined,
    createdAt: row.created_at,
    notBefore: row.not_before ?? undefined,
    retryCount: row.retry_count,
    lastError: row.last_error ?? undefined,
    nextAttemptAt: row.next_attempt_at ?? undefined,
  }]
}
