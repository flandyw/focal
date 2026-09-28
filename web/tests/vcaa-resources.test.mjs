import { expect, test } from "bun:test"
import { parseStudyIndex, parseStudyResources } from "../vcaa/import-exam-resources.mjs"

test("parses VCAA study pages and classifies official resources", () => {
  expect(parseStudyIndex('<a href="/assessment/vce/examination-specifications-past-examinations-and-examination-reports/english">English</a>'))
    .toEqual([{ studyName: "English", pageUrl: "https://www.vcaa.vic.edu.au/assessment/vce/examination-specifications-past-examinations-and-examination-reports/english" }])
  expect(parseStudyResources('<a href="/files/2025-English.pdf">2025 VCE English examination</a><a href="/files/2025-report.docx">2025 English external assessment report</a>'))
    .toEqual([
      { label: "2025 VCE English examination", url: "https://www.vcaa.vic.edu.au/files/2025-English.pdf", kind: "exam", year: 2025 },
      { label: "2025 English external assessment report", url: "https://www.vcaa.vic.edu.au/files/2025-report.docx", kind: "report", year: 2025 },
    ])
})

test("does not classify presentation transcripts as exam papers", () => {
  expect(parseStudyResources('<a href="/sites/default/files/2025-04/VCE_Mathematical_Methods_Exam_1.docx">Mathematics Methods Examination 1 transcript</a>'))
    .toEqual([{
      label: "Mathematics Methods Examination 1 transcript",
      url: "https://www.vcaa.vic.edu.au/sites/default/files/2025-04/VCE_Mathematical_Methods_Exam_1.docx",
      kind: "other",
      year: 2025,
    }])
})

test("recovers archive years from URLs and does not classify assessment reports as exams", () => {
  expect(parseStudyResources('<a href="/Documents/exams/philosophy/2006philos-w.pdf">Exam</a><a href="/Documents/exams/philosophy/philosophy_assessrep_06.pdf">Exam</a>'))
    .toEqual([
      { label: "Exam", url: "https://www.vcaa.vic.edu.au/Documents/exams/philosophy/2006philos-w.pdf", kind: "exam", year: 2006 },
      { label: "Exam", url: "https://www.vcaa.vic.edu.au/Documents/exams/philosophy/philosophy_assessrep_06.pdf", kind: "report", year: 2006 },
    ])
})

test("repairs VCAA's protocol-relative archive paths", () => {
  expect(parseStudyResources('<a href="//sites/default/files/Documents/exams/industryenterprise/industenterstudies05.pdf">Exam</a>')[0].url)
    .toBe("https://www.vcaa.vic.edu.au/sites/default/files/Documents/exams/industryenterprise/industenterstudies05.pdf")
})
