/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { examWarnings, expectedRawMax, parsePaperType, rawMaxWarning, trustedRawMax } from "./paper-types"
import { getAttemptMathsPaper } from "./mistake-filters"

const paper = (subject: string, name: string, rawMax: number, paperType?: "exam1" | "exam2" | "combined") => ({ subject, paper: name, rawMax, paperType })
const METHODS = "Mathematical Methods"

describe("paper type", () => {
  test("is read from the paper text", () => {
    expect(["Exam 1", "Exam 2", "Paper 2", "Exam 1 & 2", "Exam 1 and 2", "Combined", "Trial SAC"].map(parsePaperType))
      .toEqual(["exam1", "exam2", "exam2", "combined", "combined", "combined", null])
  })

  test("a stored paperType wins, and a combined paper is in neither matrix column", () => {
    expect(getAttemptMathsPaper({ paper: "Exam 1", paperType: "combined" })).toBeNull()
    expect(getAttemptMathsPaper({ paper: "Exam 1 & 2" })).toBeNull()
    expect(getAttemptMathsPaper({ paper: "Exam 2" })).toBe(2)
    expect(getAttemptMathsPaper({ paper: "Sitting A", paperType: "exam1" })).toBe(1)
  })
})

describe("rawMax against paper type", () => {
  test("Methods: Exam 1 = 40, Exam 2 = 80, combined = 120 or 160", () => {
    expect(expectedRawMax("Mathematical Methods CAS", "exam1")).toEqual([40])
    for (const ok of [paper(METHODS, "Exam 1", 40), paper(METHODS, "Exam 2", 80), paper(METHODS, "Combined", 120), paper(METHODS, "Exam 1 & 2", 160), paper(METHODS, "Sitting", 120, "combined")]) {
      expect(rawMaxWarning(ok)).toBeNull()
    }
  })

  test("a mismatch warns, and says when the totals look swapped", () => {
    expect(rawMaxWarning(paper(METHODS, "Exam 1", 80))).toContain("usual total for Exam 2")
    expect(rawMaxWarning(paper(METHODS, "Exam 2", 40))).toContain("usual total for Exam 1")
    expect(rawMaxWarning(paper(METHODS, "Exam 2", 100))).toContain("usually marked out of 80")
    expect(rawMaxWarning(paper(METHODS, "Exam 1", 120))).toContain("paperType to combined")
    expect(rawMaxWarning(paper(METHODS, "Combined", 80))).toContain("120 or 160")
  })

  test("never complains about what it cannot judge", () => {
    expect(rawMaxWarning(paper("Chemistry", "Exam 1", 80))).toBeNull()
    expect(rawMaxWarning(paper(METHODS, "Trial SAC", 33))).toBeNull()
  })

  test("a mis-typed total is replaced by the usual one when computing rates, and only then", () => {
    expect(trustedRawMax(paper(METHODS, "Exam 1", 80))).toBe(40)
    expect(trustedRawMax(paper(METHODS, "Exam 2", 80))).toBe(80)
    expect(trustedRawMax(paper("Chemistry", "Exam 1", 80))).toBe(80)
  })

  test("an explicit paperType that disagrees with the paper text is flagged", () => {
    expect(examWarnings(paper(METHODS, "Exam 1", 120, "combined"))).toEqual([expect.stringContaining("paperType wins")])
    expect(examWarnings(paper(METHODS, "Exam 1", 40))).toEqual([])
  })
})
