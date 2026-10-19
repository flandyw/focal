import type { ExamAttempt } from "./exam-data"
import { normaliseComparisonName } from "./exam-data"

/** What a paper is: one of the two VCE exams, or one sitting that covers both ("combined"). */
export type PaperType = "exam1" | "exam2" | "combined"
export const PAPER_TYPES: readonly PaperType[] = ["exam1", "exam2", "combined"]

type PaperRules = {
  /** Subject names as `normaliseComparisonName` writes them. */
  subjects: readonly string[]
  /** Totals a paper of each type is normally marked out of. A mismatch is a warning, not an error: providers differ. */
  expectedRawMax: Record<PaperType, readonly number[]>
}

// To add a subject, add an entry; subjects without one are never checked.
export const PAPER_RULES: readonly PaperRules[] = [
  {
    subjects: ["mathematical methods", "mathematical methods cas", "specialist mathematics"],
    expectedRawMax: { exam1: [40], exam2: [80], combined: [120, 160] },
  },
]

/** Reads "Exam 1", "Paper 2", "Combined" and "Exam 1 & 2". Null when the text names no paper. */
export function parsePaperType(paper: string): PaperType | null {
  if (/combined|\b1\s*(?:&|and|\+|\/)\s*2\b/i.test(paper)) return "combined"
  const number = paper.match(/\b[12]\b/)?.[0]
  return number === "1" ? "exam1" : number === "2" ? "exam2" : null
}

/** The stored `paperType` if there is one, else what the `paper` text says. */
export const paperTypeOf = (attempt: Pick<ExamAttempt, "paper" | "paperType">) => attempt.paperType ?? parsePaperType(attempt.paper)

export const expectedRawMax = (subject: string, type: PaperType) => {
  const name = normaliseComparisonName(subject)
  return PAPER_RULES.find((rules) => rules.subjects.includes(name))?.expectedRawMax[type]
}

/** Why `rawMax` looks wrong for this paper, or null if it fits or the subject/paper cannot be checked. */
export function rawMaxWarning(attempt: Pick<ExamAttempt, "subject" | "paper" | "paperType" | "rawMax">): string | null {
  const type = paperTypeOf(attempt)
  const expected = type && expectedRawMax(attempt.subject, type)
  if (!expected || expected.includes(attempt.rawMax)) return null
  const label = { exam1: "Exam 1", exam2: "Exam 2", combined: "a combined paper" }[type!]
  const swapped = (["exam1", "exam2"] as const).find((other) => other !== type && expectedRawMax(attempt.subject, other)?.includes(attempt.rawMax))
  return `"${attempt.paper}" is ${label}, usually marked out of ${expected.join(" or ")}, but rawMax is ${attempt.rawMax}.` +
    (swapped ? ` That is the usual total for ${swapped === "exam1" ? "Exam 1" : "Exam 2"}; is the paper type the wrong way round?` : "") +
    (type === "combined" ? "" : " If it is a combined paper, set paperType to combined.")
}

/** `rawMax`, or the paper type's usual total when `rawMax` looks wrong, so one mis-typed total does not skew per-100 rates. */
export function trustedRawMax(attempt: Pick<ExamAttempt, "subject" | "paper" | "paperType" | "rawMax">): number {
  const type = paperTypeOf(attempt)
  return rawMaxWarning(attempt) ? expectedRawMax(attempt.subject, type!)![0] : attempt.rawMax
}
