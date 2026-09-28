import { expect, test } from "bun:test"
import { MISTAKE_CATEGORIES } from "../src/lib/exam-data"
import { buildMistakeImportPrompt, createMistakesFromImport, parseMistakeImport } from "../src/lib/mistake-json"

const validRecord = {
  question: "Section B, Question 4",
  questionText: "Solve $x^2 - 4 = 0$.",
  category: "Concept",
  explanation: "Forgot to factorise.",
  correction: "$x = \\pm 2$",
  totalMarks: 3,
  marksLost: 2,
  areaOfStudy: "Quadratics",
  criterion: "",
}

test("prompt lists every category, every key, and fenced JSON output rules", () => {
  const prompt = buildMistakeImportPrompt()
  expect(prompt).toContain("ONLY one fenced")
  expect(prompt).toContain("```json")
  for (const category of MISTAKE_CATEGORIES) expect(prompt).toContain(category)
  for (const key of ["question", "questionText", "category", "explanation", "correction", "totalMarks", "marksLost", "areaOfStudy", "criterion"]) {
    expect(prompt).toContain(`"${key}"`)
  }
})

test("parses a plain array of records", () => {
  const drafts = parseMistakeImport(JSON.stringify([validRecord]))
  expect(drafts).toHaveLength(1)
  expect(drafts[0]).toMatchObject({ question: "Section B, Question 4", totalMarks: 3, marksLost: 2 })
})

test("parses fenced JSON, wrapped objects, single records, and prose around the JSON", () => {
  expect(parseMistakeImport("```json\n" + JSON.stringify([validRecord]) + "\n```")).toHaveLength(1)
  expect(parseMistakeImport(JSON.stringify({ mistakes: [validRecord] }))).toHaveLength(1)
  expect(parseMistakeImport(JSON.stringify(validRecord))).toHaveLength(1)
  const noisy = `Here are your mistakes:\n${JSON.stringify([validRecord])}\nGood luck!`
  expect(parseMistakeImport(noisy)).toHaveLength(1)
})

test("coerces numeric strings, loose categories, and missing optional fields", () => {
  const drafts = parseMistakeImport(JSON.stringify([{
    ...validRecord,
    totalMarks: "4.5",
    marksLost: "1",
    category: "knowledge recall",
    areaOfStudy: null,
  }]))
  expect(drafts[0]?.totalMarks).toBe(4.5)
  expect(drafts[0]?.marksLost).toBe(1)
  expect(drafts[0]?.category).toBe("Knowledge recall")
  expect(drafts[0]?.areaOfStudy).toBe("")
})

test("rejects invalid imports with item-level messages", () => {
  expect(() => parseMistakeImport("")).toThrow("Paste the JSON")
  expect(() => parseMistakeImport("{question: oops}")).toThrow("not valid JSON")
  expect(() => parseMistakeImport("[]")).toThrow("no mistake records")
  expect(() => parseMistakeImport("[1]")).toThrow("Item 1")
  expect(() => parseMistakeImport(JSON.stringify([{ ...validRecord, explanation: "" }]))).toThrow('"explanation"')
  expect(() => parseMistakeImport(JSON.stringify([{ ...validRecord, category: "Sloppiness" }]))).toThrow('"category"')
  expect(() => parseMistakeImport(JSON.stringify([{ ...validRecord, marksLost: 9 }]))).toThrow("cannot exceed")
  expect(() => parseMistakeImport(JSON.stringify([{ ...validRecord, totalMarks: 0 }]))).toThrow("greater than zero")
  expect(() => parseMistakeImport(JSON.stringify([{ ...validRecord, totalMarks: "many" }]))).toThrow('must be a number')
})

test("creates review-ready mistakes bound to the chosen attempt", () => {
  const timestamp = "2026-08-23T00:00:00.000Z"
  const mistakes = createMistakesFromImport(parseMistakeImport(JSON.stringify([validRecord, { ...validRecord, areaOfStudy: "" }])), "attempt-1", timestamp)
  expect(mistakes).toHaveLength(2)
  expect(new Set(mistakes.map((mistake) => mistake.id)).size).toBe(2)
  for (const mistake of mistakes) {
    expect(mistake.attemptId).toBe("attempt-1")
    expect(mistake.dueAt).toBe(timestamp)
    expect(mistake.createdAt).toBe(timestamp)
    expect(mistake.updatedAt).toBe(timestamp)
    expect(mistake.resolved).toBe(false)
  }
  expect(mistakes[0]?.areaOfStudy).toBe("Quadratics")
  expect(mistakes[1]?.areaOfStudy).toBeUndefined()
})
