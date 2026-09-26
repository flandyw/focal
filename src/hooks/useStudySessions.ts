import { useCallback, useEffect, useRef } from "react"
import type { StudySession, StudySessionDraft, StudyTimeRange } from "@/lib/types"
import { generateId, stableJsonStringify } from "@/lib/utils"
import { usePersistedData } from "@/lib/hooks/usePersistedData"
import { useLatestRef } from "@/lib/hooks/useLatestRef"
import { recordLocalSoftDelete, recordLocalUpsert, rememberDuplicateNotionPages } from "@/lib/sync/engine"
import { createStudySession, normalizeStudySession, updateStudySession, type CreateStudySessionInput } from "@/lib/studySessions"
import { repairDuplicateSessions, sessionDeletionIds } from "@/lib/sync/sessions"
import { readPersistedArray } from "@/lib/storage/database"

export function useStudySessions() {
  const duplicateIdsRef = useRef<string[]>([])
  const duplicateNotionPageIdsRef = useRef<string[]>([])
  const { data: sessions, loading, error, save: saveSessions, mutate: mutateSessions, refresh } = usePersistedData({
    fileName: "sessions.json",
    normalize: normalizeStudySession,
    onLoad: (normalised) => {
      const repair = repairDuplicateSessions(normalised)
      duplicateIdsRef.current = repair.duplicateIds
      duplicateNotionPageIdsRef.current = repair.duplicateNotionPageIds
      return repair.sessions
    },
  })

  const sessionsRef = useLatestRef(sessions)

  useEffect(() => {
    if (loading || duplicateIdsRef.current.length === 0) return
    const duplicateIds = duplicateIdsRef.current
    const duplicateNotionPageIds = duplicateNotionPageIdsRef.current
    duplicateIdsRef.current = []
    duplicateNotionPageIdsRef.current = []
    void Promise.all(duplicateIds.map((id) => recordLocalSoftDelete("study_sessions", id))).then(async () => {
      await mutateSessions((current) => repairDuplicateSessions(current).sessions.filter((session) => !duplicateIds.includes(session.id)))
      await rememberDuplicateNotionPages(duplicateNotionPageIds)
    }).catch((error: unknown) => {
      duplicateIdsRef.current = duplicateIds
      duplicateNotionPageIdsRef.current = duplicateNotionPageIds
      console.error("Could not persist duplicate session repair:", error)
    })
  }, [loading, mutateSessions, sessions])

  const addSession = useCallback(async (input: CreateStudySessionInput) => {
    const session = createStudySession(generateId(), input)
    const updated = [...sessionsRef.current, session]
    await saveSessions(updated)
    await recordLocalUpsert("study_sessions", session)
    return session
  }, [sessionsRef, saveSessions])

  const addSessions = useCallback(async (items: {
    projectId?: string
    subjectIds: string[]
    title: string
    startTime: string
    endTime: string
    description?: string
    topics?: string[]
    notes?: string
    activeDurations?: StudyTimeRange[]
  }[]) => {
    const createdAt = new Date().toISOString()
    const newSessions = items.map((item) => createStudySession(generateId(), {
      projectId: item.projectId,
      subjectIds: item.subjectIds,
      title: item.title,
      description: item.description,
      topics: item.topics,
      schedule: { blocks: item.activeDurations?.length ? item.activeDurations : [{ start: item.startTime, end: item.endTime }] },
      reflection: item.notes ? { notes: item.notes } : undefined,
      createdVia: "planner",
    }, createdAt))
    const updated = [...sessionsRef.current, ...newSessions]
    await saveSessions(updated)
    await Promise.all(newSessions.map((session) => recordLocalUpsert("study_sessions", session)))
    return newSessions
  }, [sessionsRef, saveSessions])

  const updateSession = useCallback(async (
    id: string,
    updates: Partial<Omit<StudySession, "id" | "created_at">>
  ) => {
    const updated = await mutateSessions((current) => current.map((s) => s.id === id ? updateStudySession(s, updates) : s))
    const session = updated.find((item) => item.id === id)
    if (session) await recordLocalUpsert("study_sessions", session)
  }, [mutateSessions])

  const updateSessions = useCallback(async (
    items: { id: string; updates: Partial<Omit<StudySession, "id" | "created_at">> }[]
  ) => {
    if (items.length === 0) return
    const updateMap = new Map(items.map((item) => [item.id, item.updates]))
    const updated = sessionsRef.current.map((session) => {
      const updates = updateMap.get(session.id)
      return updates ? updateStudySession(session, updates) : session
    })
    await saveSessions(updated)
    await Promise.all(items.map(async (item) => {
      const session = updated.find((candidate) => candidate.id === item.id)
      if (session) await recordLocalUpsert("study_sessions", session)
    }))
  }, [sessionsRef, saveSessions])

  const deleteSessions = useCallback(async (ids: string[]) => {
    if (ids.length === 0) return
    const current = (await readPersistedArray("sessions.json")).map(normalizeStudySession)
    const targets = sessionDeletionIds(current, sessionsRef.current, ids)
    await Promise.all(targets.map((id) => recordLocalSoftDelete("study_sessions", id)))
    // Deletion and its outbox intent are already atomic in SQLite. Reload rather
    // than writing an old UI snapshot back over concurrent sync changes.
    await refresh()
  }, [refresh, sessionsRef])

  const deleteSession = useCallback((id: string) => deleteSessions([id]), [deleteSessions])

  const restoreSession = useCallback(async (session: StudySession) => {
    const exists = sessionsRef.current.some((s) => s.id === session.id)
    if (exists) return
    const restored = updateStudySession(session, { deleted_at: null })
    const updated = [...sessionsRef.current, restored]
    await saveSessions(updated)
    await recordLocalUpsert("study_sessions", restored)
  }, [sessionsRef, saveSessions])

  const restoreSessions = useCallback(async (sessionsToRestore: StudySession[]) => {
    const existingIds = new Set(sessionsRef.current.map((s) => s.id))
    const newSessions = sessionsToRestore.filter((s) => !existingIds.has(s.id))
    if (newSessions.length === 0) return
    const restoredSessions = newSessions.map((session) => updateStudySession(session, { deleted_at: null }))
    const updated = [...sessionsRef.current, ...restoredSessions]
    await saveSessions(updated)
    await Promise.all(restoredSessions.map((session) => recordLocalUpsert("study_sessions", session)))
  }, [sessionsRef, saveSessions])

  const restoreMergedSessions = useCallback(async (sessionsToRestore: StudySession[]) => {
    if (sessionsToRestore.length === 0) return
    const restoredSessions = sessionsToRestore.map((session) => updateStudySession(session, { deleted_at: null }))
    const restoredById = new Map(restoredSessions.map((session) => [session.id, session]))
    await mutateSessions((current) => {
      const currentIds = new Set(current.map((session) => session.id))
      return [
        ...current.map((session) => restoredById.get(session.id) ?? session),
        ...restoredSessions.filter((session) => !currentIds.has(session.id)),
      ]
    })
    await Promise.all(restoredSessions.map((session) => recordLocalUpsert("study_sessions", session)))
  }, [mutateSessions])

  const updateAndDeleteSessions = useCallback(async (
    items: { id: string; updates: Partial<Omit<StudySession, "id" | "created_at">> }[],
    ids: string[],
  ) => {
    if (items.length === 0 && ids.length === 0) return
    const updateMap = new Map(items.map((item) => [item.id, item.updates]))
    const deleteSet = new Set(ids)
    const updated = sessionsRef.current
      .filter((session) => !deleteSet.has(session.id))
      .map((session) => {
        const updates = updateMap.get(session.id)
        return updates ? updateStudySession(session, updates) : session
      })
    await Promise.all(ids.map((id) => recordLocalSoftDelete("study_sessions", id)))
    await saveSessions(updated)
    await Promise.all(items.map(async (item) => {
      const session = updated.find((candidate) => candidate.id === item.id)
      if (session) await recordLocalUpsert("study_sessions", session)
    }))
  }, [sessionsRef, saveSessions])

  const syncSessions = useCallback(async (
    itemsToCreate: StudySessionDraft[],
    itemsToUpdate: {
      id: string
      updates: Partial<Omit<StudySession, "id" | "created_at">>
      expectedRecord?: StudySession
    }[],
  ) => {
    const updateMap = new Map(itemsToUpdate.map((item) => [item.id, item.updates]))
    const expectedRecordMap = new Map(itemsToUpdate.flatMap((item) => (
      item.expectedRecord ? [[item.id, stableJsonStringify(item.expectedRecord)] as const] : []
    )))
    const createdAt = new Date().toISOString()
    const newSessions = itemsToCreate.map((item) => normalizeStudySession({
      ...item,
      id: item.id ?? generateId(),
      created_at: createdAt,
      updated_at: createdAt,
    }))
    const createdIds = new Set<string>()
    const appliedUpdateIds = new Set<string>()
    const updated = await mutateSessions((current) => {
      const existingIds = new Set(current.map((session) => session.id))
      const created = newSessions.filter((session) => {
        if (existingIds.has(session.id)) return false
        createdIds.add(session.id)
        return true
      })
      return [
        ...current.map((session) => {
          const updates = updateMap.get(session.id)
          const expectedRecord = expectedRecordMap.get(session.id)
          if (!updates || (expectedRecord && stableJsonStringify(session) !== expectedRecord)) return session
          appliedUpdateIds.add(session.id)
          return updateStudySession(session, updates, createdAt)
        }),
        ...created,
      ]
    })
    await Promise.all(itemsToUpdate.map(async (item) => {
      if (!appliedUpdateIds.has(item.id)) return
      const session = updated.find((candidate) => candidate.id === item.id)
      if (session) await recordLocalUpsert("study_sessions", session)
    }))
    const created = newSessions.filter((session) => createdIds.has(session.id))
    await Promise.all(created.map((session) => recordLocalUpsert("study_sessions", session)))
    return {
      created,
      updated: itemsToUpdate.flatMap((item) => {
        if (!appliedUpdateIds.has(item.id)) return []
        const session = updated.find((candidate) => candidate.id === item.id)
        return session ? [session] : []
      }),
    }
  }, [mutateSessions])

  const getSessionsByProject = useCallback((projectId: string) => {
    return sessions.filter((s) => s.projectId === projectId)
  }, [sessions])

  const getUpcomingSessions = useCallback((days = 7) => {
    const now = new Date()
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000)
    return sessions
      .filter((s) => {
        const startTime = new Date(s.startTime)
        return startTime >= now && startTime <= futureDate && s.status === "planned"
      })
      .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
  }, [sessions])

  return {
    sessions,
    loading,
    error,
    addSession,
    addSessions,
    updateSession,
    updateSessions,
    deleteSession,
    deleteSessions,
    restoreSession,
    restoreSessions,
    restoreMergedSessions,
    updateAndDeleteSessions,
    syncSessions,
    getSessionsByProject,
    getUpcomingSessions,
    refresh,
  }
}
