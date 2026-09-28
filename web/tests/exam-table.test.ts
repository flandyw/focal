import { expect, test } from "bun:test"
import { analyseAttempt, type ExamAttempt } from "../src/lib/exam-data"
import { compareExamRows, type ExamSortKey } from "../src/lib/exam-sort"
import { getExamIdFromHash, getExamTarget } from "../src/lib/exam-target"

test("round-trips an exam id through its dashboard target", () => {
  const id = "attempt/with spaces"
  const target = getExamTarget(id)
  expect(target).toBe("exam-attempt%2Fwith%20spaces")
  expect(getExamIdFromHash(`#${target}`)).toBe(id)
  expect(getExamIdFromHash("#mistakes")).toBeNull()
})

test("sorts exam columns and keeps same-year paper sets together", () => {
  const attempts = [
    { id: "chem", subject: "Chemistry", provider: "VCAA", title: "Chem", examYear: 2024, paper: "Exam", completedAt: "2026-06-01", rawScore: 30, rawMax: 50 },
    { id: "methods-2", subject: "Mathematical Methods", provider: "VCAA", title: "Methods", examYear: 2024, paper: "Exam 2", completedAt: "2026-07-01", rawScore: 32, rawMax: 40 },
    { id: "methods-1", subject: "Mathematical Methods", provider: "VCAA", title: "Methods", examYear: 2024, paper: "Exam 1", completedAt: "2026-05-01", rawScore: 36, rawMax: 40 },
    { id: "english", subject: "English", provider: "VCAA", title: "English", examYear: 2025, paper: "Exam", completedAt: "2026-04-01", rawScore: 35, rawMax: 50 },
  ] as ExamAttempt[]
  const rows = attempts.map((attempt) => ({ attempt, reference: undefined, analysis: analyseAttempt(attempt) }))
  rows[1].analysis.percentile = 80
  rows[2].analysis.percentile = 90
  rows[3].analysis.percentile = 70
  const ids = (key: ExamSortKey) => rows.toSorted((a, b) => compareExamRows(a, b, key, "desc")).map(({ attempt }) => attempt.id)

  expect(ids("examYear")).toEqual(["english", "chem", "methods-1", "methods-2"])
  expect(ids("completedAt")).toEqual(["methods-2", "chem", "methods-1", "english"])
  expect(ids("mark")).toEqual(["methods-1", "english", "methods-2", "chem"])
  expect(ids("result")).toEqual(["methods-1", "methods-2", "english", "chem"])
  expect(ids("comparison")).toEqual(["methods-1", "methods-2", "english", "chem"])
})
