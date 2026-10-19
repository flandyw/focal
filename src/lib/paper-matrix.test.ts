/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import type { ExamAttempt, Mistake, QuestionResult } from "./exam-data"
import { failingCase, FAILING_CASE_SUBJECT } from "./fixtures/failing-case"
import { buildPaperDataQuality, buildPaperWeaknessMatrix, WEAKNESS_THRESHOLDS } from "./performance-insights"

const SUBJECT = FAILING_CASE_SUBJECT
const TOPIC = "Integration & area"
const { minCards, minMarksLostPerPaper, dominanceRatio } = WEAKNESS_THRESHOLDS

const attempt = (id: string, paper: "Exam 1" | "Exam 2", questionResults?: QuestionResult[]): ExamAttempt => ({
  id, subject: SUBJECT, provider: "VCAA", title: id, examYear: 2025, paper, completedAt: "2026-03-01",
  rawScore: 20, rawMax: paper === "Exam 1" ? 40 : 80, referenceId: null, createdAt: "", updatedAt: "", questionResults,
})
const card = (id: string, attemptId: string, marksLost: number | undefined, category: Mistake["category"] = "Algebra"): Mistake => ({
  id, attemptId, question: id, category, explanation: "", correction: "", topic: TOPIC, marksLost, totalMarks: marksLost === undefined ? undefined : marksLost + 1,
  resolved: false, createdAt: "", updatedAt: "",
})
const result = (label: string, awarded: number, max: number): QuestionResult => ({ id: label, label, marksAwarded: awarded, maxMarks: max, topic: TOPIC, confidence: "medium" })
const row = (attempts: ExamAttempt[], mistakes: Mistake[]) => buildPaperWeaknessMatrix(attempts, mistakes, SUBJECT).find((item) => item.areaOfStudy === TOPIC)!

// One Exam 1 paper (40) and one Exam 2 paper (80), so 3 marks on Exam 1 is 7.5 per 100 and 6 marks on Exam 2 is 7.5 per 100.
const papers = [attempt("e1", "Exam 1"), attempt("e2", "Exam 2")]

describe("mistake-based diagnosis states (no question results)", () => {
  test("no cards on a topic reads no evidence, not a strength", () => {
    expect(row(papers, []).diagnosis).toBe("no evidence")
  })

  test(`fewer than ${minCards} cards is mistake-only evidence, whatever they cost`, () => {
    expect(row(papers, [card("a", "e1", 9), card("b", "e1", 9)]).diagnosis).toBe("mistake-only evidence")
  })

  test("cards that cost nothing, or have no marks, stay mistake-only evidence", () => {
    const unknown = [card("a", "e1", undefined), card("b", "e1", undefined), card("c", "e2", undefined)]
    const found = row(papers, unknown)
    expect(found.diagnosis).toBe("mistake-only evidence")
    expect(found.exam1.cardsWithoutMarks).toBe(2)
  })

  test("loss on one paper only is that paper's gap", () => {
    const e1 = [card("a", "e1", 1), card("b", "e1", 1), card("c", "e1", 1)]
    expect(row(papers, e1).diagnosis).toBe("exam-1-only gap")
    expect(row(papers, e1.map((item) => ({ ...item, attemptId: "e2" }))).diagnosis).toBe("exam-2-only gap")
  })

  test("the per-paper threshold is inclusive", () => {
    const at = (marks: number) => [card("a", "e1", marks / 2), card("b", "e1", marks / 2), card("c", "e1", 0)]
    expect(row(papers, at(minMarksLostPerPaper)).diagnosis).toBe("exam-1-only gap")
    expect(row(papers, at(minMarksLostPerPaper - 0.5)).diagnosis).toBe("mistake-only evidence")
  })

  test("both papers losing at a similar rate per 100 marks is a shared weakness", () => {
    const cards = [card("a", "e1", 1.5), card("b", "e1", 1.5), card("c", "e2", 3), card("d", "e2", 3)]
    expect(row(papers, cards).diagnosis).toBe("shared weakness")
  })

  test(`a paper losing ${dominanceRatio}x the rate of the other is its gap even if both lose marks`, () => {
    const e1Heavy = [card("a", "e1", 6), card("b", "e2", 1), card("c", "e2", 1)] // 15 vs 2.5 per 100
    expect(row(papers, e1Heavy).diagnosis).toBe("exam-1-only gap")
    const e2Heavy = [card("a", "e2", 12), card("b", "e1", 1), card("c", "e1", 1)] // 15 vs 5 per 100 (ratio exactly 3)
    expect(row(papers, e2Heavy).diagnosis).toBe("exam-2-only gap")
  })

  test("suspended cards are not evidence", () => {
    const suspended = [card("a", "e1", 3), card("b", "e1", 3), card("c", "e1", 3)].map((item) => ({ ...item, suspended: true }))
    expect(row(papers, suspended).diagnosis).toBe("no evidence")
  })
})

describe("what each cell carries", () => {
  test("marks lost, repeat mistakes, dominant category and the category split per paper", () => {
    const cards = [card("a", "e1", 3, "Algebra"), card("b", "e1", 2, "Algebra"), card("c", "e1", 1, "Calculator"), card("d", "e2", 4, "Reasoning")]
    const found = row(papers, cards)
    expect(found.basis).toBe("mistakes")
    expect(found.exam1).toMatchObject({ mistakeCount: 3, marksLost: 6, repeatMistakes: 1, dominantCategory: "Algebra" })
    expect(found.exam1.lostByCategory).toEqual([{ category: "Algebra", marks: 5, cards: 2 }, { category: "Calculator", marks: 1, cards: 1 }])
    expect(found.exam2).toMatchObject({ mistakeCount: 1, marksLost: 4, repeatMistakes: 0, dominantCategory: "Reasoning" })
  })

  test("with no marks on any card the dominant category is the most frequent one", () => {
    const found = row(papers, [card("a", "e1", undefined, "Concept"), card("b", "e1", undefined, "Accuracy"), card("c", "e1", undefined, "Accuracy")])
    expect(found.exam1.dominantCategory).toBe("Accuracy")
  })
})

describe("matrix from marked questions", () => {
  const marked = (e1: [number, number], e2: [number, number]) => [
    attempt("e1", "Exam 1", [result("1", ...e1)]), attempt("e2", "Exam 2", [result("1", ...e2)]),
  ]

  test("keeps the technology states and prefers marks to cards", () => {
    expect(row(marked([6, 10], [9, 10]), []).diagnosis).toBe("tech-free fragile")
    expect(row(marked([9, 10], [6, 10]), []).diagnosis).toBe("tech-active fragile")
    expect(row(marked([6, 10], [7, 10]), []).diagnosis).toBe("general weakness")
    expect(row(marked([9.2, 10], [9, 10]), []).diagnosis).toBe("secure")
    expect(row(marked([9, 10], [9, 10]), [card("a", "e1", 5)]).basis).toBe("results")
  })

  test("evidence on one paper only is named for that paper, not hidden", () => {
    // Results mode needs some topic marked on both papers; here that is Circular functions.
    const circular = (paper: "Exam 1" | "Exam 2") => ({ ...result(`c-${paper}`, 9, 10), topic: "Circular functions" })
    const build = (awarded: number) => [attempt("e1", "Exam 1", [result("1", awarded, 10), circular("Exam 1")]), attempt("e2", "Exam 2", [circular("Exam 2")])]
    expect(row(build(5), []).diagnosis).toBe("exam-1-only gap")
    expect(row(build(10), []).diagnosis).toBe("stable")
  })
})

describe("data quality on the failing case", () => {
  const { attempts, mistakes } = failingCase()
  const quality = buildPaperDataQuality(attempts, mistakes, SUBJECT)

  test("reports every gap in the data", () => {
    expect(quality).toMatchObject({ attempts: 53, attemptsWithoutQuestionResults: 53, cards: 102, cardsWithoutTopic: 102, cardsWithoutMarksLost: 0, cardsOnOtherPapers: 0 })
    expect(quality.papersWithRawMaxMismatch.map((paper) => `${paper.paper}:${paper.rawMax}`).toSorted()).toEqual(
      ["Exam 1:80", "Exam 1:80", "Exam 1:80", "Exam 2:40", "Exam 2:40", "Exam 2:40"])
    expect(quality.warnings.length).toBeGreaterThanOrEqual(4)
  })

  test("shows unattributed marks per paper and leaves mis-totalled papers out of them", () => {
    const { exam1, exam2 } = quality.lostMarks
    expect(exam1.papers + exam2.papers).toBe(53 - 6)
    expect(exam1.unattributedMarks).toBeGreaterThan(0)
    expect(exam2.unattributedMarks).toBeGreaterThan(0)
    expect(exam1.unattributedMarks).toBeLessThanOrEqual(exam1.marksLost)
  })

  test("the matrix is no longer all 'insufficient evidence': it names which paper loses marks", () => {
    const rows = buildPaperWeaknessMatrix(attempts, mistakes, SUBJECT)
    const states = new Set(rows.map((item) => item.diagnosis))
    expect(states.has("exam-1-only gap")).toBe(true)
    expect(states.has("exam-2-only gap")).toBe(true)
    expect(rows.every((item) => item.basis === "mistakes" && item.groupBy === "topic")).toBe(true)
  })

  test("per-100 rates use the usual total for a paper logged out of the wrong mark", () => {
    const clean = failingCase()
    const fixed = clean.attempts.map((item) => ({ ...item, rawMax: item.paper === "Exam 1" ? 40 : 80 }))
    const a = buildPaperWeaknessMatrix(attempts, mistakes, SUBJECT)
    const b = buildPaperWeaknessMatrix(fixed, clean.mistakes, SUBJECT)
    expect(a.map((item) => [item.exam1.lostPer100, item.exam2.lostPer100])).toEqual(b.map((item) => [item.exam1.lostPer100, item.exam2.lostPer100]))
  })
})
