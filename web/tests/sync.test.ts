import { describe, expect, test } from "bun:test"
import { EMPTY_APP_DATA, getDueMistakes, getOverdueMistakes, recordMistakeReview, type Mistake } from "../src/lib/exam-data"
import { diffAppData, isTombstoned, mergeMistakeConflict, rowsFromAppData, sameValue } from "../src/lib/app-sync"
import { equalAppData, isSupersededSync } from "../src/lib/sync"

describe("Focal cursor sync", () => {
  test("accepts Folio reviews when the mistake IDs and totals have not changed", () => {
    const at = new Date(2026, 9, 1, 12)
    const yesterday = new Date(2026, 8, 30, 12).toISOString()
    const card: Mistake = {
      id: "mistake-1", attemptId: "attempt-1", question: "Question 8b", category: "Algebra",
      explanation: "", correction: "", resolved: false, dueAt: yesterday,
      createdAt: yesterday, updatedAt: yesterday,
    }
    const current = { ...EMPTY_APP_DATA, mistakes: [card] }
    const merged = { ...current, mistakes: [recordMistakeReview(card, "good", at.toISOString())] }

    // Exercise the same decision that the sync hook uses to publish remote changes.
    const displayed = equalAppData(current, merged) ? current : merged
    expect(getDueMistakes(current.mistakes, at)).toHaveLength(1)
    expect(getOverdueMistakes(current.mistakes, at)).toHaveLength(1)
    expect(displayed).toBe(merged)
    expect(getDueMistakes(displayed.mistakes, at)).toHaveLength(0)
    expect(getOverdueMistakes(displayed.mistakes, at)).toHaveLength(0)
    expect(diffAppData(merged, displayed)).toEqual([]) // Never upload the stale schedule back.
    expect(equalAppData(merged, structuredClone(merged))).toBe(true)
  })

  test("drops a projection that would resurrect a locally deleted attempt", () => {
    const beforeDelete = { ...EMPTY_APP_DATA, attempts: [{ id: "attempt-1" } as never] }
    const afterDelete = { ...EMPTY_APP_DATA, attempts: [] }

    expect(isSupersededSync(beforeDelete, afterDelete)).toBe(true)
    expect(isSupersededSync(beforeDelete, beforeDelete)).toBe(false)
    // The delete is dropped from the projection even when the queue has not yet
    // persisted it, which is the window an in-flight sync used to slip through.
    expect(isSupersededSync(beforeDelete, { ...afterDelete })).toBe(true)
  })

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

  test("keeps a locally deleted attempt out of every later projection", () => {
    const tombstones = { attempts: { "attempt-1": "2026-07-15T02:00:00.000Z" }, mistakes: {} }

    // The stale server copy the sync feed keeps replaying.
    expect(isTombstoned("attempts", "attempt-1", "2026-07-15T01:00:00.000Z", tombstones)).toBe(true)
    // An undo from another device is stamped after the delete, so it still wins.
    expect(isTombstoned("attempts", "attempt-1", "2026-07-15T03:00:00.000Z", tombstones)).toBe(false)
    expect(isTombstoned("mistakes", "attempt-1", "2026-07-15T01:00:00.000Z", tombstones)).toBe(false)
  })

  test("rebases a Folio scheduling edit without dropping concurrent question content", () => {
    const base = {
      id: "mistake-1", questionText: "Original question", explanation: "Original explanation",
      dueAt: "2026-07-20T00:00:00.000Z", reviewHistory: [], intervalDays: 1,
    }
    const local = { ...base, dueAt: "2026-08-02T00:00:00.000Z", intervalDays: 14,
      reviewHistory: [{ id: "review-local", completedAt: "2026-07-18T00:00:00.000Z" }] }
    const remote = { ...base, questionText: "Edited in Focal", explanation: "New explanation" }

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
