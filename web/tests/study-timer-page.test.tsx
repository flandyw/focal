import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { StudyTimerPage } from "../src/components/study-timer-page"
import type { ExamTimerModeProps } from "../src/components/exam-timer-mode"
import type { CanonicalStudySession } from "../../../src/lib/sync/sessionContract"

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

function render(mode: "focus" | "exam" = "focus", subject = "", sessions?: CanonicalStudySession[]) {
  return renderToStaticMarkup(
    <StudyTimerPage
      subjects={["Chemistry", "Physics"]}
      preferredSubjects={["Physics"]}
      mode={mode}
      onModeChange={noop}
      onFocusSessionChange={noop}
      exam={exam}
      sessions={sessions}
      focusPreset={subject ? { subject, intent: "" } : undefined}
    />,
  )
}

/** A sitting finished today, as Focal desktop would have written it to the shared record. */
function sittingToday(): CanonicalStudySession {
  const started = new Date()
  started.setHours(started.getHours() - 1, 0, 0, 0)
  const ended = new Date(started.getTime() + 45 * 60_000)
  return {
    id: "cs1", kind: "focus", state: "completed", phase: "focus", revision: 2,
    title: "Redo the 2023 organic paper", subject_id: "mm", originating_app: "focal",
    created_at: started.toISOString(), updated_at: ended.toISOString(),
    started_at: started.toISOString(), paused_at: null, completed_at: ended.toISOString(),
    cancelled_at: null, accumulated_active_ms: 45 * 60_000, segment_started_at: null,
    metadata: { subjectIds: ["mm"], schedule: { blocks: [{ start: started.toISOString(), end: ended.toISOString() }] } },
    segments: [{ id: "g1", session_id: "cs1", started_at: started.toISOString(), ended_at: ended.toISOString(), phase: null, source_device_id: null }],
  }
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
  expect(markup).toContain("Study")
  expect(markup).toContain("Timed paper")
  // The active mode is the one the app asked for, and it owns the selection.
  expect(markup).toContain('aria-selected="true"')
})

test("the focus mode leads with a labelled readout, its controls, and the block's own fields", () => {
  const markup = render("focus")

  // Free study starts at zero and has no countdown or cycle markers.
  expect(markup).toContain("0:00")
  expect(markup).toContain("Free study")

  // The readout is a real timer with a name.
  expect(markup).toContain('role="timer"')
  expect(markup).toContain('aria-label="Free study, 0:00 elapsed"')
  expect(markup).not.toContain("Set 1 of 4")

  for (const control of ["Start", "Reset", "Finish free study", "Pomodoro"]) {
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
  for (const label of ["Start"]) {
    expect(buttonEnding(withoutSubject, label)).toContain('disabled=""')
  }

  // A subject handed over by the day plan unlocks the timer immediately.
  const withSubject = render("focus", "Chemistry")
  expect(withSubject).not.toContain("Pick one to unlock the timer.")
  for (const label of ["Start"]) {
    expect(buttonEnding(withSubject, label)).not.toContain('disabled=""')
  }
})

test("an empty day explains itself instead of showing a bare list", () => {
  const markup = render("focus")
  expect(markup).toContain("No study logged today")
  expect(markup).toContain("Finish a study session")
  // Defaults to a four block goal, so the card reads 0 / 4 rather than 0 / 0.
  expect(markup).toContain("Pomodoro settings")
  expect(markup).not.toContain("0 / 4")
  expect(markup).toContain("Across 0 sessions")
})

// The timer's own blocks are mirrored into shared sittings, so today's record is the shared
// one. That is also what makes study done in Focal show up here instead of a silent zero.
test("today's focus counts study logged in another app, not just this browser's blocks", () => {
  const markup = render("focus", "", [sittingToday()])

  expect(markup).toContain("Redo the 2023 organic paper")
  expect(markup).toContain("45 min")
  expect(markup).toContain("Across 1 session")
  expect(markup).not.toContain("1 / 4")
  // It is a finished sitting, so the empty-day invitation is gone.
  expect(markup).not.toContain("No study logged today")
})

test("every settings control is labelled and states its own on and off position", () => {
  const markup = render("focus")

  for (const id of ["timer-work", "timer-break", "timer-long-break", "timer-every", "timer-goal"]) {
    expect(markup).toContain(`for="${id}"`)
    expect(markup).toContain(`id="${id}"`)
  }

  // Toggles are buttons carrying aria-pressed, not colour-only switches.
  expect(markup.match(/aria-pressed="(true|false)"/g)?.length).toBe(10)
  for (const label of ["Sound", "Notifications", "Auto-start breaks", "Auto-start focus"]) {
    expect(markup).toContain(label)
  }
})

test("free study hides the Pomodoro planner", () => {
  const markup = render("focus")

  expect(markup).not.toContain("Plan a session")
  expect(markup).not.toContain("Connect ChatGPT in Settings to plan sessions.")
  // Nothing to plan yet, so the timer is left exactly as it was.
  expect(markup).toContain("0:00")
  expect(markup).toContain('aria-label="Free study, 0:00 elapsed"')
})
