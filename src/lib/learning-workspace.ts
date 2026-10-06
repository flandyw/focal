import type { AppData, AssessmentReference, ExamAttempt } from "./exam-data"
import { predictStudyScore } from "./study-score"

type StudyTaskKind = "mistake-review" | "topic-practice" | "practice-exam" | "sac-prep" | "custom"
export type StudyTaskStatus = "planned" | "completed" | "skipped"

export type StudyTask = {
  id: string
  kind: StudyTaskKind
  title: string
  subject?: string
  detail: string
  durationMinutes: number
  plannedFor: string
  status: StudyTaskStatus
  sourceId?: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export type StoplightRating = "red" | "amber" | "green"
export type StoplightType = "recall" | "technique" | "apply" | "practical"
const STOPLIGHT_RATINGS = ["red", "amber", "green"]
const STOPLIGHT_TYPES = ["recall", "technique", "apply", "practical"]

// ponytail: the persisted key stays `curriculumAreas` (synced + Folio-compatible); a stoplight item is a curriculum area with a `group`.
export type CurriculumArea = {
  id: string
  subject: string
  name: string
  description?: string
  /** Unit / Area of Study heading the item sits under. */
  group?: string
  rating?: StoplightRating
  ratedAt?: string
  /** One-line "prove it" test: green means passing this cold and timed. */
  check?: string
  type?: StoplightType
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

export type StudyGoalKind = "study-score" | "exam-percentage" | "atar"

export type StudyGoal = {
  id: string
  kind: StudyGoalKind
  subject?: string
  target: number
  deadline: string
  createdAt: string
  updatedAt: string
  archivedAt?: string
}

type LearningPreferences = {
  dailyMinutes: number
  studyDays: number[]
}

export type LearningWorkspace = {
  tasks: StudyTask[]
  curriculumAreas: CurriculumArea[]
  goals: StudyGoal[]
  preferences: LearningPreferences
  preferencesUpdatedAt?: string
  updatedAt: string
}

export type LearningWorkspaceUpdate = LearningWorkspace | ((current: LearningWorkspace) => LearningWorkspace)

export const EMPTY_LEARNING_WORKSPACE: LearningWorkspace = {
  tasks: [],
  curriculumAreas: [],
  goals: [],
  preferences: { dailyMinutes: 60, studyDays: [1, 2, 3, 4, 5, 6] },
  preferencesUpdatedAt: "1970-01-01T00:00:00.000Z",
  updatedAt: "1970-01-01T00:00:00.000Z",
}

export type TaskDraft = Omit<StudyTask, "id" | "status" | "createdAt" | "updatedAt">

export type GoalProgress = {
  current: number | null
  target: number
  progress: number
  gap: number | null
  label: string
  evidence: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object"
}

function isTimestamped(value: unknown) {
  return isRecord(value) && typeof value.id === "string" && typeof value.createdAt === "string" && typeof value.updatedAt === "string" &&
    (value.archivedAt === undefined || typeof value.archivedAt === "string")
}

export function isLearningWorkspace(value: unknown): value is LearningWorkspace {
  if (!isRecord(value)) return false
  return Array.isArray(value.tasks) && value.tasks.every((task) => isTimestamped(task) &&
    ["mistake-review", "topic-practice", "practice-exam", "sac-prep", "custom"].includes(String(task.kind)) &&
    typeof task.title === "string" && task.title.trim().length > 0 && task.title.length <= 500 && (task.subject === undefined || typeof task.subject === "string") &&
    typeof task.detail === "string" && typeof task.durationMinutes === "number" && Number.isFinite(task.durationMinutes) && task.durationMinutes > 0 && task.durationMinutes <= 1440 &&
    typeof task.plannedFor === "string" && ["planned", "completed", "skipped"].includes(String(task.status)) &&
    (task.sourceId === undefined || typeof task.sourceId === "string")) &&
    Array.isArray(value.curriculumAreas) && value.curriculumAreas.every((area) => isTimestamped(area) &&
      typeof area.subject === "string" && area.subject.trim().length > 0 && typeof area.name === "string" && area.name.trim().length > 0 &&
      (area.description === undefined || typeof area.description === "string") &&
      (area.group === undefined || typeof area.group === "string") &&
      (area.rating === undefined || STOPLIGHT_RATINGS.includes(String(area.rating))) &&
      (area.ratedAt === undefined || typeof area.ratedAt === "string") &&
      (area.check === undefined || typeof area.check === "string") &&
      (area.type === undefined || STOPLIGHT_TYPES.includes(String(area.type)))) &&
    Array.isArray(value.goals) && value.goals.every((goal) => isTimestamped(goal) &&
      ["study-score", "exam-percentage", "atar"].includes(String(goal.kind)) &&
      (goal.subject === undefined || typeof goal.subject === "string") && typeof goal.target === "number" &&
      Number.isFinite(goal.target) && typeof goal.deadline === "string") &&
    isRecord(value.preferences) && typeof value.preferences.dailyMinutes === "number" && value.preferences.dailyMinutes > 0 &&
    Array.isArray(value.preferences.studyDays) && value.preferences.studyDays.every((day) => Number.isInteger(day) && Number(day) >= 0 && Number(day) <= 6) &&
    (value.preferencesUpdatedAt === undefined || typeof value.preferencesUpdatedAt === "string") &&
    typeof value.updatedAt === "string"
}

export function migrateLearningWorkspace(value: unknown): LearningWorkspace {
  // Rebuild explicitly so keys from removed features (practice sessions) do not ride
  // along in saved and synced data forever.
  const workspace = isLearningWorkspace(value) ? value : EMPTY_LEARNING_WORKSPACE
  return {
    tasks: workspace.tasks,
    curriculumAreas: workspace.curriculumAreas,
    goals: workspace.goals,
    preferences: workspace.preferences,
    preferencesUpdatedAt: workspace.preferencesUpdatedAt,
    updatedAt: workspace.updatedAt,
  }
}

function mergeTimestamped<T extends { id: string; updatedAt: string }>(local: T[], remote: T[]) {
  const merged = new Map(local.map((item) => [item.id, item]))
  for (const item of remote) {
    const current = merged.get(item.id)
    if (!current || item.updatedAt > current.updatedAt) merged.set(item.id, item)
  }
  return [...merged.values()]
}

export function mergeLearningWorkspace(local: LearningWorkspace, remote: LearningWorkspace): LearningWorkspace {
  const localPreferencesUpdatedAt = local.preferencesUpdatedAt ?? local.updatedAt
  const remotePreferencesUpdatedAt = remote.preferencesUpdatedAt ?? remote.updatedAt
  const remoteSettingsWin = remotePreferencesUpdatedAt > localPreferencesUpdatedAt
  return {
    tasks: mergeTimestamped(local.tasks, remote.tasks),
    curriculumAreas: mergeTimestamped(local.curriculumAreas, remote.curriculumAreas),
    goals: mergeTimestamped(local.goals, remote.goals),
    preferences: remoteSettingsWin ? remote.preferences : local.preferences,
    preferencesUpdatedAt: remoteSettingsWin ? remotePreferencesUpdatedAt : localPreferencesUpdatedAt,
    updatedAt: remote.updatedAt > local.updatedAt ? remote.updatedAt : local.updatedAt,
  }
}

export function localDate(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, "0")
  const day = String(date.getDate()).padStart(2, "0")
  return `${year}-${month}-${day}`
}

export function materialiseTask(draft: TaskDraft, now = new Date()): StudyTask {
  const timestamp = now.toISOString()
  return { ...draft, id: crypto.randomUUID(), status: "planned", createdAt: timestamp, updatedAt: timestamp }
}

function averagePercent(attempts: ExamAttempt[], subject?: string) {
  const matched = subject ? attempts.filter((attempt) => attempt.subject.toLowerCase() === subject.toLowerCase()) : attempts
  if (!matched.length) return null
  return matched.reduce((total, attempt) => total + attempt.rawScore / attempt.rawMax * 100, 0) / matched.length
}

export function getGoalProgress(goal: StudyGoal, data: AppData, references: AssessmentReference[]): GoalProgress {
  let current: number | null = null
  let label = "Current"
  let evidence = "No compatible evidence yet."
  if (goal.kind === "exam-percentage") {
    current = averagePercent(data.attempts, goal.subject)
    label = "Average exam result"
    evidence = current === null ? evidence : `Based on ${data.attempts.filter((attempt) => !goal.subject || attempt.subject.toLowerCase() === goal.subject.toLowerCase()).length} recorded paper(s).`
  } else if (goal.kind === "study-score" && goal.subject) {
    const prediction = predictStudyScore({ subject: goal.subject, attempts: data.attempts, references })
    current = prediction?.studyScore ?? null
    label = "Predicted raw study score"
    evidence = prediction ? `${prediction.confidence} confidence · likely ${prediction.low}–${prediction.high}.` : evidence
  } else if (goal.kind === "atar") {
    const saved = data.atarEstimates[0]
    current = saved ? Number.parseFloat(saved.atarLabel.replace(/[^0-9.]/g, "")) : null
    label = "Latest saved ATAR estimate"
    evidence = saved ? `Saved ${new Date(saved.savedAt).toLocaleDateString("en-AU")}.` : "Save an ATAR estimate to establish a baseline."
  }
  const gap = current === null ? null : Math.max(0, goal.target - current)
  return { current, target: goal.target, progress: current === null ? 0 : Math.max(0, Math.min(100, current / goal.target * 100)), gap, label, evidence }
}

