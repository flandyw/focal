import type { AppData } from "./exam-data"
import { EMPTY_LEARNING_WORKSPACE } from "./learning-workspace"

export const TIMETABLE_ROW = "timetable_config"
export const EPOCH = "1970-01-01T00:00:00.000Z"

export type Entity = "attempts" | "mistakes" | "user_state" | "events" | "timetable_config"
type Operation = "put" | "delete"
export type AppRow = { entity: Entity; rowId: string; operation: Operation; payload: unknown }

const logicalKey = (entity: string, rowId: string) => `${entity}:${rowId}`

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The synced row layout of AppData; shared by the web client and the MCP server so both write identical rows. */
export function rowsFromAppData(data: AppData): AppRow[] {
  const rows: AppRow[] = [
    ...data.attempts.map((item) => ({ entity: "attempts" as const, rowId: item.id, operation: "put" as const, payload: item })),
    ...data.mistakes.map((item) => ({ entity: "mistakes" as const, rowId: item.id, operation: "put" as const, payload: item })),
    ...data.events.map((item) => ({ entity: "events" as const, rowId: item.id, operation: "put" as const, payload: item })),
  ]
  if (data.classTimetable) rows.push({ entity: "timetable_config", rowId: TIMETABLE_ROW, operation: "put", payload: data.classTimetable })
  const state: Array<[string, unknown, string]> = [
    ["examProgression", data.examProgression, data.examProgression?.updatedAt ?? EPOCH],
    ["trackedExamIds", data.trackedExamIds, data.trackedExamIdsUpdatedAt],
    ["completedExamIds", data.completedExamIds, data.completedExamIdsUpdatedAt],
    ["subjects", data.subjects, data.subjectsUpdatedAt],
    ["sacRecords", data.sacRecords, data.sacRecordsUpdatedAt],
    ["mistakeInsights", data.mistakeInsights, data.mistakeInsights?.questionsGeneratedAt ?? data.mistakeInsights?.generatedAt ?? EPOCH],
    ["alternativeMistakeDeck", data.alternativeMistakeDeck, data.alternativeMistakeDeck?.updatedAt ?? EPOCH],
    ["mistakeReviewPreferences", data.mistakeReviewPreferences, data.mistakeReviewPreferences?.updatedAt ?? EPOCH],
    ["examDifficulty", data.examDifficulty, data.examDifficulty?.updatedAt ?? EPOCH],
    ["atarEstimates", data.atarEstimates, data.atarEstimatesUpdatedAt],
    ["learning", data.learning, data.learning.updatedAt],
  ]
  for (const [rowId, value, updatedAt] of state) {
    if (value === undefined || value === null || (updatedAt === EPOCH && isDefaultValue(value))) continue
    rows.push({ entity: "user_state", rowId, operation: "put", payload: { value, updated_at: updatedAt } })
  }
  return rows
}

function isDefaultValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0
  return sameValue(value, EMPTY_LEARNING_WORKSPACE)
}

export function sameValue(first: unknown, second: unknown): boolean {
  if (Object.is(first, second)) return true
  if (Array.isArray(first) || Array.isArray(second)) {
    return Array.isArray(first) && Array.isArray(second) && first.length === second.length && first.every((value, index) => sameValue(value, second[index]))
  }
  if (!isRecord(first) || !isRecord(second)) return false
  const firstKeys = Object.keys(first)
  return firstKeys.length === Object.keys(second).length && firstKeys.every((key) => Object.hasOwn(second, key) && sameValue(first[key], second[key]))
}

export function diffAppData(previous: AppData, next: AppData): AppRow[] {
  const before = new Map(rowsFromAppData(previous).map((row) => [logicalKey(row.entity, row.rowId), row]))
  const after = new Map(rowsFromAppData(next).map((row) => [logicalKey(row.entity, row.rowId), row]))
  const changes: AppRow[] = []
  for (const [key, oldRow] of before) {
    const newRow = after.get(key)
    if (!newRow) changes.push({ ...oldRow, operation: "delete", payload: null })
    else if (!sameValue(oldRow.payload, newRow.payload)) changes.push(newRow)
  }
  for (const [key, row] of after) if (!before.has(key)) changes.push(row)
  return changes
}
