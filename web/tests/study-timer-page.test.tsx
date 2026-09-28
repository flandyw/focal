import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { StudyTimerPage } from "../src/components/study-timer-page"
import type { ExamTimerModeProps } from "../src/components/exam-timer-mode"

const noop = () => {}

const exam: ExamTimerModeProps = {
  progression: undefined,
  onProgressionChange: noop,
  attempts: [],
  references: [],
  studies: [],
  preferredSubjects: [],
  saveStatus: "",
  onLeave: noop,
  onSessionChange: noop,
  onSave: noop,
}

function render(mode: "focus" | "exam" = "focus", subject = "") {
  return renderToStaticMarkup(
    <StudyTimerPage
      subjects={["Chemistry", "Physics"]}
      preferredSubjects={["Physics"]}
      mode={mode}
      onModeChange={noop}
      onFocusSessionChange={noop}
      exam={exam}
      focusPreset={subject ? { subject, intent: "" } : undefined}
    />,
  )
}

/** The markup up to a control's closing tag, so a control can be asserted on
 *  without a query engine. */
function buttonEnding(markup: string, label: string) {
  return markup.split("</button>").find((chunk) => chunk.trimEnd().endsWith(`>${label}`)) ?? ""
}

test("the study timer is one surface with a focus block and a timed paper mode", () => {
  const markup = render()

  expect(markup).toContain("Study timer")
  expect(markup).toContain('role="tablist"')
  expect(markup).toContain("Focus blocks")
  expect(markup).toContain("Timed paper")
  // The active mode is the one the app asked for, and it owns the selection.
  expect(markup).toContain('aria-selected="true"')
})

test("the focus mode leads with a labelled readout, its controls, and the block's own fields", () => {
  const markup = render("focus")

  // A paused 25 minute block on the default standard preset.
  expect(markup).toContain("25:00")
  expect(markup).toContain("Focus")

  // The readout is a real timer with a name.
  expect(markup).toContain('role="timer"')
  expect(markup).toContain('aria-label="Focus, 25:00 remaining"')
  expect(markup).toContain("Set 1 of 4")

  for (const control of ["Start", "Reset", "Start free study", "5 min", "10 min"]) {
    expect(markup).toContain(control)
  }
  expect(markup).not.toContain("Skip break")

  expect(markup).toContain('id="timer-subject"')
  expect(markup).toContain('id="timer-intent"')
  // The subject is a searchable combobox the student can also type into.
  expect(markup).toContain('role="combobox"')
  expect(markup).toContain("Search or type a subject")
})

test("no block starts without a subject, and the timer says why", () => {
  const withoutSubject = render("focus")

  // Every control that starts study is inert, and the field explains the hold.
  expect(withoutSubject).toContain("Pick one to unlock the timer.")
  expect(withoutSubject).toContain("A subject is required")
  for (const label of ["Start", "Start free study"]) {
    expect(buttonEnding(withoutSubject, label)).toContain('disabled=""')
  }

  // A subject handed over by the day plan unlocks the timer immediately.
  const withSubject = render("focus", "Chemistry")
  expect(withSubject).not.toContain("Pick one to unlock the timer.")
  for (const label of ["Start", "Start free study"]) {
    expect(buttonEnding(withSubject, label)).not.toContain('disabled=""')
  }
})

test("an empty day explains itself instead of showing a bare list", () => {
  const markup = render("focus")
  expect(markup).toContain("No blocks logged today")
  expect(markup).toContain("Finish one focus block")
  // Defaults to a four block goal, so the card reads 0 / 4 rather than 0 / 0.
  expect(markup).toContain("Daily goal")
  expect(markup).toContain("0 / 4")
  expect(markup).toContain("Across 0 blocks")
})

test("every settings control is labelled and states its own on and off position", () => {
  const markup = render("focus")

  for (const id of ["timer-work", "timer-break", "timer-long-break", "timer-every", "timer-goal"]) {
    expect(markup).toContain(`for="${id}"`)
    expect(markup).toContain(`id="${id}"`)
  }

  // Toggles are buttons carrying aria-pressed, not colour-only switches.
  expect(markup.match(/aria-pressed="(true|false)"/g)?.length).toBe(8)
  for (const label of ["Sound", "Notifications", "Auto-start breaks", "Auto-start focus"]) {
    expect(markup).toContain(label)
  }
})

test("the planner is inert and honest without a ChatGPT connection", () => {
  const markup = render("focus")

  expect(markup).toContain("Plan a session")
  expect(markup).toContain("Connect ChatGPT in Settings to plan sessions.")
  // Nothing to plan yet, so the timer is left exactly as it was.
  expect(markup).toContain("25:00")
  expect(markup).toContain('aria-label="Focus, 25:00 remaining"')
})
