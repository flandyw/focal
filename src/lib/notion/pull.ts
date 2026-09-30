import type { CalendarEvent, NotionSyncSnapshot, StudySession, Subject } from "@/lib/types"
import type { NotionCalendarSettings } from "@/lib/settings"
import type { EventUpdates, NotionPage, SessionUpdates, SyncCtx } from "@/lib/notion/schema"
import {
  getPageKind,
  getFocalId,
  getFocalKind,
  getPropertyDateForEvent,
  getNotionSource,
  pageMatchesEvent,
  pageMatchesSession,
  toEventFromPage,
  toSessionFromPage,
  eventFingerprint,
  sessionFingerprint,
  hashBody,
  bodyHasChanged,
  buildSessionBodyText,
  eventSyncSnapshot,
  sessionSyncSnapshot,
  notionSnapshotsEqual,
  mergeNotionSyncSnapshots,
  resolveNotionSyncSnapshot,
} from "@/lib/notion/schema"
import { findSubjectIdFromValues } from "@/lib/notion/subjectMatch"

const CONFLICT_RECHECK_DELAYS_MS = [500, 1_000] as const
const LOCAL_WRITE_ECHO_GRACE_MS = 5_000

type RefreshNotionPage = (pageId: string) => Promise<NotionPage>
type Wait = (delayMs: number) => Promise<void>

export function chooseNotionConflictSide(
  localUpdatedAt?: string,
  notionLastEditedTime?: string,
): "local" | "notion" | null {
  const localTime = localUpdatedAt ? new Date(localUpdatedAt).getTime() : Number.NaN
  const notionTime = notionLastEditedTime ? new Date(notionLastEditedTime).getTime() : Number.NaN
  if (!Number.isFinite(localTime) || !Number.isFinite(notionTime)) return null
  // A Notion timestamp immediately after a local edit is commonly Focal's own
  // write becoming visible. Prefer local briefly; clearly later Notion edits win.
  return notionTime > localTime + LOCAL_WRITE_ECHO_GRACE_MS ? "notion" : "local"
}

function resetPullState(ctx: SyncCtx): void {
  ctx.created.length = 0
  ctx.createdSessions.length = 0
  ctx.updatedEvents.clear()
  ctx.updatedSessions.clear()
  ctx.matchedEventIds.clear()
  ctx.matchedSessionIds.clear()
  ctx.blockedEventFingerprints.clear()
  ctx.blockedSessionFingerprints.clear()
  ctx.skipped = 0
  ctx.skippedReasons.length = 0
  ctx.conflicts = 0
  ctx.conflictDetails.length = 0
  ctx.conflictItems.length = 0
  ctx.pulledEventIds.clear()
  ctx.pulledSessionIds.clear()
  ctx.conflictedEventIds.clear()
  ctx.conflictedSessionIds.clear()
  ctx.acknowledgedEventIds.clear()
  ctx.acknowledgedSessionIds.clear()
}

function recordSkippedReason(ctx: SyncCtx, reason: string | undefined): void {
  if (reason && !ctx.skippedReasons.includes(reason) && ctx.skippedReasons.length < 3) {
    ctx.skippedReasons.push(reason)
  }
}

export function eventUpdatesFromSnapshot(snapshot: NotionSyncSnapshot): EventUpdates {
  const updates: EventUpdates = {
    title: String(snapshot.title ?? ""),
    startTime: String(snapshot.startTime ?? ""),
    endTime: typeof snapshot.endTime === "string" ? snapshot.endTime : undefined,
  }
  if (typeof snapshot.eventType === "string") updates.eventType = snapshot.eventType as CalendarEvent["eventType"]
  if (typeof snapshot.isFinished === "boolean") updates.isFinished = snapshot.isFinished
  if ("subjectId" in snapshot) updates.subjectId = typeof snapshot.subjectId === "string" ? snapshot.subjectId : undefined
  return updates
}

export function sessionUpdatesFromSnapshot(
  snapshot: NotionSyncSnapshot,
  existing: StudySession,
  currentPrimarySubjectId?: string | null,
  remoteCompletedAt?: string,
): SessionUpdates {
  const updates: SessionUpdates = {
    title: String(snapshot.title ?? ""),
    startTime: String(snapshot.startTime ?? ""),
    endTime: String(snapshot.endTime ?? snapshot.startTime ?? ""),
  }
  if ("subjectId" in snapshot) {
    const nextPrimarySubjectId = typeof snapshot.subjectId === "string" ? snapshot.subjectId : null
    if (nextPrimarySubjectId !== currentPrimarySubjectId) {
      updates.subjectIds = [
        ...(nextPrimarySubjectId ? [nextPrimarySubjectId] : []),
        ...existing.subjectIds.filter((subjectId) => (
          subjectId !== currentPrimarySubjectId && subjectId !== nextPrimarySubjectId
        )),
      ]
    }
  }
  if (typeof snapshot.isCompleted === "boolean") {
    const currentlyCompleted = existing.execution.state === "completed"
    if (snapshot.isCompleted !== currentlyCompleted) {
      updates.status = snapshot.isCompleted
        ? "completed"
        : existing.execution.intervals.length > 0
          ? "in-progress"
          : "planned"
      updates.completedAt = snapshot.isCompleted
        ? (remoteCompletedAt ?? (existing.execution.state === "completed" ? existing.execution.completedAt : new Date().toISOString()))
        : undefined
    }
  }
  return updates
}

export function rebaseNotionConflictUpdates(
  kind: "event" | "session",
  conflictingFields: readonly string[],
  page: NotionPage,
  current: CalendarEvent | StudySession,
  settings: NotionCalendarSettings,
  subjects: Subject[],
  resolution: "local" | "notion",
): EventUpdates | SessionUpdates {
  const source = "schedule" in current ? current.integrations?.notion : current.source?.type === "notion" ? current.source : undefined
  if (kind === "event") {
    const event = current as CalendarEvent
    const remote = toEventFromPage(page, settings, subjects, findSubjectIdFromValues)
    const localSnapshot = eventSyncSnapshot(event, settings)
    const remoteSnapshot = eventSyncSnapshot(remote, settings)
    const merge = source?.syncSnapshot
      ? mergeNotionSyncSnapshots(source.syncSnapshot, localSnapshot, remoteSnapshot)
      : { merged: {}, conflictingFields: ["record"] }
    const fields = conflictingFields.includes("record") || merge.conflictingFields.includes("record")
      ? ["record"]
      : [...new Set([...conflictingFields, ...merge.conflictingFields])]
    return eventUpdatesFromSnapshot(resolveNotionSyncSnapshot(
      merge.merged,
      resolution === "local" ? localSnapshot : remoteSnapshot,
      fields,
    ))
  }

  const session = current as StudySession
  const remote = toSessionFromPage(page, settings, subjects, findSubjectIdFromValues)
  if (!remote) throw new Error("The Notion page no longer has a valid date")
  const localSnapshot = sessionSyncSnapshot(session, settings, subjects)
  const remoteSnapshot = sessionSyncSnapshot(remote, settings, subjects)
  const merge = source?.syncSnapshot
    ? mergeNotionSyncSnapshots(source.syncSnapshot, localSnapshot, remoteSnapshot)
    : { merged: {}, conflictingFields: ["record"] }
  const fields = conflictingFields.includes("record") || merge.conflictingFields.includes("record")
    ? ["record"]
    : [...new Set([...conflictingFields, ...merge.conflictingFields])]
  const currentPrimarySubjectId = typeof localSnapshot.subjectId === "string" ? localSnapshot.subjectId : null
  return sessionUpdatesFromSnapshot(
    resolveNotionSyncSnapshot(
      merge.merged,
      resolution === "local" ? localSnapshot : remoteSnapshot,
      fields,
    ),
    session,
    currentPrimarySubjectId,
    remote.completedAt,
  )
}

function pullEvent(
  page: NotionPage,
  startTime: string,
  existingEvents: CalendarEvent[],
  eventBySourceId: Map<string, CalendarEvent>,
  settings: NotionCalendarSettings,
  subjects: Subject[],
  ctx: SyncCtx,
): void {
  const existing = eventBySourceId.get(page.id)
    ?? (getFocalId(page) ? existingEvents.find((event) => event.id === getFocalId(page)) : undefined)
  if (existing) {
    ctx.matchedEventIds.add(existing.id)
    const existingSource = existing.source?.type === "notion" ? existing.source : undefined
    if (
      !existing.source
      && getFocalId(page) === existing.id
      && pageMatchesEvent(page, existing, settings, subjects, findSubjectIdFromValues)
    ) {
      const bodyHash = hashBody(existing.description)
      ctx.updatedEvents.set(existing.id, {
        ...ctx.updatedEvents.get(existing.id),
        source: getNotionSource(
          page,
          "event",
          undefined,
          eventSyncSnapshot(existing, settings),
        ),
      })
      if (bodyHash === undefined) {
        ctx.pulledEventIds.add(existing.id)
        ctx.acknowledgedEventIds.add(existing.id)
      }
      return
    }
    if (!existingSource?.lastEditedTime || existingSource.lastEditedTime !== page.last_edited_time) {
      const fromPage = toEventFromPage(page, settings, subjects, findSubjectIdFromValues)
      const localSnapshot = eventSyncSnapshot(existing, settings)
      const remoteSnapshot = eventSyncSnapshot(fromPage, settings)
      const remoteSource = getNotionSource(page, "event", existingSource?.bodyHash, remoteSnapshot)
      const remoteUpdates: EventUpdates = {
        ...eventUpdatesFromSnapshot(remoteSnapshot),
        source: remoteSource,
      }
      if (ctx.dirtyEventIds.has(existing.id)) {
        const localBodyChanged = bodyHasChanged(existingSource?.bodyHash, existing.description)
        const merge = existingSource?.syncSnapshot
          ? mergeNotionSyncSnapshots(existingSource.syncSnapshot, localSnapshot, remoteSnapshot)
          : undefined
        if (merge) {
          if (merge.conflictingFields.length === 0) {
            ctx.updatedEvents.set(existing.id, {
              ...ctx.updatedEvents.get(existing.id),
              ...eventUpdatesFromSnapshot(merge.merged),
              source: remoteSource,
            })
            if (!localBodyChanged && notionSnapshotsEqual(merge.merged, remoteSnapshot)) {
              ctx.pulledEventIds.add(existing.id)
              ctx.acknowledgedEventIds.add(existing.id)
            }
            return
          }
        } else if (notionSnapshotsEqual(localSnapshot, remoteSnapshot)) {
          ctx.updatedEvents.set(existing.id, {
            ...ctx.updatedEvents.get(existing.id),
            source: remoteSource,
          })
          if (!localBodyChanged) {
            ctx.pulledEventIds.add(existing.id)
            ctx.acknowledgedEventIds.add(existing.id)
          }
          return
        }

        const conflictingFields = merge?.conflictingFields ?? ["record"]
        const automaticSide = chooseNotionConflictSide(existing.updated_at, page.last_edited_time)
        if (automaticSide) {
          const automaticSnapshot = resolveNotionSyncSnapshot(
            merge?.merged ?? {},
            automaticSide === "local" ? localSnapshot : remoteSnapshot,
            conflictingFields,
          )
          ctx.updatedEvents.set(existing.id, {
            ...ctx.updatedEvents.get(existing.id),
            ...eventUpdatesFromSnapshot(automaticSnapshot),
            source: remoteSource,
          })
          if (!localBodyChanged && notionSnapshotsEqual(automaticSnapshot, remoteSnapshot)) {
            ctx.pulledEventIds.add(existing.id)
            ctx.acknowledgedEventIds.add(existing.id)
          }
          return
        }
        const localResolutionSnapshot = resolveNotionSyncSnapshot(
          merge?.merged ?? {},
          localSnapshot,
          conflictingFields,
        )
        const remoteResolutionSnapshot = resolveNotionSyncSnapshot(
          merge?.merged ?? {},
          remoteSnapshot,
          conflictingFields,
        )
        ctx.conflicts += 1
        ctx.conflictedEventIds.add(existing.id)
        ctx.conflictDetails.push(`Event "${existing.title}" was modified both locally and in Notion`)
        ctx.conflictItems.push({
          localId: existing.id,
          kind: "event",
          title: existing.title,
          startTime: existing.startTime,
          endTime: existing.endTime,
          notionPageId: page.id,
          notionLastEditedTime: page.last_edited_time,
          notionUrl: page.url,
          localUpdates: eventUpdatesFromSnapshot(localResolutionSnapshot),
          remoteUpdates: eventUpdatesFromSnapshot(remoteResolutionSnapshot),
          localSnapshot,
          remoteSnapshot,
          conflictingFields,
          localUpdatedAt: existing.updated_at,
          localBodyHash: hashBody(existing.description),
        })
        return
      }
      ctx.updatedEvents.set(existing.id, {
        ...ctx.updatedEvents.get(existing.id),
        ...remoteUpdates,
      })
      ctx.pulledEventIds.add(existing.id)
      ctx.acknowledgedEventIds.add(existing.id)
    } else if (
      !existingSource.syncSnapshot
      && !bodyHasChanged(existingSource.bodyHash, existing.description)
      && pageMatchesEvent(page, existing, settings, subjects, findSubjectIdFromValues)
    ) {
      ctx.updatedEvents.set(existing.id, {
        ...ctx.updatedEvents.get(existing.id),
        source: getNotionSource(page, "event", existingSource.bodyHash, eventSyncSnapshot(existing, settings)),
      })
      ctx.pulledEventIds.add(existing.id)
      ctx.acknowledgedEventIds.add(existing.id)
    }
    return
  }

  const candidates = existingEvents.filter((e) => (
    !e.source && !ctx.matchedEventIds.has(e.id) && pageMatchesEvent(page, e, settings, subjects, findSubjectIdFromValues)
  ))
  if (candidates.length > 1) {
    const pageStart = new Date(startTime).getTime()
    candidates.sort((a, b) =>
      Math.abs(new Date(a.startTime).getTime() - pageStart) -
      Math.abs(new Date(b.startTime).getTime() - pageStart),
    )
  }
  for (const c of candidates) ctx.blockedEventFingerprints.add(eventFingerprint(c))

  const match = candidates[0]
  if (match) {
    ctx.matchedEventIds.add(match.id)
    const bodyHash = hashBody(match.description)
    ctx.updatedEvents.set(match.id, {
      ...ctx.updatedEvents.get(match.id),
      source: getNotionSource(
        page,
        "event",
        undefined,
        eventSyncSnapshot(match, settings),
      ),
    })
    if (bodyHash === undefined) {
      ctx.pulledEventIds.add(match.id)
      ctx.acknowledgedEventIds.add(match.id)
    }
    return
  }

  const focalId = getFocalId(page)
  const fromPage = toEventFromPage(page, settings, subjects, findSubjectIdFromValues)
  ctx.created.push(focalId ? { ...fromPage, id: focalId } : fromPage)
}

function pullSession(
  page: NotionPage,
  startTime: string,
  existingSessions: StudySession[],
  sessionBySourceId: Map<string, StudySession>,
  settings: NotionCalendarSettings,
  subjects: Subject[],
  ctx: SyncCtx,
): void {
  const existing = sessionBySourceId.get(page.id)
    ?? (getFocalId(page) ? existingSessions.find((session) => session.id === getFocalId(page)) : undefined)
  if (existing) {
    ctx.matchedSessionIds.add(existing.id)
    const source = existing.integrations?.notion
    if (
      !source
      && getFocalId(page) === existing.id
      && pageMatchesSession(page, existing, settings, subjects, findSubjectIdFromValues)
    ) {
      const bodyText = buildSessionBodyText(existing)
      ctx.updatedSessions.set(existing.id, {
        ...ctx.updatedSessions.get(existing.id),
        source: getNotionSource(
          page,
          "session",
          undefined,
          sessionSyncSnapshot(existing, settings, subjects),
        ),
      })
      if (hashBody(bodyText) === undefined) {
        ctx.pulledSessionIds.add(existing.id)
        ctx.acknowledgedSessionIds.add(existing.id)
      }
      return
    }
    if (!source?.lastEditedTime || source.lastEditedTime !== page.last_edited_time) {
      const session = toSessionFromPage(page, settings, subjects, findSubjectIdFromValues)
      if (session) {
        const localSnapshot = sessionSyncSnapshot(existing, settings, subjects)
        const remoteSnapshot = sessionSyncSnapshot(session, settings, subjects)
        const currentPrimarySubjectId = typeof localSnapshot.subjectId === "string" ? localSnapshot.subjectId : null
        const remoteSource = getNotionSource(page, "session", source?.bodyHash, remoteSnapshot)
        const remoteUpdates: SessionUpdates = {
          ...ctx.updatedSessions.get(existing.id),
          ...sessionUpdatesFromSnapshot(remoteSnapshot, existing, currentPrimarySubjectId, session.completedAt),
          source: remoteSource,
        }
        if (ctx.dirtySessionIds.has(existing.id)) {
          const localBodyChanged = bodyHasChanged(source?.bodyHash, buildSessionBodyText(existing))
          const merge = source?.syncSnapshot
            ? mergeNotionSyncSnapshots(source.syncSnapshot, localSnapshot, remoteSnapshot)
            : undefined
          if (merge) {
            if (merge.conflictingFields.length === 0) {
              ctx.updatedSessions.set(existing.id, {
                ...ctx.updatedSessions.get(existing.id),
                ...sessionUpdatesFromSnapshot(merge.merged, existing, currentPrimarySubjectId, session.completedAt),
                source: remoteSource,
              })
              if (!localBodyChanged && notionSnapshotsEqual(merge.merged, remoteSnapshot)) {
                ctx.pulledSessionIds.add(existing.id)
                ctx.acknowledgedSessionIds.add(existing.id)
              }
              return
            }
          } else if (notionSnapshotsEqual(localSnapshot, remoteSnapshot)) {
            ctx.updatedSessions.set(existing.id, {
              ...ctx.updatedSessions.get(existing.id),
              source: remoteSource,
            })
            if (!localBodyChanged) {
              ctx.pulledSessionIds.add(existing.id)
              ctx.acknowledgedSessionIds.add(existing.id)
            }
            return
          }

          const conflictingFields = merge?.conflictingFields ?? ["record"]
          const automaticSide = chooseNotionConflictSide(existing.updated_at, page.last_edited_time)
          if (automaticSide) {
            const automaticSnapshot = resolveNotionSyncSnapshot(
              merge?.merged ?? {},
              automaticSide === "local" ? localSnapshot : remoteSnapshot,
              conflictingFields,
            )
            ctx.updatedSessions.set(existing.id, {
              ...ctx.updatedSessions.get(existing.id),
              ...sessionUpdatesFromSnapshot(
                automaticSnapshot,
                existing,
                currentPrimarySubjectId,
                session.completedAt,
              ),
              source: remoteSource,
            })
            if (!localBodyChanged && notionSnapshotsEqual(automaticSnapshot, remoteSnapshot)) {
              ctx.pulledSessionIds.add(existing.id)
              ctx.acknowledgedSessionIds.add(existing.id)
            }
            return
          }
          const localResolutionSnapshot = resolveNotionSyncSnapshot(
            merge?.merged ?? {},
            localSnapshot,
            conflictingFields,
          )
          const remoteResolutionSnapshot = resolveNotionSyncSnapshot(
            merge?.merged ?? {},
            remoteSnapshot,
            conflictingFields,
          )
          ctx.conflicts += 1
          ctx.conflictedSessionIds.add(existing.id)
          ctx.conflictDetails.push(`Session "${existing.title}" was modified both locally and in Notion`)
          ctx.conflictItems.push({
            localId: existing.id,
            kind: "session",
            title: existing.title,
            startTime: existing.schedule.blocks[0].start,
            endTime: existing.schedule.blocks[existing.schedule.blocks.length - 1].end,
            notionPageId: page.id,
            notionLastEditedTime: page.last_edited_time,
            notionUrl: page.url,
            localUpdates: sessionUpdatesFromSnapshot(
              localResolutionSnapshot,
              existing,
              currentPrimarySubjectId,
              session.completedAt,
            ),
            remoteUpdates: sessionUpdatesFromSnapshot(
              remoteResolutionSnapshot,
              existing,
              currentPrimarySubjectId,
              session.completedAt,
            ),
            localSnapshot,
            remoteSnapshot,
            conflictingFields,
            localUpdatedAt: existing.updated_at,
            localBodyHash: hashBody(buildSessionBodyText(existing)),
            localSubjectIds: [...existing.subjectIds],
          })
          return
        }
        ctx.updatedSessions.set(existing.id, remoteUpdates)
        ctx.pulledSessionIds.add(existing.id)
        ctx.acknowledgedSessionIds.add(existing.id)
      }
    } else if (
      !source.syncSnapshot
      && !bodyHasChanged(source.bodyHash, buildSessionBodyText(existing))
      && pageMatchesSession(page, existing, settings, subjects, findSubjectIdFromValues)
    ) {
      ctx.updatedSessions.set(existing.id, {
        ...ctx.updatedSessions.get(existing.id),
        source: getNotionSource(
          page,
          "session",
          source.bodyHash,
          sessionSyncSnapshot(existing, settings, subjects),
        ),
      })
      ctx.pulledSessionIds.add(existing.id)
      ctx.acknowledgedSessionIds.add(existing.id)
    }
    return
  }

  const candidates = existingSessions.filter((s) => (
    !s.integrations?.notion && !ctx.matchedSessionIds.has(s.id) && pageMatchesSession(page, s, settings, subjects, findSubjectIdFromValues)
  ))
  if (candidates.length > 1) {
    const pageStart = new Date(startTime).getTime()
    candidates.sort((a, b) =>
      Math.abs(new Date(a.schedule.blocks[0].start).getTime() - pageStart) -
      Math.abs(new Date(b.schedule.blocks[0].start).getTime() - pageStart),
    )
  }
  for (const c of candidates) ctx.blockedSessionFingerprints.add(sessionFingerprint(c))

  const match = candidates[0]
  if (match) {
    ctx.matchedSessionIds.add(match.id)
    const bodyText = buildSessionBodyText(match)
    ctx.updatedSessions.set(match.id, {
      ...ctx.updatedSessions.get(match.id),
      source: getNotionSource(
        page,
        "session",
        undefined,
        sessionSyncSnapshot(match, settings, subjects),
      ),
    })
    if (hashBody(bodyText) === undefined) {
      ctx.pulledSessionIds.add(match.id)
      ctx.acknowledgedSessionIds.add(match.id)
    }
    return
  }

  const session = toSessionFromPage(page, settings, subjects, findSubjectIdFromValues)
  if (session) {
    const focalId = getFocalId(page)
    ctx.createdSessions.push(focalId ? { ...session, id: focalId } : session)
  }
}

export function pullFromNotion(
  pages: NotionPage[],
  existingEvents: CalendarEvent[],
  existingSessions: StudySession[],
  settings: NotionCalendarSettings,
  subjects: Subject[],
  ctx: SyncCtx,
): void {
  const eventBySourceId = new Map<string, CalendarEvent>(
    existingEvents
      .filter((e) => e.source?.type === "notion" && e.source.kind !== "session")
      .map((e) => [e.source!.id, e]),
  )
  const sessionBySourceId = new Map<string, StudySession>(
    existingSessions
      .filter((s) => s.integrations?.notion && s.integrations.notion.kind !== "event")
      .map((s) => [s.integrations!.notion!.id, s]),
  )

  for (const page of pages) {
    const properties = page.properties ?? {}
    const kind = getFocalKind(page) ?? getPageKind(properties, settings)
    const { startTime, skippedReason } = getPropertyDateForEvent(properties, settings)

    if (!startTime) {
      ctx.skipped += 1
      recordSkippedReason(ctx, skippedReason)
      continue
    }
    recordSkippedReason(ctx, skippedReason)

    if (kind === "session") {
      pullSession(page, startTime, existingSessions, sessionBySourceId, settings, subjects, ctx)
    } else {
      pullEvent(page, startTime, existingEvents, eventBySourceId, settings, subjects, ctx)
    }
  }
}

export async function pullFromNotionAfterConflictRecheck(
  pages: NotionPage[],
  existingEvents: CalendarEvent[],
  existingSessions: StudySession[],
  settings: NotionCalendarSettings,
  subjects: Subject[],
  ctx: SyncCtx,
  refreshPage: RefreshNotionPage,
  onRecheck?: () => void,
  wait: Wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
): Promise<NotionPage[]> {
  let currentPages = pages
  pullFromNotion(currentPages, existingEvents, existingSessions, settings, subjects, ctx)

  // ponytail: two targeted rereads cover Notion's short consistency window.
  // If it regularly exceeds 1.5s, replace this with revision-aware acknowledgements.
  for (const delayMs of CONFLICT_RECHECK_DELAYS_MS) {
    if (ctx.conflicts === 0) break
    onRecheck?.()
    await wait(delayMs)

    const conflictPageIds = [...new Set(ctx.conflictItems.map((item) => item.notionPageId))]
    const refreshedPages = new Map<string, NotionPage>()
    for (const pageId of conflictPageIds) {
      try {
        refreshedPages.set(pageId, await refreshPage(pageId))
      } catch {
        // Keep the original conflict when its confirmation read fails. The
        // existing resolver will refresh it again before applying a choice.
      }
    }
    if (refreshedPages.size === 0) break

    currentPages = currentPages.map((page) => refreshedPages.get(page.id) ?? page)
    resetPullState(ctx)
    pullFromNotion(currentPages, existingEvents, existingSessions, settings, subjects, ctx)
  }

  return currentPages
}
