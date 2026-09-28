import { describe, expect, test } from "bun:test"
import { buildSacSubjectStats, computeSacStats, getSacTimerState, getUpcomingSacs, isSacRecord, migrateSacRecords, sacPercentage, validateSac, type SacRecord } from "../src/lib/sac"
import { isSacTimerSession } from "../src/lib/ongoing-timers"

const base: SacRecord = {
  id: "sac-1",
  subject: "Mathematical Methods",
  provider: "Northside College",
  title: "Calculus SAC",
  sacNumber: "2A",
  unit: 3,
  areaOfStudy: "Calculus",
  scheduledAt: "2026-08-10",
  durationMinutes: 50,
  score: 40,
  maxScore: 50,
  weighting: 20,
  completedAt: "2026-08-10",
  timing: { plannedSeconds: 3000, actualSeconds: 3120, overtimeSeconds: 120, pausedSeconds: 30 },
  createdAt: "2026-08-10T00:00:00.000Z",
  updatedAt: "2026-08-10T00:00:00.000Z",
}

describe("SAC tracking", () => {
  test("validates planned and completed SACs", () => {
    expect(validateSac({ ...base, score: undefined, maxScore: undefined })).toBeNull()
    expect(validateSac({ ...base, unit: 1 })).toBeNull()
    expect(validateSac({ ...base, unit: 2 })).toBeNull()
    expect(validateSac({ ...base, score: 51 })).toBe("Mark cannot exceed the maximum.")
    expect(validateSac({ ...base, maxScore: undefined })).toBe("Enter both the mark and maximum, or leave both blank.")
    expect(validateSac({ ...base, provider: "" })).toBe("Subject, school/provider, and SAC title are required.")
    expect(validateSac({ ...base, unit: 5 as never })).toBe("Unit must be between 1 and 4.")
    expect(isSacRecord(base)).toBe(true)
    expect(isSacRecord({ ...base, unit: 1 })).toBe(true)
    expect(isSacRecord({ ...base, unit: 2 })).toBe(true)
    expect(isSacRecord({ ...base, timing: { ...base.timing!, actualSeconds: -1 } })).toBe(false)
  })

  test("backfills a school/provider for records saved before the field existed", () => {
    const { provider: _provider, ...legacy } = base
    expect(migrateSacRecords([legacy])).toEqual([{ ...legacy, provider: "School" }])
    expect(migrateSacRecords([{ ...legacy, unit: 1 }])).toEqual([{ ...legacy, unit: 1, provider: "School" }])
  })

  test("restores active Units 1/2 timers from local or synced state", () => {
    const timer = {
      subject: "Biology",
      provider: "School",
      title: "Cells assessment",
      unit: 1,
      scheduledAt: "2026-03-12",
      durationMinutes: 50,
      maxScore: 40,
      startedAt: 1_000_000,
      pausedSeconds: 0,
    }
    expect(isSacTimerSession(timer)).toBe(true)
    expect(isSacTimerSession({ ...timer, unit: 2 })).toBe(true)
  })

  test("accepts valid performance context and rejects invalid ratings", () => {
    expect(isSacRecord({ ...base, performanceContext: { sleepHours: 7.5, energy: 4, focus: 5, stress: 2 } })).toBe(true)
    expect(isSacRecord({ ...base, performanceContext: { confidence: 6 } })).toBe(false)
  })

  test("computes weighted results, trends, time, and upcoming work", () => {
    const second = { ...base, id: "sac-2", title: "Probability SAC", scheduledAt: "2026-09-01", completedAt: "2026-09-01", score: 45, weighting: 30, timing: undefined }
    const upcoming = { ...base, id: "sac-3", title: "Statistics SAC", scheduledAt: "2026-10-01", score: undefined, maxScore: undefined, completedAt: undefined, timing: undefined }
    const records = [base, second, upcoming]
    const stats = computeSacStats(records, "2026-09-15")

    expect(sacPercentage(base)).toBe(80)
    expect(stats).toMatchObject({ total: 3, completed: 2, upcoming: 1, average: 86, best: 90, totalTimedSeconds: 3120, trend: 10 })
    expect(getUpcomingSacs(records, "2026-09-15")).toEqual([upcoming])
    expect(buildSacSubjectStats(records, "2026-09-15")).toEqual([
      expect.objectContaining({ subject: "Mathematical Methods", completed: 2, upcoming: 1, average: 86, best: 90 }),
    ])
  })

  test("moves from countdown to overtime", () => {
    expect(getSacTimerState(2_500_000, 1_000_000, 30)).toMatchObject({ phase: "timing", remainingSeconds: 300, elapsedSeconds: 1500 })
    expect(getSacTimerState(3_100_000, 1_000_000, 30)).toMatchObject({ phase: "overtime", remainingSeconds: 0, elapsedSeconds: 2100, overtimeSeconds: 300, progress: 100 })
  })
})
