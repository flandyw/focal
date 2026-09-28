import { describe, expect, test } from "bun:test"
import { EMPTY_APP_DATA } from "../src/lib/exam-data"
import { diffAppData, mergeMistakeConflict, rowsFromAppData, sameValue } from "../src/lib/app-sync"

describe("ExamTrack cursor sync", () => {
  test("projects attempts, mistakes and each setting as stable independent rows", () => {
    const data = {
      ...EMPTY_APP_DATA,
      attempts: [{ id: "attempt-1", subject: "Chemistry", updatedAt: "2026-07-15T01:00:00.000Z" } as never],
      mistakes: [{ id: "mistake-1", question: "Explain", updatedAt: "2026-07-15T02:00:00.000Z" } as never],
      trackedExamIds: ["exam-1"],
      trackedExamIdsUpdatedAt: "2026-07-15T03:00:00.000Z",
      activeExamTimer: { id: "timer-1" } as never,
    }

    expect(rowsFromAppData(data).map(({ entity, rowId }) => `${entity}:${rowId}`)).toEqual([
      "attempts:attempt-1", "mistakes:mistake-1", "user_state:trackedExamIds",
    ])
  })

  test("queues a stable row update and tombstone instead of rewriting a collection", () => {
    const previous = {
      ...EMPTY_APP_DATA,
      attempts: [{ id: "attempt-1", updatedAt: "2026-07-15T01:00:00.000Z", comment: "old" } as never,
        { id: "attempt-2", updatedAt: "2026-07-15T01:00:00.000Z" } as never],
    }
    const next = { ...previous, attempts: [{ ...previous.attempts[0], comment: "new", updatedAt: "2026-07-15T02:00:00.000Z" }] }
    expect(diffAppData(previous, next)).toEqual([
      { entity: "attempts", rowId: "attempt-1", operation: "put", payload: next.attempts[0] },
      { entity: "attempts", rowId: "attempt-2", operation: "delete", payload: null },
    ])
  })

  test("rebases a Folio scheduling edit without dropping concurrent question content", () => {
    const base = {
      id: "mistake-1", questionText: "Original question", explanation: "Original explanation",
      dueAt: "2026-07-20T00:00:00.000Z", reviewHistory: [], intervalDays: 1,
    }
    const local = { ...base, dueAt: "2026-08-02T00:00:00.000Z", intervalDays: 14,
      reviewHistory: [{ id: "review-local", completedAt: "2026-07-18T00:00:00.000Z" }] }
    const remote = { ...base, questionText: "Edited in ExamTrack", explanation: "New explanation" }

    expect(mergeMistakeConflict(base, local, remote)).toEqual({
      ...remote, dueAt: local.dueAt, intervalDays: 14, reviewHistory: local.reviewHistory,
    })
  })

  test("unions concurrent mistake review history by stable review id", () => {
    const base = { id: "m", reviewHistory: [] as { id: string }[] }
    const local = { id: "m", reviewHistory: [{ id: "local" }] }
    const remote = { id: "m", reviewHistory: [{ id: "remote" }] }
    expect(mergeMistakeConflict(base, local, remote)).toEqual({ id: "m", reviewHistory: [{ id: "remote" }, { id: "local" }] })
  })

  test("compares nested payloads structurally without timestamp conflict ordering", () => {
    expect(sameValue({ a: [1, { b: true }] }, { a: [1, { b: true }] })).toBe(true)
    expect(sameValue({ a: [1, { b: true }] }, { a: [1, { b: false }] })).toBe(false)
  })
})
