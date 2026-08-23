import type { Project, Subject } from "@/lib/types"

export interface AcademicInboxItem {
  id: string
  kind: "file" | "note"
  name: string
  path?: string
  content?: string
  createdAt: string
  suggestedProjectId?: string
}
function tokens(value: string): string[] {
  return value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length >= 2)
}

export function suggestInboxProject(value: string, projects: Project[], subjects: Subject[]): string | undefined {
  const input = new Set(tokens(value))
  let best: { id: string; score: number } | undefined
  for (const project of projects) {
    if (project.isArchived || project.isFinished) continue
    const subject = subjects.find((candidate) => candidate.id === project.subjectId)
    const terms = [project.name, project.folder_path, subject?.name ?? "", subject?.shortCode ?? ""].flatMap(tokens)
    const score = terms.reduce((sum, term) => sum + (input.has(term) ? (term.length >= 4 ? 2 : 1) : 0), 0)
    if (score > 0 && (!best || score > best.score)) best = { id: project.id, score }
  }
  return best?.id
}
