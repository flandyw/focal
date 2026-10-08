import { VCE_SUBJECTS, type Subject } from "./types"

/** Match exact identities only: e.g. English Language must never become English. */
function studySubjectId(value: string, subjects: readonly Subject[] = VCE_SUBJECTS): string {
  const key = value.trim().toLowerCase()
  const name = key === "mathematical methods cas" ? "mathematical methods" : key
  return subjects.find((subject) => [subject.id, subject.name, subject.shortCode]
    .some((alias) => alias.toLowerCase() === name))?.id ?? value
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
  if (known) return known.color
  let hash = 0
  for (const char of id.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return `hsl(${hash % 360} 65% 42%)`
}
