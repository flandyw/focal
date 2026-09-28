import { describe, expect, test } from "bun:test"

import type { ExamAttempt } from "@/lib/exam-data"
import { isTechSplitMathsSubject, matchesMathsExamFilter } from "@/lib/mistake-filters"

function attempt(subject: string, paper: string) {
  return { subject, paper } as ExamAttempt
}

describe("maths mistake filters", () => {
  test("recognises maths subjects with tech-free and tech-active exams", () => {
    expect(isTechSplitMathsSubject("Mathematical Methods")).toBe(true)
    expect(isTechSplitMathsSubject("Mathematical Methods (CAS)")).toBe(true)
    expect(isTechSplitMathsSubject("Specialist Mathematics")).toBe(true)
    expect(isTechSplitMathsSubject("General Mathematics")).toBe(false)
    expect(isTechSplitMathsSubject("Foundation Mathematics")).toBe(false)
    expect(isTechSplitMathsSubject("Physics")).toBe(false)
  })

  test("separates exam 1 and exam 2 attempts", () => {
    expect(matchesMathsExamFilter(attempt("Mathematical Methods", "Exam 1"), "exam-1")).toBe(true)
    expect(matchesMathsExamFilter(attempt("Mathematical Methods", "Examination 2"), "exam-2")).toBe(true)
    expect(matchesMathsExamFilter(attempt("Specialist Mathematics", "Exam 2 - calculator allowed"), "exam-1")).toBe(false)
  })

  test("does not include non-maths or unnumbered papers in a selected exam", () => {
    expect(matchesMathsExamFilter(attempt("Physics", "Exam 1"), "exam-1")).toBe(false)
    expect(matchesMathsExamFilter(attempt("Mathematical Methods", "Exam"), "exam-1")).toBe(false)
    expect(matchesMathsExamFilter(undefined, "exam-2")).toBe(false)
  })

  test("keeps every attempt when all exams are selected", () => {
    expect(matchesMathsExamFilter(attempt("Physics", "Exam"), "all")).toBe(true)
    expect(matchesMathsExamFilter(undefined, "all")).toBe(true)
  })
})
