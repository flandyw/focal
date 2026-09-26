import type { CalendarEvent, StudySession, Subject } from "@/lib/types"
import type { NotionCalendarSettings } from "@/lib/settings"
import type { NotionCalendarSyncResult, NotionPage } from "@/lib/notion/schema"
import {
  FOCAL_ID_PROPERTY,
  FOCAL_KIND_PROPERTY,
  getCachedSchema,
  getFocalId,
  getFocalKind,
  notionPageFingerprint,
  setCachedSchema,
  createSyncCtx,
} from "@/lib/notion/schema"
import { deleteNotionPage, ensureNotionSyncProperties, fetchNotionPage, fetchNotionSchema, queryNotionCalendar } from "@/lib/notion/api"
import { pullFromNotionAfterConflictRecheck } from "@/lib/notion/pull"
import { executePush, processNotionArchiveIntents } from "@/lib/notion/push"
import { readNotionIntents } from "@/lib/notion/outbox"
import { dedupeCalendarEvents } from "@/lib/calendarEvents"
import { repairDuplicateSessions } from "@/lib/sync/sessions"
import { readState, writeState } from "@/lib/sync/persistence"

export type { NotionCalendarSyncResult } from "@/lib/notion/schema"
export type { PushSingleResult } from "@/lib/notion/push"
export { pushEventToNotion, pushSessionToNotion } from "@/lib/notion/push"

export async function syncNotionCalendar(
  settings: NotionCalendarSettings,
  existingEvents: CalendarEvent[],
  existingSessions: StudySession[],
  subjects: Subject[],
  onProgress?: (msg: string) => void,
  changedEventIds?: Set<string>,
  changedSessionIds?: Set<string>,
): Promise<NotionCalendarSyncResult> {
  if (!settings.token.trim()) throw new Error("Add a Notion integration token first.")
  if (!settings.dataSourceId.trim()) throw new Error("Add a Notion data source or database id first.")
  const eventRepair = dedupeCalendarEvents(existingEvents)
  const sessionRepair = repairDuplicateSessions(existingSessions)
  const cleanEvents = eventRepair.events
  const cleanSessions = sessionRepair.sessions
  const knownDuplicatePageIds = new Set([
    ...eventRepair.duplicateIds.flatMap((id) => {
      const source = existingEvents.find((event) => event.id === id)?.source
      return source?.type === "notion" ? [source.id] : []
    }),
    ...sessionRepair.duplicateNotionPageIds,
    ...(await readState<string[]>("notion:duplicate-pages") ?? []),
  ])
  const intents = await readNotionIntents(settings.dataSourceId)
  const dirtyEventIds = new Set([
    ...(changedEventIds ?? []),
    ...intents.filter((intent) => intent.operation === "upsert" && intent.kind === "event").map((intent) => intent.localId),
  ])
  const dirtySessionIds = new Set([
    ...(changedSessionIds ?? []),
    ...intents.filter((intent) => intent.operation === "upsert" && intent.kind === "session").map((intent) => intent.localId),
  ])
  const ctx = createSyncCtx(dirtyEventIds, dirtySessionIds)
  let schema = getCachedSchema(settings.dataSourceId) ?? await fetchNotionSchema(settings) ?? {}
  if (!(FOCAL_ID_PROPERTY in schema) || !(FOCAL_KIND_PROPERTY in schema)) {
    onProgress?.("Adding stable Focal identity columns to Notion…")
    schema = await ensureNotionSyncProperties(settings)
  }
  setCachedSchema(settings.dataSourceId, schema)

  const queriedPages = await queryNotionCalendar(settings)
  onProgress?.(`Fetched ${queriedPages.length} page${queriedPages.length === 1 ? "" : "s"} from Notion`)
  const pages = await removeDuplicateNotionPages(queriedPages, cleanEvents, cleanSessions, knownDuplicatePageIds, settings, ctx, onProgress)
  const archivedOrPendingIds = await processNotionArchiveIntents(cleanEvents, cleanSessions, settings, ctx, onProgress)
  const activePages = archivedOrPendingIds.size > 0
    ? pages.filter((page) => !archivedOrPendingIds.has(page.id))
    : pages

  const settledPages = await pullFromNotionAfterConflictRecheck(
    activePages,
    cleanEvents,
    cleanSessions,
    settings,
    subjects,
    ctx,
    (pageId) => fetchNotionPage(settings, pageId),
    () => onProgress?.("Confirming possible Notion conflicts…"),
  )
  const pagesById = new Map(settledPages.map((page) => [page.id, page]))
  const totalPulled = ctx.created.length + ctx.updatedEvents.size + ctx.createdSessions.length + ctx.updatedSessions.size
  onProgress?.(totalPulled > 0 ? `Found ${totalPulled} new or updated item${totalPulled === 1 ? "" : "s"}` : "No new items from Notion")

  const eventsForPush = cleanEvents.map((event) => ({ ...event, ...ctx.updatedEvents.get(event.id) }))
  const sessionsForPush = cleanSessions.map((session) => ({ ...session, ...ctx.updatedSessions.get(session.id) }))
  await executePush(eventsForPush, sessionsForPush, settings, subjects, schema, pagesById, ctx)
  return {
    created: ctx.created,
    updated: [...ctx.updatedEvents.entries()].map(([id, updates]) => ({ id, updates })),
    createdSessions: ctx.createdSessions,
    updatedSessions: [...ctx.updatedSessions.entries()].map(([id, updates]) => ({ id, updates })),
    skipped: ctx.skipped,
    skippedReasons: ctx.skippedReasons,
    pushedCreated: ctx.pushedCreated,
    pushedUpdated: ctx.pushedUpdated,
    deleted: ctx.deleted,
    conflicts: ctx.conflicts,
    conflictDetails: ctx.conflictDetails,
    conflictItems: ctx.conflictItems,
    pushErrors: ctx.pushErrors,
    acknowledgedEventIds: [...ctx.acknowledgedEventIds],
    acknowledgedSessionIds: [...ctx.acknowledgedSessionIds],
  }
}

async function removeDuplicateNotionPages(
  pages: NotionPage[],
  events: CalendarEvent[],
  sessions: StudySession[],
  knownDuplicatePageIds: ReadonlySet<string>,
  settings: NotionCalendarSettings,
  ctx: ReturnType<typeof createSyncCtx>,
  onProgress?: (message: string) => void,
): Promise<NotionPage[]> {
  const linkedPageIds = new Set([
    ...events.flatMap((event) => event.source?.type === "notion" ? [event.source.id] : []),
    ...sessions.flatMap((session) => session.source?.type === "notion" ? [session.source.id] : []),
  ])
  const { archiveIds: duplicateIds, hiddenIds: hiddenDuplicateIds } = planDuplicateNotionPages(
    pages,
    linkedPageIds,
    knownDuplicatePageIds,
    settings,
  )
  if (duplicateIds.size === 0) {
    await writeState("notion:duplicate-pages", [])
    return pages.filter((page) => !hiddenDuplicateIds.has(page.id))
  }

  onProgress?.(`Archiving ${duplicateIds.size} duplicate Notion page${duplicateIds.size === 1 ? "" : "s"}…`)
  const failedDuplicateIds: string[] = []
  for (const pageId of duplicateIds) {
    try {
      await deleteNotionPage(settings, pageId)
      ctx.deleted += 1
    } catch (error) {
      failedDuplicateIds.push(pageId)
      ctx.pushErrors.push(`Archive duplicate page ${pageId}: ${error instanceof Error ? error.message : String(error)}`)
    }
    // Notion integrations average three write requests per second. Keep bulk
    // repair below that limit so one 429 does not strand the rest of the batch.
    await new Promise((resolve) => setTimeout(resolve, 350))
  }
  await writeState("notion:duplicate-pages", failedDuplicateIds)
  return pages.filter((page) => !hiddenDuplicateIds.has(page.id))
}

export function planDuplicateNotionPages(
  pages: NotionPage[],
  linkedPageIds: ReadonlySet<string>,
  knownDuplicatePageIds: ReadonlySet<string>,
  settings: NotionCalendarSettings,
): { archiveIds: Set<string>; hiddenIds: Set<string> } {
  const identityGroups = new Map<string, NotionPage[]>()
  const fingerprintGroups = new Map<string, NotionPage[]>()
  for (const page of pages) {
    const focalId = getFocalId(page)
    const kind = getFocalKind(page)
    if (focalId && kind) addToGroup(identityGroups, `${kind}:${focalId}`, page)
    const fingerprint = notionPageFingerprint(page, settings)
    if (fingerprint) addToGroup(fingerprintGroups, fingerprint, page)
  }

  const archiveIds = new Set<string>()
  const hiddenIds = new Set<string>()
  for (const group of identityGroups.values()) {
    if (group.length < 2) continue
    const canonical = chooseCanonicalNotionPage(group, linkedPageIds)
    for (const page of group) {
      if (page.id === canonical.id) continue
      hiddenIds.add(page.id)
      archiveIds.add(page.id)
    }
  }

  for (const group of fingerprintGroups.values()) {
    const visible = group.filter((page) => !hiddenIds.has(page.id))
    const tagged = visible.filter((page) => Boolean(getFocalId(page) && getFocalKind(page)))
    const untagged = visible.filter((page) => !getFocalId(page) || !getFocalKind(page))
    if (tagged.length > 0) {
      for (const page of untagged) {
        hiddenIds.add(page.id)
        archiveIds.add(page.id)
      }
      continue
    }
    if (untagged.length < 2) continue
    const canonical = chooseCanonicalNotionPage(untagged, linkedPageIds)
    for (const page of untagged) {
      if (page.id === canonical.id) continue
      hiddenIds.add(page.id)
      if (knownDuplicatePageIds.has(page.id)) archiveIds.add(page.id)
    }
  }
  return { archiveIds, hiddenIds }
}

function addToGroup(groups: Map<string, NotionPage[]>, key: string, page: NotionPage): void {
  const group = groups.get(key) ?? []
  group.push(page)
  groups.set(key, group)
}

function chooseCanonicalNotionPage(group: NotionPage[], linkedPageIds: ReadonlySet<string>): NotionPage {
  return group.find((page) => linkedPageIds.has(page.id))
    ?? [...group].sort((a, b) => a.id.localeCompare(b.id))[0]
}
