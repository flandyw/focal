/// <reference types="bun-types" />
import { expect, test } from "bun:test"
import { atarRawScore, estimateAtar } from "./atar"
import { atarScalingReference, interpolateScaledScore } from "./scaling"
import { projectRows, rowsFromAppData } from "./app-rows"
import { EMPTY_APP_DATA, migrateAppData } from "./exam-data"
import { currentSubjectWork, setSubjectCompletion, subjectCompletionYear } from "./subject-completion"
import reports from "../../public/vtac-scaling-reports.json"

test("completed 2026 studies count in the primary four and increments with 2025 fallback scaling", () => {
  let data = { ...EMPTY_APP_DATA, subjects: ["English Language", "Chemistry", "Specialist Mathematics", "Chinese Second Language", "Mathematical Methods", "Physical Education"] }
  for (const subject of ["Mathematical Methods", "Physical Education"]) data = setSubjectCompletion(data, subject, 2026)
  const results = data.subjects.map((subject, i) => {
    const study = reports.references.find((r) => r.studyName === subject && r.year === 2025)!
    expect(study).toBeDefined()
    const scaling = atarScalingReference(reports.references, study.code, 2025, subjectCompletionYear(data, subject))!
    expect(scaling.year).toBe(2025)
    const rawScore = subject === "Physical Education" ? 20 : 40
    return { id: String(i), code: study.code, studyName: subject, rawScore, scaledScore: interpolateScaledScore(rawScore, scaling.points)! }
  })
  const estimate = estimateAtar(results, 2025)!
  expect(estimate.primaryFour.some((r) => r.studyName === "Mathematical Methods")).toBe(true)
  expect(estimate.increments.some((r) => r.studyName === "Physical Education")).toBe(true)
  expect(estimate.primaryFour.length + estimate.increments.length).toBe(6)
  expect(estimate.aggregate).toBeCloseTo(estimate.primaryFour.reduce((n, r) => n + r.scaledScore, 0) + estimate.increments.reduce((n, r) => n + r.scaledScore * 0.1, 0))
  expect(currentSubjectWork(data).subjects).not.toContain("Mathematical Methods")
})

test("scaling prefers completion year, then conversion year, then latest available, never inventing unscaled scores", () => {
  const study = reports.references.find((r) => r.year === 2025)!
  const older = { ...study, year: 2024 }
  expect(atarScalingReference([study, older], study.code, 2025, 2024)).toBe(older)
  expect(atarScalingReference([study, older], study.code, 2025, 2026)).toBe(study)
  expect(atarScalingReference([older, study], study.code, 2023, 2026)).toBe(study)
  expect(atarScalingReference([], study.code, 2025, 2026)).toBeUndefined()
})

test("completed-subject Focal/manual selection survives saved scenario serialization", () => {
  const row = { id: "methods", code: "MM", raw: "40", usePrediction: true }
  const data = setSubjectCompletion({ ...EMPTY_APP_DATA, subjects: ["Mathematical Methods"] }, "Mathematical Methods", 2026)
  for (const usePrediction of [true, false]) {
    const saved = { id: "scenario", year: 2025, rows: [{ ...row, usePrediction }], atarLabel: "90.00", aggregate: 160, savedAt: new Date().toISOString() }
    const restored = migrateAppData(JSON.parse(JSON.stringify({ ...data, atarEstimates: [saved] })))!
    const synced = projectRows(rowsFromAppData(restored).map((row, seq) => ({ ...row, seq }))).data
    expect(synced.atarEstimates[0].rows[0].usePrediction).toBe(usePrediction)
    expect(atarRawScore(synced.atarEstimates[0].rows[0], 45)).toBe(usePrediction ? 45 : 40)
  }
  expect(atarRawScore(row)).toBe(40)
})
