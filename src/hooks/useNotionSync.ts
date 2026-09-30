import { useState, useCallback, useEffect, useRef } from "react"
import { toast } from "sonner"
import { getNotionCalendarSettings, type NotionCalendarSettings } from "@/lib/settings"
import { syncNotionCalendar, pushEventToNotion, pushSessionToNotion, type NotionCalendarSyncResult } from "@/lib/notion"
import type { CalendarEvent, NotionSyncSnapshot, StudySession, StudySessionDraft, Subject } from "@/lib/types"
import type { NotionConflict } from "@/components/sync/NotionConflictDialog"
import { clearNotionIntent, readNotionIntents, notionIntentDue } from "@/lib/notion/outbox"
import { readRecords } from "@/lib/storage/database"
import { normaliseEvent } from "@/lib/calendarEvents"
import { fetchNotionPage } from "@/lib/notion/api"
import { updateStudySession, studySessionDraftPatch, normalizeStudySession } from "@/lib/studySessions"
import { rebaseNotionConflictUpdates } from "@/lib/notion/pull"
import {
  buildSessionBodyText,
  eventSyncSnapshot,
  hashBody,
  notionSnapshotsEqual,
  sessionSyncSnapshot,
} from "@/lib/notion/schema"

const MAX_CONFLICT_RESOLUTION_ATTEMPTS = 3

interface UseNotionSyncOptions {
  ready: boolean
  events: CalendarEvent[]
  sessions: StudySession[]
  allSubjects: Subject[]
  syncEvents: (created: (Omit<CalendarEvent, "id" | "created_at"> & { id?: string })[], updated: { id: string; updates: Partial<Omit<CalendarEvent, "id" | "created_at">>; expectedRecord?: CalendarEvent }[]) => Promise<{ created: CalendarEvent[]; updated: CalendarEvent[] }>
  syncSessions: (created: StudySessionDraft[], updated: { id: string; updates: Partial<Omit<StudySession, "id" | "created_at">>; expectedRecord?: StudySession }[]) => Promise<{ created: StudySession[]; updated: StudySession[] }>
}

export function notionEditedTimeLabel(value?: string): string {
  const date = value ? new Date(value) : null
  return date && Number.isFinite(date.getTime()) ? date.toLocaleString() : "unknown"
}

export function notionSyncSettledState(succeeded: boolean, now = Date.now()) {
  return succeeded
    ? { status: "success" as const, lastSyncTime: now }
    : { status: "error" as const }
}

export function notionSyncResultSucceeded(result: Pick<NotionCalendarSyncResult, "pushErrors" | "conflicts">): boolean {
  return result.pushErrors.length === 0 && result.conflicts === 0
}

export function retainFailedNotionConflicts<T extends { id: string }>(
  conflicts: T[],
  failedIds: ReadonlySet<string>,
): T[] {
  return conflicts.filter((conflict) => failedIds.has(conflict.id))
}

export function notionConflictId(item: {
  kind: "event" | "session"
  localId: string
  notionPageId: string
  notionLastEditedTime?: string
}): string {
  return [item.kind, item.localId, item.notionPageId, item.notionLastEditedTime ?? "unknown"].join(":")
}

function snapshotString(snapshot: NotionSyncSnapshot, key: string): string | undefined {
  return typeof snapshot[key] === "string" ? snapshot[key] : undefined
}

function snapshotSubject(snapshot: NotionSyncSnapshot, subjects: Subject[]): string | undefined {
  if (!("subjectId" in snapshot)) return undefined
  if (typeof snapshot.subjectId !== "string") return "No subject"
  return subjects.find((subject) => subject.id === snapshot.subjectId)?.name ?? snapshot.subjectId
}

function sourcesEqual(
  first: CalendarEvent["source"],
  second: CalendarEvent["source"],
): boolean {
  return JSON.stringify(first) === JSON.stringify(second)
}

export function preserveNewerEventChanges(
  input: CalendarEvent,
  current: CalendarEvent,
  updates: Partial<Omit<CalendarEvent, "id" | "created_at">>,
  settings: NotionCalendarSettings,
): Partial<Omit<CalendarEvent, "id" | "created_at">> {
  const before = eventSyncSnapshot(input, settings)
  const now = eventSyncSnapshot(current, settings)
  const next = { ...updates }
  if (now.title !== before.title) delete next.title
  if (now.startTime !== before.startTime) delete next.startTime
  if (now.endTime !== before.endTime) delete next.endTime
  if (now.eventType !== before.eventType) delete next.eventType
  if (now.isFinished !== before.isFinished) delete next.isFinished
  if (now.subjectId !== before.subjectId) delete next.subjectId
  if (!sourcesEqual(input.source, current.source)) delete next.source
  return next
}

export function preserveNewerSessionChanges(
  input: StudySession,
  current: StudySession,
  updates: Partial<StudySessionDraft>,
  settings: NotionCalendarSettings,
  subjects: Subject[],
): Partial<StudySessionDraft> {
  const before = sessionSyncSnapshot(input, settings, subjects)
  const now = sessionSyncSnapshot(current, settings, subjects)
  const next = { ...updates }
  if (now.title !== before.title) delete next.title
  if (now.startTime !== before.startTime) delete next.startTime
  if (now.endTime !== before.endTime) delete next.endTime
  if (now.subjectId !== before.subjectId) {
    delete next.subjectIds
  } else if (next.subjectIds) {
    const currentPrimarySubjectId = typeof now.subjectId === "string" ? now.subjectId : null
    const nextPrimarySubjectId = next.subjectIds.find((subjectId) => (
      subjects.some((subject) => subject.id === subjectId)
    )) ?? null
    next.subjectIds = [
      ...(nextPrimarySubjectId ? [nextPrimarySubjectId] : []),
      ...current.subjectIds.filter((subjectId) => (
        subjectId !== currentPrimarySubjectId && subjectId !== nextPrimarySubjectId
      )),
    ]
  }
  if (now.isCompleted !== before.isCompleted) {
    delete next.status
    delete next.completedAt
  }
  if (!sourcesEqual(input.integrations?.notion, current.integrations?.notion)) delete next.source
  return next
}

export function notionEventIsSettled(event: CalendarEvent, settings: NotionCalendarSettings): boolean {
  const source = event.source?.type === "notion" ? event.source : undefined
  return Boolean(
    source?.syncSnapshot
    && notionSnapshotsEqual(eventSyncSnapshot(event, settings), source.syncSnapshot)
    && hashBody(event.description) === source.bodyHash,
  )
}

export function notionSessionIsSettled(
  session: StudySession,
  settings: NotionCalendarSettings,
  subjects: Subject[],
): boolean {
  const source = session.integrations?.notion
  return Boolean(
    source?.syncSnapshot
    && notionSnapshotsEqual(sessionSyncSnapshot(session, settings, subjects), source.syncSnapshot)
    && hashBody(buildSessionBodyText(session)) === source.bodyHash,
  )
}

export function useNotionSync({ ready, events, sessions, allSubjects, syncEvents, syncSessions }: UseNotionSyncOptions) {
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "error" | "success">("idle")
  const [lastSyncTime, setLastSyncTime] = useState(0)
  const [notionConflicts, setNotionConflicts] = useState<NotionConflict[]>([])
  const [notionConflictDialogOpen, setNotionConflictDialogOpen] = useState(false)

  const notionSyncInFlightRef = useRef(false)
  const notionSyncQueuedRef = useRef(false)
  const notionSyncQueuedNotifyRef = useRef(false)
  const notionSyncQueuedResolversRef = useRef<{
    resolve: (value: NotionCalendarSyncResult | null) => void
    reject: (reason: unknown) => void
  }[]>([])
  const notionSyncRunnerRef = useRef<((notify: boolean, onProgress?: (msg: string) => void) => Promise<NotionCalendarSyncResult | null>) | null>(null)
  const eventsRef = useRef(events)
  const sessionsRef = useRef(sessions)
  const allSubjectsRef = useRef(allSubjects)

  // Debounce rapid sync requests into a single batched call
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingNotifyRef = useRef(false)

  useEffect(() => {
    eventsRef.current = events
    sessionsRef.current = sessions
    allSubjectsRef.current = allSubjects
  })

  const performNotionSync = useCallback(async (notify: boolean, onProgress?: (msg: string) => void, changedEventIds?: Set<string>, changedSessionIds?: Set<string>) => {
    const settings = getNotionCalendarSettings()
    if (!settings.token.trim() || !settings.dataSourceId.trim()) return null
    const shouldNotify = notify || pendingNotifyRef.current
    if (notionSyncInFlightRef.current) {
      notionSyncQueuedRef.current = true
      notionSyncQueuedNotifyRef.current = notionSyncQueuedNotifyRef.current || shouldNotify
      if (shouldNotify) {
        return new Promise<NotionCalendarSyncResult | null>((resolve, reject) => {
          notionSyncQueuedResolversRef.current.push({ resolve, reject })
        })
      }
      return null
    }

    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
      debounceTimerRef.current = null
    }
    pendingNotifyRef.current = false

    notionSyncInFlightRef.current = true
    notionSyncQueuedRef.current = false
    setSyncStatus("syncing")
    let succeeded = false
    let pauseQueuedSync = false
    try {
      const inputEvents = (await readRecords("events")).map(normaliseEvent)
      const inputSessions = (await readRecords("study_sessions")).map(normalizeStudySession)
      eventsRef.current = inputEvents
      sessionsRef.current = inputSessions
      const inputEventById = new Map(inputEvents.map((event) => [event.id, event]))
      const inputSessionById = new Map(inputSessions.map((session) => [session.id, session]))
      const result = await syncNotionCalendar(settings, inputEvents, inputSessions, allSubjectsRef.current, onProgress, changedEventIds, changedSessionIds)
      const currentEventById = new Map(eventsRef.current.map((event) => [event.id, event]))
      const eventUpdates = result.updated.flatMap((item) => {
        const input = inputEventById.get(item.id)
        const current = currentEventById.get(item.id)
        return input && current
          ? [{
              ...item,
              updates: preserveNewerEventChanges(input, current, item.updates, settings),
              expectedRecord: current,
            }]
          : []
      })
      const eventCreates = result.created.filter((item) => !item.id || !currentEventById.has(item.id))
      const writtenEvents = new Map<string, CalendarEvent>()
      const writtenSessions = new Map<string, StudySession>()
      const createdEventIds = new Set<string>()
      const createdSessionIds = new Set<string>()

      if (eventCreates.length > 0 || eventUpdates.length > 0) {
        const synced = await syncEvents(eventCreates, eventUpdates)
        for (const event of synced.updated) writtenEvents.set(event.id, event)
        for (const event of synced.created) {
          writtenEvents.set(event.id, event)
          createdEventIds.add(event.id)
        }
        eventsRef.current = [
          ...eventsRef.current.map((event) => writtenEvents.get(event.id) ?? event),
          ...synced.created.filter((event) => !eventsRef.current.some((current) => current.id === event.id)),
        ]
      }
      const currentSessionById = new Map(sessionsRef.current.map((session) => [session.id, session]))
      const sessionUpdates = result.updatedSessions.flatMap((item) => {
        const input = inputSessionById.get(item.id)
        const current = currentSessionById.get(item.id)
        return input && current
          ? [{
              ...item,
              updates: studySessionDraftPatch(current, preserveNewerSessionChanges(input, current, item.updates, settings, allSubjectsRef.current)),
              expectedRecord: current,
            }]
          : []
      })
      const sessionCreates = result.createdSessions.filter((item) => !item.id || !currentSessionById.has(item.id))
      if (sessionCreates.length > 0 || sessionUpdates.length > 0) {
        const synced = await syncSessions(sessionCreates, sessionUpdates)
        for (const session of synced.updated) writtenSessions.set(session.id, session)
        for (const session of synced.created) {
          writtenSessions.set(session.id, session)
          createdSessionIds.add(session.id)
        }
        sessionsRef.current = [
          ...sessionsRef.current.map((session) => writtenSessions.get(session.id) ?? session),
          ...synced.created.filter((session) => !sessionsRef.current.some((current) => current.id === session.id)),
        ]
      }
      const acknowledgedEventIds = new Set([
        ...result.acknowledgedEventIds,
        ...[...writtenEvents.values()]
          .filter((event) => createdEventIds.has(event.id) && notionEventIsSettled(event, settings))
          .map((event) => event.id),
      ])
      const acknowledgedSessionIds = new Set([
        ...result.acknowledgedSessionIds,
        ...[...writtenSessions.values()]
          .filter((session) => createdSessionIds.has(session.id) && notionSessionIsSettled(session, settings, allSubjectsRef.current))
          .map((session) => session.id),
      ])
      await Promise.all([
        ...[...acknowledgedEventIds].flatMap((id) => {
          const event = writtenEvents.get(id) ?? eventsRef.current.find((candidate) => candidate.id === id)
          return event && notionEventIsSettled(event, settings)
            ? [clearNotionIntent(settings.dataSourceId, "event", id, "upsert", event)]
            : []
        }),
        ...[...acknowledgedSessionIds].flatMap((id) => {
          const session = writtenSessions.get(id) ?? sessionsRef.current.find((candidate) => candidate.id === id)
          return session && notionSessionIsSettled(session, settings, allSubjectsRef.current)
            ? [clearNotionIntent(settings.dataSourceId, "session", id, "upsert", session)]
            : []
        }),
      ])
      const syncSucceeded = notionSyncResultSucceeded(result)
      if (result.conflicts > 0 && result.conflictItems.length > 0) {
        pauseQueuedSync = true
        const conflicts: NotionConflict[] = result.conflictItems.map((item) => {
          const localUpdates = item.localUpdates as Record<string, unknown>
          const remoteUpdates = item.remoteUpdates as Record<string, unknown>
          return {
            id: notionConflictId(item),
            type: item.kind,
            title: item.title,
            localId: item.localId,
            notionPageId: item.notionPageId,
            notionLastEditedTime: item.notionLastEditedTime,
            localUpdatedAt: item.localUpdatedAt,
            localSnapshot: item.localSnapshot,
            remoteSnapshot: item.remoteSnapshot,
            localBodyHash: item.localBodyHash,
            localSubjectIds: item.localSubjectIds,
            conflictingFields: item.conflictingFields,
            localVersion: {
              title: snapshotString(item.localSnapshot, "title") ?? item.title,
              startTime: snapshotString(item.localSnapshot, "startTime") ?? item.startTime,
              endTime: snapshotString(item.localSnapshot, "endTime") ?? item.endTime,
              status: item.kind === "session" && typeof item.localSnapshot.isCompleted === "boolean"
                ? (item.localSnapshot.isCompleted ? "Completed" : "Not completed")
                : item.kind === "event" && typeof item.localSnapshot.isFinished === "boolean"
                  ? (item.localSnapshot.isFinished ? "Finished" : "Open")
                  : undefined,
              subject: snapshotSubject(item.localSnapshot, allSubjectsRef.current),
              eventType: item.kind === "event" ? snapshotString(item.localSnapshot, "eventType") : undefined,
            },
            notionVersion: {
              title: snapshotString(item.remoteSnapshot, "title")
                ?? (typeof remoteUpdates.title === "string"
                  ? remoteUpdates.title
                  : `Notion version (last edited ${notionEditedTimeLabel(item.notionLastEditedTime)})`),
              startTime: snapshotString(item.remoteSnapshot, "startTime"),
              endTime: snapshotString(item.remoteSnapshot, "endTime"),
              status: item.kind === "session" && typeof item.remoteSnapshot.isCompleted === "boolean"
                ? (item.remoteSnapshot.isCompleted ? "Completed" : "Not completed")
                : item.kind === "event" && typeof item.remoteSnapshot.isFinished === "boolean"
                  ? (item.remoteSnapshot.isFinished ? "Finished" : "Open")
                  : undefined,
              subject: snapshotSubject(item.remoteSnapshot, allSubjectsRef.current),
              eventType: item.kind === "event" ? snapshotString(item.remoteSnapshot, "eventType") : undefined,
              url: item.notionUrl,
            },
            localUpdates,
            remoteUpdates,
          }
        })
        setNotionConflicts(conflicts)
        setNotionConflictDialogOpen(true)
      }

      if (shouldNotify) {
        const pulled = result.created.length + result.updated.length + result.createdSessions.length + result.updatedSessions.length
        const pushed = result.pushedCreated + result.pushedUpdated
        const parts: string[] = []
        if (pulled > 0) parts.push(`${pulled} pulled`)
        if (pushed > 0) parts.push(`${pushed} pushed`)
        if (result.deleted > 0) parts.push(`${result.deleted} deleted`)
        if (syncSucceeded) {
          toast.success(
            parts.length > 0
              ? `Synced Notion items: ${parts.join(", ")}`
              : "Notion items already up to date",
          )
        }
        if (result.skipped > 0) {
          toast.info(`${result.skipped} Notion item${result.skipped === 1 ? "" : "s"} skipped without a valid date`, {
            description: result.skippedReasons[0],
          })
        }
        if (result.pushErrors.length > 0) {
          toast.error(`${result.pushErrors.length} push error${result.pushErrors.length === 1 ? "" : "s"}`, {
            description: result.pushErrors[0],
          })
        }
      }
      succeeded = syncSucceeded
      return shouldNotify ? result : null
    } catch (e) {
      if (shouldNotify) {
        toast.error(`Notion sync failed: ${String(e)}`)
        throw e
      }
      console.error(`Notion sync failed: ${String(e)}`)
      return null
    } finally {
      const settled = notionSyncSettledState(succeeded)
      setSyncStatus(settled.status)
      if (settled.status === "success") {
        setLastSyncTime(settled.lastSyncTime)
        setTimeout(() => setSyncStatus((status) => status === "success" ? "idle" : status), 2000)
      }
      notionSyncInFlightRef.current = false
      if (notionSyncQueuedRef.current) {
        notionSyncQueuedRef.current = false
        const queuedNotify = notionSyncQueuedNotifyRef.current
        notionSyncQueuedNotifyRef.current = false
        const queuedResolvers = notionSyncQueuedResolversRef.current.splice(0)
        if (pauseQueuedSync) {
          queuedResolvers.forEach(({ resolve }) => resolve(null))
        } else {
          const result = notionSyncRunnerRef.current?.(queuedNotify)
          if (result) {
            result.then(
              (syncResult) => queuedResolvers.forEach(({ resolve }) => resolve(syncResult)),
              (error) => queuedResolvers.forEach(({ reject }) => reject(error)),
            )
          } else {
            queuedResolvers.forEach(({ resolve }) => resolve(null))
          }
        }
      }
    }
    return null
  }, [syncEvents, syncSessions])

  useEffect(() => {
    notionSyncRunnerRef.current = performNotionSync
  }, [performNotionSync])

  const requestNotionSync = useCallback((notify = false) => {
    const settings = getNotionCalendarSettings()
    if (!settings.token.trim() || !settings.dataSourceId.trim()) return
    if (notionConflictDialogOpen && !notify) return
    if (notionSyncInFlightRef.current) {
      notionSyncQueuedRef.current = true
      notionSyncQueuedNotifyRef.current = notionSyncQueuedNotifyRef.current || notify
      return
    }
    // Debounce: collect rapid fire calls into one batched sync
    pendingNotifyRef.current = pendingNotifyRef.current || notify
    if (debounceTimerRef.current !== null) {
      clearTimeout(debounceTimerRef.current)
    }
    debounceTimerRef.current = setTimeout(() => {
      debounceTimerRef.current = null
      const notifyNow = pendingNotifyRef.current
      pendingNotifyRef.current = false
      void performNotionSync(notifyNow).catch(() => undefined)
    }, 500)
  }, [notionConflictDialogOpen, performNotionSync])

  useEffect(() => {
    if (!ready) return
    requestNotionSync(false)
    const wake = () => {
      const settings = getNotionCalendarSettings()
      void readNotionIntents(settings.dataSourceId).then((intents) => {
        if (intents.some((intent) => notionIntentDue(intent, new Date().toISOString()))) requestNotionSync(false)
      }).catch((error: unknown) => console.error("Could not read Notion intents:", error))
    }
    const onChange = (event: Event) => {
      const tables = (event as CustomEvent<{ tables?: string[]; table?: string }>).detail
      if (tables?.tables?.some((table) => table === "events" || table === "study_sessions") || tables?.table === "events" || tables?.table === "study_sessions") wake()
    }
    window.addEventListener("focal-sync-data-changed", onChange)
    window.addEventListener("online", wake)
    window.addEventListener("focus", wake)
    // ponytail: one 30-second poll discovers remote Notion edits and retries due intents.
    // Use Notion webhooks only if lower-latency remote discovery becomes necessary.
    const timer = window.setInterval(() => requestNotionSync(false), 30_000)
    return () => {
      window.clearInterval(timer)
      if (debounceTimerRef.current !== null) clearTimeout(debounceTimerRef.current)
      window.removeEventListener("focal-sync-data-changed", onChange)
      window.removeEventListener("online", wake)
      window.removeEventListener("focus", wake)
    }
  }, [ready, requestNotionSync])

  const resolveConflicts = useCallback(async (resolutions: Record<string, "local" | "notion" | "skip">) => {
    const settings = getNotionCalendarSettings()
    if (!settings.token.trim() || !settings.dataSourceId.trim()) {
      throw new Error("Reconnect Notion before resolving these conflicts.")
    }

    const localResolutions: string[] = []
    const notionResolutions: string[] = []
    const skipped: string[] = []
    const failedResolutionIds = new Set<string>()
    let newerLocalChangesQueued = false
    for (const conflict of notionConflicts) {
      const resolution = resolutions[conflict.id]
      if (!resolution || resolution === "skip") {
        skipped.push(conflict.title)
        continue
      }

      let resolved = false
      let supersededByNewerLocalChange = false
      for (let attempt = 0; attempt < MAX_CONFLICT_RESOLUTION_ATTEMPTS; attempt += 1) {
        try {
          setSyncStatus("syncing")
          const currentPage = await fetchNotionPage(settings, conflict.notionPageId)
          const currentLocal = conflict.type === "event"
            ? eventsRef.current.find((event) => event.id === conflict.localId)
            : sessionsRef.current.find((session) => session.id === conflict.localId)
          if (!currentLocal) throw new Error(`Local ${conflict.type} no longer exists`)
          const chosenUpdates = rebaseNotionConflictUpdates(
            conflict.type,
            conflict.conflictingFields,
            currentPage,
            currentLocal,
            settings,
            allSubjectsRef.current,
            resolution,
          )

          if (conflict.type === "event") {
            const event = currentLocal as CalendarEvent
            const resolvedEvent = {
              ...event,
              ...chosenUpdates,
              source: {
                ...event.source,
                type: "notion" as const,
                id: currentPage.id,
                kind: "event" as const,
              },
            }
            const result = await pushEventToNotion(settings, resolvedEvent, allSubjectsRef.current)
            if (!result) throw new Error("Notion did not accept the event")
            const synced = await syncEvents([], [{
              id: event.id,
              updates: { ...chosenUpdates, source: result.source },
              expectedRecord: event,
            }])
            const saved = synced.updated[0]
            if (saved && notionEventIsSettled(saved, settings)) {
              eventsRef.current = eventsRef.current.map((candidate) => candidate.id === saved.id ? saved : candidate)
              await clearNotionIntent(settings.dataSourceId, "event", event.id, "upsert", saved)
              resolved = true
              break
            }
          } else {
            const session = currentLocal as StudySession
            const sessionUpdates = chosenUpdates as Partial<StudySessionDraft>
            const resolvedSession = updateStudySession(session, studySessionDraftPatch(session, sessionUpdates))
            const result = await pushSessionToNotion(settings, {
              ...resolvedSession,
              integrations: { ...resolvedSession.integrations, notion: {
                ...resolvedSession.integrations?.notion,
                type: "notion",
                id: currentPage.id,
                kind: "session",
              } },
            }, allSubjectsRef.current)
            if (!result) throw new Error("Notion did not accept the study session")
            const synced = await syncSessions([], [{
              id: session.id,
              updates: studySessionDraftPatch(session, { ...sessionUpdates, source: result.source }),
              expectedRecord: session,
            }])
            const saved = synced.updated[0]
            if (saved && notionSessionIsSettled(saved, settings, allSubjectsRef.current)) {
              sessionsRef.current = sessionsRef.current.map((candidate) => candidate.id === saved.id ? saved : candidate)
              await clearNotionIntent(settings.dataSourceId, "session", session.id, "upsert", saved)
              resolved = true
              break
            }
          }

          if (attempt === MAX_CONFLICT_RESOLUTION_ATTEMPTS - 1) {
            supersededByNewerLocalChange = true
          }
        } catch (error) {
          failedResolutionIds.add(conflict.id)
          console.error(`Failed to keep ${resolution} "${conflict.title}":`, error)
          break
        }
      }

      if (resolved || supersededByNewerLocalChange) {
        if (resolution === "local") localResolutions.push(conflict.title)
        else notionResolutions.push(conflict.title)
        if (supersededByNewerLocalChange) newerLocalChangesQueued = true
      }
    }

    const parts: string[] = []
    if (localResolutions.length > 0) parts.push(`${localResolutions.length} kept local`)
    if (notionResolutions.length > 0) parts.push(`${notionResolutions.length} accepted from Notion`)
    if (skipped.length > 0) parts.push(`${skipped.length} skipped`)

    if (parts.length > 0) {
      toast.success(`Conflicts resolved: ${parts.join(", ")}`)
    }

    const failedConflicts = retainFailedNotionConflicts(notionConflicts, failedResolutionIds)
    setNotionConflicts(failedConflicts)
    if (failedConflicts.length > 0) {
      setSyncStatus("error")
      toast.error(`${failedConflicts.length} conflict resolution${failedConflicts.length === 1 ? "" : "s"} failed`, {
        description: "The unresolved items were kept open so you can retry.",
      })
      setNotionConflictDialogOpen(true)
      throw new Error("Notion could not apply some choices. Check the connection, then try again.")
    }
    if (newerLocalChangesQueued) {
      toast.info("A newer local edit was saved and will sync next.")
      window.setTimeout(() => requestNotionSync(false), 250)
    }
    if (localResolutions.length > 0 || notionResolutions.length > 0) {
      const syncedAt = Date.now()
      setSyncStatus("success")
      setLastSyncTime(syncedAt)
      setTimeout(() => setSyncStatus((status) => status === "success" ? "idle" : status), 2000)
    } else {
      setSyncStatus("idle")
    }
  }, [notionConflicts, requestNotionSync, syncEvents, syncSessions])


  return {
    syncStatus,
    lastSyncTime,
    notionConflicts,
    setNotionConflicts,
    notionConflictDialogOpen,
    setNotionConflictDialogOpen,
    performNotionSync,
    requestNotionSync,
    resolveConflicts,
  }
}
