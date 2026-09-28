import { describe, expect, test } from "bun:test"
import {
  DEFAULT_EXAM_DIFFICULTY,
  MATHEMATICS_PROVIDER_DIFFICULTY,
  getAttemptPerformance,
  identifyDifficultyProvider,
  resolveDifficultySettings,
  weightedPerformanceAverage,
  type ExamDifficultySettings,
} from "../src/lib/exam-difficulty"
import type { ExamAttempt } from "../src/lib/exam-data"

function attempt(provider: string, score = 60, title = `${provider} Methods`, paper = "Exam 2"): ExamAttempt {
  return {
    id: `${provider}-${score}`,
    subject: "Mathematical Methods",
    provider,
    title,
    examYear: 2025,
    paper,
    completedAt: "2026-07-20",
    rawScore: score,
    rawMax: 100,
    referenceId: null,
    createdAt: "2026-07-20T00:00:00.000Z",
    updatedAt: "2026-07-20T00:00:00.000Z",
  }
}

describe("exam difficulty calibration", () => {
  test("places NHT just above the unchanged VCAA baseline", () => {
    expect(getAttemptPerformance(attempt("VCAA"), DEFAULT_EXAM_DIFFICULTY)).toMatchObject({ alignedPercentage: 60, adjustment: 0, relevanceWeight: 1 })
    expect(getAttemptPerformance(attempt("VCAA", 60, "VCAA NHT Methods"), DEFAULT_EXAM_DIFFICULTY)).toMatchObject({ alignedPercentage: 61.5, adjustment: 1.5, relevanceWeight: 0.9 })
  })

  test("raises hard-company marks conservatively and downweights their evidence", () => {
    const result = getAttemptPerformance(attempt("iTute"), { ...DEFAULT_EXAM_DIFFICULTY, providerOrder: [...MATHEMATICS_PROVIDER_DIFFICULTY] })
    expect(result.alignedPercentage).toBe(66)
    expect(result.relevanceWeight).toBe(0.52)
  })

  test("uses a custom order relative to VCAA", () => {
    const settings: ExamDifficultySettings = {
      ...DEFAULT_EXAM_DIFFICULTY,
      providerOrder: ["VCAA", "iTute", "MAV", "Kilbaha", "VCAA NHT", "NEAP", "Insight", "Heffernan", "TSSM"],
    }
    expect(getAttemptPerformance(attempt("iTute"), settings).adjustment).toBe(-1.5)
  })

  test("weights VCAA more heavily than an extreme tutor-company result", () => {
    const average = weightedPerformanceAverage([attempt("VCAA", 70), attempt("iTute", 40)], {
      ...DEFAULT_EXAM_DIFFICULTY,
      providerOrder: [...MATHEMATICS_PROVIDER_DIFFICULTY],
    })
    expect(average).toBeCloseTo(61.789, 2)
  })

  test("recognises Hefferman spelling and NHT paper labels", () => {
    expect(identifyDifficultyProvider(attempt("Hefferman"))).toBe("Heffernan")
    expect(identifyDifficultyProvider(attempt("Heffernan"))).toBe("Heffernan")
    expect(identifyDifficultyProvider(attempt("VCAA", 60, "VCAA Methods", "Northern Hemisphere Exam"))).toBe("VCAA NHT")
  })

  test("calibrates a custom provider and keeps removed defaults removed", () => {
    const settings: ExamDifficultySettings = {
      ...DEFAULT_EXAM_DIFFICULTY,
      providerOrder: ["Custom Humanities Co", "VCAA"],
    }
    expect(resolveDifficultySettings(settings).providerOrder).toEqual(["Custom Humanities Co", "VCAA"])
    expect(getAttemptPerformance(attempt("Custom Humanities Co"), settings)).toMatchObject({
      provider: "Custom Humanities Co",
      adjustment: 1.5,
    })
  })
})
