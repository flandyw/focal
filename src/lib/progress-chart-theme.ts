import { subjectColor } from "./studySubjects"

export const getSubjectColor = (subjectId: string): string => subjectColor(subjectId) ?? "var(--muted-foreground)"

export function getHeatColor(level: 0 | 1 | 2 | 3 | 4): string {
  return level === 0 ? "var(--muted)" : `color-mix(in oklch, var(--primary) ${level * 25}%, var(--card))`
}
