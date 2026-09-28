export function getExamTarget(id: string) {
  return `exam-${encodeURIComponent(id)}`
}

export function getExamIdFromHash(hash: string) {
  if (!hash.startsWith("#exam-")) return null
  try {
    return decodeURIComponent(hash.slice(6))
  } catch {
    return null
  }
}
