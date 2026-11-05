import { validateQuestionResults, type ExamAttempt, type Mistake, type QuestionResult } from "./exam-data"

/** Accept spreadsheet TSV and quoted CSV without treating pasted cells as markup or code. */
export function parseScoreTable(text: string): QuestionResult[] {
  if (text.length > 200_000) throw new Error("Paste up to 200 KB of scores at a time.")
  const delimiter = text.includes("\t") ? "\t" : ","
  const rows: string[][] = []
  let row: string[] = [], cell = "", quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ }
      else if (quoted || !cell) quoted = !quoted
      else throw new Error("A quote must start a cell. Check the pasted table.")
    } else if (!quoted && (char === delimiter || char === "\n" || char === "\r")) {
      row.push(cell.trim()); cell = ""
      if (char !== delimiter) {
        if (row.some(Boolean)) rows.push(row)
        row = []
        if (char === "\r" && text[i + 1] === "\n") i++
      }
    } else cell += char
  }
  if (quoted) throw new Error("A quoted cell is unfinished. Check the pasted table.")
  row.push(cell.trim())
  if (row.some(Boolean)) rows.push(row)
  if (/^(?:item|question|label|earned|marks awarded)$/i.test(rows[0]?.[0] ?? "") && !Number.isFinite(Number(rows[0]?.[1]))) rows.shift()
  if (!rows.length || rows.length > 500) throw new Error("Paste between 1 and 500 questions.")
  const results = rows.map((cells, index): QuestionResult => {
    if (cells.length < 2 || cells.length > 5) throw new Error(`Row ${index + 1}: use earned/out of, or item/earned/out of/topic/feedback.`)
    const offset = cells.length === 2 ? 0 : 1
    if (!cells[offset] || !cells[offset + 1]) throw new Error(`Row ${index + 1}: both marks are required.`)
    return {
      id: crypto.randomUUID(), label: offset ? cells[0] : `Question ${index + 1}`,
      marksAwarded: Number(cells[offset]), maxMarks: Number(cells[offset + 1]),
      confidence: "medium", areaOfStudy: cells[3] || undefined, examinerNote: cells[4] || undefined,
    }
  })
  const error = validateQuestionResults(results)
  if (error) throw new Error(error)
  if (new Set(results.map((result) => questionKey(result.label))).size !== results.length) throw new Error("Question labels must be unique.")
  return results
}

export const questionKey = (label: string) => label.normalize("NFKC").toLowerCase().replace(/\bquestion(?=\s*\d)/g, "q").replace(/[^\p{L}\p{N}]/gu, "")

export function findMarkingTemplate(attempts: ExamAttempt[], paper: Pick<ExamAttempt, "subject" | "provider" | "examYear" | "paper">): ExamAttempt | undefined {
  return attempts.filter((attempt) => attempt.questionResults?.length && attempt.examYear === paper.examYear &&
    ["subject", "provider", "paper"].every((key) => attempt[key as "subject" | "provider" | "paper"].trim().toLowerCase() === paper[key as "subject" | "provider" | "paper"].trim().toLowerCase()))
    .toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0]
}

export function unloggedMistakes(attempt: ExamAttempt, mistakes: Mistake[]): QuestionResult[] {
  const logged = new Set(mistakes.filter((mistake) => mistake.attemptId === attempt.id).map((mistake) => questionKey(mistake.question)))
  return (attempt.questionResults ?? []).filter((result) => result.marksAwarded < result.maxMarks && !logged.has(questionKey(result.label)))
}
