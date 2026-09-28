import { expect, test } from "bun:test"
import { buildRevisionPriorities, buildRevisionQueue, formatReviewInterval, getMistakeProgress, getMistakeQueueCounts } from "../src/lib/mistake-review"
import type { Mistake } from "../src/lib/exam-data"

const mistake = (category: Mistake["category"], resolved = false): Mistake => ({
  id: crypto.randomUUID(),
  attemptId: "attempt-1",
  question: "1a",
  category,
  explanation: "Missed a step",
  correction: "Show the step",
  resolved,
  createdAt: "2026-07-11T00:00:00.000Z",
  updatedAt: "2026-07-11T00:00:00.000Z",
})

test("ranks revision categories by unresolved mistakes", () => {
  expect(buildRevisionPriorities([
    mistake("Concept"),
    mistake("Algebra"),
    mistake("Concept", true),
    mistake("Algebra"),
  ])).toEqual([
    { category: "Algebra", unresolved: 2, resolved: 0 },
    { category: "Concept", unresolved: 1, resolved: 1 },
  ])
})

test("builds a revision queue from recurring categories, oldest first", () => {
  const olderConcept = { ...mistake("Concept"), id: "concept-old", updatedAt: "2026-07-09T00:00:00.000Z" }
  const newerConcept = { ...mistake("Concept"), id: "concept-new", updatedAt: "2026-07-10T00:00:00.000Z" }
  const algebra = { ...mistake("Algebra"), id: "algebra" }
  const mastered = { ...mistake("Concept", true), id: "mastered" }

  expect(buildRevisionQueue([algebra, newerConcept, mastered, olderConcept]).map((item) => item.id)).toEqual([
    "concept-old",
    "concept-new",
    "algebra",
  ])
})

test("summarises due cards by Anki-style learning state", () => {
  const now = new Date("2026-07-19T00:00:00.000Z")
  const cards: Mistake[] = [
    { ...mistake("Concept"), id: "new", dueAt: "2026-07-19T00:00:00.000Z" },
    { ...mistake("Concept"), id: "learning", reviewState: "learning", dueAt: "2026-07-18T00:00:00.000Z" },
    { ...mistake("Concept", true), id: "mature", reviewState: "review", intervalDays: 30, dueAt: "2026-07-19T00:00:00.000Z" },
    { ...mistake("Concept"), id: "future", dueAt: "2026-07-20T00:00:00.000Z" },
    { ...mistake("Concept"), id: "suspended", suspended: true },
  ]
  expect(getMistakeQueueCounts(cards, now)).toEqual({
    new: 1,
    learning: 1,
    review: 1,
    relearning: 0,
    due: 3,
    scheduled: 1,
    mature: 1,
    suspended: 1,
  })
  expect(formatReviewInterval("2026-07-19T00:10:00.000Z", now)).toBe("10m")
  expect(formatReviewInterval("2026-07-22T00:00:00.000Z", now)).toBe("3d")
})

test("summarises mistake mastery and recent review progress", () => {
  const now = new Date("2026-07-21T00:00:00.000Z")
  const improving: Mistake = {
    ...mistake("Concept", true),
    id: "improving",
    reviewState: "review",
    intervalDays: 25,
    reviewHistory: [
      { id: "previous", completedAt: "2026-06-10T00:00:00.000Z", result: "again", intervalDays: 0 },
      { id: "recent-1", completedAt: "2026-07-01T00:00:00.000Z", result: "good", intervalDays: 10 },
      { id: "recent-2", completedAt: "2026-07-20T00:00:00.000Z", result: "easy", intervalDays: 25 },
    ],
  }
  const learning: Mistake = {
    ...mistake("Algebra"),
    id: "learning",
    reviewHistory: [
      { id: "previous", completedAt: "2026-06-20T00:00:00.000Z", result: "correct", intervalDays: 3 },
      { id: "recent", completedAt: "2026-07-19T00:00:00.000Z", result: "hard", intervalDays: 1 },
    ],
  }

  expect(getMistakeProgress([improving, learning, { ...mistake("Timing"), suspended: true }], now)).toEqual({
    activeCards: 2,
    matureCards: 1,
    masteryPercent: 50,
    reviewsCompleted: 3,
    recallRate: 100,
    recallDelta: 50,
    strengthenedCards: 1,
    newlyMatureCards: 1,
  })
})
