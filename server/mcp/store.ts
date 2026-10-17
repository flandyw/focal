import { readFile } from "node:fs/promises"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { diffAppData, TIMETABLE_ROW } from "../../src/lib/app-rows"
import { EMPTY_APP_DATA, isTimetableConfig, migrateAppData, migrateCalendarEvents, normalizeMistakeReviewPreferences, type AppData, type AssessmentReference } from "../../src/lib/exam-data"
import { isExamDifficultySettings } from "../../src/lib/exam-difficulty"
import { isExamProgression } from "../../src/lib/exam-progression"
import { migrateLearningWorkspace } from "../../src/lib/learning-workspace"
import { migrateSacRecords } from "../../src/lib/sac"
import type { ScalingReference } from "../../src/lib/scaling"
import {
  parseCanonicalStudySession, parseStudySessionMutationResult,
  type CanonicalStudySession, type StudySessionCommand, type StudySessionMutationResult,
} from "../../src/lib/sync/sessionContract"
import { isTimetable, type Timetable } from "../../src/lib/timetable"
import type { VcaaStudyResources } from "../../src/lib/vcaa-resources"

// ponytail: single-user. The server signs in as one Focal account from env and acts as that user
// through the same RPCs the apps use, so RLS and the sync protocol stay the only authority.
// Ceiling: multi-user needs OAuth in front of this instead of FOCAL_EMAIL/FOCAL_PASSWORD.
const DEVICE_ID = crypto.randomUUID()
const EPOCH = "1970-01-01T00:00:00.000Z"
const MAX_PASSES = 5

type Connection = { sb: SupabaseClient; userId: string }
let connection: Promise<Connection> | null = null

function connect(): Promise<Connection> {
  connection ??= (async () => {
    const url = process.env.VITE_SUPABASE_URL
    const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY
    const email = process.env.FOCAL_EMAIL
    const password = process.env.FOCAL_PASSWORD
    if (!url || !key || !email || !password) {
      throw new Error("Set VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, FOCAL_EMAIL and FOCAL_PASSWORD.")
    }
    const sb = createClient(url, key, { auth: { persistSession: false } })
    const { data, error } = await sb.auth.signInWithPassword({ email, password })
    if (error) throw new Error(`Focal sign-in failed: ${error.message}`)
    return { sb, userId: data.user.id }
  })().catch((error) => { connection = null; throw error })
  return connection
}

/** One RPC as the signed-in user. An expired login is re-established once. */
async function rpc(fn: string, args: (userId: string) => object): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    const { sb, userId } = await connect()
    const { data, error, status } = await sb.rpc(fn, args(userId))
    if (!error) return data
    const expired = status === 401 || ["PGRST301", "PGRST303"].includes(error.code)
    if (!expired || attempt > 0) throw new Error(`${fn}: ${error.message}`)
    connection = null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

type Row = { entity: string; rowId: string; operation: "put" | "delete"; payload: unknown; seq: number }
const rowKey = (entity: string, rowId: string) => `${entity}\u0000${rowId}`

/** The current state of every row, from one snapshot read (a negative cursor means "state, not changes"). */
async function snapshot(): Promise<Map<string, Row>> {
  const data = await rpc("sync_read_changes", (userId) => ({ p_after: -1, p_limit: 1000, p_expected_user_id: userId }))
  if (!isRecord(data) || data.mode !== "snapshot" || !Array.isArray(data.rows)) throw new Error("Malformed sync_read_changes response")
  const rows = new Map<string, Row>()
  for (const raw of data.rows) {
    if (!isRecord(raw) || typeof raw.entity !== "string" || typeof raw.row_id !== "string" ||
      (raw.operation !== "put" && raw.operation !== "delete") || !Number.isSafeInteger(raw.seq)) continue
    rows.set(rowKey(raw.entity, raw.row_id), { entity: raw.entity, rowId: raw.row_id, operation: raw.operation, payload: raw.payload ?? null, seq: raw.seq as number })
  }
  return rows
}

const live = (rows: Map<string, Row>, entity: string) =>
  [...rows.values()].filter((row) => row.entity === entity && row.operation === "put")

const strings = (value: unknown) => Array.isArray(value) && value.every((item) => typeof item === "string") ? value as string[] : []

/** The same projection the apps build from the feed, minus the local outbox. */
function project(rows: Map<string, Row>): AppData {
  const state = new Map<string, { value: unknown; updatedAt: string }>()
  for (const row of live(rows, "user_state")) {
    if (isRecord(row.payload) && "value" in row.payload) {
      state.set(row.rowId, { value: row.payload.value, updatedAt: typeof row.payload.updated_at === "string" ? row.payload.updated_at : "" })
    }
  }
  const value = (key: string) => state.get(key)?.value
  const stamp = (key: string) => state.get(key)?.updatedAt || EPOCH
  const migrated = migrateAppData({
    ...EMPTY_APP_DATA,
    attempts: live(rows, "attempts").map((row) => row.payload),
    mistakes: live(rows, "mistakes").map((row) => row.payload),
  })
  if (!migrated) throw new Error("Synced attempts or mistakes failed validation")
  const timetable = rows.get(rowKey("timetable_config", TIMETABLE_ROW))
  const progression = value("examProgression")
  const difficulty = value("examDifficulty")
  const reviewPreferences = value("mistakeReviewPreferences")
  return {
    ...migrated,
    events: migrateCalendarEvents(live(rows, "events").map((row) => row.payload)),
    classTimetable: timetable?.operation === "put" && isTimetableConfig(timetable.payload) ? timetable.payload : undefined,
    examProgression: isExamProgression(progression) ? progression : undefined,
    trackedExamIds: strings(value("trackedExamIds")), trackedExamIdsUpdatedAt: stamp("trackedExamIds"),
    completedExamIds: strings(value("completedExamIds")), completedExamIdsUpdatedAt: stamp("completedExamIds"),
    subjects: strings(value("subjects")), subjectsUpdatedAt: stamp("subjects"),
    sacRecords: migrateSacRecords(value("sacRecords")) ?? [], sacRecordsUpdatedAt: stamp("sacRecords"),
    mistakeReviewPreferences: isRecord(reviewPreferences) ? normalizeMistakeReviewPreferences(reviewPreferences) : undefined,
    examDifficulty: isExamDifficultySettings(difficulty) ? difficulty : undefined,
    atarEstimates: migrateAppData({ ...EMPTY_APP_DATA, atarEstimates: value("atarEstimates") })?.atarEstimates ?? [],
    atarEstimatesUpdatedAt: stamp("atarEstimates"),
    learning: migrateLearningWorkspace(value("learning")),
  }
}

/** App data and study sessions from one snapshot, so the two are consistent with each other. Deleted sessions are dropped. */
export async function readAll(): Promise<{ data: AppData; sessions: CanonicalStudySession[] }> {
  const rows = await snapshot()
  const sessions = live(rows, "study_sessions").flatMap((row) => parseCanonicalStudySession(row.payload) ?? [])
  return { data: project(rows), sessions: sessions.filter((session) => session.cancelled_at === null) }
}

/* ------------------------------------------------------------------ */
/* writing                                                             */
/* ------------------------------------------------------------------ */

/**
 * Read, edit, validate, write. Each row is written only if it is still at the version that was
 * read (`expected_seq`), so an edit made in the app in between is never overwritten: the stale rows
 * are re-read and the edit is applied to them again. `edit` must therefore be a pure function of the
 * data it is given, and ids it creates must be made by the caller, not inside it.
 */
export async function updateApp(edit: (data: AppData) => AppData): Promise<AppData> {
  let only: Set<string> | null = null
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const rows = await snapshot()
    const before = project(rows)
    const after = edit(before)
    // The apps run this same check on every synced row; an invalid one would break them all.
    if (!migrateAppData(after)) throw new Error("That change would leave Focal data invalid, so nothing was saved.")
    const changes = diffAppData(before, after).filter((change) => !only || only.has(rowKey(change.entity, change.rowId)))
    if (!changes.length) return after
    const sent = changes.map((change) => ({ ...change, changeId: crypto.randomUUID() }))
    const result = await rpc("sync_apply_changes", (userId) => ({
      p_expected_user_id: userId,
      p_changes: sent.map((change) => ({
        change_id: change.changeId, client_id: DEVICE_ID, entity: change.entity, row_id: change.rowId,
        operation: change.operation, payload: change.payload, expected_seq: rows.get(rowKey(change.entity, change.rowId))?.seq ?? 0,
      })),
    }))
    if (!isRecord(result) || !Array.isArray(result.stale)) throw new Error("Malformed sync_apply_changes response")
    const stale = new Set(result.stale.flatMap((item) => isRecord(item) && typeof item.change_id === "string" ? [item.change_id] : []))
    if (!stale.size) return after
    only = new Set(sent.filter((change) => stale.has(change.changeId)).map((change) => rowKey(change.entity, change.rowId)))
  }
  throw new Error("Focal data kept changing while saving. Try again.")
}

/** One study-session command. Lifecycle commands carry no timing, so the server stamps them at receipt. */
export async function sessionCommand(command: Omit<StudySessionCommand, "mutation_id" | "device_id" | "app">): Promise<StudySessionMutationResult> {
  const data = await rpc("study_session_mutate", (userId) => ({
    p_command: { ...command, mutation_id: crypto.randomUUID(), device_id: DEVICE_ID, app: "examtrack", expected_user_id: userId },
  }))
  const result = parseStudySessionMutationResult(data)
  if (!result) throw new Error("Malformed study_session_mutate response")
  if (!result.applied) throw new Error(`The server did not apply that session change (${result.reason ?? "unknown reason"}).`)
  return result
}

/* ------------------------------------------------------------------ */
/* reference datasets (public/*.json)                                  */
/* ------------------------------------------------------------------ */

const assets = new Map<string, Promise<unknown>>()
function asset(name: string): Promise<unknown> {
  if (!assets.has(name)) assets.set(name, readFile(new URL(`../../public/${name}`, import.meta.url), "utf8").then(JSON.parse))
  return assets.get(name)!
}
const list = <T>(value: unknown): T[] => Array.isArray(value) ? value as T[] : []

export async function gradeReferences(): Promise<AssessmentReference[]> {
  const data = await asset("vcaa-grade-distributions.json") as { assessments?: unknown }
  return list<AssessmentReference>(data.assessments).filter((entry) => entry.studyName && entry.name && Array.isArray(entry.gradeBands))
}

export async function examResources(): Promise<VcaaStudyResources[]> {
  const data = await asset("vcaa-exam-resources.json") as { studies?: unknown }
  return list<VcaaStudyResources>(data.studies).filter((entry) => entry.studyName && Array.isArray(entry.resources))
}

export async function scalingReferences(): Promise<ScalingReference[]> {
  const data = await asset("vtac-scaling-reports.json") as { references?: unknown }
  return list<ScalingReference>(data.references).filter((entry) => entry.id && entry.studyName && typeof entry.year === "number")
}

export async function vceTimetable(): Promise<Timetable | null> {
  const data = await asset("vce-2026-timetable.json")
  return isTimetable(data) ? data : null
}
