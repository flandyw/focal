import type { CalendarEvent, NotionSource, StudySession, Subject } from "@/lib/types"
import type { NotionCalendarSettings } from "@/lib/settings"
import type { NotionPage, NotionProperty, SyncCtx, PushTask } from "@/lib/notion/schema"
import {
  getCachedSchema,
  setCachedSchema,
  getNotionSource,
  focalIdentityProperties,
  getFocalId,
  getFocalKind,
  buildPageChildren,
  hashBody,
  bodyHasChanged,
  buildSessionBodyText,
  eventFingerprint,
  sessionFingerprint,
  richTextValue,
  createTextProperty,
  createPropertyValue,
  getSchemaPropertyType,
  pageMatchesEvent,
  pageMatchesSession,
  toNotionType,
  eventSyncSnapshot,
  getPrimarySessionSubjectId,
  sessionSyncSnapshot,
} from "@/lib/notion/schema"
import { findSubjectIdFromValues } from "@/lib/notion/subjectMatch"
import {
  clearNotionIntent,
  notionIntentDue,
  persistRetriedNotionIntent,
  readNotionIntents,
  retryNotionIntent,
} from "@/lib/notion/outbox"
import {
  createNotionPage,
  deleteNotionPage,
  fetchNotionSchema,
  isRetryableNotionError,
  NotionApiError,
  queryNotionCalendar,
  updateNotionPage,
} from "@/lib/notion/api"

// ---------------------------------------------------------------------------
// Push helpers: retry, concurrency
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_API_CALLS = 3
const MAX_RETRIES = 2
const MIN_WRITE_SPACING_MS = 350
let writeThrottle: Promise<unknown> = Promise.resolve()
let nextWriteAt = 0

async function waitForWriteTurn(): Promise<void> {
  const turn = writeThrottle.then(async () => {
    const wait = Math.max(0, nextWriteAt - Date.now())
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait))
    nextWriteAt = Date.now() + MIN_WRITE_SPACING_MS
  })
  writeThrottle = turn.catch(() => undefined)
  await turn
}

export function notionWriteRetryDelay(error: unknown, attempt: number, jitter = Math.random()): number {
  const serverDelay = error instanceof NotionApiError ? error.retryAfterMs : undefined
  return Math.max(serverDelay ?? 0, 500 * 2 ** attempt) + Math.floor(250 * jitter)
}

export function buildPageChildrenForSync(
  text: string | undefined,
  previousBodyHash: string | undefined,
): unknown[] | undefined {
  return buildPageChildren(text) ?? (previousBodyHash === undefined ? undefined : [])
}

async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  pushErrors: string[],
): Promise<T | undefined> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await waitForWriteTurn()
      return await fn()
    } catch (e) {
      if (attempt === MAX_RETRIES || !isRetryableNotionError(e)) {
        pushErrors.push(`${label}: ${e instanceof Error ? e.message : String(e)}`)
        return undefined
      }
      await new Promise((resolve) => setTimeout(resolve, notionWriteRetryDelay(e, attempt)))
    }
  }
}

async function executePushTasks(tasks: PushTask[]): Promise<void> {
  if (tasks.length === 0) return
  const queue = [...tasks]
  const workers = Array.from({ length: Math.min(MAX_CONCURRENT_API_CALLS, queue.length) }, async () => {
    while (queue.length > 0) {
      const task = queue.shift()
      if (task) await task.run()
    }
  })
  await Promise.all(workers)
}

// ---------------------------------------------------------------------------
// Property building
// ---------------------------------------------------------------------------

function buildNotionEventProperties(
  settings: NotionCalendarSettings,
  event: CalendarEvent,
  subjects: Subject[],
  schema: Record<string, NotionProperty>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    ...focalIdentityProperties(event.id, "event"),
    [settings.titleProperty]: { title: richTextValue(event.title) },
    [settings.dateProperty]: {
      date: {
        start: event.startTime,
        end: event.endTime,
      },
    },
  }

  if (settings.typeProperty.trim()) {
    const pt = getSchemaPropertyType(schema, settings.typeProperty, "select")
    const prop = createPropertyValue(pt, toNotionType(event.eventType))
    if (prop) properties[settings.typeProperty] = prop
  }

  if (settings.completedProperty.trim()) {
    const pt = getSchemaPropertyType(schema, settings.completedProperty, "checkbox")
    const prop = createPropertyValue(pt, event.isFinished ?? false)
    if (prop) properties[settings.completedProperty] = prop
  }

  if (settings.subjectProperty.trim()) {
    const subject = subjects.find((c) => c.id === event.subjectId)
    const pt = getSchemaPropertyType(schema, settings.subjectProperty, "select")
    const prop = createTextProperty(pt, subject?.name)
    if (prop) properties[settings.subjectProperty] = prop
  }

  return properties
}

function buildNotionSessionProperties(
  settings: NotionCalendarSettings,
  session: StudySession,
  subjects: Subject[],
  schema: Record<string, NotionProperty>,
): Record<string, unknown> {
  const properties: Record<string, unknown> = {
    ...focalIdentityProperties(session.id, "session"),
    [settings.titleProperty]: { title: richTextValue(session.title) },
    [settings.dateProperty]: {
      date: {
        start: session.schedule.blocks[0].start,
        end: session.schedule.blocks[session.schedule.blocks.length - 1].end,
      },
    },
  }

  if (settings.typeProperty.trim()) {
    const pt = getSchemaPropertyType(schema, settings.typeProperty, "select")
    const prop = createPropertyValue(pt, "Study Session")
    if (prop) properties[settings.typeProperty] = prop
  }

  if (settings.completedProperty.trim()) {
    const pt = getSchemaPropertyType(schema, settings.completedProperty, "checkbox")
    const prop = createPropertyValue(pt, session.execution.state === "completed")
    if (prop) properties[settings.completedProperty] = prop
  }

  if (settings.subjectProperty.trim()) {
    const primarySubjectId = getPrimarySessionSubjectId(session, subjects)
    const subject = subjects.find((candidate) => candidate.id === primarySubjectId)
    const pt = getSchemaPropertyType(schema, settings.subjectProperty, "select")
    const prop = createPropertyValue(pt, subject?.name)
    if (prop) properties[settings.subjectProperty] = prop
  }

  return properties
}

function eventWriteMatches(
  page: NotionPage,
  event: CalendarEvent,
  settings: NotionCalendarSettings,
  subjects: Subject[],
): boolean {
  return getFocalId(page) === event.id
    && getFocalKind(page) === "event"
    && pageMatchesEvent(page, event, settings, subjects, findSubjectIdFromValues)
}

function sessionWriteMatches(
  page: NotionPage,
  session: StudySession,
  settings: NotionCalendarSettings,
  subjects: Subject[],
): boolean {
  return getFocalId(page) === session.id
    && getFocalKind(page) === "session"
    && pageMatchesSession(page, session, settings, subjects, findSubjectIdFromValues)
}

function verifyEventWrite(
  page: NotionPage,
  event: CalendarEvent,
  settings: NotionCalendarSettings,
  subjects: Subject[],
): NotionPage {
  if (!eventWriteMatches(page, event, settings, subjects)) {
    throw new Error("Notion did not persist every mapped event field")
  }
  return page
}

function verifySessionWrite(
  page: NotionPage,
  session: StudySession,
  settings: NotionCalendarSettings,
  subjects: Subject[],
): NotionPage {
  if (!sessionWriteMatches(page, session, settings, subjects)) {
    throw new Error("Notion did not persist every mapped study-session field")
  }
  return page
}

// ---------------------------------------------------------------------------
// Fast-push: push a single event or session without pulling from Notion first
// ---------------------------------------------------------------------------

async function updateOrCreatePage(
  settings: NotionCalendarSettings,
  pageId: string,
  localId: string,
  kind: "event" | "session",
  properties: Record<string, unknown>,
  children: unknown[] | undefined,
): Promise<NotionPage> {
  try {
    return await updateNotionPage(settings, pageId, properties, children)
  } catch (e) {
    if (e instanceof NotionApiError && e.code === "object_not_found") {
      return await createRecoverablePage(settings, localId, kind, properties, children)
    }
    throw e
  }
}

async function createRecoverablePage(
  settings: NotionCalendarSettings,
  localId: string,
  kind: "event" | "session",
  properties: Record<string, unknown>,
  children: unknown[] | undefined,
): Promise<NotionPage> {
  try {
    return await createNotionPage(settings, properties, children)
  } catch (error) {
    if (!isRetryableNotionError(error)) throw error
    // A timed-out create may already have committed remotely. Recover by the
    // stable Focal identity before any retry is allowed to create another page.
    let pages: NotionPage[]
    try {
      pages = await queryNotionCalendar(settings)
    } catch (recoveryError) {
      // ponytail: an unverifiable create stays in the durable outbox. The next
      // full sync queries stable IDs before pushing, so retrying here is riskier.
      const uncertainError = Object.assign(
        new Error(
          `Notion create outcome is uncertain; it will be verified on the next sync: ${recoveryError instanceof Error ? recoveryError.message : String(recoveryError)}`,
        ),
        { cause: recoveryError },
      )
      throw uncertainError
    }
    const existing = pages.find((page) => (
      getFocalId(page) === localId && getFocalKind(page) === kind
    ))
    if (existing) return existing
    throw error
  }
}

export interface PushSingleResult {
  source: NotionSource
}

export async function pushEventToNotion(
  settings: NotionCalendarSettings,
  event: CalendarEvent,
  subjects: Subject[],
): Promise<PushSingleResult | null> {
  if (event.source?.type === "vcaa") return null
  let schema = getCachedSchema(settings.dataSourceId)
  if (!schema || Object.keys(schema).length === 0) {
    schema = await fetchNotionSchema(settings)
    if (!schema) return null
    setCachedSchema(settings.dataSourceId, schema)
  }

  const properties = buildNotionEventProperties(settings, event, subjects, schema)
  const children = buildPageChildrenForSync(
    event.description,
    event.source?.type === "notion" ? event.source.bodyHash : undefined,
  )
  const bodyHash = hashBody(event.description)

  const errors: string[] = []
  const page = await withRetry(
    `Event "${event.title}"`,
    event.source?.type === "notion"
      ? () => updateOrCreatePage(settings, event.source!.id, event.id, "event", properties, children)
      : () => createRecoverablePage(settings, event.id, "event", properties, children),
    errors,
  )
  if (!page) throw new Error(errors[0] ?? "Notion did not accept the event")
  const verifiedPage = verifyEventWrite(page, event, settings, subjects)

  return {
    source: getNotionSource(verifiedPage, "event", bodyHash, eventSyncSnapshot(event, settings)),
  }
}

export async function pushSessionToNotion(
  settings: NotionCalendarSettings,
  session: StudySession,
  subjects: Subject[],
): Promise<PushSingleResult | null> {
  let schema = getCachedSchema(settings.dataSourceId)
  if (!schema || Object.keys(schema).length === 0) {
    schema = await fetchNotionSchema(settings)
    if (!schema) return null
    setCachedSchema(settings.dataSourceId, schema)
  }

  const source = session.integrations?.notion
  const bodyText = buildSessionBodyText(session)
  const children = buildPageChildrenForSync(bodyText, source?.bodyHash)
  const properties = buildNotionSessionProperties(settings, session, subjects, schema)
  const bodyHash = hashBody(bodyText ?? "")

  const errors: string[] = []
  const page = await withRetry(
    `Session "${session.title}"`,
    source
      ? () => updateOrCreatePage(settings, source.id, session.id, "session", properties, children)
      : () => createRecoverablePage(settings, session.id, "session", properties, children),
    errors,
  )
  if (!page) throw new Error(errors[0] ?? "Notion did not accept the study session")
  const verifiedPage = verifySessionWrite(page, session, settings, subjects)

  return {
    source: getNotionSource(verifiedPage, "session", bodyHash, sessionSyncSnapshot(session, settings, subjects)),
  }
}

// ---------------------------------------------------------------------------
// Collect push tasks for full sync
// ---------------------------------------------------------------------------

export function collectEventPushTasks(
  existingEvents: CalendarEvent[],
  settings: NotionCalendarSettings,
  subjects: Subject[],
  schema: Record<string, NotionProperty>,
  pagesById: Map<string, NotionPage>,
  ctx: SyncCtx,
  fastPushIds?: Set<string>,
): PushTask[] {
  const tasks: PushTask[] = []
  for (const event of existingEvents) {
    if (event.source?.type === "vcaa") continue
    if (event.source?.type === "notion" && event.source.kind === "session") continue
    const isFastPush = fastPushIds?.has(event.id)
    if (!isFastPush && (ctx.pulledEventIds.has(event.id) || ctx.conflictedEventIds.has(event.id))) continue
    if (!isFastPush && !event.source && ctx.matchedEventIds.has(event.id)) continue
    if (!isFastPush && !event.source && ctx.blockedEventFingerprints.has(eventFingerprint(event))) continue
    const isDirty = ctx.dirtyEventIds.has(event.id)
    const children = buildPageChildrenForSync(
      event.description,
      event.source?.type === "notion" ? event.source.bodyHash : undefined,
    )
    const bodyHash = hashBody(event.description)
    const properties = buildNotionEventProperties(settings, event, subjects, schema)
    if (event.source?.type === "notion") {
      if (isFastPush) {
        tasks.push({
          run: async () => {
            const page = await withRetry(
              `Event "${event.title}"`,
              () => updateOrCreatePage(settings, event.source!.id, event.id, "event", properties, children),
              ctx.pushErrors,
            )
            if (!page) return
            if (!eventWriteMatches(page, event, settings, subjects)) {
              ctx.pushErrors.push(`Event "${event.title}": Notion did not persist every mapped field`)
              return
            }
            ctx.pushedUpdated += 1
            ctx.acknowledgedEventIds.add(event.id)
            ctx.newNotionIds.add(page.id)
            ctx.updatedEvents.set(event.id, {
              ...ctx.updatedEvents.get(event.id),
              source: getNotionSource(page, "event", bodyHash, eventSyncSnapshot(event, settings)),
            })
          },
        })
        continue
      }
      const remotePage = pagesById.get(event.source.id)
      if (remotePage) {
        const propertiesMatch = pageMatchesEvent(remotePage, event, settings, subjects, findSubjectIdFromValues)
        const bodyDiffers = bodyHasChanged(event.source.bodyHash, event.description)
        const identityMatches = getFocalId(remotePage) === event.id && getFocalKind(remotePage) === "event"
        if (!isDirty && propertiesMatch && !bodyDiffers && identityMatches) continue
        if (propertiesMatch && !bodyDiffers && identityMatches) {
          ctx.acknowledgedEventIds.add(event.id)
          ctx.updatedEvents.set(event.id, {
            ...ctx.updatedEvents.get(event.id),
            source: getNotionSource(remotePage, "event", bodyHash, eventSyncSnapshot(event, settings)),
          })
          continue
        }
        tasks.push({
          run: async () => {
            const page = await withRetry(
              `Event "${event.title}"`,
              () => updateNotionPage(
                settings,
                event.source!.id,
                properties,
                bodyDiffers ? children : undefined,
              ),
              ctx.pushErrors,
            )
            if (!page) return
            if (!eventWriteMatches(page, event, settings, subjects)) {
              ctx.pushErrors.push(`Event "${event.title}": Notion did not persist every mapped field`)
              return
            }
            ctx.pushedUpdated += 1
            ctx.acknowledgedEventIds.add(event.id)
            ctx.newNotionIds.add(page.id)
            ctx.updatedEvents.set(event.id, {
              ...ctx.updatedEvents.get(event.id),
              source: getNotionSource(page, "event", bodyHash, eventSyncSnapshot(event, settings)),
            })
          },
        })
      } else {
        tasks.push({
          run: async () => {
            const page = await withRetry(
              `Event "${event.title}"`,
              () => createRecoverablePage(settings, event.id, "event", properties, children),
              ctx.pushErrors,
            )
            if (!page) return
            if (!eventWriteMatches(page, event, settings, subjects)) {
              ctx.pushErrors.push(`Event "${event.title}": Notion did not persist every mapped field`)
              return
            }
            ctx.pushedCreated += 1
            ctx.acknowledgedEventIds.add(event.id)
            ctx.newNotionIds.add(page.id)
            ctx.updatedEvents.set(event.id, {
              ...ctx.updatedEvents.get(event.id),
              source: getNotionSource(page, "event", bodyHash, eventSyncSnapshot(event, settings)),
            })
          },
        })
      }
      continue
    }
    tasks.push({
      run: async () => {
        const page = await withRetry(
          `Event "${event.title}"`,
          () => createRecoverablePage(settings, event.id, "event", properties, children),
          ctx.pushErrors,
        )
        if (!page) return
        if (!eventWriteMatches(page, event, settings, subjects)) {
          ctx.pushErrors.push(`Event "${event.title}": Notion did not persist every mapped field`)
          return
        }
        ctx.pushedCreated += 1
        ctx.acknowledgedEventIds.add(event.id)
        ctx.newNotionIds.add(page.id)
        ctx.updatedEvents.set(event.id, {
          ...ctx.updatedEvents.get(event.id),
          source: getNotionSource(page, "event", bodyHash, eventSyncSnapshot(event, settings)),
        })
      },
    })
  }

  return tasks
}

export function collectSessionPushTasks(
  existingSessions: StudySession[],
  settings: NotionCalendarSettings,
  subjects: Subject[],
  schema: Record<string, NotionProperty>,
  pagesById: Map<string, NotionPage>,
  ctx: SyncCtx,
  fastPushIds?: Set<string>,
): PushTask[] {
  const tasks: PushTask[] = []
  for (const session of existingSessions) {
    const source = session.integrations?.notion
    if (source?.kind === "event") continue
    const isFastPush = fastPushIds?.has(session.id)
    if (!isFastPush && (ctx.pulledSessionIds.has(session.id) || ctx.conflictedSessionIds.has(session.id))) continue
    if (!isFastPush && !source && ctx.matchedSessionIds.has(session.id)) continue
    if (!isFastPush && !source && ctx.blockedSessionFingerprints.has(sessionFingerprint(session))) continue
    const isDirty = ctx.dirtySessionIds.has(session.id)
    const bodyText = buildSessionBodyText(session)
    const children = buildPageChildrenForSync(bodyText, source?.bodyHash)
    const bodyHash = hashBody(bodyText ?? "")
    const properties = buildNotionSessionProperties(settings, session, subjects, schema)
    if (source) {
      if (isFastPush) {
        tasks.push({
          run: async () => {
            const page = await withRetry(
              `Session "${session.title}"`,
              () => updateOrCreatePage(settings, source.id, session.id, "session", properties, children),
              ctx.pushErrors,
            )
            if (!page) return
            if (!sessionWriteMatches(page, session, settings, subjects)) {
              ctx.pushErrors.push(`Session "${session.title}": Notion did not persist every mapped field`)
              return
            }
            ctx.pushedUpdated += 1
            ctx.acknowledgedSessionIds.add(session.id)
            ctx.newNotionIds.add(page.id)
            ctx.updatedSessions.set(session.id, {
              ...ctx.updatedSessions.get(session.id),
              source: getNotionSource(page, "session", bodyHash, sessionSyncSnapshot(session, settings, subjects)),
            })
          },
        })
        continue
      }
      const remotePage = pagesById.get(source.id)
      if (remotePage) {
        const propertiesMatch = pageMatchesSession(remotePage, session, settings, subjects, findSubjectIdFromValues)
        const bodyDiffers = bodyHasChanged(source.bodyHash, bodyText)
        const identityMatches = getFocalId(remotePage) === session.id && getFocalKind(remotePage) === "session"
        if (!isDirty && propertiesMatch && !bodyDiffers && identityMatches) continue
        if (propertiesMatch && !bodyDiffers && identityMatches) {
          ctx.acknowledgedSessionIds.add(session.id)
          ctx.updatedSessions.set(session.id, {
            ...ctx.updatedSessions.get(session.id),
            source: getNotionSource(
              remotePage,
              "session",
              bodyHash,
              sessionSyncSnapshot(session, settings, subjects),
            ),
          })
          continue
        }
        tasks.push({
          run: async () => {
            const page = await withRetry(
              `Session "${session.title}"`,
              () => updateNotionPage(
                settings,
                source.id,
                properties,
                bodyDiffers ? children : undefined,
              ),
              ctx.pushErrors,
            )
            if (!page) return
            if (!sessionWriteMatches(page, session, settings, subjects)) {
              ctx.pushErrors.push(`Session "${session.title}": Notion did not persist every mapped field`)
              return
            }
            ctx.pushedUpdated += 1
            ctx.acknowledgedSessionIds.add(session.id)
            ctx.newNotionIds.add(page.id)
            ctx.updatedSessions.set(session.id, {
              ...ctx.updatedSessions.get(session.id),
              source: getNotionSource(page, "session", bodyHash, sessionSyncSnapshot(session, settings, subjects)),
            })
          },
        })
      } else {
        tasks.push({
          run: async () => {
            const page = await withRetry(
              `Session "${session.title}"`,
              () => createRecoverablePage(settings, session.id, "session", properties, children),
              ctx.pushErrors,
            )
            if (!page) return
            if (!sessionWriteMatches(page, session, settings, subjects)) {
              ctx.pushErrors.push(`Session "${session.title}": Notion did not persist every mapped field`)
              return
            }
            ctx.pushedCreated += 1
            ctx.acknowledgedSessionIds.add(session.id)
            ctx.newNotionIds.add(page.id)
            ctx.updatedSessions.set(session.id, {
              ...ctx.updatedSessions.get(session.id),
              source: getNotionSource(page, "session", bodyHash, sessionSyncSnapshot(session, settings, subjects)),
            })
          },
        })
      }
      continue
    }
    tasks.push({
      run: async () => {
        const page = await withRetry(
          `Session "${session.title}"`,
          () => createRecoverablePage(settings, session.id, "session", properties, children),
          ctx.pushErrors,
        )
        if (!page) return
        if (!sessionWriteMatches(page, session, settings, subjects)) {
          ctx.pushErrors.push(`Session "${session.title}": Notion did not persist every mapped field`)
          return
        }
        ctx.pushedCreated += 1
        ctx.acknowledgedSessionIds.add(session.id)
        ctx.newNotionIds.add(page.id)
        ctx.updatedSessions.set(session.id, {
          ...ctx.updatedSessions.get(session.id),
          source: getNotionSource(page, "session", bodyHash, sessionSyncSnapshot(session, settings, subjects)),
        })
      },
    })
  }
  return tasks
}

// ---------------------------------------------------------------------------
// Phase 3: Orphan cleanup
// ---------------------------------------------------------------------------

export async function processNotionArchiveIntents(
  existingEvents: CalendarEvent[],
  existingSessions: StudySession[],
  settings: NotionCalendarSettings,
  ctx: SyncCtx,
  onProgress?: (msg: string) => void,
): Promise<Set<string>> {
  const hiddenIds = new Set<string>()
  const now = new Date().toISOString()
  const intents = (await readNotionIntents(settings.dataSourceId))
    .filter((intent) => intent.operation === "archive")
  const eventIds = new Set(existingEvents.map((event) => event.id))
  const sessionIds = new Set(existingSessions.map((session) => session.id))
  const due: (typeof intents[number] & { pageId: string })[] = []
  for (const intent of intents) {
    const restored = intent.kind === "event"
      ? eventIds.has(intent.localId)
      : sessionIds.has(intent.localId)
    if (restored || !intent.pageId) {
      await clearNotionIntent(intent.dataSourceId, intent.kind, intent.localId, "archive", undefined, intent)
      continue
    }
    hiddenIds.add(intent.pageId)
    if (notionIntentDue(intent, now)) due.push({ ...intent, pageId: intent.pageId })
  }
  if (due.length > 0) {
    onProgress?.(`Cleaning up ${due.length} deleted item${due.length === 1 ? "" : "s"}...`)
  }
  for (const intent of due) {
    try {
      await waitForWriteTurn()
      await deleteNotionPage(settings, intent.pageId)
      ctx.deleted += 1
      await clearNotionIntent(intent.dataSourceId, intent.kind, intent.localId, "archive", undefined, intent)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      ctx.pushErrors.push(`Delete page ${intent.pageId}: ${message}`)
      await persistRetriedNotionIntent(retryNotionIntent(intent, message, now))
    }
  }
  return hiddenIds
}

// ---------------------------------------------------------------------------
// Orchestrate push phase
// ---------------------------------------------------------------------------

export async function executePush(
  existingEvents: CalendarEvent[],
  existingSessions: StudySession[],
  settings: NotionCalendarSettings,
  subjects: Subject[],
  schema: Record<string, NotionProperty>,
  pagesById: Map<string, NotionPage>,
  ctx: SyncCtx,
  fastPushEventIds?: Set<string>,
  fastPushSessionIds?: Set<string>,
): Promise<void> {
  const eventTasks = collectEventPushTasks(existingEvents, settings, subjects, schema, pagesById, ctx, fastPushEventIds)
  const sessionTasks = collectSessionPushTasks(existingSessions, settings, subjects, schema, pagesById, ctx, fastPushSessionIds)
  await executePushTasks([...eventTasks, ...sessionTasks])
}
