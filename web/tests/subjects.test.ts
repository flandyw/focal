import { describe, expect, test } from "bun:test"
import { firstPreferredSubject, isPreferredSubject, prioritiseSubjects } from "../src/lib/subjects"

describe("subject priority", () => {
  test("keeps selected subjects first in priority order", () => {
    const subjects = ["English", "Chemistry", "Biology", "Mathematical Methods"]
    const preferred = ["Mathematical Methods", "Chemistry"]
    expect(prioritiseSubjects(subjects, preferred)).toEqual(["Mathematical Methods", "Chemistry", "Biology", "English"])
    expect(firstPreferredSubject(subjects, preferred)).toBe("Mathematical Methods")
    expect(isPreferredSubject("chemistry", preferred)).toBe(true)
  })
})
