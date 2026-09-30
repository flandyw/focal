import { VCE_SUBJECTS, type Subject } from "./types"

/** Match exact identities only: e.g. English Language must never become English. */
export function studySubjectId(value: string, subjects: readonly Subject[] = VCE_SUBJECTS): string {
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
