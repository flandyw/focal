import { expect, test } from "vite-plus/test"
import { mergeConcurrentValue } from "./app-sync"

for (const row of ["subjects", "completedSubjects", "trackedExamIds", "completedExamIds"]) {
  const merge = (base: string[], local: string[], remote: string[]) =>
    (mergeConcurrentValue("user_state", row, { value: base }, { value: local }, { value: remote }) as { value: string[] }).value.toSorted()
  test(`${row}: concurrent add/add`, () => expect(merge(["a"], ["a", "b"], ["a", "c"])).toEqual(["a", "b", "c"]))
  test(`${row}: concurrent add/remove`, () => {
    expect(merge(["a"], ["a", "b"], [])).toEqual(["b"])
    expect(merge(["a"], [], ["a", "b"])).toEqual(["b"])
  })
  test(`${row}: concurrent remove/remove`, () => expect(merge(["a", "b", "c"], ["b", "c"], ["a", "c"])).toEqual(["c"]))
}
test("completion years merge independent additions and removals", () => {
  expect(mergeConcurrentValue("user_state", "subjectCompletionYears", { value: { a: 2025 } }, { value: { a: 2025, b: 2026 } }, { value: { c: 2026 } })).toEqual({ value: { b: 2026, c: 2026 } })
})
