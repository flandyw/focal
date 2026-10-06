import { useCallback, useEffect, useRef } from "react"
import type { CalendarEvent, StudySession, StudySessionDraft, StudyTimeRange } from "@/lib/types"
import { generateId } from "@/lib/utils"
import { usePersistedData } from "@/lib/hooks/usePersistedData"
import { useLatestRef } from "@/lib/hooks/useLatestRef"
import { rememberDuplicateNotionPages } from "@/lib/sync/engine"
import { createStudySession, normalizeStudySession, updateStudySession, type CreateStudySessionInput } from "@/lib/studySessions"
import { repairDuplicateSessions } from "@/lib/sync/sessions"
import { commitEventConversion, commitSessionChanges, repairStudySessionDuplicates, type SessionUpdate } from "@/lib/storage/sessionMutations"

export function useStudySessions() {
  const duplicateIdsRef = useRef<string[]>([])
  const duplicateNotionPageIdsRef = useRef<string[]>([])
  const { data: sessions, loading, error, refresh } = usePersistedData({
    kind: "study_sessions",
    normalize: normalizeStudySession,
    onLoad: (normalised) => {
      const repair = repairDuplicateSessions(normalised)
      duplicateIdsRef.current = repair.duplicateIds
      duplicateNotionPageIdsRef.current = repair.duplicateNotionPageIds
      // A cancelled server row syncs back as a record with deleted_at set; hide it like events and projects.
      return repair.sessions.filter((session) => !session.deleted_at)
    },
  })
  const sessionsRef = useLatestRef(sessions)

  useEffect(() => {
    if (loading || !duplicateIdsRef.current.length) return
    const ids = duplicateIdsRef.current
    const pages = duplicateNotionPageIdsRef.current
    duplicateIdsRef.current = []
    duplicateNotionPageIdsRef.current = []
    void repairStudySessionDuplicates().then((committedPages) => rememberDuplicateNotionPages(committedPages))
      .catch((error: unknown) => {
        duplicateIdsRef.current = ids
        duplicateNotionPageIdsRef.current = pages
        console.error("Could not persist duplicate session repair:", error)
      })
  }, [loading, sessions])

  const addSession = useCallback(async (input: CreateStudySessionInput) => {
    const session = createStudySession(generateId(), input)
    await commitSessionChanges([{ record: session }])
    return session
  }, [])
  const convertEventToSession = useCallback(async (event: CalendarEvent, input: CreateStudySessionInput) => (
    commitEventConversion(event, createStudySession(generateId(), input))
  ), [])
  const addSessions = useCallback(async (items: {
    projectId?: string; subjectIds: string[]; title: string; startTime: string; endTime: string
    description?: string; topics?: string[]; notes?: string; activeDurations?: StudyTimeRange[]
  }[]) => {
    const now = new Date().toISOString()
    const records = items.map((item) => createStudySession(generateId(), {
      projectId: item.projectId, subjectIds: item.subjectIds, title: item.title,
      description: item.description, topics: item.topics,
      schedule: { blocks: item.activeDurations?.length ? item.activeDurations : [{ start: item.startTime, end: item.endTime }] },
      reflection: item.notes ? { notes: item.notes } : undefined, createdVia: "planner",
    }, now))
    return commitSessionChanges(records.map((record) => ({ record })))
  }, [])
  const updateSessions = useCallback(async (items: SessionUpdate[]) => {
    await commitSessionChanges([], items)
  }, [])
  const updateSession = useCallback(async (id: string, updates: SessionUpdate["updates"]) => {
    await updateSessions([{ id, updates }])
  }, [updateSessions])
  const deleteSessions = useCallback(async (ids: string[]) => {
    await commitSessionChanges([], [], ids, sessionsRef.current)
  }, [sessionsRef])
  const deleteSession = useCallback(async (id: string) => deleteSessions([id]), [deleteSessions])
  const restoreSessions = useCallback(async (records: StudySession[]) => {
    await commitSessionChanges(records.map((session) => ({ record: updateStudySession(session, { deleted_at: null }) })))
  }, [])
  const restoreSession = useCallback(async (session: StudySession) => restoreSessions([session]), [restoreSessions])
  const restoreMergedSessions = useCallback(async (records: StudySession[]) => {
    await commitSessionChanges(records.map((session) => ({ record: updateStudySession(session, { deleted_at: null }), replace: true })))
  }, [])
  const updateAndDeleteSessions = useCallback(async (items: SessionUpdate[], ids: string[]) => {
    await commitSessionChanges([], items, ids, sessionsRef.current)
  }, [sessionsRef])
  const syncSessions = useCallback(async (itemsToCreate: StudySessionDraft[], itemsToUpdate: SessionUpdate[]) => {
    const now = new Date().toISOString()
    const records = itemsToCreate.map((item) => normalizeStudySession({ ...item, id: item.id ?? generateId(), created_at: now, updated_at: now }))
    const applied = await commitSessionChanges(records.map((record) => ({ record })), itemsToUpdate)
    const createdIds = new Set(records.map((record) => record.id))
    return { created: applied.filter((record) => createdIds.has(record.id)), updated: applied.filter((record) => !createdIds.has(record.id)) }
  }, [])
  const getSessionsByProject = useCallback((projectId: string) => sessions.filter((s) => s.projectId === projectId), [sessions])
  const getUpcomingSessions = useCallback((days = 7) => {
    const now = Date.now()
    const future = now + days * 24 * 60 * 60 * 1000
    return sessions.filter((s) => {
      const start = Date.parse(s.schedule.blocks[0].start)
      return start >= now && start <= future && s.execution.state === "planned"
    }).sort((a, b) => Date.parse(a.schedule.blocks[0].start) - Date.parse(b.schedule.blocks[0].start))
  }, [sessions])

  return { sessions, loading, error, addSession, addSessions, convertEventToSession, updateSession, updateSessions, deleteSession, deleteSessions, restoreSession, restoreSessions, restoreMergedSessions, updateAndDeleteSessions, syncSessions, getSessionsByProject, getUpcomingSessions, refresh }
}
