import { invoke } from "@tauri-apps/api/core"
import type { CalendarEvent, StudySession } from "@/lib/types"
import { normalizeStudySession, updateStudySession } from "@/lib/studySessions"
import { repairDuplicateSessions, sessionDeletionIds } from "@/lib/sync/sessions"
import { mutationAccountId, notifyCommittedPlanningChanges } from "@/lib/sync/engine"
import { getNotionCalendarSettings } from "@/lib/settings"
import { stableJsonStringify } from "@/lib/utils"
import { ensureRecordImport, readRecordRows, withWriteLock } from "@/lib/storage/database"
import { emitLocalDataChanged } from "@/lib/sync/localData"

export interface SessionUpdate {
  id: string
  updates: Partial<Omit<StudySession, "id" | "created_at">>
  expectedRecord?: StudySession
}
interface SessionPut { record: StudySession; replace?: boolean }
type NativeMutation =
  | { operation: "put"; record: StudySession; expected?: string }
  | { operation: "delete"; id: string }

export async function commitSessionChanges(
  puts: SessionPut[], updates: SessionUpdate[] = [], ids: string[] = [], visible: StudySession[] = [],
): Promise<StudySession[]> {
  if (!puts.length && !updates.length && !ids.length) return []
  const expectedAccountId = mutationAccountId()
  await ensureRecordImport("study_sessions")
  const raw = await withWriteLock("study_sessions", async () => {
    // ponytail: deletion aliases require a scan; updates read only their requested rows.
    // Index integration IDs if this scan becomes material for very large histories.
    const wanted = [...new Set([...puts.map(({ record }) => record.id), ...updates.map(({ id }) => id)])]
    const rows = await readRecordRows("study_sessions", ids.length ? undefined : wanted)
    const byId = new Map(rows.map((row) => [row.id, row.payload]))
    const current = rows.map((row) => normalizeStudySession(JSON.parse(row.payload)))
    const deleted = new Set(visible.length ? sessionDeletionIds(current, visible, ids) : ids)
    const mutations: NativeMutation[] = updates.flatMap((item) => {
      const payload = byId.get(item.id)
      if (!payload || deleted.has(item.id)) return []
      const record = normalizeStudySession(JSON.parse(payload))
      if (item.expectedRecord && stableJsonStringify(record) !== stableJsonStringify(item.expectedRecord)) return []
      return [{ operation: "put", record: updateStudySession(record, item.updates), expected: payload }]
    })
    mutations.push(...puts.filter(({ record }) => !deleted.has(record.id)).map(({ record, replace }): NativeMutation => ({
      operation: "put", record, expected: replace ? byId.get(record.id) : undefined,
    })), ...[...deleted].map((id): NativeMutation => ({ operation: "delete", id })))
    return invoke<unknown[]>("mutate_sessions", { mutations, expectedAccountId, dataSourceId: getNotionCalendarSettings().dataSourceId })
  })
  notifyCommittedPlanningChanges(["study_sessions"])
  return raw.map(normalizeStudySession)
}

// Whole-dataset replacement is an import boundary, never a normal mutation path.
export async function restoreStudySessionBackup(raw: unknown[]): Promise<void> {
  const expectedAccountId = mutationAccountId()
  await ensureRecordImport("study_sessions")
  const records = raw.map(normalizeStudySession)
  await withWriteLock("study_sessions", async () => {
    const rows = await readRecordRows("study_sessions")
    const byId = new Map(rows.map((row) => [row.id, row.payload]))
    const restored = new Set(records.map((record) => record.id))
    await invoke("mutate_sessions", {
      mutations: [
        ...records.map((record) => ({ operation: "put", record, expected: byId.get(record.id) })),
        ...rows.filter((row) => !restored.has(row.id)).map(({ id }) => ({ operation: "delete", id })),
      ],
      expectedAccountId,
      dataSourceId: getNotionCalendarSettings().dataSourceId,
    })
  })
  notifyCommittedPlanningChanges(["study_sessions"])
}

export async function repairStudySessionDuplicates(wake = true): Promise<string[]> {
  const expectedAccountId = mutationAccountId()
  await ensureRecordImport("study_sessions")
  const pages = await withWriteLock("study_sessions", async () => {
    const rows = await readRecordRows("study_sessions")
    const repair = repairDuplicateSessions(rows.map((row): unknown => JSON.parse(row.payload)))
    if (!repair.duplicateIds.length) return []
    const byId = new Map(rows.map((row) => [row.id, row.payload]))
    await invoke("mutate_sessions", {
      mutations: [
        ...repair.sessions.map((record) => ({ operation: "put", record, expected: byId.get(record.id) })),
        ...repair.duplicateIds.map((id) => ({ operation: "delete", id })),
      ],
      expectedAccountId,
      dataSourceId: getNotionCalendarSettings().dataSourceId,
    })
    return repair.duplicateNotionPageIds
  })
  if (wake) notifyCommittedPlanningChanges(["study_sessions"])
  else emitLocalDataChanged("study_sessions")
  return pages
}

export async function commitEventConversion(event: CalendarEvent, session: StudySession): Promise<StudySession> {
  const expectedAccountId = mutationAccountId()
  await Promise.all([ensureRecordImport("events"), ensureRecordImport("study_sessions")])
  const raw = await withWriteLock("events", () => withWriteLock("study_sessions", () => invoke<unknown[]>("mutate_sessions", {
    mutations: [],
    conversion: { eventId: event.id, expectedEvent: event, session },
    expectedAccountId,
    dataSourceId: getNotionCalendarSettings().dataSourceId,
  })))
  notifyCommittedPlanningChanges(["events", "study_sessions"])
  return normalizeStudySession(raw[0])
}
