/// <reference types="bun-types" />
import { expect, test } from "bun:test"
import { EMPTY_APP_DATA } from "./exam-data"
import { subjectKey } from "./studySubjects"
import { isPreferredSubject } from "./subjects"
import { currentSubjectWork, setSubjects, setSubjectCompletion } from "./subject-completion"

test("subject keys match aliases without merging distinct English subjects", () => {
  for (const alias of ["Methods", " mm ", "MCM", "Mathematical Methods CAS"]) {
    expect(subjectKey(alias)).toBe(subjectKey("Mathematical Methods"))
    expect(isPreferredSubject(alias, ["Mathematical Methods"])).toBe(true)
  }
  expect(subjectKey("English Language")).not.toBe(subjectKey("English"))
})
test("removing a subject prunes completion and year before re-adding", () => {
  const data = setSubjectCompletion({ ...EMPTY_APP_DATA, subjects: ["Methods", "English"] }, "Mathematical Methods", 2025)
  expect(currentSubjectWork(data).subjects).toEqual(["English"])
  const removed = setSubjects(data, ["English"])
  expect(removed.completedSubjects).toEqual([])
  expect(removed.subjectCompletionYears).toEqual({})
  expect(setSubjects(removed, ["English", "Methods"]).completedSubjects).toEqual([])
  expect(setSubjects(data, ["mm", "Methods", "English"]).subjects).toEqual(["Methods", "English"])
  expect(setSubjects(data, ["mm"]).completedSubjects).toEqual(["Mathematical Methods"])
})
