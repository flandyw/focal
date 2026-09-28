import { describe, expect, test } from "bun:test"
import { createChatGPTProgressHandler, formatMistakeAIError, orderMistakeBatchDrafts, selectChatGPTModel, validateMistakeBatchImages, validateMistakeImage, validateMistakeImages } from "../src/lib/mistake-ai"
import {
  applyMistakeAutofills,
  applyMistakeFieldMergePlan,
  countMistakeFieldMergePlan,
  createMistakeFieldMergePlan,
  getEmptyMistakeFields,
  getMistakeFieldValues,
  summarizeMistakeAutofills,
  type MistakeAutofill,
} from "../src/lib/mistake-autofill"
import type { Mistake } from "../src/lib/exam-data"

describe("mistake image analysis", () => {
  test("validates uploads and chooses from the account's available models", () => {
    expect(validateMistakeImage({ type: "application/pdf", size: 100 })).toBe("Choose an image file.")
    expect(validateMistakeImage({ type: "image/jpeg", size: 4 * 1024 * 1024 })).toBe("Choose an image smaller than 3 MB.")
    expect(validateMistakeImage({ type: "image/jpeg", size: 100 })).toBeNull()
    expect(validateMistakeImages([{ type: "image/jpeg", size: 2 * 1024 * 1024 }, { type: "image/png", size: 2 * 1024 * 1024 }])).toBe("Choose images totalling less than 3 MB.")
    expect(validateMistakeBatchImages([{ type: "image/jpeg", size: 2 * 1024 * 1024 }])).toBe("Choose at least two images for a batch import.")
    expect(validateMistakeBatchImages(Array.from({ length: 5 }, () => ({ type: "image/jpeg", size: 2 * 1024 * 1024 })))).toBeNull()
    expect(validateMistakeBatchImages(Array.from({ length: 11 }, () => ({ type: "image/jpeg", size: 100 })))).toBe("Choose no more than 10 images at once.")
    expect(selectChatGPTModel(["gpt-5.6-sol", "gpt-5.5"])).toBe("gpt-5.6-sol")
    expect(selectChatGPTModel(["gpt-5.4-mini", "gpt-5.5"], "gpt-5.4-mini")).toBe("gpt-5.4-mini")
    expect(selectChatGPTModel(["gpt-5.5-pro", "gpt-5.5"])).toBe("gpt-5.5")
    expect(selectChatGPTModel(["gpt-5.5-pro"], "gpt-5.5-pro")).toBeNull()
    expect(selectChatGPTModel(["account-specific-model"])).toBe("account-specific-model")
    expect(selectChatGPTModel([])).toBeNull()
  })

  test("turns proxy failures into useful messages", () => {
    expect(formatMistakeAIError({ statusCode: 400, responseBody: '{"detail":"Streaming is not supported"}' })).toContain("does not support streamed analysis")
    expect(formatMistakeAIError({ statusCode: 413, responseBody: '{"error":"responses_request_too_large"}' })).toContain("too large")
    expect(formatMistakeAIError({ statusCode: 429 })).toContain("Wait a minute")
  })

  test("keeps batch drafts in image order and requires one valid result per image", () => {
    const draft = (imageIndex: number, question: string) => ({
      imageIndex,
      attemptId: "exam-1",
      question,
      questionText: `Prompt ${question}`,
      category: "Concept" as const,
      explanation: "Missed the key idea",
      correction: "Use the key idea",
      areaOfStudy: "Topic",
      criterion: "Accuracy",
      totalMarks: 4,
      marksLost: 1,
    })
    expect(orderMistakeBatchDrafts([draft(1, "Question 2"), draft(0, "Question 1")], 2).map(({ question }) => question)).toEqual(["Question 1", "Question 2"])
    expect(() => orderMistakeBatchDrafts([draft(0, "Question 1"), draft(0, "Duplicate")], 2)).toThrow("one mistake for every image")
    expect(() => orderMistakeBatchDrafts([{ ...draft(0, "Question 1"), marksLost: 5 }], 1)).toThrow("invalid marks")
  })

  test("reports streamed tokens and detected reasoning", () => {
    const updates: unknown[] = []
    const onChunk = createChatGPTProgressHandler((progress) => updates.push(progress))
    onChunk({ chunk: { type: "reasoning-delta", text: "think" } })
    onChunk({ chunk: { type: "text-delta", text: "answer" } })
    onChunk({ chunk: { type: "finish", totalUsage: { outputTokens: 12, outputTokenDetails: { reasoningTokens: 4 } } } })
    expect(updates).toEqual([
      { phase: "thinking", tokens: 2, estimated: true, reasoning: true },
      { phase: "writing", tokens: 3, estimated: true, reasoning: true },
      { phase: "complete", tokens: 12, estimated: false, reasoning: true },
    ])
  })
})

describe("mistake field autofill", () => {
  const mistake: Mistake = {
    id: "mistake-1",
    attemptId: "exam-1",
    question: "Question 2",
    questionText: "Existing prompt",
    category: "Concept",
    explanation: "",
    correction: "Existing correction",
    marksLost: 0,
    resolved: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }

  test("finds blank text and absent numbers without treating zero as empty", () => {
    expect(getEmptyMistakeFields(mistake)).toEqual(["explanation", "areaOfStudy", "criterion", "totalMarks"])
  })

  test("fills only empty fields and preserves every existing value", () => {
    const autofill: MistakeAutofill = {
      id: mistake.id,
      question: "Replacement label",
      questionText: "Replacement prompt",
      explanation: "Missed the governing concept",
      correction: "Replacement correction",
      areaOfStudy: "Topic 1",
      criterion: "Use the correct principle",
      totalMarks: 4,
      marksLost: 3,
    }
    const [updated] = applyMistakeAutofills([mistake], [autofill], "2026-02-01T00:00:00.000Z")
    expect(updated).toEqual({
      ...mistake,
      explanation: "Missed the governing concept",
      areaOfStudy: "Topic 1",
      criterion: "Use the correct principle",
      totalMarks: 4,
      updatedAt: "2026-02-01T00:00:00.000Z",
    })
  })

  test("rechecks current values and rejects invalid generated marks", () => {
    const current = { ...mistake, explanation: "Added while AI was running", marksLost: undefined }
    const autofill: MistakeAutofill = {
      id: mistake.id,
      question: null,
      questionText: null,
      explanation: "AI explanation",
      correction: null,
      areaOfStudy: null,
      criterion: null,
      totalMarks: -1,
      marksLost: -2,
    }
    expect(applyMistakeAutofills([current], [autofill], "later")[0]).toBe(current)
  })

  test("applies generated marks only as a complete valid pair", () => {
    const baseAutofill: MistakeAutofill = {
      id: mistake.id,
      question: null,
      questionText: null,
      explanation: null,
      correction: null,
      areaOfStudy: null,
      criterion: null,
      totalMarks: 4,
      marksLost: null,
    }
    const withoutMarks = { ...mistake, explanation: "Existing explanation", marksLost: undefined }

    expect(applyMistakeAutofills([withoutMarks], [baseAutofill], "later")[0]).toBe(withoutMarks)
    const completeAutofill = { ...baseAutofill, marksLost: 2 }
    expect(applyMistakeAutofills([withoutMarks], [completeAutofill], "later")[0]).toEqual({
      ...withoutMarks,
      totalMarks: 4,
      marksLost: 2,
      updatedAt: "later",
    })
  })

  test("reports only fields that can actually be applied", () => {
    const autofill: MistakeAutofill = {
      id: mistake.id,
      question: null,
      questionText: "Ignored replacement",
      explanation: "  Added explanation  ",
      correction: null,
      areaOfStudy: null,
      criterion: "Accuracy",
      totalMarks: 4,
      marksLost: null,
    }
    expect(summarizeMistakeAutofills([mistake], [autofill])).toEqual({ fieldCount: 3, mistakeCount: 1 })
  })
})

describe("mistake field merging", () => {
  const makeMistake = (id: string, areaOfStudy?: string, criterion?: string): Mistake => ({
    id,
    attemptId: "exam-1",
    question: id,
    category: "Concept",
    explanation: "Explanation",
    correction: "Correction",
    areaOfStudy,
    criterion,
    resolved: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  })
  const mistakes = [
    makeMistake("one", "  Quadratics ", "Accuracy"),
    makeMistake("two", "Quadratics", "Working"),
    makeMistake("three", "Polynomials", "Accuracy"),
  ]

  test("lists non-empty labels with usage counts", () => {
    expect(getMistakeFieldValues(mistakes, "areaOfStudy")).toEqual([
      { value: "Polynomials", count: 1 },
      { value: "Quadratics", count: 2 },
    ])
  })

  test("applies a multi-label AI plan without changing the other field", () => {
    const values = getMistakeFieldValues(mistakes, "areaOfStudy")
    const plan = createMistakeFieldMergePlan("areaOfStudy", values, [
      { source: "Quadratics", target: "Polynomial functions" },
      { source: "Polynomials", target: "Polynomial functions" },
    ])
    expect(countMistakeFieldMergePlan(mistakes, plan)).toBe(3)
    const updated = applyMistakeFieldMergePlan(mistakes, plan, "later")
    expect(updated.map(({ areaOfStudy, criterion, updatedAt }) => ({ areaOfStudy, criterion, updatedAt }))).toEqual([
      { areaOfStudy: "Polynomial functions", criterion: "Accuracy", updatedAt: "later" },
      { areaOfStudy: "Polynomial functions", criterion: "Working", updatedAt: "later" },
      { areaOfStudy: "Polynomial functions", criterion: "Accuracy", updatedAt: "later" },
    ])
  })

  test("can merge assessment criteria without changing topics", () => {
    const plan = createMistakeFieldMergePlan("criterion", getMistakeFieldValues(mistakes, "criterion"), [
      { source: "Accuracy", target: "Precise execution" },
    ])
    expect(countMistakeFieldMergePlan(mistakes, plan)).toBe(2)
    const updated = applyMistakeFieldMergePlan(mistakes, plan, "later")
    expect(updated.map(({ areaOfStudy, criterion }) => ({ areaOfStudy, criterion }))).toEqual([
      { areaOfStudy: "  Quadratics ", criterion: "Precise execution" },
      { areaOfStudy: "Quadratics", criterion: "Working" },
      { areaOfStudy: "Polynomials", criterion: "Precise execution" },
    ])
  })

  test("flattens chained suggestions and validates unsafe AI output", () => {
    const values = getMistakeFieldValues(mistakes, "areaOfStudy")
    expect(createMistakeFieldMergePlan("areaOfStudy", values, [
      { source: "Quadratics", target: "Polynomials" },
      { source: "Polynomials", target: "Polynomial functions" },
    ]).merges).toEqual([
      { source: "Quadratics", target: "Polynomial functions" },
      { source: "Polynomials", target: "Polynomial functions" },
    ])
    expect(() => createMistakeFieldMergePlan("areaOfStudy", values, [
      { source: "Unknown", target: "Polynomial functions" },
    ])).toThrow("unknown source label")
    expect(() => createMistakeFieldMergePlan("areaOfStudy", values, [
      { source: "Quadratics", target: "Polynomials" },
      { source: "Polynomials", target: "Quadratics" },
    ])).toThrow("circular merge plan")
  })

  test("rechecks current labels when the reviewed plan is applied", () => {
    const plan = createMistakeFieldMergePlan("areaOfStudy", getMistakeFieldValues(mistakes, "areaOfStudy"), [
      { source: "Quadratics", target: "Polynomial functions" },
    ])
    const editedWhileAnalysing = { ...mistakes[0], areaOfStudy: "Functions" }
    const updated = applyMistakeFieldMergePlan([editedWhileAnalysing, mistakes[1]], plan, "later")
    expect(updated[0]).toBe(editedWhileAnalysing)
    expect(updated[1]).toEqual({ ...mistakes[1], areaOfStudy: "Polynomial functions", updatedAt: "later" })
  })
})
