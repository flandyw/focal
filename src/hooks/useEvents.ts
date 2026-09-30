import { useCallback, useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import type { CalendarEvent } from "@/lib/types"
import { generateId } from "@/lib/utils"
import { usePersistedData } from "@/lib/hooks/usePersistedData"
import { useLatestRef } from "@/lib/hooks/useLatestRef"
import { mutationAccountId, notifyCommittedPlanningChanges } from "@/lib/sync/engine"
import { ensureRecordImport, withWriteLock } from "@/lib/storage/database"
import { getNotionCalendarSettings } from "@/lib/settings"
import { calendarEventFingerprint, dedupeCalendarEvents, normaliseEvent } from "@/lib/calendarEvents"

type EventInput = Omit<CalendarEvent, "id" | "created_at" | "updated_at" | "isFinished"> & { isFinished?: boolean; id?: string }
interface EventUpdate { id: string; updates: Partial<Omit<CalendarEvent, "id" | "created_at">>; expectedRecord?: CalendarEvent }
type EventMutation =
  | { operation: "put"; record: CalendarEvent; overwrite?: boolean }
  | { operation: "update"; id: string; patch: Record<string, unknown>; expected?: CalendarEvent }
  | { operation: "delete"; id: string }

function eventHasPassed(event: Pick<CalendarEvent, "startTime" | "endTime">, now = Date.now()): boolean {
  return new Date(event.endTime ?? event.startTime).getTime() < now
}

function createEvent(data: EventInput): CalendarEvent {
  const now = new Date().toISOString()
  const isFinished = Boolean(data.isFinished) || eventHasPassed(data)
  return { ...data, id: data.id ?? generateId(), isFinished, finishedAt: data.finishedAt ?? (isFinished ? now : undefined), created_at: now, updated_at: now }
}

function updateMutation(item: EventUpdate): EventMutation {
  // Explicit undefined clears a field; JSON would otherwise silently omit it.
  const patch = Object.fromEntries(Object.entries(item.updates).map(([key, value]) => [key, value ?? null]))
  return { operation: "update", id: item.id, patch: { ...patch, updated_at: new Date().toISOString() }, expected: item.expectedRecord }
}

async function commit(mutations: EventMutation[]): Promise<CalendarEvent[]> {
  if (!mutations.length) return []
  const expectedAccountId = mutationAccountId()
  await ensureRecordImport("events")
  const records = await withWriteLock("events", () => invoke<unknown[]>("mutate_events", {
    mutations,
    expectedAccountId,
    dataSourceId: getNotionCalendarSettings().dataSourceId,
  }))
  notifyCommittedPlanningChanges(["events"])
  return records.map(normaliseEvent)
}

export function useEvents() {
  const duplicateIdsRef = useRef<string[]>([])
  const { data: events, loading, error, refresh } = usePersistedData({
    kind: "events",
    normalize: normaliseEvent,
    onLoad: (normalised) => {
      const result = dedupeCalendarEvents(normalised.filter((event) => !event.deleted_at))
      duplicateIdsRef.current = result.duplicateIds
      return result.events
    },
  })
  const eventsRef = useLatestRef(events)

  useEffect(() => {
    if (loading || !duplicateIdsRef.current.length) return
    const ids = duplicateIdsRef.current
    duplicateIdsRef.current = []
    void commit(ids.map((id) => ({ operation: "delete", id }))).catch((error: unknown) => {
      duplicateIdsRef.current = ids
      console.error("Could not persist duplicate event repair:", error)
    })
  }, [events, loading])

  const addEvents = useCallback(async (items: EventInput[]) => {
    const fingerprints = new Set(eventsRef.current.map(calendarEventFingerprint))
    const created = items.map(createEvent).filter((event) => {
      const fingerprint = calendarEventFingerprint(event)
      if (fingerprints.has(fingerprint)) return false
      fingerprints.add(fingerprint)
      return true
    })
    return commit(created.map((record) => ({ operation: "put", record })))
  }, [eventsRef])
  const addEvent = useCallback(async (data: EventInput) => (await addEvents([data]))[0] ?? null, [addEvents])
  const updateEvents = useCallback(async (items: EventUpdate[]) => {
    await commit(items.map(updateMutation))
  }, [])
  const updateEvent = useCallback(async (id: string, updates: EventUpdate["updates"]) => {
    await updateEvents([{ id, updates }])
  }, [updateEvents])
  const deleteEvents = useCallback(async (ids: string[]) => {
    await commit(ids.map((id) => ({ operation: "delete", id })))
  }, [])
  const deleteEvent = useCallback(async (id: string) => deleteEvents([id]), [deleteEvents])
  const restoreEvents = useCallback(async (records: CalendarEvent[]) => {
    await commit(records.map((record) => ({ operation: "put", record: { ...record, deleted_at: null, updated_at: new Date().toISOString() } })))
  }, [])
  const restoreEvent = useCallback(async (record: CalendarEvent) => restoreEvents([record]), [restoreEvents])
  const updateAndDeleteEvents = useCallback(async (items: EventUpdate[], ids: string[]) => {
    const deleted = new Set(ids)
    await commit([
      ...items.filter((item) => !deleted.has(item.id)).map(updateMutation),
      ...ids.map((id): EventMutation => ({ operation: "delete", id })),
    ])
  }, [])
  const syncEvents = useCallback(async (itemsToCreate: EventInput[], itemsToUpdate: EventUpdate[]) => {
    const createdRecords = itemsToCreate.map(createEvent)
    const applied = await commit([
      ...itemsToUpdate.map(updateMutation),
      ...createdRecords.map((record): EventMutation => ({ operation: "put", record })),
    ])
    const createdIds = new Set(createdRecords.map((record) => record.id))
    return { created: applied.filter((record) => createdIds.has(record.id)), updated: applied.filter((record) => !createdIds.has(record.id)) }
  }, [])

  useEffect(() => {
    if (loading) return
    const markFinished = () => {
      const now = new Date().toISOString()
      const items = eventsRef.current.filter((event) => !event.isFinished && eventHasPassed(event))
      // Conditional patches cannot auto-finish an event rescheduled by a concurrent edit.
      void updateEvents(items.map((event) => ({ id: event.id, expectedRecord: event, updates: { isFinished: true, finishedAt: now } })))
        .catch((error: unknown) => console.error("Could not auto-finish events:", error))
    }
    markFinished()
    const interval = window.setInterval(markFinished, 60_000)
    return () => window.clearInterval(interval)
  }, [eventsRef, loading, updateEvents])

  return { events, loading, error, addEvent, addEvents, updateEvent, updateEvents, deleteEvent, deleteEvents, restoreEvent, restoreEvents, updateAndDeleteEvents, syncEvents, refresh }
}
