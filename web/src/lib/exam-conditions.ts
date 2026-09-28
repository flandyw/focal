import { normaliseComparisonName } from "@/lib/exam-data"

export type KnownExamConditions = {
  readingMinutes: number
  writingMinutes: number
  marks: number
}

const SINGLE_EXAM_SUBJECTS = new Set([
  "biology",
  "chemistry",
  "environmental science",
  "physics",
  "psychology",
  "foundation mathematics",
  "english",
  "english as an additional language",
  "english as an additional language eal",
  "english language",
  "literature",
  "physical education",
])

function isPaperlessSingleExam(paper: string) {
  return !paper.trim() || !/\d/.test(paper)
}

export function getKnownExamConditions(subject: string, paper: string): KnownExamConditions | null {
  const normalisedSubject = normaliseComparisonName(subject)
  const isMathematicalMethods = normalisedSubject === "mathematical methods" ||
    normalisedSubject === "mathematical methods cas"

  const paperNumber = Number(paper.match(/\d+/)?.[0])
  if (isMathematicalMethods || normalisedSubject === "specialist mathematics") {
    if (paperNumber === 1) return { readingMinutes: 15, writingMinutes: 60, marks: 40 }
    if (paperNumber === 2) return { readingMinutes: 15, writingMinutes: 120, marks: 80 }
    return null
  }

  if (normalisedSubject === "general mathematics") {
    if (paperNumber === 1) return { readingMinutes: 15, writingMinutes: 90, marks: 40 }
    if (paperNumber === 2) return { readingMinutes: 15, writingMinutes: 90, marks: 60 }
    return null
  }

  if (SINGLE_EXAM_SUBJECTS.has(normalisedSubject) && isPaperlessSingleExam(paper)) {
    if (normalisedSubject === "foundation mathematics") return { readingMinutes: 15, writingMinutes: 120, marks: 80 }
    if (normalisedSubject === "english" ||
      normalisedSubject === "english as an additional language" ||
      normalisedSubject === "english as an additional language eal") {
      return { readingMinutes: 15, writingMinutes: 180, marks: 60 }
    }
    if (normalisedSubject === "english language") return { readingMinutes: 15, writingMinutes: 120, marks: 75 }
    if (normalisedSubject === "literature") return { readingMinutes: 15, writingMinutes: 120, marks: 40 }
    if (normalisedSubject === "physical education") return { readingMinutes: 15, writingMinutes: 120, marks: 110 }
    if (normalisedSubject === "environmental science") return { readingMinutes: 15, writingMinutes: 120, marks: 120 }
    return { readingMinutes: 15, writingMinutes: 150, marks: 120 }
  }

  return null
}

export function getKnownExamMarks(subject: string, paper: string): number | null {
  return getKnownExamConditions(subject, paper)?.marks ?? null
}
