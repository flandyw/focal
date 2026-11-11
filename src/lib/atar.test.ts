/// <reference types="bun-types" />
import { expect, test } from "bun:test"
import { atarRawScore, estimateAtar } from "./atar"
import { buildAtarHistory, buildAtarModel } from "./atar-model"
import { ATAR_AGGREGATE_REFERENCES } from "./atar-data"
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
  expect(atarRawScore(row)).toBeNaN()
  expect(atarRawScore({ ...row, raw: "", usePrediction: false })).toBeNaN()
  expect(atarRawScore({ ...row, raw: " ", usePrediction: false })).toBeNaN()
  expect(atarRawScore({ ...row, raw: "40.5", usePrediction: false })).toBeNaN()
  expect(atarRawScore({ ...row, raw: "19", usePrediction: false })).toBeNaN()
  expect(atarRawScore({ ...row, usePrediction: false }, 45)).toBe(40)
})

test("legacy and current Accounting codes contribute only once in every ATAR consumer", () => {
  const results = [
    { id: "en", code: "EN", studyName: "English", rawScore: 40, scaledScore: 40 },
    { id: "ch", code: "CH", studyName: "Chemistry", rawScore: 40, scaledScore: 40 },
    { id: "pe", code: "PE", studyName: "Physical Education", rawScore: 40, scaledScore: 40 },
    { id: "ac", code: "AC", studyName: "Accounting", rawScore: 40, scaledScore: 40 },
    { id: "legacy", code: "LEGACY_ACCOUNTING", studyName: "Accounting", rawScore: 45, scaledScore: 45 },
  ]
  const estimate = estimateAtar(results, 2025)!
  const counted = [...estimate.primaryFour, ...estimate.increments]
  expect(counted.filter((r) => r.studyName === "Accounting").map((r) => r.id)).toEqual(["legacy"])
  expect(estimate.aggregate).toBe(165)
})

const modelRow = (code: string, raw: string, usePrediction = false) => ({ id: code, code, raw, usePrediction })
const modelInput = (rows: ReturnType<typeof modelRow>[], target: number | null = null) =>
  ({ data: EMPTY_APP_DATA, references: [], scaling: reports.references, rows, year: 2025, target })

test("ATAR model agrees with estimateAtar and applies the Focal/Manual/blank source rules", () => {
  const rows = ["EN", "CH", "PH", "NJ", "BI", "PE"].map((code) => modelRow(code, "40"))
  const model = buildAtarModel(modelInput([...rows, modelRow("NS", "", true), modelRow("FR", ""), modelRow("SP", "19"), modelRow("ZZ", "45")]))
  expect(model.estimate!.aggregate).toBe(estimateAtar(model.results, 2025)!.aggregate)
  expect(model.estimate!.aggregate).toBeCloseTo(39 + 46 + 44 + 42 + 4.1 + 3.8)
  const by = new Map(model.rows.map((item) => [item.row.code, item]))
  expect(by.get("EN")!.role).toBe("English")
  expect(by.get("PE")!.role).toBe("Increment")
  expect(by.get("PE")!.contribution).toBeCloseTo(3.8)
  expect(model.rows.reduce((total, item) => total + item.contribution, 0)).toBeCloseTo(model.estimate!.aggregate)
  // Focal without usable practice, blank and out-of-range manual scores, and unknown studies contribute nothing.
  expect([by.get("NS")!.issue, by.get("FR")!.issue, by.get("SP")!.issue, by.get("ZZ")!.issue]).toEqual(["no-estimate", "blank", "invalid-manual", "no-study"])
  for (const code of ["NS", "FR", "SP", "ZZ"]) expect([by.get(code)!.contribution, by.get(code)!.role, by.get(code)!.sensitivity]).toEqual([0, null, null])
  expect(model.range).toBeNull()
})

test("ATAR sensitivity re-runs selection for +1 raw, and the target gap uses the conversion table", () => {
  const model = buildAtarModel(modelInput(["EN", "CH", "PH", "NJ", "BI", "PE"].map((code) => modelRow(code, "40")), 99.25))
  const by = new Map(model.rows.map((item) => [item.row.code, item]))
  expect(by.get("EN")!.sensitivity!.aggregate).toBeCloseTo(1.2)
  expect(by.get("CH")!.sensitivity!.aggregate).toBeCloseTo(0.6)
  expect(by.get("PE")!.sensitivity!.aggregate).toBeCloseTo(0.12)
  expect(buildAtarModel(modelInput([modelRow("EN", "50"), modelRow("CH", "40"), modelRow("PH", "40"), modelRow("NJ", "40")])).rows[0].sensitivity).toBeNull()
  // An increment that out-scales a primary study gets swapped in, so its +1 counts at full weight.
  const swap = buildAtarModel(modelInput([modelRow("EN", "40"), modelRow("CH", "40"), modelRow("PH", "40"), modelRow("NJ", "40"), modelRow("BI", "41")]))
  expect(swap.rows.find((item) => item.row.code === "BI")!.sensitivity!.aggregate).toBeCloseTo(1)
  const point = ATAR_AGGREGATE_REFERENCES.find((item) => item.year === 2025)!.points.find((item) => item.atar >= 99.25 - 1e-9)!
  expect(model.targetAggregate).toBe(point.aggregate)
  expect(model.aggregateGap).toBeCloseTo(point.aggregate - model.estimate!.aggregate)
  expect(model.gap).toBeCloseTo(99.25 - model.estimate!.atar!)
  expect(buildAtarModel(modelInput(model.rows.map((item) => item.row))).gap).toBeNull()
})

test("ATAR history lists saved scenarios in time order and keeps below-table labels as gaps", () => {
  const atarEstimates = [
    { id: "b", year: 2025, rows: [], atarLabel: "<30.00", aggregate: 60, savedAt: "2026-05-01T00:00:00.000Z" },
    { id: "a", year: 2025, rows: [], atarLabel: "90.10", aggregate: 170, savedAt: "2026-03-01T00:00:00.000Z" },
  ]
  const history = buildAtarHistory({ ...modelInput([]), data: { ...EMPTY_APP_DATA, atarEstimates } })
  expect(history.map((point) => [point.atar, point.aggregate, point.kind])).toEqual([[90.1, 170, "saved"], [null, 60, "saved"]])
})
