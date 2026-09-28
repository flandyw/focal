import { validateMistakeMarks, type Mistake } from "@/lib/exam-data"

export const MISTAKE_AUTOFILL_FIELDS = [
  "question",
  "questionText",
  "explanation",
  "correction",
  "areaOfStudy",
  "criterion",
  "totalMarks",
  "marksLost",
] as const

export type MistakeAutofillField = (typeof MISTAKE_AUTOFILL_FIELDS)[number]

export type MistakeAutofill = {
  id: string
  question: string | null
  questionText: string | null
  explanation: string | null
  correction: string | null
  areaOfStudy: string | null
  criterion: string | null
  totalMarks: number | null
  marksLost: number | null
}

export type MistakeAutofillSummary = {
  fieldCount: number
  mistakeCount: number
}

export const MISTAKE_MERGE_FIELDS = ["areaOfStudy", "criterion"] as const

export type MistakeMergeField = (typeof MISTAKE_MERGE_FIELDS)[number]

export type MistakeFieldMerge = {
  source: string
  target: string
}

export type MistakeFieldMergePlan = {
  field: MistakeMergeField
  merges: MistakeFieldMerge[]
}

export type MistakeFieldValue = {
  value: string
  count: number
}

const TEXT_FIELDS = ["question", "questionText", "explanation", "correction", "areaOfStudy", "criterion"] as const

function isEmptyText(value: string | undefined) {
  return !value?.trim()
}

export function getEmptyMistakeFields(mistake: Mistake): MistakeAutofillField[] {
  const fields: MistakeAutofillField[] = TEXT_FIELDS.filter((field) => isEmptyText(mistake[field]))
  if (mistake.totalMarks === undefined) fields.push("totalMarks")
  if (mistake.marksLost === undefined) fields.push("marksLost")
  return fields
}

export function hasEmptyMistakeFields(mistake: Mistake) {
  return getEmptyMistakeFields(mistake).length > 0
}

type MistakeAutofillPatch = Partial<Pick<Mistake, MistakeAutofillField>>

function getMistakeAutofillPatch(mistake: Mistake, autofill: MistakeAutofill): MistakeAutofillPatch {
  const patch: MistakeAutofillPatch = {}

  for (const field of TEXT_FIELDS) {
    const suggestion = autofill[field]
    if (isEmptyText(mistake[field]) && typeof suggestion === "string" && suggestion.trim()) {
      patch[field] = suggestion.trim()
    }
  }

  // Marks are a pair in persisted mistake data. Only apply generated marks when
  // the resulting pair is complete and valid so autofill cannot corrupt storage.
  const totalMarks = mistake.totalMarks ?? autofill.totalMarks ?? undefined
  const marksLost = mistake.marksLost ?? autofill.marksLost ?? undefined
  if (
    (mistake.totalMarks === undefined || mistake.marksLost === undefined)
    && totalMarks !== undefined
    && marksLost !== undefined
    && validateMistakeMarks(totalMarks, marksLost) === null
  ) {
    if (mistake.totalMarks === undefined) patch.totalMarks = totalMarks
    if (mistake.marksLost === undefined) patch.marksLost = marksLost
  }

  return patch
}

export function summarizeMistakeAutofills(mistakes: Mistake[], autofills: MistakeAutofill[]): MistakeAutofillSummary {
  const autofillMap = new Map(autofills.map((autofill) => [autofill.id, autofill]))
  let fieldCount = 0
  let mistakeCount = 0

  for (const mistake of mistakes) {
    const autofill = autofillMap.get(mistake.id)
    if (!autofill) continue
    const changedFields = Object.keys(getMistakeAutofillPatch(mistake, autofill)).length
    if (!changedFields) continue
    fieldCount += changedFields
    mistakeCount += 1
  }

  return { fieldCount, mistakeCount }
}

/**
 * Applies sparse AI suggestions to the latest records. Each field is checked again
 * immediately before assignment so a value added while ChatGPT was running wins.
 */
export function applyMistakeAutofills(mistakes: Mistake[], autofills: MistakeAutofill[], updatedAt: string): Mistake[] {
  const autofillMap = new Map(autofills.map((autofill) => [autofill.id, autofill]))

  return mistakes.map((mistake) => {
    const autofill = autofillMap.get(mistake.id)
    if (!autofill) return mistake
    const patch = getMistakeAutofillPatch(mistake, autofill)
    return Object.keys(patch).length ? { ...mistake, ...patch, updatedAt } : mistake
  })
}

export function getMistakeFieldValues(mistakes: Mistake[], field: MistakeMergeField): MistakeFieldValue[] {
  const counts = new Map<string, number>()
  for (const mistake of mistakes) {
    const value = mistake[field]?.trim()
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts].map(([value, count]) => ({ value, count }))
    .toSorted((first, second) => first.value.localeCompare(second.value, undefined, { sensitivity: "base" }))
}

export function createMistakeFieldMergePlan(
  field: MistakeMergeField,
  values: MistakeFieldValue[],
  suggestions: MistakeFieldMerge[],
): MistakeFieldMergePlan {
  const available = new Set(values.map(({ value }) => value))
  const direct = new Map<string, string>()

  for (const suggestion of suggestions) {
    const source = suggestion.source.trim()
    const target = suggestion.target.trim()
    if (!available.has(source)) throw new Error(`ChatGPT returned an unknown source label: “${source || "(empty)"}”.`)
    if (!target) throw new Error("ChatGPT returned an empty target label.")
    if (source === target) continue
    if (direct.has(source)) throw new Error(`ChatGPT returned more than one merge for “${source}”.`)
    direct.set(source, target)
  }

  function finalTarget(source: string) {
    const visited = new Set([source])
    let target = direct.get(source)!
    while (direct.has(target)) {
      if (visited.has(target)) throw new Error("ChatGPT returned a circular merge plan. Generate a new plan and try again.")
      visited.add(target)
      target = direct.get(target)!
    }
    return target
  }

  return {
    field,
    merges: [...direct].map(([source]) => ({ source, target: finalTarget(source) })),
  }
}

export function countMistakeFieldMergePlan(mistakes: Mistake[], plan: MistakeFieldMergePlan) {
  const sources = new Set(plan.merges.map(({ source }) => source.trim()))
  return mistakes.filter((mistake) => sources.has(mistake[plan.field]?.trim() ?? "")).length
}

/** Applies an AI-reviewed label plan while preserving every unrelated field. */
export function applyMistakeFieldMergePlan(mistakes: Mistake[], plan: MistakeFieldMergePlan, updatedAt: string): Mistake[] {
  const targets = new Map(plan.merges.map(({ source, target }) => [source.trim(), target.trim()]))

  return mistakes.map((mistake) => {
    const target = targets.get(mistake[plan.field]?.trim() ?? "")
    return target ? { ...mistake, [plan.field]: target, updatedAt } : mistake
  })
}
