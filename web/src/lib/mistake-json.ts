import { MISTAKE_CATEGORIES, validateMistakeMarks, type Mistake, type MistakeCategory } from "@/lib/exam-data"

export type ParsedMistakeDraft = {
  question: string
  questionText: string
  category: MistakeCategory
  explanation: string
  correction: string
  totalMarks: number
  marksLost: number
  areaOfStudy: string
  criterion: string
}

const PROMPT_EXAMPLE = `[
  {
    "question": "Section B, Question 4",
    "questionText": "A 0.150 kg ball is thrown vertically upwards at **6.0 m/s**. Ignoring air resistance, determine the maximum height reached. (3 marks)",
    "category": "Accuracy",
    "explanation": "Used $v = u + at$ with the wrong sign for $g$, so the maximum height came out negative and I wrote it as positive without checking.",
    "correction": "Take up as positive so $g$ is $-9.8\\\\ \\\\text{m/s}^2$. At the top $v = 0$, so $h = u^2/(2g) = 6.0^2/19.6 \\\\approx 1.8\\\\ \\\\text{m}$. Always sanity-check that a height is positive.",
    "totalMarks": 3,
    "marksLost": 2,
    "areaOfStudy": "Motion",
    "criterion": "Applies formulas correctly"
  }
]`

export function buildMistakeImportPrompt(): string {
  return `You are helping me log my exam mistakes into my study tracker. I will give you material such as marked exam papers, photos of questions and responses, transcripts, or my own description of what happened. Turn every distinct mistake in that material into one JSON record so I can paste the result straight into the app.

OUTPUT RULES
- Return ONLY one fenced \`\`\`json code block containing the JSON array, ending with \`\`\`. Do not include explanations or commentary outside the code block.
- The response must be a single JSON array of objects, one object per distinct mistake, even when there is only one mistake.
- Keep mathematical and scientific notation as Markdown with LaTeX ($...$ inline or $$...$$ display) only where needed, and escape backslashes correctly inside JSON strings.
- Write concise, student-friendly text. Never invent unreadable or missing content; use context to infer what you can.

Each object must use exactly these keys:

{
  "question": "...",
  "questionText": "...",
  "category": "...",
  "explanation": "...",
  "correction": "...",
  "totalMarks": 0,
  "marksLost": 0,
  "areaOfStudy": "",
  "criterion": ""
}

FIELD DETAILS
- "question" (required string): short item identifier exactly as labelled on the assessment, e.g. "Section B, Question 4", "Multiple Choice Question 17", "Essay 1", "Practical Report Part A". Use "Item unclear" only if the label is unreadable.
- "questionText" (required string): the complete question or task written to stand alone without the original paper. Include every stem, source, stimulus, table, definition, diagram description, subpart dependency, and referenced context ("using the information above") needed to answer it later. Describe non-text visuals precisely in words.
- "category" (required string): EXACTLY one of:
  ${MISTAKE_CATEGORIES.join(" | ")}
  Pick the single best match for the root cause of the error; use "Other" when nothing fits.
- "explanation" (required string): what went wrong — the specific misunderstanding, omission, unsupported claim, unclear wording, wrong process, or careless slip — written diagnostically so I can recognise the same error next time.
- "correction" (required string): the improved response, model answer, correct method, structure, evidence, or working that I should reproduce next time.
- "totalMarks" (required number > 0): total marks available for the whole item; infer from mark schemes, bracketed marks, or question wording.
- "marksLost" (required number >= 0): marks I lost on the item; never greater than totalMarks; infer from cross marks, annotations, subtotals, or my description. Use 0 if I received full marks but still want the habit logged.
- "areaOfStudy" (optional string): concise topic, skill, or curriculum area, e.g. "Calculus", "Argument analysis", "Cellular respiration"; "" if unknown.
- "criterion" (optional string): the assessment criterion being assessed, e.g. "Use of evidence"; "" if unknown.

EXAMPLE OF A COMPLETE RECORD

\`\`\`json
${PROMPT_EXAMPLE}
\`\`\`

Material to analyse follows after this line.`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```\s*$/)
  return fenced ? fenced[1] : trimmed
}

function coerceString(value: unknown, label: string, index: number): string {
  if (value === undefined || value === null || value === "") throw new Error(`Item ${index}: "${label}" is required.`)
  if (typeof value !== "string") throw new Error(`Item ${index}: "${label}" must be text.`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`Item ${index}: "${label}" cannot be empty.`)
  return trimmed
}

function coerceOptionalString(value: unknown, label: string, index: number): string {
  if (value === undefined || value === null) return ""
  if (typeof value === "number" && Number.isFinite(value)) return String(value)
  if (typeof value !== "string") throw new Error(`Item ${index}: "${label}" must be text.`)
  return value.trim()
}

function coerceNumber(value: unknown, label: string, index: number): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`Item ${index}: "${label}" must be a finite number.`)
    return value
  }
  if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value)
  throw new Error(`Item ${index}: "${label}" must be a number.`)
}

function coerceCategory(value: unknown, index: number): MistakeCategory {
  if (typeof value !== "string") throw new Error(`Item ${index}: "category" must be text.`)
  const exact = MISTAKE_CATEGORIES.find((category) => category === value)
  if (exact) return exact
  const normalised = value.trim().toLowerCase()
  const loose = MISTAKE_CATEGORIES.find((category) => category.toLowerCase() === normalised)
  if (loose) return loose
  throw new Error(`Item ${index}: "category" must be exactly one of the listed values.`)
}

export function parseMistakeImport(text: string): ParsedMistakeDraft[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(extractJsonPayload(text))
  } catch {
    const start = text.search(/[[{]/)
    const end = Math.max(text.lastIndexOf("]"), text.lastIndexOf("}"))
    if (start === -1 || end <= start) throw new Error("Paste the JSON array returned by your chatbot.")
    try {
      parsed = JSON.parse(text.slice(start, end + 1))
    } catch {
      throw new Error("This is not valid JSON. Ask your chatbot to return one fenced JSON code block, then paste it again.")
    }
  }

  let items: unknown[]
  if (Array.isArray(parsed)) items = parsed
  else if (isRecord(parsed) && Array.isArray(parsed.mistakes)) items = parsed.mistakes
  else if (isRecord(parsed)) items = [parsed]
  else throw new Error("The JSON must be an array of mistake objects.")

  if (!items.length) throw new Error("The JSON contains no mistake records.")

  return items.map((item, itemIndex) => {
    if (!isRecord(item)) throw new Error(`Item ${itemIndex + 1}: each record must be a JSON object.`)
    const index = itemIndex + 1
    const totalMarks = coerceNumber(item.totalMarks, "totalMarks", index)
    const marksLost = coerceNumber(item.marksLost, "marksLost", index)
    const draft: ParsedMistakeDraft = {
      question: coerceString(item.question, "question", index),
      questionText: coerceString(item.questionText, "questionText", index),
      category: coerceCategory(item.category, index),
      explanation: coerceString(item.explanation, "explanation", index),
      correction: coerceString(item.correction, "correction", index),
      areaOfStudy: coerceOptionalString(item.areaOfStudy, "areaOfStudy", index),
      criterion: coerceOptionalString(item.criterion, "criterion", index),
      totalMarks,
      marksLost,
    }
    const marksError = validateMistakeMarks(totalMarks, marksLost)
    if (marksError) throw new Error(`Item ${index}: ${marksError}`)
    return draft
  })
}

export function createMistakesFromImport(
  drafts: ParsedMistakeDraft[],
  attemptId: string,
  timestamp = new Date().toISOString(),
): Mistake[] {
  return drafts.map((draft) => ({
    id: crypto.randomUUID(),
    attemptId,
    question: draft.question,
    questionText: draft.questionText,
    category: draft.category,
    explanation: draft.explanation,
    correction: draft.correction,
    totalMarks: draft.totalMarks,
    marksLost: draft.marksLost,
    areaOfStudy: draft.areaOfStudy || undefined,
    criterion: draft.criterion || undefined,
    dueAt: timestamp,
    resolved: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  }))
}
