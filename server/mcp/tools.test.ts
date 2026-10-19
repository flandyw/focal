/// <reference types="bun-types" />
import { beforeEach, expect, mock, test } from "bun:test"
import { z } from "zod"
import { EMPTY_APP_DATA, migrateAppData, type AppData } from "../../src/lib/exam-data"
import { failingCase } from "../../src/lib/fixtures/failing-case"

// The tools run against an in-memory account. updateApp runs the same validity check the real store does.
let data: AppData
mock.module("./store", () => ({
  readAll: async () => ({ data, sessions: [] }),
  updateApp: async (edit: (current: AppData) => AppData) => {
    const next = edit(data)
    if (!migrateAppData(next)) throw new Error("That change would leave Focal data invalid, so nothing was saved.")
    data = next
    return data
  },
  gradeReferences: async () => [], examResources: async () => [], scalingReferences: async () => [], vceTimetable: async () => null,
}))

type Run = (args: Record<string, unknown>) => Promise<any>
const tools = new Map<string, Run>()
const define = (name: string, _description: string, shape: z.ZodRawShape, _hint: string, run: (args: any) => unknown) =>
  void tools.set(name, async (args) => run(z.object(shape).parse(args)))
const { recordTools } = await import("./records")
const { insightTools } = await import("./insights")
recordTools(define as never)
insightTools(define as never)
const call = (name: string, args: Record<string, unknown> = {}) => tools.get(name)!(args)

// Bulk writes log one JSON line to stderr; keep it out of the test output but check it is written.
const logs: string[] = []
console.error = (line: string) => void logs.push(line)
beforeEach(() => { data = { ...EMPTY_APP_DATA, ...failingCase() }; logs.length = 0 })

const exam = { subject: "Mathematical Methods", provider: "Neap", examYear: 2025, completedAt: "2026-05-01", rawScore: 30 }

test("save_exam saves a mismatched total but warns, and nothing else changes", async () => {
  const saved = await call("save_exam", { ...exam, paper: "Exam 1", rawMax: 80 })
  expect(saved.warnings).toHaveLength(1)
  expect(saved.warnings[0]).toContain("usual total for Exam 2")
  expect(data.attempts.find((attempt) => attempt.id === saved.id)?.rawMax).toBe(80)
})

test("save_exam is quiet when the total fits, and for subjects it has no rule for", async () => {
  expect((await call("save_exam", { ...exam, paper: "Exam 1", rawMax: 40 })).warnings).toEqual([])
  expect((await call("save_exam", { ...exam, paper: "Exam 2", rawMax: 80 })).warnings).toEqual([])
  expect((await call("save_exam", { ...exam, subject: "Chemistry", paper: "Exam 1", rawMax: 80 })).warnings).toEqual([])
})

test("an explicit combined paper type is stored, accepted at 120/160, and kept out of the matrix columns", async () => {
  const { id, warnings } = await call("save_exam", { ...exam, paper: "Combined", paperType: "combined", rawMax: 120, rawScore: 90 })
  expect(warnings).toEqual([])
  expect(data.attempts.find((attempt) => attempt.id === id)?.paperType).toBe("combined")
  expect((await call("save_exam", { id, ...exam, paper: "Combined", paperType: "combined", rawMax: 100 })).warnings[0]).toContain("120 or 160")
})

test("fixing a mismatched total with the same id clears the warning in dataQuality", async () => {
  const before = (await call("get_exam_analytics", { subject: "Mathematical Methods" })).dataQuality.papersWithRawMaxMismatch
  expect(before).toHaveLength(6)
  const bad = data.attempts.find((attempt) => attempt.id === before[0].id)!
  await call("save_exam", { id: bad.id, subject: bad.subject, provider: bad.provider, examYear: bad.examYear, paper: bad.paper, completedAt: bad.completedAt, rawScore: 30, rawMax: 40 })
  expect((await call("get_exam_analytics", { subject: "Mathematical Methods" })).dataQuality.papersWithRawMaxMismatch).toHaveLength(5)
})

/* ------------------------------------------------------------------ D: ergonomics */

const SUBJECT = "Mathematical Methods"
const ids = (list: { mistakes: { id: string }[] }) => list.mistakes.map((m) => m.id)

test("list_mistakes is compact by default and a fraction of the full size", async () => {
  const compact = await call("list_mistakes", { limit: 200 })
  const full = await call("list_mistakes", { limit: 200, compact: false })
  expect(compact.mistakes[0]).not.toHaveProperty("questionText")
  expect(compact.mistakes[0]).not.toHaveProperty("correction")
  expect(JSON.stringify(compact).includes("<svg")).toBe(false)
  expect(full.mistakes[0].correction).toContain("<svg>")
  expect(JSON.stringify(compact).length).toBeLessThan(JSON.stringify(full).length / 2)
})

test("fields picks columns (id always), and compact still strips SVG from them", async () => {
  const list = await call("list_mistakes", { fields: ["question", "correction"], limit: 1 })
  expect(Object.keys(list.mistakes[0]).toSorted()).toEqual(["correction", "id", "question"])
  expect(list.mistakes[0].correction).toBe("[svg]")
  expect((await call("list_mistakes", { fields: ["correction"], compact: false, limit: 1 })).mistakes[0].correction).toContain("<svg>")
})

test("cursor pagination walks every card once and then stops", async () => {
  const seen: string[] = []
  let cursor: string | undefined
  let pages = 0
  do {
    const page = await call("list_mistakes", { limit: 40, cursor })
    seen.push(...ids(page))
    cursor = page.nextCursor ?? undefined
    pages += 1
  } while (cursor)
  expect(pages).toBe(3)
  expect(seen).toHaveLength(102)
  expect(new Set(seen).size).toBe(102)
  await expect(call("list_mistakes", { cursor: "no-such-card" })).rejects.toThrow("cursor")
})

test("topic filter finds cards with no topic, and backfill_topics previews before it writes", async () => {
  expect((await call("list_mistakes", { topic: "none", limit: 200 })).total).toBe(102)
  const snapshot = JSON.stringify(data.mistakes)
  const preview = await call("backfill_topics", {})
  expect(preview).toMatchObject({ dryRun: true, applied: false, willChange: 102 })
  expect(preview.unmatched.length).toBeGreaterThan(0)
  expect(JSON.stringify(data.mistakes)).toBe(snapshot)
  expect(logs).toHaveLength(0)

  const applied = await call("backfill_topics", { dryRun: false })
  expect(logs).toHaveLength(1)
  expect(JSON.parse(logs[0])).toMatchObject({ tool: "backfill_topics", changes: expect.arrayContaining([{ id: "card-0", topic: [null, "Functions/domains/transformations"] }]) })
  expect(applied).toMatchObject({ dryRun: false, applied: true, willChange: 102 })
  expect((await call("list_mistakes", { topic: "none", limit: 200 })).total).toBe(0)
  expect((await call("backfill_topics", { dryRun: false })).willChange).toBe(0)
})

test("update_mistakes: dryRun previews, a bad topic rejects the whole batch, applying remembers the old values and revert restores them", async () => {
  const [first, second] = data.mistakes
  const edit = [{ id: first.id, topic: "integration & AREA", areaOfStudy: "Area between curves (tech-active)" }, { id: second.id, topic: "Circular functions" }]
  const snapshot = JSON.stringify(data.mistakes)

  const preview = await call("update_mistakes", { updates: edit, dryRun: true })
  expect(preview).toMatchObject({ dryRun: true, applied: false, changed: 2, errors: [] })
  expect(preview.changes[0]).toMatchObject({ before: { topic: null, areaOfStudy: first.areaOfStudy }, after: { topic: "Integration & area", areaOfStudy: "Area between curves (tech-active)" } })
  expect(JSON.stringify(data.mistakes)).toBe(snapshot)

  const bad = [...edit, { id: data.mistakes[2].id, topic: "Calculus" }]
  expect((await call("update_mistakes", { updates: bad, dryRun: true })).errors).toHaveLength(1)
  await expect(call("update_mistakes", { updates: bad })).rejects.toThrow("Nothing was changed")
  expect(JSON.stringify(data.mistakes)).toBe(snapshot)

  await call("update_mistakes", { updates: edit })
  expect(JSON.parse(logs.at(-1)!)).toMatchObject({ tool: "update_mistakes" })
  expect(data.mistakes[0]).toMatchObject({ topic: "Integration & area", areaOfStudy: "Area between curves (tech-active)", previous: { topic: null, areaOfStudy: first.areaOfStudy } })
  expect(data.mistakes[1].topic).toBe("Circular functions")

  const undone = await call("update_mistakes", { updates: edit, revert: true })
  expect(undone).toMatchObject({ changed: 2, reverted: true })
  expect(data.mistakes[0]).not.toHaveProperty("previous")
  expect(data.mistakes[0].areaOfStudy).toBe(first.areaOfStudy)
  expect(data.mistakes[0].topic).toBeUndefined()
})

test("save_exam attaches question results to an existing exam in one call, with only the id and the results", async () => {
  const target = data.attempts[0]
  await call("save_exam", {
    id: target.id,
    questionResults: [
      { label: "Q1", marksAwarded: 3, maxMarks: 4, topic: "differentiation & applications" },
      { label: "Q2", marksAwarded: 1, maxMarks: 3, areaOfStudy: "Tangent to a curve" },
    ],
  })
  const saved = data.attempts[0]
  expect(saved).toMatchObject({ rawScore: target.rawScore, rawMax: target.rawMax, paper: target.paper, title: target.title })
  expect(saved.questionResults?.map((r) => [r.label, r.topic])).toEqual([["Q1", "Differentiation & applications"], ["Q2", undefined]])
  await expect(call("save_exam", { id: target.id, questionResults: [{ label: "Q1", marksAwarded: 1, maxMarks: 1, topic: "Calculus" }] })).rejects.toThrow("Q1")
  await expect(call("save_exam", { ...exam, paper: "Exam 1" })).rejects.toThrow("rawMax")
})

test("get_exam_analytics: groupBy and the paper filter", async () => {
  const byTopic = await call("get_exam_analytics", { subject: "mathematical methods" })
  expect(byTopic.paperWeakness).toHaveLength(8)
  expect(byTopic.paperWeakness[0].groupBy).toBe("topic")
  const byLabel = await call("get_exam_analytics", { subject: SUBJECT, groupBy: "areaOfStudy" })
  expect(byLabel.paperWeakness.length).toBeGreaterThan(80)
  expect(byLabel.paperWeakness[0].groupBy).toBe("areaOfStudy")

  const exam1 = await call("get_exam_analytics", { subject: SUBJECT, paper: "Exam 1" })
  expect(exam1.dataQuality.attempts).toBe(27)
  expect(exam1.paperWeakness.every((row: { exam2: { mistakeCount: number } }) => row.exam2.mistakeCount === 0)).toBe(true)
  expect(exam1.outlooks[0].attempts).toBe(27)
})

test("save_sac takes a plain date or a timestamp and stores the app's plain date either way", async () => {
  const sac = { subject: "Physical Education", provider: "School", title: "SAC 6", unit: 3, durationMinutes: 60 }
  const plain = await call("save_sac", { ...sac, scheduledAt: "2026-10-06" })
  const stamped = await call("save_sac", { ...sac, title: "SAC 5", scheduledAt: "2026-04-02T23:59:00+11:00" })
  expect(data.sacRecords.find((r) => r.id === plain.id)?.scheduledAt).toBe("2026-10-06")
  expect(data.sacRecords.find((r) => r.id === stamped.id)?.scheduledAt).toBe("2026-04-02")
  await expect(call("save_sac", { ...sac, scheduledAt: "next Tuesday" })).rejects.toThrow()
  // Re-saving a record that holds a timestamp heals it, and a score keeps the date as the completion date.
  await call("save_sac", { id: stamped.id, ...sac, title: "SAC 5", scheduledAt: "2026-04-02T23:59:00+11:00", score: 20, maxScore: 25 })
  expect(data.sacRecords.find((r) => r.id === stamped.id)).toMatchObject({ scheduledAt: "2026-04-02", completedAt: "2026-04-02" })
})
