/**
 * Outbound sinks. Notion is a mirror of Focal's data, not a participant in sync: it is
 * fed from local writes and from applied remote changes, so it follows the log without
 * needing a cursor of its own.
 */
import { getNotionCalendarSettings } from "@/lib/settings"
import { enqueueNotionArchive, enqueueNotionUpsert, type NotionIntentKind } from "@/lib/notion/outbox"
import { isSyncTable } from "@/lib/sync/reduce"
import type { LocalRecord, RemoteSyncChange, SyncTable } from "@/lib/sync/types"

export interface NotionDeleteMetadata {
  pageId: string
  kind: NotionIntentKind
  dataSourceId: string
}

export function notionKindForTable(table: SyncTable): NotionIntentKind | null {
  if (table === "events") return "event"
  if (table === "study_sessions") return "session"
  return null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

export function notionSourceFromRecord(value: Record<string, unknown>): Record<string, unknown> | null {
  if (isObject(value.source)) return value.source
  return isObject(value.integrations)
    && isObject(value.integrations.notion)
    && value.integrations.notion.type === "notion"
    ? value.integrations.notion
    : null
}

/** Tombstone metadata rides on the delete so every device can archive the same page. */
export function notionDeletePayload(table: SyncTable, rowId: string, value: LocalRecord | undefined): unknown {
  const kind = notionKindForTable(table)
  if (!kind || !isObject(value)) return null
  const source = notionSourceFromRecord(value)
  if (source?.type !== "notion" || typeof source.id !== "string") return null
  return {
    notion: {
      pageId: source.id,
      kind,
      localId: rowId,
      dataSourceId: getNotionCalendarSettings().dataSourceId,
    },
  }
}

export function getNotionDeleteMetadata(payload: unknown): NotionDeleteMetadata | null {
  if (!isObject(payload) || !isObject(payload.notion)) return null
  const notion = payload.notion
  if (typeof notion.pageId !== "string" || notion.pageId.length === 0) return null
  if (notion.kind !== "event" && notion.kind !== "session") return null
  return {
    pageId: notion.pageId,
    kind: notion.kind,
    dataSourceId: typeof notion.dataSourceId === "string" ? notion.dataSourceId : "",
  }
}

export async function recordNotionUpsertIntent(table: SyncTable, rowId: string, value: LocalRecord): Promise<void> {
  const kind = notionKindForTable(table)
  if (!kind || !isObject(value)) return
  const source = notionSourceFromRecord(value)
  if (isObject(source) && source.type === "vcaa") return
  const settings = getNotionCalendarSettings()
  if (!settings.dataSourceId.trim()) return
  const pageId = source?.type === "notion" && typeof source.id === "string" ? source.id : undefined
  await enqueueNotionUpsert(settings.dataSourceId, kind, rowId, pageId)
}

export async function recordRemoteNotionDeleteIntent(
  change: RemoteSyncChange,
  localValue: Record<string, unknown> | undefined,
): Promise<void> {
  if (!isSyncTable(change.entity)) return
  const payload = getNotionDeleteMetadata(change.payload)
    ?? getNotionDeleteMetadata(notionDeletePayload(change.entity, change.rowId, localValue as unknown as LocalRecord))
  if (!payload) return
  await enqueueNotionArchive(payload.dataSourceId, payload.kind, change.rowId, payload.pageId, new Date().toISOString())
}
