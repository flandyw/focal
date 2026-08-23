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

export interface RecentDownloadCandidate {
  name: string
  modifiedAt: number
}

const INCOMPLETE_DOWNLOAD_SUFFIX = /\.(crdownload|download|part)$/i

export function selectRecentDownloads<T extends RecentDownloadCandidate>(files: T[], limit = 8): T[] {
  return files
    .filter((file) => !file.name.startsWith(".") && !INCOMPLETE_DOWNLOAD_SUFFIX.test(file.name))
    .sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name))
    .slice(0, Math.max(0, limit))
}

export function filterRecentDownloads<T extends RecentDownloadCandidate>(
  files: T[],
  query: string,
): T[] {
  const normalized = query.trim().toLocaleLowerCase()
  return normalized
    ? files.filter((file) => file.name.toLocaleLowerCase().includes(normalized))
    : files
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
