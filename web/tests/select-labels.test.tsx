import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { ExamWorkspace } from "../src/components/exam-workspace"
import { PerformanceContextFields } from "../src/components/performance-context-fields"
import type { ExamWorkspaceStatus } from "../src/lib/ongoing-timers"

const noop = () => {}

function selectedLabels(markup: string) {
  return [...markup.matchAll(/<span\b[^>]*data-slot="select-value"[^>]*>(.*?)<\/span>/g)].map((match) => match[1])
}

test("closed workspace selects display labels for every status and confidence", () => {
  const statuses: ExamWorkspaceStatus[] = ["not-started", "in-progress", "flagged", "done"]
  const confidences = ["low", "medium", "high"] as const
  const markup = renderToStaticMarkup(<ExamWorkspace
    items={statuses.map((status, index) => ({ id: String(index), label: `Question ${index + 1}`, marks: 1, status, confidence: confidences[index % confidences.length] }))}
    expectedMarks={2}
    totalMarks={4}
    onChange={noop}
  />)

  expect(selectedLabels(markup)).toEqual([
    "Not started", "Low confidence", "In progress", "Medium confidence",
    "Flagged", "High confidence", "Done", "Low confidence",
  ])
})

test("closed headspace selects display rating descriptions and unrecorded labels", () => {
  const markup = renderToStaticMarkup(<PerformanceContextFields
    value={{ energy: 1, focus: 2, stress: 3, confidence: 4, preparedness: 5 }}
    onChange={noop}
    idPrefix="context"
  />)
  expect(selectedLabels(markup)).toEqual(["1 · Very low", "2 · Low", "3 · Moderate", "4 · High", "5 · Very high"])

  const empty = renderToStaticMarkup(<PerformanceContextFields value={{}} onChange={noop} idPrefix="empty" />)
  expect(selectedLabels(empty)).toEqual(Array(5).fill("Not recorded"))
})
