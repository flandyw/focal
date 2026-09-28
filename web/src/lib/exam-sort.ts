import type { AssessmentReference, AttemptAnalysis, ExamAttempt } from "@/lib/exam-data"

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

  const values = {
    completedAt: [left.attempt.completedAt, right.attempt.completedAt],
    mark: [left.reference ? left.analysis.scaledScore : left.attempt.rawScore, right.reference ? right.analysis.scaledScore : right.attempt.rawScore],
    result: [left.analysis.percentage, right.analysis.percentage],
    comparison: [left.analysis.percentile, right.analysis.percentile],
  }[key]
  const [leftValue, rightValue] = values
  if (leftValue == null) return rightValue == null ? 0 : 1
  if (rightValue == null) return -1
  const comparison = typeof leftValue === "string"
    ? leftValue.localeCompare(rightValue as string)
    : leftValue - (rightValue as number)
  return comparison * (direction === "asc" ? 1 : -1)
}
