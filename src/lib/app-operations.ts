import { recordMistakeReview, reduceMistakeReviews, type AppData, type ExamAttempt, type Mistake, type PracticeContext, type ReviewRating } from "./exam-data.js"
import type { SacRecord } from "./sac.js"
import { materialiseTask, type TaskDraft } from "./learning-workspace.js"

// Pure AppData operations shared by the app and the MCP server, so both write the same records the same way.

const upsert = <T extends { id: string }>(items: T[], item: T) =>
  items.some((existing) => existing.id === item.id) ? items.map((existing) => existing.id === item.id ? item : existing) : [...items, item]

export function recordAttemptResult(data: AppData, attempt: ExamAttempt): AppData {
  return { ...data, attempts: upsert(data.attempts, attempt) }
}

export function saveSacRecord(data: AppData, record: SacRecord, at: string): AppData {
  return { ...data, sacRecords: upsert(data.sacRecords, record), sacRecordsUpdatedAt: at }
}

export function deleteSacRecord(data: AppData, id: string, at: string): AppData {
  return { ...data, sacRecords: data.sacRecords.filter((record) => record.id !== id), sacRecordsUpdatedAt: at }
}

export function setExamFlag(data: AppData, list: "tracked" | "completed", id: string, on: boolean, at: string): AppData {
  const toggle = (ids: string[]) => on ? [...new Set([...ids, id])] : ids.filter((value) => value !== id)
  return list === "tracked"
    ? { ...data, trackedExamIds: toggle(data.trackedExamIds), trackedExamIdsUpdatedAt: at }
    : { ...data, completedExamIds: toggle(data.completedExamIds), completedExamIdsUpdatedAt: at }
}

export function saveMistakes(data: AppData, mistakes: Mistake[]): AppData {
  return { ...data, mistakes: mistakes.reduce(upsert, data.mistakes) }
}

export function reviewMistake(data: AppData, id: string, rating: ReviewRating, completedAt: string, context: PracticeContext = {}): AppData {
  return { ...data, mistakes: data.mistakes.map((item) => item.id === id ? recordMistakeReview(item, rating, completedAt, data.mistakeReviewPreferences, data.mistakes, context) : item) }
}

export function setMistakesSuspended(data: AppData, ids: string[], suspended: boolean, at: string): AppData {
  const selected = new Set(ids)
  return { ...data, mistakes: data.mistakes.map((mistake) => selected.has(mistake.id) ? { ...mistake, suspended, updatedAt: at } : mistake) }
}

/** Spreads due reviews over the next `days` so at most `target` fall on each; `scope` limits which cards may move. */
export function postponeReviews(data: AppData, days: number, target: number, now: number, scope: Mistake[] = data.mistakes): AppData {
  const changes = reduceMistakeReviews(scope, days, target, now)
  const updatedAt = new Date(now).toISOString()
  return { ...data, mistakes: data.mistakes.map((mistake) => changes.has(mistake.id) ? { ...mistake, dueAt: changes.get(mistake.id)!, updatedAt } : mistake) }
}

/** Adds drafted tasks, skipping any whose source already has a live task. */
export function addPlannedTasks(data: AppData, drafts: TaskDraft[], now = new Date()): AppData {
  const existing = new Set(data.learning.tasks.filter((task) => !task.archivedAt).map((task) => task.sourceId))
  const tasks = drafts.filter((draft) => !existing.has(draft.sourceId)).map((draft) => materialiseTask({ ...draft, title: draft.title.trim() }, now))
  return { ...data, learning: { ...data.learning, tasks: [...data.learning.tasks, ...tasks], updatedAt: now.toISOString() } }
}
