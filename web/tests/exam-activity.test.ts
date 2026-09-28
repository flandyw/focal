import { describe, expect, test } from "bun:test"
import { buildExamActivity } from "../src/lib/exam-activity"

function findDay(activity: ReturnType<typeof buildExamActivity>, date: string) {
  return activity.weeks.flat().find((day) => day.date === date)
}

describe("exam activity", () => {
  test("groups attempts by day and builds a 53-week calendar", () => {
    const activity = buildExamActivity([
      { completedAt: "2025-07-20" },
      { completedAt: "2025-07-21" },
      { completedAt: "2026-07-18" },
      { completedAt: "2026-07-19" },
      { completedAt: "2026-07-20" },
      { completedAt: "2026-07-20" },
      { completedAt: "2026-07-20" },
      { completedAt: "2026-07-20" },
      { completedAt: "2026-07-21" },
    ], new Date(2026, 6, 20))

    expect(activity.rangeStart).toBe("2025-07-21")
    expect(activity.rangeEnd).toBe("2026-07-20")
    expect(activity.weeks).toHaveLength(53)
    expect(activity.weeks.every((week) => week.length === 7)).toBe(true)
    expect(activity.total).toBe(7)
    expect(activity.activeDays).toBe(4)
    expect(activity.longestStreak).toBe(3)
    expect(findDay(activity, "2026-07-20")).toMatchObject({ count: 4, level: 4, inRange: true })
    expect(findDay(activity, "2025-07-20")).toMatchObject({ count: 0, inRange: false })
  })

  test("maps daily exam counts to increasing activity levels", () => {
    const activity = buildExamActivity([
      { completedAt: "2026-07-17" },
      { completedAt: "2026-07-18" },
      { completedAt: "2026-07-18" },
      { completedAt: "2026-07-19" },
      { completedAt: "2026-07-19" },
      { completedAt: "2026-07-19" },
    ], new Date(2026, 6, 20))

    expect(findDay(activity, "2026-07-17")?.level).toBe(1)
    expect(findDay(activity, "2026-07-18")?.level).toBe(2)
    expect(findDay(activity, "2026-07-19")?.level).toBe(3)
    expect(findDay(activity, "2026-07-20")?.level).toBe(0)
  })
})
