import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { MistakesPage } from "../src/components/mistakes-page"
import { EMPTY_APP_DATA, type AppData, type Mistake } from "../src/lib/exam-data"

const noop = () => {}

const attempt = {
  id: "attempt-1",
  subject: "Mathematics",
  title: "2025 Exam 1",
  paper: "Exam 1",
  date: "2025-11-05",
  durationMinutes: 120,
  provider: "VCE",
  totalMarks: 120,
  questions: [],
  score: 80,
} as unknown as AppData["attempts"][number]

const mistake = {
  id: "m1",
  attemptId: "attempt-1",
  question: "Question 4a",
  questionText: "Solve $x^2 - 5x + 6 = 0$.",
  category: "Algebra",
  areaOfStudy: "Quadratics",
  explanation: "Factoring was skipped.",
  correction: "$x = \\frac{5 \\pm \\sqrt{25 - 24}}{2}$",
  criterion: "Correctly factors and solves.",
  totalMarks: 2,
  marksLost: 2,
  resolved: false,
  createdAt: "2025-11-06T00:00:00.000Z",
  updatedAt: "2025-11-06T00:00:00.000Z",
} as unknown as Mistake

const data: AppData = { ...EMPTY_APP_DATA, attempts: [attempt], mistakes: [mistake] }

function render(pageData = data) {
  return renderToStaticMarkup(
    <MistakesPage
      data={pageData}
      studies={[]}
      onLog={noop}
      onEdit={noop}
      onReview={noop}
      onToggleSuspend={noop}
      onSetSuspended={noop}
      onDelete={noop}
      onImportMistakes={noop}
      onApplyAutofills={noop}
      onApplyMergePlan={noop}
      onSaveInsights={noop}
      onSaveAlternativeDeck={noop}
    />,
  )
}

test("library lists dense rows and defers the maths-heavy body until a card opens", () => {
  const markup = render()

  // One row, one card title, and no answer rendering: KaTeX is the most expensive
  // synchronous cost on this page and must only run for the open card.
  expect(markup.match(/Select Question 4a/g)?.length).toBe(1)
  expect(markup).toContain("Algebra")
  expect(markup).toContain("2/2 lost")
  expect(markup).toContain("Due now")
  expect(markup).not.toContain("katex")
  expect(markup).not.toContain("mfrac")
  // Answer bodies live in the reading pane, never inside a list row.
  expect(markup).not.toContain("What went wrong")
})

test("library falls back to a full-width empty state when nothing matches", () => {
  const markup = renderToStaticMarkup(
    <MistakesPage
      data={{ ...data, mistakes: [] }}
      studies={[]}
      onLog={noop}
      onEdit={noop}
      onReview={noop}
      onToggleSuspend={noop}
      onSetSuspended={noop}
      onDelete={noop}
      onImportMistakes={noop}
      onApplyAutofills={noop}
      onApplyMergePlan={noop}
      onSaveInsights={noop}
      onSaveAlternativeDeck={noop}
    />,
  )

  expect(markup).toContain("No mistakes yet")
  expect(markup).not.toContain("Select all")
})


test("mistakes can be added or imported without any exams", () => {
  const markup = render(EMPTY_APP_DATA)
  const buttons = markup.match(/<button[^>]*>[\s\S]*?<\/button>/g) ?? []
  for (const label of ["Add mistake", "Import from chatbot"]) {
    const button = buttons.find((button) => button.includes(label))
    expect(button).toBeDefined()
    expect(button?.split(">")[0]).not.toMatch(/\sdisabled(?:=|\s|$)/)
  }
  expect(render({ ...EMPTY_APP_DATA, mistakes: [{ ...mistake, attemptId: "" }] })).toContain("Uncategorised")
})
