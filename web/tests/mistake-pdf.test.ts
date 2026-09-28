import { expect, test } from "bun:test"
import { buildMistakesTex } from "../src/lib/mistake-pdf"
import type { ExamAttempt, Mistake } from "../src/lib/exam-data"

test("builds a printable TeX worksheet while preserving maths", () => {
  const attempt = { id: "a", subject: "Maths & Methods", provider: "VCAA", examYear: 2025, paper: "Exam 1" } as ExamAttempt
  const mistake = { id: "m", attemptId: "a", question: "Q4_b", questionText: "Solve $x^2 + 1 = 0$.\n\nShow 50% of your work.", totalMarks: 3 } as Mistake
  const tex = buildMistakesTex([mistake], [attempt])

  expect(tex).toContain("Q4\\_b")
  expect(tex).toContain("$x^2 + 1 = 0$")
  expect(tex).toContain("50\\%")
  expect(tex).toContain("MATHS \\& METHODS")
  expect(tex).toContain("UNOFFICIAL PRACTICE MATERIAL")
  expect(tex).toContain("\\questionheader{Question 1}{\\markbox{3}}")
  expect(tex).toContain("\\sourcequestion{VCAA 2025 Exam 1}{Q4\\_b}")
  expect(tex).toContain("\\workingarea")
  expect(tex).toContain("\\thispagestyle{lastquestion}")
})

test("summarises the worksheet marks on the cover", () => {
  const attempt = { id: "a", subject: "Mathematical Methods", provider: "VCAA", examYear: 2025, paper: "Examination 1" } as ExamAttempt
  const mistakes = [
    { id: "m1", attemptId: "a", question: "1a", totalMarks: 2 },
    { id: "m2", attemptId: "a", question: "2b", totalMarks: 4 },
  ] as Mistake[]

  const tex = buildMistakesTex(mistakes, [attempt])

  expect(tex).toContain("Tasks & 2 tasks")
  expect(tex).toContain("Total marks & 6 marks")
  expect(tex).toContain("Show sufficient reasoning, evidence or working")
  expect(tex).toContain("MATHEMATICAL METHODS")
  expect(tex).toContain("Examination 1")
})
