import { describe, expect, test } from "bun:test"

import { getDueMistakes, getOverdueMistakes, localDayDifference, type Mistake } from "../src/lib/exam-data"

function mistake(id: string, due: string, overrides: Partial<Mistake> = {}): Mistake {
  return {
    id,
    attemptId: "exam",
    question: id,
    category: "Reasoning",
    explanation: "",
    correction: "",
    resolved: false,
    createdAt: due,
    updatedAt: due,
    dueAt: due,
    ...overrides,
  }
}

// Build instants from local calendar parts so the assertions do not depend on the runner's zone.
const at = (year: number, month: number, day: number, hour = 12) => new Date(year, month - 1, day, hour).toISOString()

describe("mistake overdue (calendar day, not a rolling 24 hours)", () => {
  test("a card is overdue from local midnight, not after 24 hours", () => {
    const now = new Date(2026, 8, 16, 14, 1) // 16 Sep 2026, 14:01 local
    const cards = [
      mistake("today", at(2026, 9, 16, 13)), // earlier today, not overdue
      mistake("yesterday", at(2026, 9, 15, 23)), // previous local day
      mistake("older", at(2026, 9, 13)),
      mistake("future", at(2026, 9, 18)),
      mistake("suspended", at(2026, 9, 12), { suspended: true }),
    ]
    expect(getOverdueMistakes(cards, now).map((item) => item.id)).toEqual(["older", "yesterday"])
  })

  test("mastered cards stay in the overdue queue, matching folio", () => {
    const now = new Date(2026, 8, 16, 14)
    const mastered = mistake("mastered", at(2026, 9, 1), { resolved: true, reviewState: "review", intervalDays: 30 })
    expect(getOverdueMistakes([mastered], now).map((item) => item.id)).toEqual(["mastered"])
  })

  test("queues legacy and tied cards stably, retaining original references and local eligibility", () => {
    const now = new Date(2026, 8, 16, 14)
    const legacy = mistake("legacy", at(2026, 9, 12), {
      dueAt: null, reviewHistory: [{ id: "r1", result: "correct", completedAt: at(2026, 9, 12) }],
    })
    const tied = mistake("tied", at(2026, 9, 15))
    const today = mistake("today", at(2026, 9, 16, 13))
    const older = mistake("older", at(2026, 9, 13))
    const cards = [legacy, today, tied, older,
      mistake("future", at(2026, 9, 17)),
      mistake("suspended-invalid", "invalid", { suspended: true, dueAt: null }),
    ]
    const before = structuredClone(cards)
    for (const [queue, expected] of [
      [getDueMistakes(cards, now), [older, legacy, tied, today]],
      [getOverdueMistakes(cards, now), [older, legacy, tied]],
    ]) {
      expect(queue).toEqual(expected)
      queue.forEach((card, index) => expect(card).toBe(expected[index]))
    }
    expect(cards).toEqual(before)
  })

  test("sorts due strings lexically, not by their offset-adjusted timestamps", () => {
    const earlier = mistake("earlier", "2026-09-14T00:00:00+10:00")
    const later = mistake("later", "2026-09-13T23:00:00Z")
    const now = new Date("2026-09-16T12:00:00Z")
    for (const queue of [getDueMistakes, getOverdueMistakes]) {
      expect(queue([earlier, later], now)).toEqual([later, earlier])
    }
  })

  test("same local day is zero days apart whatever the hour", () => {
    const morning = new Date(2026, 8, 16, 1)
    const night = new Date(2026, 8, 16, 23)
    expect(localDayDifference(night, morning)).toBe(0)
    expect(localDayDifference(new Date(2026, 8, 17, 0, 1), morning)).toBe(1)
    expect(localDayDifference(new Date(2026, 8, 15, 23, 59), morning)).toBe(-1)
  })

  // Only meaningful where a daylight-saving transition happens; CI may run in UTC.
  const melbourne = Intl.DateTimeFormat().resolvedOptions().timeZone === "Australia/Melbourne"

  test.skipIf(!melbourne)("counts a 23-hour daylight-saving day as one day", () => {
    const now = new Date(2026, 9, 4, 12) // 4 Oct 2026, DST begins at 02:00
    expect(localDayDifference(new Date(2026, 9, 5, 9), now)).toBe(1)
  })

  test.skipIf(!melbourne)("counts a 25-hour daylight-saving day as one day", () => {
    const now = new Date(2026, 3, 6, 12) // 6 Apr 2026, DST ended 5 Apr
    expect(localDayDifference(new Date(2026, 3, 5, 9), now)).toBe(-1)
  })
})
