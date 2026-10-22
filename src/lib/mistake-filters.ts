import { normaliseComparisonName, type ExamAttempt } from "./exam-data.js"
import { paperTypeOf } from "./paper-types.js"

export type MathsExamFilter = "all" | "exam-1" | "exam-2"

const TECH_SPLIT_MATHS_SUBJECTS = new Set([
  "mathematical methods",
  "mathematical methods cas",
  "specialist mathematics",
])

export function isTechSplitMathsSubject(subject: string) {
  return TECH_SPLIT_MATHS_SUBJECTS.has(normaliseComparisonName(subject))
}

/** Exam 1 or 2, honouring a stored paperType. A combined paper is neither, so it never lands in either column. */
export function getAttemptMathsPaper(attempt: Pick<ExamAttempt, "paper" | "paperType">): 1 | 2 | null {
  const type = paperTypeOf(attempt)
  return type === "exam1" ? 1 : type === "exam2" ? 2 : null
}

export function getMathsExamPaper(paper: string): 1 | 2 | null {
  return getAttemptMathsPaper({ paper })
}

export function matchesMathsExamFilter(attempt: ExamAttempt | undefined, filter: MathsExamFilter) {
  if (filter === "all") return true
  if (!attempt || !isTechSplitMathsSubject(attempt.subject)) return false

  const paperNumber = getAttemptMathsPaper(attempt)
  return paperNumber === (filter === "exam-1" ? 1 : 2)
}
