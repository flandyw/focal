import type { AssessmentReference, AttemptAnalysis, ExamAttempt } from "./exam-data"

export type ExamSortKey = "examYear" | "completedAt" | "mark" | "result" | "comparison"
export type SortDirection = "asc" | "desc"
type ExamRow = {
  attempt: ExamAttempt
  reference: AssessmentReference | undefined
  analysis: AttemptAnalysis
}

const examSetCollator = new Intl.Collator("en-AU", { numeric: true, sensitivity: "base" })

export function compareExamRows(left: ExamRow, right: ExamRow, key: ExamSortKey, direction: SortDirection) {
  if (key === "examYear") {
    const year = left.attempt.examYear - right.attempt.examYear
    if (year) return year * (direction === "asc" ? 1 : -1)
    return examSetCollator.compare(left.attempt.subject, right.attempt.subject)
      || examSetCollator.compare(left.attempt.provider, right.attempt.provider)
      || examSetCollator.compare(left.attempt.paper, right.attempt.paper)
  }

  if (key === "completedAt") return left.attempt.completedAt.localeCompare(right.attempt.completedAt) * (direction === "asc" ? 1 : -1)
  const leftValue = key === "mark" ? left.reference ? left.analysis.scaledScore : left.attempt.rawScore
    : key === "result" ? left.analysis.percentage : left.analysis.percentile
  const rightValue = key === "mark" ? right.reference ? right.analysis.scaledScore : right.attempt.rawScore
    : key === "result" ? right.analysis.percentage : right.analysis.percentile
  if (leftValue == null) return rightValue == null ? 0 : 1
  if (rightValue == null) return -1
  return (leftValue - rightValue) * (direction === "asc" ? 1 : -1)
}
