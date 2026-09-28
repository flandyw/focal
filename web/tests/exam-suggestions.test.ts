import { describe, expect, test } from "bun:test"
import { buildCompanyExamSuggestions, buildExamSuggestions } from "../src/lib/exam-suggestions"
import { analyseAttempt, type AssessmentReference, type ExamAttempt } from "../src/lib/exam-data"
import { getKnownExamConditions } from "../src/lib/exam-conditions"
import { DEFAULT_EXAM_DIFFICULTY, MATHEMATICS_PROVIDER_DIFFICULTY } from "../src/lib/exam-difficulty"
import type { VcaaStudyResources } from "../src/lib/vcaa-resources"

function reference(year: number, paper: number, studyName = "Mathematical Methods"): AssessmentReference {
  return {
    id: `${studyName}:${year}:${paper}`,
    studyCode: "METHODS",
    studyName,
    displayName: studyName,
    year,
    gaCode: `GA ${paper + 1}`,
    name: `WRITTEN EXAMINATION ${paper}`,
    maxScore: studyName === "Mathematical Methods" ? (paper === 1 ? 80 : 160) : (paper === 1 ? 40 : 80),
    sourceUrl: "https://example.test",
    gradeBands: [],
  }
}

function attempt(overrides: Partial<ExamAttempt> = {}): ExamAttempt {
  return {
    id: "attempt-1",
    subject: "Mathematical Methods",
    provider: "VCAA",
    title: "VCAA 2011 Mathematical Methods",
    examYear: 2011,
    paper: "Exam 2",
    completedAt: "2026-07-19",
    rawScore: 60,
    rawMax: 80,
    referenceId: null,
    createdAt: "2026-07-19T10:00:00.000Z",
    updatedAt: "2026-07-19T10:00:00.000Z",
    ...overrides,
  }
}

const references = [
  reference(2011, 1),
  reference(2011, 2),
  reference(2012, 1),
  reference(2012, 2),
  reference(2013, 1),
  reference(2013, 2),
]

const archivedStudies: VcaaStudyResources[] = [{
  studyName: "Mathematical Methods",
  pageUrl: "https://example.test/methods",
  resources: [2012, 2013].flatMap((year) => [1, 2].map((paper) => ({
    label: `${year} Mathematical Methods exam ${paper}`,
    url: `https://example.test/${year}-${paper}`,
    kind: "exam" as const,
    year,
  }))),
}]

const mathematicsDifficulty = {
  ...DEFAULT_EXAM_DIFFICULTY,
  providerOrder: [...MATHEMATICS_PROVIDER_DIFFICULTY],
}

describe("next exam suggestions", () => {
  test("uses raw Methods paper marks while retaining doubled distribution scaling", () => {
    const methodsReferences = [reference(2025, 1), reference(2025, 2)]

    expect(buildExamSuggestions([], methodsReferences, ["Mathematical Methods"], 2)).toEqual([
      expect.objectContaining({ paper: "Exam 1", marks: 40 }),
      expect.objectContaining({ paper: "Exam 2", marks: 80 }),
    ])
    expect(methodsReferences.map((item) => item.maxScore)).toEqual([80, 160])
    expect(analyseAttempt({ rawScore: 30, rawMax: 40 }, methodsReferences[0]).scaledScore).toBe(60)
  })

  test("uses the correct Methods reading and writing times", () => {
    expect(getKnownExamConditions("Mathematical Methods", "Exam 1")).toEqual({
      readingMinutes: 15,
      writingMinutes: 60,
      marks: 40,
    })
    expect(getKnownExamConditions("Mathematical Methods", "Exam 2")).toEqual({
      readingMinutes: 15,
      writingMinutes: 120,
      marks: 80,
    })
  })

  test("uses the current VCAA paper marks and timed conditions across the first subject groups", () => {
    const conditions = [
      ["Biology", "Exam", 15, 150, 120],
      ["Chemistry", "Exam", 15, 150, 120],
      ["Environmental Science", "Exam", 15, 120, 120],
      ["Physics", "Exam", 15, 150, 120],
      ["Psychology", "Exam", 15, 150, 120],
      ["Foundation Mathematics", "Exam", 15, 120, 80],
      ["General Mathematics", "Exam 1", 15, 90, 40],
      ["General Mathematics", "Exam 2", 15, 90, 60],
      ["Mathematical Methods", "Exam 1", 15, 60, 40],
      ["Mathematical Methods", "Exam 2", 15, 120, 80],
      ["Specialist Mathematics", "Exam 1", 15, 60, 40],
      ["Specialist Mathematics", "Exam 2", 15, 120, 80],
      ["English", "Exam", 15, 180, 60],
      ["English as an Additional Language (EAL)", "Exam", 15, 180, 60],
      ["English Language", "Exam", 15, 120, 75],
      ["Literature", "Exam", 15, 120, 40],
      ["Physical Education", "Exam", 15, 120, 110],
    ] as const

    for (const [subject, paper, readingMinutes, writingMinutes, marks] of conditions) {
      expect(getKnownExamConditions(subject, paper)).toEqual({ readingMinutes, writingMinutes, marks })
    }
  })

  test("continues the latest subject into the next exam years", () => {
    expect(buildExamSuggestions([attempt()], references, ["Mathematical Methods"])).toEqual([
      expect.objectContaining({ examYear: 2012, paper: "Exam 1" }),
      expect.objectContaining({ examYear: 2012, paper: "Exam 2" }),
      expect.objectContaining({ examYear: 2013, paper: "Exam 1" }),
      expect.objectContaining({ examYear: 2013, paper: "Exam 2" }),
    ])
  })

  test("skips papers that have already been logged", () => {
    const logged2012 = attempt({ id: "attempt-2", examYear: 2012, paper: "Exam 1", completedAt: "2026-07-20" })
    const suggestions = buildExamSuggestions([attempt(), logged2012], references, ["Mathematical Methods"])
    expect(suggestions.some((item) => item.examYear === 2012 && item.paper === "Exam 1")).toBe(false)
    expect(suggestions).toEqual([
      expect.objectContaining({ examYear: 2012, paper: "Exam 2" }),
      expect.objectContaining({ examYear: 2013, paper: "Exam 1" }),
      expect.objectContaining({ examYear: 2013, paper: "Exam 2" }),
      expect.objectContaining({ examYear: 2011, paper: "Exam 1" }),
    ])
  })

  test("uses preferred subjects and recent papers when there is no attempt history", () => {
    const chemistry = [reference(2024, 1, "Chemistry"), reference(2025, 1, "Chemistry")]
    expect(buildExamSuggestions([], [...references, ...chemistry], ["Chemistry"], 2)).toEqual([
      expect.objectContaining({ subject: "Chemistry", examYear: 2025 }),
      expect.objectContaining({ subject: "Chemistry", examYear: 2024 }),
    ])
  })

  test("continues through archived papers that have no grade distribution", () => {
    const currentReferences = [reference(2021, 1), reference(2021, 2), reference(2022, 1), reference(2022, 2)]
    const latest = attempt({ examYear: 2012, paper: "Exam 1" })
    expect(buildExamSuggestions([latest], currentReferences, ["Mathematical Methods"], 4, archivedStudies)).toEqual([
      expect.objectContaining({ examYear: 2012, paper: "Exam 2" }),
      expect.objectContaining({ examYear: 2013, paper: "Exam 1" }),
      expect.objectContaining({ examYear: 2013, paper: "Exam 2" }),
      expect.objectContaining({ examYear: 2021, paper: "Exam 1" }),
    ])
  })
})

describe("company exam progression", () => {
  test("finishes the current provider before advancing from easier to harder companies", () => {
    const latest = attempt({ provider: "TSSM", title: "TSSM 2011 Mathematical Methods", paper: "Exam 1" })
    expect(buildCompanyExamSuggestions([latest], references, ["Mathematical Methods"], mathematicsDifficulty)).toEqual([
      expect.objectContaining({ provider: "TSSM", examYear: 2011, paper: "Exam 2", marks: 80 }),
      expect.objectContaining({ provider: "Heffernan", examYear: 2011, paper: "Exam 1", marks: 40 }),
      expect.objectContaining({ provider: "Heffernan", examYear: 2011, paper: "Exam 2", marks: 80 }),
      expect.objectContaining({ provider: "Insight", examYear: 2011, paper: "Exam 1", marks: 40 }),
    ])
  })

  test("moves directly to the next company after the current paper set is complete", () => {
    const first = attempt({ id: "tssm-1", provider: "TSSM", title: "TSSM 2011 Mathematical Methods", paper: "Exam 1", completedAt: "2026-07-18" })
    const second = attempt({ id: "tssm-2", provider: "TSSM", title: "TSSM 2011 Mathematical Methods", paper: "Exam 2" })
    expect(buildCompanyExamSuggestions([first, second], references, ["Mathematical Methods"], mathematicsDifficulty, 2)).toEqual([
      expect.objectContaining({ provider: "Heffernan", paper: "Exam 1" }),
      expect.objectContaining({ provider: "Heffernan", paper: "Exam 2" }),
    ])
  })

  test("skips company papers already logged", () => {
    const tssm = attempt({ id: "tssm-2", provider: "TSSM", title: "TSSM 2011 Mathematical Methods", paper: "Exam 2", completedAt: "2026-07-19" })
    const heffernanOne = attempt({ id: "heffernan-1", provider: "Heffernan", title: "Heffernan 2011 Mathematical Methods", paper: "Exam 1", completedAt: "2026-07-20" })
    expect(buildCompanyExamSuggestions([tssm, heffernanOne], references, ["Mathematical Methods"], mathematicsDifficulty, 2)).toEqual([
      expect.objectContaining({ provider: "Heffernan", paper: "Exam 2" }),
      expect.objectContaining({ provider: "Insight", paper: "Exam 1" }),
    ])
  })

  test("starts a new progression at the easiest configured company", () => {
    expect(buildCompanyExamSuggestions([], references, ["Mathematical Methods"], undefined, 1)).toEqual([
      expect.objectContaining({ provider: "TSSM", paper: "Exam 1" }),
    ])
  })
})
