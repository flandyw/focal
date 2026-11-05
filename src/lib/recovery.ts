import { EMPTY_APP_DATA, migrateAppData, type AppData } from "./exam-data"
import { localDate } from "./learning-workspace"
import { openIndexedDb, requestResult, transactionDone } from "./outbox"
import { isDeleted, parseCanonicalStudySession, type CanonicalStudySession } from "./sync/sessionContract"
import { downloadExamFile } from "./host"

export type RecoveryEntry = {
  id: string
  owner: string
  kind: "backup" | "deleted"
  label: string
  createdAt: string
  data: AppData
  sessions: CanonicalStudySession[]
  sessionIds: Record<string, string>
}

const openRecovery = () => openIndexedDb("examtrack-recovery", 1, { entries: { keyPath: "id" } })

export async function listRecovery(owner: string): Promise<RecoveryEntry[]> {
  const transaction = (await openRecovery()).transaction("entries", "readonly")
  const entries = await requestResult(transaction.objectStore("entries").getAll() as IDBRequest<RecoveryEntry[]>)
  await transactionDone(transaction)
  return entries.filter((entry) => entry.owner === owner && (entry.kind === "backup" || Date.parse(entry.createdAt) >= Date.now() - 30 * 86_400_000)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export async function saveRecovery(owner: string, kind: RecoveryEntry["kind"], label: string, data: AppData, sessions: CanonicalStudySession[], daily = false): Promise<void> {
  const now = new Date()
  // The observer and pre-delete save share an ID, so one deletion leaves one recovery copy.
  const deletionKey = kind === "deleted" ? [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify({ data, sessions }))))].map((byte) => byte.toString(16).padStart(2, "0")).join("") : null
  const entry: RecoveryEntry = {
    id: deletionKey ? `${owner}:deleted:${deletionKey}` : daily ? `${owner}:daily:${localDate(now)}` : crypto.randomUUID(), owner, kind, label, createdAt: now.toISOString(),
    // Timers are live state. Restoring a backup must never restart a clock from yesterday.
    data: { ...data, activeExamTimer: undefined, activeSacTimer: undefined },
    sessions: sessions.filter((session) => !isDeleted(session)).map((session) => ({
      ...session,
      // Freeze open intervals at capture time so exporting and reimporting cannot add unworked hours.
      segments: session.segments.map((segment) => segment.ended_at ? segment : { ...segment, ended_at: new Date(Math.max(now.getTime(), Date.parse(segment.started_at) + 1)).toISOString() }),
      segment_started_at: null,
      paused_at: !session.completed && session.started_at ? now.toISOString() : session.paused_at,
    })),
    sessionIds: Object.fromEntries(sessions.map((session) => [session.id, crypto.randomUUID()])),
  }
  const transaction = (await openRecovery()).transaction("entries", "readwrite")
  const store = transaction.objectStore("entries")
  const entries = await requestResult(store.getAll() as IDBRequest<RecoveryEntry[]>)
  // ponytail: retain 14 backups and 100 deletion groups per account on this device; use server retention for cross-device history.
  if (!entries.some((saved) => saved.id === entry.id)) store.put(entry)
  const own = [...entries.filter((saved) => saved.owner === owner && saved.id !== entry.id), entry].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  let backups = 0, deletions = 0
  for (const saved of own) {
    const expired = saved.kind === "backup" ? ++backups > 14 : ++deletions > 100 || Date.parse(saved.createdAt) < now.getTime() - 30 * 86_400_000
    if (expired) store.delete(saved.id)
  }
  await transactionDone(transaction)
}

export async function deleteRecovery(owner: string, id: string): Promise<void> {
  const transaction = (await openRecovery()).transaction("entries", "readwrite")
  const store = transaction.objectStore("entries")
  const entry = await requestResult(store.get(id) as IDBRequest<RecoveryEntry | undefined>)
  if (entry?.owner === owner) store.delete(id)
  await transactionDone(transaction)
}

const missing = <T extends { id: string }>(before: T[], after: T[]) => {
  const ids = new Set(after.map((item) => item.id))
  return before.filter((item) => !ids.has(item.id))
}
const unarchived = <T extends { archivedAt?: string }>(items: T[]) => items.filter((item) => !item.archivedAt)

export function deletedSince(before: AppData, after: AppData, beforeSessions: CanonicalStudySession[], afterSessions: CanonicalStudySession[]) {
  const mistakes = missing(before.mistakes, after.mistakes)
  const deletedAttempts = missing(before.attempts, after.attempts)
  const parentIds = new Set(mistakes.map((mistake) => mistake.attemptId))
  const attempts = [...new Map([...deletedAttempts, ...before.attempts.filter((attempt) => parentIds.has(attempt.id))].map((attempt) => [attempt.id, attempt])).values()]
  const data: AppData = {
    ...EMPTY_APP_DATA, attempts, mistakes,
    sacRecords: missing(before.sacRecords, after.sacRecords),
    events: missing(before.events.filter((event) => !event.deleted_at), after.events.filter((event) => !event.deleted_at)),
    atarEstimates: missing(before.atarEstimates, after.atarEstimates),
    learning: { ...EMPTY_APP_DATA.learning,
      tasks: missing(unarchived(before.learning.tasks), unarchived(after.learning.tasks)),
      curriculumAreas: missing(unarchived(before.learning.curriculumAreas), unarchived(after.learning.curriculumAreas)),
      goals: missing(unarchived(before.learning.goals), unarchived(after.learning.goals)),
    },
  }
  const sessions = missing(beforeSessions.filter((session) => !isDeleted(session)), afterSessions.filter((session) => !isDeleted(session)))
  const count = deletedAttempts.length + mistakes.length + data.sacRecords.length + data.events.length + data.atarEstimates.length + data.learning.tasks.length + data.learning.curriculumAreas.length + data.learning.goals.length + sessions.length
  return count ? { data, sessions, count } : null
}

export function validateRecovery(value: unknown): RecoveryEntry {
  if (!value || typeof value !== "object") throw new Error("This is not a valid Focal recovery backup.")
  const entry = value as Partial<RecoveryEntry>
  if (typeof entry.id !== "string" || typeof entry.owner !== "string" || typeof entry.label !== "string" ||
    !["backup", "deleted"].includes(entry.kind ?? "") || typeof entry.createdAt !== "string" ||
    !Array.isArray(entry.sessions) || !entry.sessionIds || typeof entry.sessionIds !== "object") throw new Error("This is not a valid Focal recovery backup.")
  const data = migrateAppData(entry.data)
  const sessions = entry.sessions.map(parseCanonicalStudySession)
  if (!data || sessions.some((session) => !session || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(entry.sessionIds![session.id])) || !Number.isFinite(Date.parse(entry.createdAt))) throw new Error("This recovery copy could not be read. Export your current data and try another copy.")
  return { id: entry.id, owner: entry.owner, label: entry.label, kind: entry.kind as RecoveryEntry["kind"], createdAt: entry.createdAt, data, sessions: sessions as CanonicalStudySession[], sessionIds: entry.sessionIds }
}

export function downloadRecovery(entry: RecoveryEntry) {
  return downloadExamFile(new Blob([JSON.stringify({ format: "focal-recovery", ...entry }, null, 2)], { type: "application/json" }), `focal-backup-${entry.createdAt.replace(/[:.]/g, "-")}.json`)
}

export function replacementData(saved: AppData, current: AppData, now = new Date().toISOString()): AppData {
  const stamp = <T extends { updatedAt?: string }>(items: T[]) => items.map((item) => ({ ...item, updatedAt: now }))
  const restoreLearning = <T extends { id: string; updatedAt: string; archivedAt?: string }>(old: T[], live: T[]) => {
    const ids = new Set(old.map((item) => item.id))
    // Learning records merge by ID across clients; removed items need an archive marker.
    return [...stamp(old), ...live.filter((item) => !ids.has(item.id)).map((item) => ({ ...item, archivedAt: now, updatedAt: now }))]
  }
  return {
    ...saved, attempts: stamp(saved.attempts), mistakes: stamp(saved.mistakes), sacRecords: stamp(saved.sacRecords),
    subjectsUpdatedAt: now, sacRecordsUpdatedAt: now, trackedExamIdsUpdatedAt: now, completedExamIdsUpdatedAt: now, atarEstimatesUpdatedAt: now,
    learning: { ...saved.learning, tasks: restoreLearning(saved.learning.tasks, current.learning.tasks), goals: restoreLearning(saved.learning.goals, current.learning.goals), curriculumAreas: restoreLearning(saved.learning.curriculumAreas, current.learning.curriculumAreas), preferencesUpdatedAt: now, updatedAt: now },
    events: saved.events.map((event) => ({ ...event, updated_at: now })),
    examDifficulty: saved.examDifficulty ? { ...saved.examDifficulty, updatedAt: now } : undefined,
    examProgression: saved.examProgression ? { ...saved.examProgression, updatedAt: now } : undefined,
    activeExamTimer: current.activeExamTimer, activeSacTimer: current.activeSacTimer,
  }
}

export function restoreMissing(current: AppData, saved: AppData, now = new Date().toISOString()): AppData {
  const restore = <T extends { id: string; archivedAt?: string }>(live: T[], old: T[]) => {
    const active = new Set(unarchived(live).map((item) => item.id))
    const incoming = old.filter((item) => !item.archivedAt && !active.has(item.id)).map((item) => ({ ...item, archivedAt: undefined, updatedAt: now }))
    const ids = new Set(incoming.map((item) => item.id))
    return [...live.filter((item) => !ids.has(item.id)), ...incoming]
  }
  const attempts = restore(current.attempts, saved.attempts)
  const attemptIds = new Set(attempts.map((attempt) => attempt.id))
  return {
    ...current, attempts,
    mistakes: restore(current.mistakes, saved.mistakes.filter((mistake) => !mistake.attemptId || attemptIds.has(mistake.attemptId))),
    sacRecords: restore(current.sacRecords, saved.sacRecords), sacRecordsUpdatedAt: now,
    atarEstimates: restore(current.atarEstimates, saved.atarEstimates), atarEstimatesUpdatedAt: now,
    events: restore(current.events.filter((event) => !event.deleted_at), saved.events).map((event) => current.events.some((item) => item.id === event.id && !item.deleted_at) ? event : { ...event, deleted_at: null, updated_at: now }),
    learning: { ...current.learning,
      tasks: restore(current.learning.tasks, saved.learning.tasks),
      goals: restore(current.learning.goals, saved.learning.goals),
      curriculumAreas: restore(current.learning.curriculumAreas, saved.learning.curriculumAreas), updatedAt: now,
    },
  }
}

export function recoveryCounts(data: AppData) {
  return { exams: data.attempts.length, mistakes: data.mistakes.length, SACs: data.sacRecords.length, events: data.events.filter((event) => !event.deleted_at).length,
    tasks: unarchived(data.learning.tasks).length, skills: unarchived(data.learning.curriculumAreas).length, goals: unarchived(data.learning.goals).length, estimates: data.atarEstimates.length }
}

export function recoverySessionCandidates(entry: RecoveryEntry, current: CanonicalStudySession[]) {
  const existing = new Set(current.filter((session) => !isDeleted(session)).flatMap((session) => [session.id, typeof session.metadata.recoveredFrom === "string" ? session.metadata.recoveredFrom : session.id]))
  return entry.sessions.filter((session) => !existing.has(session.id) && !existing.has(entry.sessionIds[session.id]))
}
