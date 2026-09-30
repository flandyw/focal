import type { CalendarEvent, EventType, StudySessionDraft } from "@/lib/types"
import { isRecord, safeString, safeStringOpt, safeBool, safeDateMeta, parseCalendarEventSource } from "@/lib/utils"

export function normaliseEvent(raw: unknown): CalendarEvent {
  const obj = isRecord(raw) ? raw : {}
  const types = ["sac", "exam", "assignment", "event", "homework", "other", "practice-sac"]
  return {
    id: safeString(obj, "id", `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`),
    title: safeString(obj, "title", "Untitled Event"),
    description: safeStringOpt(obj, "description"),
    startTime: safeString(obj, "startTime", new Date().toISOString()),
    endTime: safeStringOpt(obj, "endTime"),
    eventType: types.includes(String(obj.eventType)) ? obj.eventType as EventType : "event",
    subjectId: safeStringOpt(obj, "subjectId"), location: safeStringOpt(obj, "location"),
    isFinished: safeBool(obj, "isFinished", false), finishedAt: safeStringOpt(obj, "finishedAt"),
    source: parseCalendarEventSource(obj.source), ...safeDateMeta(obj),
  }
}

export function eventToStudySessionDraft(event: CalendarEvent): StudySessionDraft {
  const start = new Date(event.startTime).getTime()
  if (!Number.isFinite(start)) throw new Error("Event has an invalid start time")
  const end = event.endTime ? new Date(event.endTime).getTime() : start + 60 * 60_000
  if (!Number.isFinite(end) || end <= start) throw new Error("Event must end after it starts")
  return {
    title: event.title,
    description: [event.description, event.location ? `Location: ${event.location}` : undefined].filter(Boolean).join("\n\n") || undefined,
    subjectIds: event.subjectId ? [event.subjectId] : [],
    startTime: event.startTime,
    endTime: new Date(end).toISOString(),
    // ponytail: finished events do not prove actual study; completion stays an explicit choice.
    status: "planned",
  }
}

function instantKey(value?: string): string {
  if (!value) return ""
  const time = new Date(value).getTime()
  return Number.isNaN(time) ? value : String(time)
}

export function calendarEventFingerprint(
  event: Pick<CalendarEvent, "title" | "description" | "startTime" | "endTime" | "eventType" | "subjectId" | "location">,
): string {
  return [
    event.title.trim(),
    event.description?.trim() ?? "",
    instantKey(event.startTime),
    instantKey(event.endTime),
    event.eventType,
    event.subjectId ?? "",
    event.location?.trim() ?? "",
  ].join("\u0000")
}

function updatedAt(event: CalendarEvent): number {
  const value = new Date(event.updated_at ?? event.created_at ?? "").getTime()
  return Number.isNaN(value) ? 0 : value
}

export function dedupeCalendarEvents(events: CalendarEvent[]): {
  events: CalendarEvent[]
  duplicateIds: string[]
} {
  const byFingerprint = new Map<string, CalendarEvent>()
  const duplicateIds: string[] = []

  for (const event of events) {
    const fingerprint = calendarEventFingerprint(event)
    const existing = byFingerprint.get(fingerprint)
    if (!existing) {
      byFingerprint.set(fingerprint, event)
      continue
    }

    if (updatedAt(event) > updatedAt(existing)) {
      duplicateIds.push(existing.id)
      byFingerprint.set(fingerprint, event)
    } else {
      duplicateIds.push(event.id)
    }
  }

  const keptIds = new Set(Array.from(byFingerprint.values(), (event) => event.id))
  return {
    events: events.filter((event) => keptIds.has(event.id)),
    duplicateIds,
  }
}
