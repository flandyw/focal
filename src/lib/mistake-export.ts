import { downloadExamFile } from "./host"
import { getMistakeSchedule, type ExamAttempt, type Mistake } from "./exam-data"
import { downloadMistakesPdf } from "./mistake-pdf"

export type ExportFormat = "pdf" | "markdown" | "csv" | "json"

const csvCell = (value: unknown) => `"${String(value ?? "").replace(/"/g, '""')}"`

/** Embedded in the JSON export so the chatbot sees the contract with the data. Keep in step with parseMistakeRoundTrip. */
const ROUND_TRIP_INSTRUCTIONS = [
  "This file is an export of study mistakes. Edit it as asked, then return it so the app can re-import your changes.",
  "1. Reply with ONLY one fenced json code block shaped like this file: an object with a \"mistakes\" array (the \"instructions\" key may be left out). Include every record you changed; unchanged records may be left out.",
  "2. Never change, remove or invent an \"id\". Records are matched to the app's mistakes by id, and unknown ids are ignored.",
  "3. Only these fields are re-imported: question, questionText, explanation, correction, areaOfStudy. Everything else (exam, subject, paper, category, marks, resolved, ...) is read-only context. A blank field is ignored, so never blank a field to keep it: copy it unchanged instead.",
  "4. Text is Markdown with LaTeX. Write inline maths as $...$ and display maths as $$...$$ on its own lines. \\( ... \\) and \\[ ... \\] also render, but prefer $ and $$.",
  "5. JSON ESCAPING (most common failure): every backslash in LaTeX must be doubled inside a JSON string. Write \"$\\\\frac{1}{2}$\", \"\\\\[ x^2 \\\\]\", \"\\\\theta\", \"\\\\times\" and \"\\\\text{m/s}\". A single backslash is either invalid JSON (\\[ \\( \\{ \\,) or silently becomes a control character: \\f, \\t, \\b, \\n and \\r turn \\frac, \\theta, \\beta, \\nu and \\rho into a form feed, tab, backspace or newline plus the rest of the word.",
  "6. Use \\n for a line break and \\\" for a double quote inside strings. Do not put raw line breaks inside a string. Do not add comments or trailing commas.",
  "7. Keep the meaning and the mathematics of each record correct unless asked to change it. Do not invent question content you cannot see.",
]

function toRows(mistakes: Mistake[], attempts: ExamAttempt[]) {
  const attemptMap = new Map(attempts.map((attempt) => [attempt.id, attempt]))
  return mistakes.map((mistake) => {
    const attempt = attemptMap.get(mistake.attemptId)
    return {
      id: mistake.id,
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
  const text = format === "json" ? JSON.stringify({ instructions: ROUND_TRIP_INSTRUCTIONS, mistakes: rows }, null, 2)
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
