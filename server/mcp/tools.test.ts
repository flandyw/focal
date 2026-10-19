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

beforeEach(() => { data = { ...EMPTY_APP_DATA, ...failingCase() } })

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
