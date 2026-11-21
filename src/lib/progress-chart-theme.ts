import { subjectColor } from "./studySubjects"

export const getSubjectColor = (subjectId: string): string => subjectColor(subjectId) ?? "var(--muted-foreground)"

export function getHeatColor(level: 0 | 1 | 2 | 3 | 4): string {
  return level === 0 ? "var(--muted)" : `color-mix(in oklch, var(--primary) ${level * 25}%, var(--card))`
}

/** Heat level for a day's study time: none, under 1h, 1–2h, 2–4h, 4h or more. */
export const heatLevel = (ms: number) => (ms <= 0 ? 0 : ms < 3_600_000 ? 1 : ms < 7_200_000 ? 2 : ms < 14_400_000 ? 3 : 4) as 0 | 1 | 2 | 3 | 4
