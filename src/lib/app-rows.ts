import { EMPTY_APP_DATA, isTimetableConfig, migrateAppData, migrateCalendarEvents, normalizeMistakeReviewPreferences, type AppData } from "./exam-data.js"
import { isExamDifficultySettings } from "./exam-difficulty.js"
import { isExamProgression } from "./exam-progression.js"
import { EMPTY_LEARNING_WORKSPACE, migrateLearningWorkspace } from "./learning-workspace.js"
import { migrateSacRecords } from "./sac.js"
import { readSubjectCompletions } from "./subject-completion.js"

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
    ["completedSubjects", data.completedSubjects, data.completedSubjectsUpdatedAt],
    ["subjectCompletionYears", data.subjectCompletionYears, data.completedSubjectsUpdatedAt],
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

/** A row as the feed holds it; `seq` orders user_state rows (higher wins). */
export type FeedRow = { entity: string; rowId: string; operation: Operation; payload: unknown; seq: number }

const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : []

/**
 * The one projection from synced rows to AppData, shared by the app (feed + local outbox) and MCP.
 * `rows` must hold at most one row per entity/rowId. Fields the feed does not carry come from `base`.
 * An invalid attempt or mistake is skipped, not fatal, so one bad row from another client cannot stall sync.
 */
export function projectRows(rows: Iterable<FeedRow>, base: AppData = EMPTY_APP_DATA): { data: AppData; omitted: string[] } {
  const all = [...rows]
  const live = (entity: string) => all.filter((row) => row.entity === entity && row.operation === "put")
  const state = new Map<string, { value: unknown; updatedAt: string }>()
  for (const row of all.filter((item) => item.entity === "user_state").toSorted((a, b) => a.seq - b.seq)) {
    if (row.operation === "delete") { state.delete(row.rowId); continue }
    if (row.rowId === "user_state" && isRecord(row.payload)) {
      // Legacy aggregate row from before per-key rows.
      for (const [key, value] of Object.entries(row.payload)) {
        if (key.endsWith("UpdatedAt") || key === "activeExamTimer" || key === "activeSacTimer") continue
        const marker = row.payload[`${key}UpdatedAt`]
        state.set(key, { value, updatedAt: typeof marker === "string" ? marker : "" })
      }
    } else if (isRecord(row.payload) && "value" in row.payload) {
      state.set(row.rowId, { value: row.payload.value, updatedAt: typeof row.payload.updated_at === "string" ? row.payload.updated_at : "" })
    }
  }
  const value = (key: string) => state.get(key)?.value
  const stamp = (key: string) => state.get(key)?.updatedAt || EPOCH
  const omitted: string[] = []
  let migrated = migrateAppData({ ...EMPTY_APP_DATA, attempts: live("attempts").map((row) => row.payload), mistakes: live("mistakes").map((row) => row.payload) })
  if (!migrated) {
    // Slow path only when something is invalid: find and skip the offending rows.
    const attempts = live("attempts").flatMap((row) => {
      const valid = migrateAppData({ ...EMPTY_APP_DATA, attempts: [row.payload] })?.attempts
      if (!valid) omitted.push(`attempts:${row.rowId}`)
      return valid ?? []
    })
    const mistakes = live("mistakes").flatMap((row) => {
      const valid = migrateAppData({ ...EMPTY_APP_DATA, attempts, mistakes: [row.payload] })?.mistakes
      if (!valid) omitted.push(`mistakes:${row.rowId}`)
      return valid ?? []
    })
    migrated = migrateAppData({ ...EMPTY_APP_DATA, attempts, mistakes })
    if (!migrated) throw new Error("Synced attempts or mistakes failed validation")
  }
  const timetable = all.find((row) => row.entity === TIMETABLE_ROW && row.rowId === TIMETABLE_ROW)
  const progression = value("examProgression")
  const difficulty = value("examDifficulty")
  const reviewPreferences = value("mistakeReviewPreferences")
  const parsed = (patch: Partial<AppData>) => migrateAppData({ ...EMPTY_APP_DATA, ...patch })
  return { omitted, data: {
    ...base,
    attempts: migrated.attempts,
    mistakes: migrated.mistakes,
    events: migrateCalendarEvents(live("events").map((row) => row.payload)),
    classTimetable: timetable?.operation === "put" && isTimetableConfig(timetable.payload) ? timetable.payload : undefined,
    examProgression: isExamProgression(progression) ? progression : undefined,
    trackedExamIds: strings(value("trackedExamIds")), trackedExamIdsUpdatedAt: stamp("trackedExamIds"),
    completedExamIds: strings(value("completedExamIds")), completedExamIdsUpdatedAt: stamp("completedExamIds"),
    ...readSubjectCompletions({ subjects: value("completedSubjects"), years: value("subjectCompletionYears") }, stamp("completedSubjects")), completedSubjectsUpdatedAt: stamp("completedSubjects"),
    subjects: strings(value("subjects")), subjectsUpdatedAt: stamp("subjects"),
    sacRecords: migrateSacRecords(value("sacRecords")) ?? [], sacRecordsUpdatedAt: stamp("sacRecords"),
    mistakeInsights: parsed({ mistakeInsights: value("mistakeInsights") as AppData["mistakeInsights"] })?.mistakeInsights,
    alternativeMistakeDeck: parsed({ alternativeMistakeDeck: value("alternativeMistakeDeck") as AppData["alternativeMistakeDeck"] })?.alternativeMistakeDeck,
    mistakeReviewPreferences: isRecord(reviewPreferences) ? normalizeMistakeReviewPreferences(reviewPreferences) : undefined,
    examDifficulty: isExamDifficultySettings(difficulty) ? difficulty : undefined,
    atarEstimates: parsed({ atarEstimates: value("atarEstimates") as AppData["atarEstimates"] })?.atarEstimates ?? [], atarEstimatesUpdatedAt: stamp("atarEstimates"),
    learning: migrateLearningWorkspace(value("learning")),
  } }
}
