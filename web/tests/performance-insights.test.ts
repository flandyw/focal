import { describe, expect, test } from "bun:test"
import type { ExamAttempt, Mistake } from "../src/lib/exam-data"
import { buildFocusPriorities, buildLostMarksAttribution, buildPaperWeaknessMatrix, buildReviewForecast, buildSubjectOutlooks } from "../src/lib/performance-insights"
import { buildPerformanceContextAnalysis, isPerformanceContext } from "../src/lib/performance-context"
import type { SacRecord } from "../src/lib/sac"

function makeAttempt(id: string, score: number, completedAt: string): ExamAttempt {
  return {
    id,
    subject: "Mathematical Methods",
    provider: "VCAA",
    title: `Practice ${id}`,
    examYear: 2025,
    paper: "Exam 1",
    completedAt,
    rawScore: score,
    rawMax: 100,
    referenceId: null,
    createdAt: `${completedAt}T00:00:00.000Z`,
    updatedAt: `${completedAt}T00:00:00.000Z`,
  }
}

function makeMistake(overrides: Partial<Mistake> = {}): Mistake {
  return {
    id: "mistake-1",
    attemptId: "attempt-3",
    question: "4b",
    category: "Concept",
    explanation: "Missed the chain rule",
    correction: "Apply the chain rule before simplifying",
    resolved: false,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
    ...overrides,
  }
}

describe("performance insights", () => {
  test("projects an improving subject with a bounded uncertainty range", () => {
    const outlook = buildSubjectOutlooks([
      makeAttempt("attempt-1", 50, "2026-07-01"),
      makeAttempt("attempt-2", 60, "2026-07-08"),
      makeAttempt("attempt-3", 70, "2026-07-15"),
    ])[0]

    expect(outlook.currentAverage).toBe(60)
    expect(outlook.projectedNext).toBeGreaterThan(70)
    expect(outlook.predictionLow).toBeLessThan(outlook.projectedNext)
    expect(outlook.predictionHigh).toBeGreaterThan(outlook.projectedNext)
    expect(outlook.confidence).toBe("medium")
  })

  test("ranks weak, low-confidence areas above stronger areas", () => {
    const markedAttempt = {
      ...makeAttempt("attempt-3", 70, "2026-07-15"),
      questionResults: [
        { id: "q1", label: "1", marksAwarded: 1, maxMarks: 5, areaOfStudy: "Algebra", confidence: "low" as const },
        { id: "q2", label: "2", marksAwarded: 4, maxMarks: 5, areaOfStudy: "Calculus", confidence: "high" as const },
      ],
    }
    const priorities = buildFocusPriorities([markedAttempt], [
      makeMistake({ areaOfStudy: "Algebra", lapses: 2 }),
    ])

    expect(priorities.map((item) => item.areaOfStudy)).toEqual(["Algebra", "Calculus"])
    expect(priorities[0]).toMatchObject({ missedMarks: 4, unresolvedMistakes: 1, lapses: 2 })
    expect(priorities[0].priorityScore).toBeGreaterThan(priorities[1].priorityScore)
  })

  test("can keep Exam 1 and Exam 2 focus evidence in separate buckets", () => {
    const exam1 = {
      ...makeAttempt("exam-1", 60, "2026-07-10"),
      questionResults: [{ id: "q1", label: "1", marksAwarded: 2, maxMarks: 10, areaOfStudy: "Probability", confidence: "low" as const }],
    }
    const exam2 = {
      ...makeAttempt("exam-2", 90, "2026-07-11"),
      paper: "Examination 2",
      questionResults: [{ id: "q2", label: "1", marksAwarded: 9, maxMarks: 10, areaOfStudy: "Probability", confidence: "high" as const }],
    }

    const priorities = buildFocusPriorities([exam1, exam2], [], { bucketByPaper: true })

    expect(priorities).toHaveLength(2)
    expect(priorities[0]).toMatchObject({ paper: "Exam 1", areaOfStudy: "Probability", mastery: 20 })
    expect(priorities[1]).toMatchObject({ paper: "Examination 2", areaOfStudy: "Probability", mastery: 90 })
  })

  test("builds a paper weakness matrix with technology diagnosis and repeat mistakes", () => {
    const exam1 = {
      ...makeAttempt("exam-1", 80, "2026-07-10"),
      questionResults: [{ id: "q1", label: "4b", marksAwarded: 2, maxMarks: 10, areaOfStudy: "Probability", confidence: "low" as const }],
    }
    const exam2 = {
      ...makeAttempt("exam-2", 95, "2026-07-11"),
      paper: "Exam 2",
      questionResults: [{ id: "q2", label: "3", marksAwarded: 9, maxMarks: 10, areaOfStudy: "Probability", confidence: "high" as const }],
    }
    const mistakes = [
      makeMistake({ id: "m1", attemptId: "exam-1", areaOfStudy: "Probability", question: "4b", criterion: "Choose distribution" }),
      makeMistake({ id: "m2", attemptId: "exam-1", areaOfStudy: "Probability", question: "4b", criterion: "Choose distribution" }),
      makeMistake({ id: "m3", attemptId: "exam-2", areaOfStudy: "Probability", question: "3", category: "Calculator" }),
    ]

    const row = buildPaperWeaknessMatrix([exam1, exam2], mistakes, "Mathematical Methods")[0]

    expect(row).toMatchObject({ areaOfStudy: "Probability", gap: 70, diagnosis: "tech-free fragile" })
    expect(row.exam1).toMatchObject({ mastery: 20, missedMarks: 8, mistakeCount: 2, repeatMistakes: 1, evidenceConfidence: "low" })
    expect(row.exam1.questions[0].mistakeCategories).toEqual(["Concept"])
    expect(row.exam2).toMatchObject({ mastery: 90, mistakeCount: 1 })
  })

  test("attributes recent lost marks by category and paper while exposing gaps", () => {
    const exam1 = { ...makeAttempt("exam-1", 80, "2026-07-10"), rawMax: 100 }
    const exam2 = { ...makeAttempt("exam-2", 90, "2026-07-11"), rawMax: 100, paper: "Exam 2" }
    const attribution = buildLostMarksAttribution([exam1, exam2], [
      makeMistake({ id: "m1", attemptId: "exam-1", category: "Algebra", marksLost: 8 }),
      makeMistake({ id: "m2", attemptId: "exam-2", category: "Calculator", marksLost: 5 }),
    ], "Mathematical Methods")

    expect(attribution).toMatchObject({ attemptCount: 2, totalLost: 30, attributedMarks: 13, unattributedMarks: 17 })
    expect(attribution.categories).toContainEqual({ category: "Algebra", marks: 8, exam1: 8, exam2: 0, other: 0 })
    expect(attribution.categories).toContainEqual({ category: "Calculator", marks: 5, exam1: 0, exam2: 5, other: 0 })
    expect(attribution.categories).toContainEqual({ category: "Unattributed", marks: 17, exam1: 12, exam2: 5, other: 0 })
  })

  test("puts overdue reviews into today and schedules upcoming cards by day", () => {
    const forecast = buildReviewForecast([
      makeMistake({ id: "overdue", dueAt: "2026-07-19T12:00:00+10:00" }),
      makeMistake({ id: "tomorrow", dueAt: "2026-07-22T12:00:00+10:00" }),
      makeMistake({ id: "suspended", dueAt: "2026-07-22T12:00:00+10:00", suspended: true }),
    ], new Date("2026-07-21T12:00:00+10:00"), 3)

    expect(forecast.map((day) => day.due)).toEqual([1, 1, 0])
    expect(forecast[0].label).toBe("Today")
  })

  test("finds favourable mental-state patterns across exams and SACs", () => {
    const attempts = [
      { ...makeAttempt("attempt-1", 55, "2026-07-01"), performanceContext: { sleepHours: 6, focus: 2 as const, stress: 5 as const } },
      { ...makeAttempt("attempt-2", 70, "2026-07-08"), performanceContext: { sleepHours: 7, focus: 3 as const, stress: 3 as const } },
      { ...makeAttempt("attempt-3", 85, "2026-07-15"), performanceContext: { sleepHours: 8, focus: 4 as const, stress: 1 as const } },
    ]
    const sac: SacRecord = {
      id: "sac-1",
      subject: "Mathematical Methods",
      provider: "School",
      title: "Calculus SAC",
      unit: 3,
      scheduledAt: "2026-07-20",
      durationMinutes: 50,
      score: 90,
      maxScore: 100,
      performanceContext: { sleepHours: 8.5, focus: 5, stress: 1 },
      createdAt: "2026-07-20T00:00:00.000Z",
      updatedAt: "2026-07-20T00:00:00.000Z",
    }
    const analysis = buildPerformanceContextAnalysis(attempts, [sac])

    expect(analysis).toMatchObject({ completedAssessments: 4, recordedAssessments: 4 })
    expect(analysis.insights.find((item) => item.key === "focus")?.favourableChange).toBeGreaterThan(0)
    expect(analysis.insights.find((item) => item.key === "stress")?.favourableChange).toBeGreaterThan(0)
  })

  test("requires valid optional context ratings", () => {
    expect(isPerformanceContext({ sleepHours: 7.5, energy: 4, stress: 2 })).toBe(true)
    expect(isPerformanceContext({ sleepHours: 25 })).toBe(false)
    expect(isPerformanceContext({ focus: 0 })).toBe(false)
  })
})
