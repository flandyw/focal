import { expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"

import { TimerReadout } from "../src/components/timer-readout"

function render(overrides: Partial<Parameters<typeof TimerReadout>[0]> = {}) {
  return renderToStaticMarkup(
    <TimerReadout
      animationKey="Focus:0"
      caption="Stay with one task until the block ends."
      display="25:00"
      mode="Focus"
      progress={0}
      status="Paused"
      {...overrides}
    />,
  )
}

test("both timer runs are read through the same named instrument", () => {
  const focus = render()
  expect(focus).toContain('role="timer"')
  expect(focus).toContain('aria-label="Focus, 25:00 remaining"')
  expect(focus).toContain('aria-label="Focus progress"')
  expect(focus).toContain("25:00")

  // A timed paper reports through the identical contract, so the two modes
  // cannot drift into different visual languages.
  const exam = render({ display: "1:45:00", mode: "Writing time", status: "Running" })
  expect(exam).toContain('role="timer"')
  expect(exam).toContain('aria-label="Writing time, 1:45:00 remaining"')
  expect(exam).toContain('aria-label="Writing time progress"')
})

test("the discrete marks strip renders one mark per step and names itself", () => {
  const markup = render({ marks: { total: 4, filled: 2, label: "Set 3 of 4" } })
  expect(markup.match(/<li /g)?.length).toBe(4)
  expect(markup).toContain("Set 3 of 4")
  expect(markup).toContain('aria-label="Set 3 of 4"')
})

test("overtime is announced as destructive, and without marks it draws no strip", () => {
  const overtime = render({ display: "+05:00", mode: "Overtime", overtime: true, progress: 100 })
  expect(overtime).toContain("text-destructive")
  expect(overtime).toContain("+05:00")
  expect(overtime).not.toContain("<li ")

  // The phase change is carried to assistive tech, not only animated.
  expect(render({ onCaption: "Break started." })).toContain('role="status"')
  expect(render({ onCaption: "Break started." })).toContain("Break started.")
})
