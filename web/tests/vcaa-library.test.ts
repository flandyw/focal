import { expect, test } from "bun:test"
import { findVcaaExamAttempt, findVcaaExamForAttempt, findVcaaExamReference, getVcaaExamCompanions, getVcaaExamPaper, getVcaaExamProvider, getVcaaExams, isVcaaExamLogged, type VcaaExamResource } from "../src/lib/vcaa-resources"
import type { AssessmentReference, ExamAttempt } from "../src/lib/exam-data"

const exam: VcaaExamResource = {
  studyName: "Mathematical Methods",
  pageUrl: "https://example.test/methods",
  label: "2006 Mathematical Methods exam 1",
  url: "https://example.test/2006-methods-1.pdf",
  kind: "exam",
  year: 2006,
}

test("includes archived exams without grade distributions", () => {
  expect(getVcaaExams([{ studyName: exam.studyName, pageUrl: exam.pageUrl, resources: [exam] }])).toEqual([exam])
  expect(getVcaaExamPaper(exam)).toBe("Exam 1")
  expect(findVcaaExamReference(exam, [])).toBeUndefined()
  expect(getVcaaExams([{ studyName: exam.studyName, pageUrl: exam.pageUrl, resources: [{ ...exam, year: null }] }])).toHaveLength(1)
})

test("matches optional distributions and logged VCAA attempts", () => {
  const reference = { year: 2006, studyName: exam.studyName, name: "WRITTEN EXAMINATION 1" } as AssessmentReference
  const attempt = { provider: "VCAA", examYear: 2006, subject: exam.studyName, paper: "Exam 1" } as ExamAttempt
  expect(findVcaaExamReference(exam, [reference])).toBe(reference)
  expect(findVcaaExamAttempt(exam, [attempt])).toBe(attempt)
  expect(findVcaaExamForAttempt(attempt, [{ studyName: exam.studyName, pageUrl: exam.pageUrl, resources: [exam] }])).toEqual(exam)
  expect(findVcaaExamForAttempt({ ...attempt, paper: "Exam" }, [{ studyName: exam.studyName, pageUrl: exam.pageUrl, resources: [exam, { ...exam, label: "2006 Mathematical Methods exam 2" }] }])).toBeUndefined()
  expect(isVcaaExamLogged(exam, [attempt])).toBe(true)
  expect(isVcaaExamLogged(exam, [{ ...attempt, paper: "Exam 2" }])).toBe(false)
})

test("excludes accessibility transcripts from the exam list", () => {
  expect(getVcaaExams([{ studyName: "English", pageUrl: exam.pageUrl, resources: [
    { label: "2025 VCE English examination", url: "https://example.test/exam.pdf", kind: "exam", year: 2025 },
    { label: "English Examination transcript", url: "https://example.test/transcript.docx", kind: "exam", year: 2025 },
  ] }])).toEqual([expect.objectContaining({ url: "https://example.test/exam.pdf" })])
})

test("deduplicates papers repeated across VCAA study pages", () => {
  const resource = { label: "2025 Music examination", url: "https://example.test/music.pdf", kind: "exam" as const, year: 2025 }
  expect(getVcaaExams([
    { studyName: "Music", pageUrl: "https://example.test/music", resources: [resource] },
    { studyName: "Music Performance", pageUrl: "https://example.test/music-performance", resources: [resource] },
  ])).toHaveLength(1)
})

test("matches companion resources to the correct numbered paper", () => {
  const methodsExam = { ...exam, year: 2025, label: "2025 VCE Mathematical Methods examination 2" }
  const resources = [
    { label: "2025 VCE Mathematical Methods examination 1 assessment guide", url: "https://example.test/guide-1", kind: "report" as const, year: 2025 },
    { label: "2025 VCE Mathematical Methods examination 2 assessment guide", url: "https://example.test/guide-2", kind: "report" as const, year: 2025 },
    { label: "2025 VCE Mathematical Methods 2 external assessment report", url: "https://example.test/report-2", kind: "report" as const, year: 2025 },
    { label: "Examination specifications", url: "https://example.test/specifications", kind: "specification" as const, year: 2025 },
    { label: "Sample questions for written examination 2", url: "https://example.test/sample-2", kind: "sample" as const, year: null },
  ]
  const companion = getVcaaExamCompanions(methodsExam, { studyName: methodsExam.studyName, pageUrl: methodsExam.pageUrl, resources })

  expect(companion.reports.map((resource) => resource.url)).toEqual([
    "https://example.test/guide-2",
    "https://example.test/report-2",
  ])
  expect(companion.specification?.url).toBe("https://example.test/specifications")
  expect(companion.sample?.url).toBe("https://example.test/sample-2")
})

test("splits the mixed NHT archive into real subjects and providers", () => {
  const nhtStudy = {
    studyName: "NHT past examinations and reports",
    pageUrl: "https://example.test/nht-examination-specifications-past-examinations-and-examination-reports",
    resources: [
      { label: "2026 VCE General Mathematics examination 1", url: "https://example.test/2026-NHT-GeneralMaths1.pdf", kind: "exam" as const, year: 2026 },
      { label: "2026 VCE Mathematical Methods examination 1", url: "https://example.test/2026-NHT-MathMethods1.pdf", kind: "exam" as const, year: 2026 },
      { label: "2026 VCE General Mathematics examination 1 assessment guide", url: "https://example.test/general-guide", kind: "report" as const, year: 2026 },
      { label: "2026 VCE Mathematical Methods examination 1 assessment guide", url: "https://example.test/methods-guide", kind: "report" as const, year: 2026 },
    ],
  }
  const [general, methods] = getVcaaExams([nhtStudy])

  expect(general.studyName).toBe("General Mathematics")
  expect(methods.studyName).toBe("Mathematical Methods")
  expect(getVcaaExamProvider(general)).toBe("VCAA NHT")
  expect(getVcaaExamCompanions(general, nhtStudy).reports.map((resource) => resource.url)).toEqual(["https://example.test/general-guide"])
})
