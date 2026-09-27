/**
 * Study sessions arrive as checkpoints from several clients, so the same sitting can
 * exist twice with different ids. These helpers fold them into one row and report the
 * duplicates as durable deletions, which is what keeps the log from growing a new row per
 * checkpoint.
 */
import { normalizeStudySession } from "@/lib/studySessions"
import type { StudySession } from "@/lib/types"

export interface SharedTimerNotice { title: string; body: string }

/** Only lifecycle changes deserve an alert; frequent timer checkpoints do not. */
export function sharedTimerNotice(previous: StudySession | undefined, next: StudySession | undefined): SharedTimerNotice | null {
  const session = next ?? previous
  const source = session?.integrations?.examtrack ?? session?.integrations?.folio
  if (!session || !source) return null
  const app = source.type === "examtrack" ? "ExamTrack" : "Folio"
  const body = session.title
  if (!next) return previous?.execution.state === "in-progress" ? { title: `${app} timer discarded`, body } : null
  if (next.execution.state === "completed") {
    return previous?.execution.state === "in-progress" ? { title: `${app} timer finished`, body } : null
  }
  if (next.execution.state !== "in-progress") return null
  if (previous?.execution.state !== "in-progress") return { title: `${app} timer started`, body }

  const running = (item: StudySession) => {
    if (item.execution.state !== "in-progress") return false
    const phase = item.integrations?.examtrack?.phase ?? item.integrations?.folio?.phase
    const intervals = item.execution.intervals
    const last = intervals[intervals.length - 1]
    return phase ? phase !== "paused" : Boolean(last && !last.end)
  }
  if (running(previous) !== running(next)) {
    return { title: `${app} timer ${running(next) ? "resumed" : "paused"}`, body }
  }
  const before = previous.integrations?.examtrack?.phase ?? previous.integrations?.folio?.phase
  const after = next.integrations?.examtrack?.phase ?? next.integrations?.folio?.phase
  return before === "reading" && after === "writing" ? { title: `${app} writing time started`, body } : null
}

export function sessionDeletionIds(sessions: StudySession[], selected: StudySession[], ids: string[]): string[] {
  const targets = new Set(ids)
  const keys = new Set([...sessions, ...selected].filter((session) => targets.has(session.id)).map(sessionDuplicateKey))
  return [...new Set([...ids, ...sessions.filter((session) => keys.has(sessionDuplicateKey(session))).map((session) => session.id)])]
}

export function repairDuplicateSessions(raw: unknown[]): {
  sessions: StudySession[]
  duplicateIds: string[]
  duplicateNotionPageIds: string[]
} {
  const sessions = raw.map(normalizeStudySession).filter((session) => !session.deleted_at)
  const canonical = new Map<string, StudySession>()
  const duplicateIds: string[] = []
  const duplicateNotionPageIds: string[] = []

  for (const session of sessions) {
    const fingerprint = sessionDuplicateKey(session)
    const existing = canonical.get(fingerprint)
    if (!existing) {
      canonical.set(fingerprint, session)
      continue
    }

    const existingKey = sessionSortKey(existing)
    const incomingKey = sessionSortKey(session)
    const keepExisting = existingKey > incomingKey || (existingKey === incomingKey && existing.id <= session.id)
    const kept = keepExisting ? existing : session
    const duplicate = keepExisting ? session : existing
    canonical.set(fingerprint, mergeDuplicateSessionDetails(kept, duplicate))
    duplicateIds.push(duplicate.id)
    if (duplicate.source?.type === "notion") duplicateNotionPageIds.push(duplicate.source.id)
  }

  const keptById = new Map([...canonical.values()].map((session) => [session.id, session]))
  return {
    sessions: sessions.flatMap((session) => keptById.has(session.id) ? [keptById.get(session.id)!] : []),
    duplicateIds,
    duplicateNotionPageIds,
  }
}

export function sessionDuplicateKey(session: StudySession): string {
  // Folio/ExamTrack updates keep a stable source id even when an older client generated
  // a new local row id for each checkpoint. Treat those rows as one logical sitting.
  // Notion page ids are intentionally not used here: two pages can legitimately describe
  // the same-looking study block and are repaired by the existing fingerprint instead.
  const source = session.integrations?.folio ?? session.integrations?.examtrack
  if (source) return `external:${source.type}:${source.id}`
  // ponytail: repair the old Folio/Notion identity-loss loop only with an exact
  // millisecond start and Folio provenance. New clients use source ids above.
  if (session.last_modified_device_id === "folio-android" &&
      /^(Study|Exam practice) in Folio(?: ·|$)/.test(session.description ?? "")) {
    return JSON.stringify(["legacy-folio", session.title.trim(), [...session.subjectIds].sort(), session.startTime])
  }
  return JSON.stringify({
    title: session.title.trim(),
    projectId: session.projectId ?? null,
    subjectIds: [...session.subjectIds].sort(),
    startTime: session.startTime,
    endTime: session.endTime,
    status: session.status,
  })
}

function mergeDuplicateSessionDetails(kept: StudySession, duplicate: StudySession): StudySession {
  const keptRaw = JSON.parse(JSON.stringify(kept)) as Record<string, unknown>
  const duplicateHasBetterTimeline = kept.execution.state !== "completed" && executionQuality(duplicate) > executionQuality(kept)
  return normalizeStudySession({
    ...keptRaw,
    description: kept.description ?? duplicate.description,
    topics: [...new Set([...(kept.topics ?? []), ...(duplicate.topics ?? [])])],
    integrations: { ...duplicate.integrations, ...kept.integrations },
    schedule: duplicateHasBetterTimeline ? duplicate.schedule : kept.schedule,
    execution: duplicateHasBetterTimeline ? duplicate.execution : kept.execution,
    reflection: {
      notes: kept.reflection?.notes ?? duplicate.reflection?.notes,
      confidence: kept.reflection?.confidence ?? duplicate.reflection?.confidence,
      blockers: kept.reflection?.blockers ?? duplicate.reflection?.blockers,
      nextAction: kept.reflection?.nextAction ?? duplicate.reflection?.nextAction,
    },
    created_at: kept.created_at <= duplicate.created_at ? kept.created_at : duplicate.created_at,
    updated_at: (kept.updated_at ?? kept.created_at) >= (duplicate.updated_at ?? duplicate.created_at)
      ? kept.updated_at
      : duplicate.updated_at,
  })
}

function executionQuality(session: StudySession): number {
  const detailedIntervals = session.execution.intervals.filter((interval) => interval.source !== "imported").length
  const stateScore = session.execution.state === "completed" ? 2 : session.execution.state === "in-progress" ? 1 : 0
  return detailedIntervals * 100 + session.execution.intervals.length * 10 + stateScore
}

function sessionSortKey(session: StudySession): string {
  const localRank = session.createdVia === "notion" ? "1" : "0"
  return `${localRank}:${session.updated_at ?? session.created_at}:${session.created_at}`
}
