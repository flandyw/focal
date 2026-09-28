import { describe, expect, test } from "bun:test"
import type { ExamAttempt, Mistake } from "@/lib/exam-data"
import { filterMistakeLibrary, type LibraryFilters } from "@/lib/mistake-library"

const defaults: LibraryFilters = { search: "", browserFilter: "all", category: "all", topic: "all", sort: "due" }
const card = (id: string, overrides: Partial<Mistake> = {}): Mistake => ({
  id, attemptId: "exam", question: "Question " + id, category: "Knowledge gap", explanation: "Forgot the rule",
  correction: "Check units", resolved: false, createdAt: "2026-01-01", updatedAt: "2026-01-01",
  dueAt: "2026-01-02", ...overrides,
})
const cards = [
  card("2", { areaOfStudy: "Algebra", marksLost: 1 }),
  card("10", { areaOfStudy: "Calculus", marksLost: 4, createdAt: "2026-02-01", suspended: true }),
  card("3", { attemptId: "deleted", areaOfStudy: "Algebra", marksLost: 2, dueAt: "2026-01-01" }),
]
const attempts = new Map([["exam", { title: "Trial paper", subject: "Methods" } as ExamAttempt]])
const filter = (overrides: Partial<LibraryFilters> = {}) => filterMistakeLibrary(cards, attempts, new Set(["2", "3"]), { ...defaults, ...overrides }).map((item) => item.id)

describe("mistake library", () => {
  test("combines text, topic, category and schedule constraints", () => {
    expect(filter({ search: "  UNITS  ", topic: "Algebra", category: "Knowledge gap", browserFilter: "due" })).toEqual(["3", "2"])
    expect(filter({ search: "Trial", topic: "Algebra" })).toEqual(["2"])
    expect(filter({ topic: "Calculus", browserFilter: "due" })).toEqual([])
  })
  test("keeps deleted-exam cards discoverable and supports subject search", () => {
    expect(filter()).toContain("3")
    expect(filter({ search: "methods" })).toEqual(["2", "10"])
  })
  test("paused cards remain available for browsing but not active review views", () => {
    expect(filter({ browserFilter: "suspended" })).toEqual(["10"])
    expect(filter({ browserFilter: "new" })).not.toContain("10")
  })
  test("sorts marks, dates and question numbers without mutating stored order", () => {
    expect(filter({ sort: "marks" })).toEqual(["10", "3", "2"])
    expect(filter({ sort: "newest" })[0]).toBe("10")
    expect(filter({ sort: "oldest" }).at(-1)).toBe("10")
    expect(filter({ sort: "question" })).toEqual(["2", "3", "10"])
    expect(cards.map((item) => item.id)).toEqual(["2", "10", "3"])
  })
})
