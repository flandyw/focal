import { getSubjectById } from "./progress-utils"

const SUBJECT_HUES: Record<string, number> = {
  eng: 15, "eng-lang": 265, lit: 335,
  mm: 250, sm: 305, gm: 190,
  csl: 45, pe: 125, chem: 80, phys: 285, bio: 155, psych: 355,
  hist: 60, geo: 135, econ: 220, bm: 325,
}

export function getSubjectColor(subjectId: string): string {
  const subject = getSubjectById(subjectId)
  if (!subject) return "var(--muted-foreground)"
  const hue = SUBJECT_HUES[subject.id]
  const color = hue === undefined ? subject.color : `oklch(0.57 0.14 ${hue})`
  return `light-dark(oklch(from ${color} 0.57 0.14 h), oklch(from ${color} 0.76 0.12 h))`
}

export function getHeatColor(level: 0 | 1 | 2 | 3 | 4): string {
  return level === 0 ? "var(--muted)" : `color-mix(in oklch, var(--primary) ${level * 25}%, var(--card))`
}
