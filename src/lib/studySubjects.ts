import { VCE_SUBJECTS, type Subject } from "./types.js"

/** Match exact identities only: e.g. English Language must never become English. */
export function studySubjectId(value: string, subjects: readonly Subject[] = VCE_SUBJECTS): string {
  const key = value.trim().toLowerCase()
  const name = key === "mathematical methods cas" ? "mathematical methods" : key
  return subjects.find((subject) => [subject.id, subject.name, subject.shortCode]
    .some((alias) => alias.toLowerCase() === name))?.id ?? value
}

export function sameStudySubject(first: string | null | undefined, second: string) {
  return !!first?.trim() && studySubjectId(first).trim().toLowerCase() === studySubjectId(second).trim().toLowerCase()
}

export function studySubjectOptions(names: string[], subjects: readonly Subject[] = VCE_SUBJECTS) {
  const options = new Map<string, { id: string; name: string }>()
  for (const name of names) {
    if (!name.trim()) continue
    const id = studySubjectId(name, subjects)
    options.set(id, { id, name: subjects.find((subject) => subject.id === id)?.name ?? name })
  }
  return [...options.values()]
}

/** Every subject gets a colour: the VCE list's own, or a stable one derived from the name for anything else. */
export function subjectColor(subjectId: string | null | undefined, subjects: readonly Subject[] = VCE_SUBJECTS): string | undefined {
  if (!subjectId) return undefined
  const id = studySubjectId(subjectId, subjects)
  const known = subjects.find((subject) => subject.id === id)
  let hash = 0
  for (const char of id.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  const colour = known?.color ?? `hsl(${hash % 360} 65% 42%)`
  return `light-dark(oklch(from ${colour} 0.48 0.12 h), oklch(from ${colour} 0.78 0.10 h))`
}
