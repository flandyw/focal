import { describe, expect, test } from "bun:test"

import { isTimetable } from "../src/lib/timetable"

/**
 * The loader's guards. These mirror the validators in use-reference-data.ts:
 * a row missing the strings every consumer calls `.toLowerCase()` on is
 * dropped at the boundary, because a render that throws is a white screen.
 */
function usableReferences(value: unknown) {
  if (!Array.isArray(value)) return []
  const text = (entry: unknown) => typeof entry === "string" && entry.trim().length > 0
  return value.filter((entry: any) =>
    entry && typeof entry === "object" && !Array.isArray(entry) &&
    text(entry.id) && text(entry.studyName) && text(entry.name) &&
    typeof entry.year === "number" && typeof entry.maxScore === "number" &&
    Array.isArray(entry.gradeBands))
}

function usableStudies(value: unknown) {
  if (!Array.isArray(value)) return []
  const text = (entry: unknown) => typeof entry === "string" && entry.trim().length > 0
  return value.filter((entry: any) =>
    entry && typeof entry === "object" && !Array.isArray(entry) &&
    text(entry.studyName) && Array.isArray(entry.resources))
}

const goodReference = {
  id: "chem-2024", studyName: "Chemistry", name: "Exam 1", year: 2024,
  maxScore: 100, gradeBands: [],
}

describe("reference data trust boundary", () => {
  test("a row without a name is dropped rather than crashing every consumer", () => {
    // The crash this prevents: study.studyName.toLowerCase() and
    // formatReferenceName(item.name) both read these unguarded.
    const payload = [
      goodReference,
      { ...goodReference, id: "no-study-name", studyName: undefined },
      { ...goodReference, id: "no-name", name: undefined },
      { ...goodReference, id: "blank-name", studyName: "   " },
      { ...goodReference, id: "no-bands", gradeBands: undefined },
      null,
      "not-an-object",
    ]
    expect(usableReferences(payload).map((entry: any) => entry.id)).toEqual(["chem-2024"])
  })

  test("studies lose an entry with no studyName, which is what the timer searches on", () => {
    expect(usableStudies([
      { studyName: "Chemistry", pageUrl: "/chem", resources: [] },
      { studyName: undefined, pageUrl: "/x", resources: [] },
      { studyName: "Physics", pageUrl: "/phys" },
    ]).map((entry: any) => entry.studyName)).toEqual(["Chemistry"])
  })

  test("a non-array payload is empty, not a crash", () => {
    expect(usableReferences(undefined)).toEqual([])
    expect(usableReferences({ assessments: [] })).toEqual([])
    expect(usableStudies("nope")).toEqual([])
  })

  test("the timetable loader already validated rather than casting, so this is the standard", () => {
    // The contrast that motivated the fix: this loader checks every field,
    // while the VCAA JSON was a bare `as` cast.
    expect(isTimetable({ year: 2026, sourceUrl: "/t.json", exams: [] })).toBe(true)
    expect(isTimetable({ exams: [] })).toBe(false)
    expect(isTimetable({ year: 2026, sourceUrl: "/t.json", exams: [{ id: "x" }] })).toBe(false)
    expect(isTimetable(null)).toBe(false)
  })
})
