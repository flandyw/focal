import { describe, expect, test } from "bun:test"
import { EMPTY_APP_DATA, type AppData } from "../src/lib/exam-data"
import {
  buildMasteryAreas,
  buildPlannerSuggestions,
  createPracticeSession,
  deletePracticeSession,
  EMPTY_LEARNING_WORKSPACE,
  finalisePracticeSession,
  getGoalProgress,
  getPracticeSessionPlan,
  getPracticeSessionTimerState,
  materialiseTask,
  mergeLearningWorkspace,
  migrateLearningWorkspace,
  pausePracticeSession,
  resumePracticeSession,
  type PracticeSession,
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
  test("builds actionable planner recommendations and materialises a task", () => {
    const suggestions = buildPlannerSuggestions(appData(), null, new Date("2026-08-23T00:00:00.000Z"))
    expect(suggestions.some((item) => item.kind === "mistake-review" && item.subject === "Biology")).toBe(true)
    const task = materialiseTask(suggestions[0], new Date("2026-08-23T01:00:00.000Z"))
    expect(task.status).toBe("planned")
    expect(task.updatedAt).toBe("2026-08-23T01:00:00.000Z")
  })

  test("places recommendations on the next day when today's study capacity is full", () => {
    const data = appData()
    data.learning = {
      ...EMPTY_LEARNING_WORKSPACE,
      preferences: { dailyMinutes: 30, studyDays: [0, 1, 2, 3, 4, 5, 6] },
      tasks: [{ id: "task-1", kind: "custom", title: "Existing", detail: "", durationMinutes: 30, plannedFor: "2026-08-23", status: "planned", createdAt: "2026-08-22T00:00:00.000Z", updatedAt: "2026-08-22T00:00:00.000Z" }],
    }
    const review = buildPlannerSuggestions(data, null, new Date("2026-08-23T00:00:00.000Z")).find((item) => item.kind === "mistake-review")
    expect(review?.plannedFor).toBe("2026-08-24")
  })

  test("turns question and mistake evidence into a conservative mastery score", () => {
    const [area] = buildMasteryAreas(appData())
    expect(area.name).toBe("Genetics")
    expect(area.evidenceCount).toBe(2)
    expect(area.mastery).toBe(35)
  })

  test("creates a targeted session and prefers an available alternative question", () => {
    const data = appData()
    data.alternativeMistakeDeck = { updatedAt: "2026-08-23T00:00:00.000Z", cards: [{ sourceMistakeId: mistake.id, skill: "Punnett squares", question: "Cross Aa with aa.", answer: "Half Aa, half aa.", marks: 2, generatedAt: "2026-08-23T00:00:00.000Z" }] }
    const session = createPracticeSession("Biology", data, { limit: 6 }, new Date("2026-08-23T00:00:00.000Z"))
    expect(session?.questions[0]).toMatchObject({ question: "Cross Aa with aa.", rating: "unattempted", marks: 2 })
    expect(session).toMatchObject({ timerStartedAt: "2026-08-23T00:00:00.000Z", elapsedSeconds: 0 })
    expect(getPracticeSessionPlan("Biology", data, { limit: 6 })).toEqual({ availableQuestions: 1, selectedQuestions: 1, totalMarks: 2, durationMinutes: 15 })
  })

  test("runs, pauses, resumes, and finalises a practice timer without counting paused time", () => {
    const session: PracticeSession = {
      id: "session-1",
      title: "Biology targeted practice",
      subject: "Biology",
      durationMinutes: 15,
      questions: [{ id: "question-1", skill: "Genetics", question: "Question", answer: "Answer", marks: 1, rating: "correct" }],
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
      startedAt: "2026-08-23T00:00:00.000Z",
      timerStartedAt: "2026-08-23T00:00:00.000Z",
      elapsedSeconds: 10,
    }

    expect(getPracticeSessionTimerState(session, new Date("2026-08-23T00:00:05.000Z"))).toMatchObject({ elapsedSeconds: 15, isRunning: true, isPaused: false })
    const paused = pausePracticeSession(session, new Date("2026-08-23T00:00:05.000Z"))
    expect(getPracticeSessionTimerState(paused, new Date("2026-08-23T00:00:20.000Z"))).toMatchObject({ elapsedSeconds: 15, isRunning: false, isPaused: true })
    const resumed = resumePracticeSession(paused, new Date("2026-08-23T00:00:20.000Z"))
    expect(getPracticeSessionTimerState(resumed, new Date("2026-08-23T00:00:25.000Z"))).toMatchObject({ elapsedSeconds: 20, isRunning: true })
    const completed = finalisePracticeSession(resumed, new Date("2026-08-23T00:00:25.000Z"))
    expect(getPracticeSessionTimerState(completed, new Date("2026-08-23T01:00:00.000Z"))).toMatchObject({ elapsedSeconds: 20, isRunning: false, isPaused: false })

    const [migratedLegacy] = migrateLearningWorkspace({
      ...EMPTY_LEARNING_WORKSPACE,
      practiceSessions: [{ ...session, timerStartedAt: undefined, elapsedSeconds: undefined }],
    }).practiceSessions
    expect(migratedLegacy).toMatchObject({ elapsedSeconds: 0, timerPausedAt: session.updatedAt })
    expect(getPracticeSessionTimerState(migratedLegacy, new Date("2026-08-24T00:00:00.000Z"))).toMatchObject({ elapsedSeconds: 0, isPaused: true })
  })

  test("calculates an exam-average goal gap from recorded evidence", () => {
    const data = appData()
    const progress = getGoalProgress({ id: "goal-1", kind: "exam-percentage", subject: "Biology", target: 80, deadline: "2026-10-01", createdAt: "2026-08-23T00:00:00.000Z", updatedAt: "2026-08-23T00:00:00.000Z" }, data, [])
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

  test("keeps practice-session deletions across sync without retaining session content", () => {
    const session: PracticeSession = {
      id: "session-to-delete",
      title: "Sensitive session content",
      subject: "Biology",
      durationMinutes: 15,
      questions: [{ id: "question-1", skill: "Genetics", question: "Question", answer: "Answer", marks: 1, rating: "unattempted" }],
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T01:00:00.000Z",
    }
    const original = { ...EMPTY_LEARNING_WORKSPACE, practiceSessions: [session], updatedAt: session.updatedAt }
    const deleted = deletePracticeSession(original, session.id, new Date("2026-08-23T03:00:00.000Z"))
    expect(deleted.practiceSessions).toEqual([])
    expect(JSON.stringify(deleted)).not.toContain("Sensitive session content")

    const remote = { ...EMPTY_LEARNING_WORKSPACE, practiceSessions: [session], updatedAt: "2026-08-23T02:00:00.000Z" }
    const merged = mergeLearningWorkspace(deleted, remote)
    expect(merged.practiceSessions).toEqual([])
    expect(merged.practiceSessionTombstones?.[session.id]).toBe("2026-08-23T03:00:00.000Z")
  })
})
