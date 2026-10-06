const key = (subject: string) => subject.trim().toLowerCase()

export function isPreferredSubject(subject: string, preferredSubjects: string[]) {
  const subjectKey = key(subject)
  return preferredSubjects.some((preferred) => key(preferred) === subjectKey)
}

export function prioritiseSubjects(subjects: string[], preferredSubjects: string[]) {
  const priorities = new Map(preferredSubjects.map((subject, index) => [key(subject), index]))
  return [...new Set(subjects)].toSorted((first, second) =>
    (priorities.get(key(first)) ?? Infinity) - (priorities.get(key(second)) ?? Infinity) ||
    first.localeCompare(second),
  )
}

export function firstPreferredSubject(subjects: string[], preferredSubjects: string[]) {
  return prioritiseSubjects(subjects, preferredSubjects).find((subject) => isPreferredSubject(subject, preferredSubjects)) ?? ""
}
