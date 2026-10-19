/// <reference types="bun-types" />
import { describe, expect, test } from "bun:test"
import { FAILING_CASE_LABELS, FAILING_CASE_SUBJECT, failingCase } from "./fixtures/failing-case"
import { buildPaperWeaknessMatrix } from "./performance-insights"
import { applyMistakeChanges, inferTopic, METHODS_TOPICS, planTopicBackfill, revertMistakes, topicConfigFor, validateTopic } from "./topics"

const methods = topicConfigFor(FAILING_CASE_SUBJECT)!

describe("topic inference", () => {
  test("files every label of the failing case where a person would", () => {
    for (const [label, expected] of FAILING_CASE_LABELS) {
      expect({ label, topic: inferTopic(methods, label).topic }).toEqual({ label, topic: expected ?? "Other" })
    }
  })

  test("flags ties instead of hiding them", () => {
    expect(inferTopic(methods, "Inverse functions and integration")).toMatchObject({ topic: "Inverse functions & intersections", ambiguous: true })
    expect(inferTopic(methods, "Domain and range of hybrid functions").ambiguous).toBe(false)
    expect(inferTopic(methods, "Careless errors")).toEqual({ topic: "Other", matched: false, ambiguous: false })
  })

  test("does not confuse tangent with tan, or inverse normal with inverse functions", () => {
    expect(inferTopic(methods, "Tangent to a curve").topic).toBe("Differentiation & applications")
    expect(inferTopic(methods, "Inverse normal for a cut-off").topic).toBe("Continuous distributions, normal, sampling & CIs")
  })

  test("topics are config-driven: another subject has none until it defines them", () => {
    expect(topicConfigFor("Chemistry")).toBeUndefined()
    expect(validateTopic("Chemistry", " Redox ")).toEqual({ topic: "Redox" })
    expect(validateTopic("Mathematical Methods CAS", "integration & AREA")).toEqual({ topic: "Integration & area" })
    expect(validateTopic("Mathematical Methods", "Calculus")).toHaveProperty("error")
  })
})

describe("matrix grouping on the failing case", () => {
  const { attempts, mistakes } = failingCase()

  test("free-text grouping is the problem: a row per label", () => {
    const rows = buildPaperWeaknessMatrix(attempts, mistakes, FAILING_CASE_SUBJECT, [], "areaOfStudy")
    expect(rows.length).toBeGreaterThan(80)
  })

  test("topic grouping gives one row per canonical topic and keeps every card", () => {
    const rows = buildPaperWeaknessMatrix(attempts, mistakes, FAILING_CASE_SUBJECT)
    expect(rows.map((row) => row.areaOfStudy).toSorted()).toEqual([...METHODS_TOPICS].toSorted())
    expect(rows.reduce((total, row) => total + row.exam1.mistakeCount + row.exam2.mistakeCount, 0)).toBe(mistakes.length)
    expect(Math.max(...rows.map((row) => row.exam1.mistakeCount + row.exam2.mistakeCount))).toBeGreaterThan(5)
  })

  test("stored topics win over inference, and backfilling does not move any card", () => {
    const before = buildPaperWeaknessMatrix(attempts, mistakes, FAILING_CASE_SUBJECT)
    const stored = applyMistakeChanges(mistakes, planTopicBackfill(attempts, mistakes).changes, "2026-10-19T00:00:00.000Z")
    expect(buildPaperWeaknessMatrix(attempts, stored, FAILING_CASE_SUBJECT)).toEqual(before)
    const moved = stored.map((card) => ({ ...card, topic: "Circular functions" }))
    const row = buildPaperWeaknessMatrix(attempts, moved, FAILING_CASE_SUBJECT).find((item) => item.areaOfStudy === "Circular functions")!
    expect(row.exam1.mistakeCount + row.exam2.mistakeCount).toBe(mistakes.length)
  })
})

describe("topic backfill", () => {
  const { attempts, mistakes } = failingCase()
  const at = "2026-10-19T00:00:00.000Z"

  test("a plan changes nothing and lists the cards it could not place", () => {
    const snapshot = JSON.stringify(mistakes)
    const plan = planTopicBackfill(attempts, mistakes)
    expect(JSON.stringify(mistakes)).toBe(snapshot)
    expect(plan.changes).toHaveLength(mistakes.length)
    const unplaced = mistakes.filter((card) => FAILING_CASE_LABELS.find(([label]) => label === card.areaOfStudy)![1] === null)
    expect(plan.unmatched.map((card) => card.id).toSorted()).toEqual(unplaced.map((card) => card.id).toSorted())
    expect(plan.changes.filter((change) => change.ambiguous).length).toBeGreaterThan(0)
  })

  test("is idempotent: a second run has nothing to change but still lists the unmatched", () => {
    const first = planTopicBackfill(attempts, mistakes)
    const applied = applyMistakeChanges(mistakes, first.changes, at)
    const second = planTopicBackfill(attempts, applied)
    expect(second.changes).toHaveLength(0)
    expect(second.unmatched).toEqual(first.unmatched)
    expect(second.alreadyTopical).toBe(mistakes.length - first.unmatched.length)
  })

  test("never overrides a topic a person chose", () => {
    const chosen = mistakes.map((card, index) => (index === 0 ? { ...card, topic: "Circular functions" } : card))
    const plan = planTopicBackfill(attempts, chosen)
    expect(plan.changes.some((change) => change.id === chosen[0].id)).toBe(false)
  })

  test("is reversible and leaves areaOfStudy alone", () => {
    const applied = applyMistakeChanges(mistakes, planTopicBackfill(attempts, mistakes).changes, at)
    expect(applied.map((card) => card.areaOfStudy)).toEqual(mistakes.map((card) => card.areaOfStudy))
    expect(applied.every((card) => card.previous?.topic === null)).toBe(true)
    const { mistakes: restored, reverted } = revertMistakes(applied, new Set(applied.map((card) => card.id)), at)
    expect(reverted).toHaveLength(mistakes.length)
    expect(restored.map(({ updatedAt: _ignored, ...card }) => card)).toEqual(mistakes.map(({ updatedAt: _ignored, ...card }) => card))
  })

  test("skips subjects without a topic list and cards with no exam", () => {
    const other = attempts.map((attempt) => ({ ...attempt, subject: "Chemistry" }))
    expect(planTopicBackfill(other, mistakes)).toMatchObject({ changes: [], skipped: mistakes.length })
    expect(planTopicBackfill(attempts, mistakes.map((card) => ({ ...card, attemptId: "" })))).toMatchObject({ changes: [], skipped: mistakes.length })
  })
})
