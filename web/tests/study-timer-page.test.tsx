import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { StudyTimerPage } from "../src/components/study-timer-page"
import { ExamTimerMode, type ExamTimerModeProps } from "../src/components/exam-timer-mode"
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
      onControlSession={async () => {}}
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

test("session setup comes before the readout and supporting settings", () => {
  const markup = render("focus")
  expect(markup.indexOf('id="timer-subject"')).toBeLessThan(markup.indexOf('role="timer"'))
  expect(markup.indexOf('role="timer"')).toBeLessThan(markup.indexOf('id="today-title"'))
  expect(markup.indexOf('id="today-title"')).toBeLessThan(markup.indexOf("Pomodoro settings"))
})

test("timed paper setup leads with the form rather than recommendations", () => {
  const markup = renderToStaticMarkup(<ExamTimerMode {...exam} />)
  expect(markup.indexOf("Set up your exam")).toBeLessThan(markup.indexOf("Suggested next exams"))
  for (const id of ["subject", "provider", "year", "paper", "reading", "writing", "marks"]) {
    expect(markup).toContain(`id="exam-mode-${id}"`)
    expect(markup).toContain(`for="exam-mode-${id}"`)
  }
  expect(markup).toContain("Begin reading time")
})

test("an active paper groups lifecycle controls with the timer before its overview", () => {
  const markup = renderToStaticMarkup(<ExamTimerMode {...exam} activeSession={{
    id: "exam-layout", subject: "Chemistry", provider: "VCAA", title: "VCAA Chemistry",
    examYear: 2025, paper: "Exam", readingMinutes: 15, writingMinutes: 120, marks: 100,
    startedAt: Date.now(), phase: "reading", workspaceItems: [],
  }} />)
  const timerIndex = markup.indexOf('role="timer"')
  for (const label of ["Pause and save", "Finish &amp; mark", "Edit conditions", "Discard exam"]) {
    expect(markup.indexOf(label)).toBeGreaterThan(timerIndex)
    expect(markup.indexOf(label)).toBeLessThan(markup.indexOf("Session overview"))
  }
  expect(markup).toContain("Expected progress")
  expect(markup).toContain("Exam workspace")
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


test("Folio study uses the main elapsed readout and regular session controls", () => {
  const session = { ...sittingToday(), originating_app: "folio" as const, state: "paused" as const,
    accumulated_active_ms: 750_000, completed_at: null, paused_at: new Date().toISOString() }
  const markup = render("focus", "", [session])
  expect(markup).toContain('aria-label="Free study, 12:30 elapsed"')
  expect(markup).toContain("Redo the 2023 organic paper")
  expect(markup).not.toContain('id="timer-subject"')
  expect(buttonEnding(markup, "Resume")).not.toContain('disabled=""')
  expect(buttonEnding(markup, "Finish free study")).not.toContain('disabled=""')
  expect(markup).toContain("Discard")
  expect(markup).not.toContain("Pick one to unlock the timer.")
})

test("running Focal study takes priority over paused shared study", () => {
  const paused = { ...sittingToday(), id: "paused", state: "paused" as const, accumulated_active_ms: 120_000,
    title: "Paused session", completed_at: null }
  const running = { ...sittingToday(), id: "running", state: "running" as const, accumulated_active_ms: 900_000,
    title: "Live desktop study", completed_at: null }
  const markup = render("focus", "", [paused, running])
  expect(markup).toContain('aria-label="Free study, 15:00 elapsed"')
  expect(buttonEnding(markup, "Pause")).not.toContain('disabled=""')
  expect(markup).toContain("Live desktop study")
})

test("another browser's study is shared, while completed and exam sessions leave the study timer idle", () => {
  const otherBrowser = { ...sittingToday(), originating_app: "examtrack" as const, state: "paused" as const,
    accumulated_active_ms: 300_000, completed_at: null }
  expect(render("focus", "", [otherBrowser])).toContain('aria-label="Free study, 5:00 elapsed"')
  const timedExam = { ...otherBrowser, kind: "exam" as const }
  expect(render("focus", "", [timedExam, sittingToday()])).toContain('aria-label="Free study, 0:00 elapsed"')
})


test("a running browser session stays in the main timer ahead of older paused sessions", () => {
  const original = globalThis.localStorage
  const own = { ...sittingToday(), id: "own", state: "running" as const, originating_app: "examtrack" as const }
  const paused = { ...sittingToday(), id: "older", state: "paused" as const, accumulated_active_ms: 120_000 }
  Reflect.set(globalThis, "localStorage", {
    getItem: (key: string) => key.endsWith("focus-session:v1") ? JSON.stringify({
      id: "own", subject: "Chemistry", provider: "Focal", title: "Browser study", workMinutes: 25,
      startedAt: Date.now(), pausedSeconds: 0,
    }) : key.endsWith("state:v1") ? JSON.stringify({
      version: 2, mode: "free", freeStudy: true, running: false, overtimeSeconds: 60, updatedAt: Date.now(),
    }) : null,
  })
  try {
    const markup = render("focus", "Chemistry", [paused, own])
    expect(markup).toContain('aria-label="Free study, 1:00 elapsed"')
    expect(markup).toContain('id="timer-subject"')
    expect(markup).not.toContain('aria-label="Free study, 2:00 elapsed"')
  } finally {
    if (original === undefined) Reflect.deleteProperty(globalThis, "localStorage")
    else Reflect.set(globalThis, "localStorage", original)
  }
})
