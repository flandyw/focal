import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { EMPTY_APP_DATA, type AppData } from "../src/lib/exam-data"
import { EMPTY_LEARNING_WORKSPACE, type PracticeSession } from "../src/lib/learning-workspace"
import { PracticeStudio } from "../src/components/practice-studio"

test("renders Practice Studio question LaTeX and the active timer surface", () => {
  const session: PracticeSession = {
    id: "practice-1",
    title: "Mathematical Methods targeted practice",
    subject: "Mathematical Methods",
    durationMinutes: 15,
    questions: [{
      id: "question-1",
      skill: "Functions $f(x)$",
      question: "Solve \\(x^2=4\\) and state the two solutions.",
      answer: "$x=2$ or $x=-2$.",
      marks: 2,
      rating: "unattempted",
    }],
    createdAt: "2026-08-23T00:00:00.000Z",
    updatedAt: "2026-08-23T00:00:00.000Z",
    startedAt: "2026-08-23T00:00:00.000Z",
    timerStartedAt: "2026-08-23T00:00:00.000Z",
    elapsedSeconds: 0,
  }
  const data: AppData = {
    ...EMPTY_APP_DATA,
    subjects: [session.subject],
    learning: { ...EMPTY_LEARNING_WORKSPACE, practiceSessions: [session] },
  }

  const markup = renderToStaticMarkup(
    <PracticeStudio data={data} onChange={() => {}} onComplete={() => {}} onOpenMistakes={() => {}} />,
  )

  expect(markup).toContain("katex")
  expect(markup).toContain("role=\"timer\"")
  expect(markup).toContain("Pause timer")
  expect(markup).not.toContain("\\(x^2=4\\)")
})
