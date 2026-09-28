import type { AppData, AssessmentReference, ExamAttempt } from "@/lib/exam-data"
import { predictStudyScore } from "@/lib/study-score"

export type StudyTaskKind = "mistake-review" | "topic-practice" | "practice-exam" | "sac-prep" | "custom"
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

export type CurriculumArea = {
  id: string
  subject: string
  name: string
  description?: string
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

export type LearningPreferences = {
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

export type MasteryArea = {
  key: string
  subject: string
  name: string
  awardedMarks: number
  availableMarks: number
  mistakes: number
  reviews: number
  mastery: number | null
  evidenceCount: number
  lastEvidenceAt?: string
}

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
      (area.description === undefined || typeof area.description === "string")) &&
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

export function buildMasteryAreas(data: Pick<AppData, "attempts" | "mistakes" | "learning">): MasteryArea[] {
  const buckets = new Map<string, MasteryArea>()
  const ensure = (subject: string, name: string) => {
    const key = `${subject.trim().toLowerCase()}::${name.trim().toLowerCase()}`
    const current = buckets.get(key) ?? { key, subject, name, awardedMarks: 0, availableMarks: 0, mistakes: 0, reviews: 0, mastery: null, evidenceCount: 0 }
    buckets.set(key, current)
    return current
  }
  for (const area of data.learning.curriculumAreas.filter((area) => !area.archivedAt)) ensure(area.subject, area.name)
  for (const attempt of data.attempts) {
    for (const result of attempt.questionResults ?? []) {
      const name = result.areaOfStudy?.trim() || result.criterion?.trim()
      if (!name) continue
      const bucket = ensure(attempt.subject, name)
      bucket.awardedMarks += result.marksAwarded
      bucket.availableMarks += result.maxMarks
      bucket.evidenceCount += 1
      bucket.lastEvidenceAt = [bucket.lastEvidenceAt ?? "", attempt.completedAt].toSorted().at(-1)
    }
  }
  const attemptMap = new Map(data.attempts.map((attempt) => [attempt.id, attempt]))
  for (const mistake of data.mistakes) {
    const attempt = attemptMap.get(mistake.attemptId)
    const name = mistake.areaOfStudy?.trim() || mistake.criterion?.trim()
    if (!attempt || !name) continue
    const bucket = ensure(attempt.subject, name)
    bucket.mistakes += 1
    bucket.reviews += mistake.reviewHistory?.length ?? 0
    bucket.evidenceCount += 1
    bucket.lastEvidenceAt = [bucket.lastEvidenceAt ?? "", mistake.updatedAt.slice(0, 10)].toSorted().at(-1)
  }
  return [...buckets.values()].map((area) => {
    if (!area.availableMarks && !area.mistakes) return area
    const score = area.availableMarks ? area.awardedMarks / area.availableMarks * 100 : 60
    const mistakePenalty = Math.min(25, area.mistakes * 5)
    const reviewRecovery = Math.min(mistakePenalty, area.reviews * 2)
    return { ...area, mastery: Math.max(0, Math.min(100, score - mistakePenalty + reviewRecovery)) }
  }).toSorted((a, b) => (a.mastery ?? -1) - (b.mastery ?? -1) || a.subject.localeCompare(b.subject))
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

