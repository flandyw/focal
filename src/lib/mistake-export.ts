import { downloadExamFile } from "./host"
import { getMistakeSchedule, type ExamAttempt, type Mistake } from "./exam-data"
import { downloadMistakesPdf } from "./mistake-pdf"

export type ExportFormat = "pdf" | "markdown" | "csv" | "json"

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`

function toRows(mistakes: Mistake[], attempts: ExamAttempt[]) {
  const attemptMap = new Map(attempts.map((attempt) => [attempt.id, attempt]))
  return mistakes.map((mistake) => {
    const attempt = attemptMap.get(mistake.attemptId)
    return {
      exam: attempt?.title ?? "", subject: attempt?.subject ?? "", paper: attempt?.paper ?? "",
      question: mistake.question, questionText: mistake.questionText ?? "", category: mistake.category,
      areaOfStudy: mistake.areaOfStudy ?? "",
      marksLost: mistake.marksLost ?? "", totalMarks: mistake.totalMarks ?? "",
      explanation: mistake.explanation, correction: mistake.correction,
      resolved: getMistakeSchedule(mistake).resolved, suspended: Boolean(mistake.suspended), createdAt: mistake.createdAt,
    }
  })
}

export async function exportMistakes(format: ExportFormat, mistakes: Mistake[], attempts: ExamAttempt[], name = "mistakes") {
  if (format === "pdf") return downloadMistakesPdf(mistakes, attempts, name)
  const rows = toRows(mistakes, attempts)
  const types = { json: "application/json", csv: "text/csv", markdown: "text/markdown" }
  const ext = format === "markdown" ? "md" : format
  const text = format === "json" ? JSON.stringify(rows, null, 2)
    : format === "csv" ? [Object.keys(rows[0]).map(csvCell).join(","), ...rows.map((row) => Object.values(row).map(csvCell).join(","))].join("\n")
    : rows.map((row) => [
      `## ${row.question}${row.exam ? ` — ${row.exam}` : ""}`,
      `*${[row.category, row.areaOfStudy, row.marksLost !== "" ? `${row.marksLost}/${row.totalMarks || "?"} marks lost` : ""].filter(Boolean).join(" · ")}*`,
      row.questionText && `**Question**\n\n${row.questionText}`,
      row.explanation && `**What went wrong**\n\n${row.explanation}`,
      row.correction && `**Correction**\n\n${row.correction}`,
    ].filter(Boolean).join("\n\n")).join("\n\n---\n\n")
  return downloadExamFile(new Blob([text], { type: types[format] }), `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "mistakes"}.${ext}`)
}
