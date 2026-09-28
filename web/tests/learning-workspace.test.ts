import { describe, expect, test } from "bun:test"
import { EMPTY_APP_DATA, type AppData } from "../src/lib/exam-data"
import {
  buildMasteryAreas,
  EMPTY_LEARNING_WORKSPACE,
  getGoalProgress,
  isLearningWorkspace,
  materialiseTask,
  mergeLearningWorkspace,
  migrateLearningWorkspace,
} from "../src/lib/learning-workspace"

const attempt = {
  id: "attempt-1",
  subject: "Biology",
  provider: "VCAA",
  title: "VCAA 2025 Biology",
  examYear: 2025,
  paper: "Examination",
  completedAt: "2026-08-20",
  rawScore: 70,
  rawMax: 100,
  questionResults: [{ id: "q1", label: "Question 1", marksAwarded: 4, maxMarks: 10, areaOfStudy: "Genetics", confidence: "low" as const }],
  referenceId: null,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
}

const mistake = {
  id: "mistake-1",
  attemptId: attempt.id,
  question: "Question 1",
  category: "Concept" as const,
  explanation: "Confused dominant and recessive alleles.",
  correction: "Track each allele independently.",
  areaOfStudy: "Genetics",
  dueAt: "2026-08-22T00:00:00.000Z",
  resolved: false,
  createdAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
}

function appData(): AppData {
  return { ...EMPTY_APP_DATA, attempts: [attempt], mistakes: [mistake], subjects: ["Biology"] }
}

describe("learning workspace", () => {
  test("turns question and mistake evidence into a conservative mastery score", () => {
    const [area] = buildMasteryAreas(appData())
    expect(area.name).toBe("Genetics")
    expect(area.evidenceCount).toBe(2)
    expect(area.mastery).toBe(35)
  })

  test("materialises a planned task from a draft", () => {
    const task = materialiseTask({ kind: "custom", title: "Redo genetics", detail: "", durationMinutes: 30, plannedFor: "2026-08-23" }, new Date("2026-08-23T01:00:00.000Z"))
    expect(task.status).toBe("planned")
    expect(task.updatedAt).toBe("2026-08-23T01:00:00.000Z")
  })

  test("calculates an exam-average goal gap from recorded evidence", () => {
    const progress = getGoalProgress({ id: "goal-1", kind: "exam-percentage", subject: "Biology", target: 80, deadline: "2026-10-01", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" }, appData(), [])
    expect(progress.current).toBe(70)
    expect(progress.gap).toBe(10)
  })

  test("merges concurrent workspace items and keeps the newest archived version", () => {
    const local = {
      ...EMPTY_LEARNING_WORKSPACE,
      updatedAt: "2026-08-23T03:00:00.000Z",
      preferencesUpdatedAt: "2026-08-23T03:00:00.000Z",
      preferences: { dailyMinutes: 90, studyDays: [1, 2, 3, 4, 5] },
      tasks: [{ id: "task", kind: "custom" as const, title: "Local", detail: "", durationMinutes: 30, plannedFor: "2026-08-24", status: "planned" as const, createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T01:00:00.000Z" }],
    }
    const remote = {
      ...EMPTY_LEARNING_WORKSPACE,
      updatedAt: "2026-08-23T04:00:00.000Z",
      preferencesUpdatedAt: "2026-08-23T02:00:00.000Z",
      tasks: [{ ...local.tasks[0], archivedAt: "2026-08-23T04:00:00.000Z", updatedAt: "2026-08-23T04:00:00.000Z" }],
      goals: [{ id: "goal", kind: "atar" as const, target: 90, deadline: "2026-10-01", createdAt: "2026-08-23T02:00:00.000Z", updatedAt: "2026-08-23T02:00:00.000Z" }],
    }
    const merged = mergeLearningWorkspace(local, remote)
    expect(merged.tasks[0].archivedAt).toBe("2026-08-23T04:00:00.000Z")
    expect(merged.goals).toHaveLength(1)
    expect(merged.preferences.dailyMinutes).toBe(90)
  })

  // Saved data written before the practice studio was removed still has a practiceSessions
  // blob. It must load, keep the real records, and stop carrying the dead key.
  test("legacy saved workspaces with practice sessions still migrate", () => {
    const legacy = { ...EMPTY_LEARNING_WORKSPACE, practiceSessions: [{ id: "session-1" }], practiceSessionTombstones: { "session-1": "2026-08-23T00:00:00.000Z" } }
    expect(isLearningWorkspace(legacy)).toBe(true)
    const migrated = migrateLearningWorkspace(legacy)
    expect(migrated.tasks).toEqual([])
    expect("practiceSessions" in migrated).toBe(false)
  })
})
