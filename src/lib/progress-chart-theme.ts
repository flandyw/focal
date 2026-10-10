import { getSubjectById } from "./progress-utils"

export function getSubjectColor(subjectId: string): string {
  const subject = getSubjectById(subjectId)
  return subject?.color ?? "var(--chart-2)"
}

export function getHeatColor(level: 0 | 1 | 2 | 3 | 4): string {
  return level === 0 ? "var(--muted)" : `color-mix(in oklch, var(--primary) ${level * 25}%, var(--card))`
}
