import type { StudySession } from "@/lib/types"
import { getSubjectById } from "@/lib/utils"

export const POMODORO_DESCRIPTION_PREFIX = "Pomodoro —"
const LEGACY_POMODORO_DESCRIPTION = "Started from the Pomodoro timer."
const LEGACY_POMODORO_NOTES = "Focus block logged from the sidebar timer."

export function isPomodoroSession(session: StudySession) {
  return session.execution.intervals.some((interval) => interval.source === "pomodoro") || (typeof session.description === "string" && (
    session.description.startsWith(POMODORO_DESCRIPTION_PREFIX)
    || session.description === LEGACY_POMODORO_DESCRIPTION
  )) || session.reflection?.notes === LEGACY_POMODORO_NOTES
}

export function getPomodoroDescription(durationMinutes: number) {
  return `${POMODORO_DESCRIPTION_PREFIX} ${durationMinutes}m focused study`
}

export function getPomodoroTitle(subjectIds: string[], projectName?: string) {
  const labels = subjectIds
    .map((id) => getSubjectById(id)?.shortCode ?? getSubjectById(id)?.name)
    .filter((label): label is string => Boolean(label))

  const subjectPart = labels.length === 0
    ? "Pomodoro"
    : labels.length === 1
      ? labels[0]
      : labels.slice(0, 2).join(" + ")

  const prefix = projectName ? `${projectName} — ` : ""
  return `${prefix}${subjectPart} · Focus`
}

export function getUniqueStrings(items: (string | undefined)[]) {
  return Array.from(new Set(items.map((item) => item?.trim()).filter((item): item is string => Boolean(item))))
}

export function getUniqueArrayItems(items: (string[] | undefined)[]) {
  return Array.from(new Set(items.flatMap((item) => item ?? []).map((item) => item.trim()).filter(Boolean)))
}
