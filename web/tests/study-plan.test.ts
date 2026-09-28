import { expect, test } from "bun:test"

import { CHEAPEST_MODEL, pickPlannerModel } from "../src/lib/ai-settings"
import { buildStudyPlan, describeStudyPlan, planSessionMinutes, type StudyPlan } from "../src/lib/study-plan"
import { DEFAULT_SETTINGS } from "../src/lib/study-timer"

const fallback: StudyPlan = {
  subject: "Chemistry",
  intent: "",
  workMinutes: 25,
  breakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  blocks: 1,
  summary: "",
  startNow: false,
}

test("a plan clamps every field and reuses the student's own subject spelling", () => {
  const plan = buildStudyPlan({
    subject: "  chemistry ",
    intent: "Redo the 2023 organic paper",
    workMinutes: 4000,
    breakMinutes: 0,
    longBreakEvery: 99,
    blocks: 40,
    startNow: "yes",
  }, fallback, ["Chemistry", "Physics"])

  expect(plan.subject).toBe("Chemistry")
  expect(plan.intent).toBe("Redo the 2023 organic paper")
  expect(plan.workMinutes).toBe(180)
  expect(plan.breakMinutes).toBe(1)
  expect(plan.longBreakEvery).toBe(12)
  expect(plan.blocks).toBe(12)
  // Anything but an explicit true is treated as false.
  expect(plan.startNow).toBe(false)
})

test("a missing, malformed or empty answer can never reach the timer", () => {
  expect(() => buildStudyPlan(undefined, fallback)).toThrow()
  expect(() => buildStudyPlan("not an object", fallback)).toThrow()
  // Half an answer still fills in from the timer's current shape.
  const partial = buildStudyPlan({ subject: "Physics", workMinutes: 50 }, fallback, ["Physics"])
  expect(partial).toMatchObject({ subject: "Physics", workMinutes: 50, breakMinutes: 5, longBreakEvery: 4 })
})

test("the session length counts breaks and the long break it lands on", () => {
  const plan = { ...fallback, workMinutes: 50, breakMinutes: 10, longBreakEvery: 2, blocks: 3 }
  // 3 x 50 focus, 2 x 10 breaks, 1 long break of 15 after the second block.
  expect(planSessionMinutes(plan)).toBe(185)
  expect(describeStudyPlan(plan, new Date("2026-03-04T18:00:00"))).toContain("finishes around 9:05 pm")
})

test("planning prefers the cheapest model the account actually offers", () => {
  const models = ["gpt-6-luna", "gpt-6-sol", "gpt-5.4", "auto"]
  expect(pickPlannerModel(models, CHEAPEST_MODEL)).toBe("gpt-6-luna")
  // A stored preference that is no longer offered falls back to the cheap model.
  expect(pickPlannerModel(models, "gpt-5.4-turbo")).toBe("gpt-6-luna")
  // Pro models cannot stream structured output at all.
  expect(pickPlannerModel(["gpt-6-pro"], CHEAPEST_MODEL)).toBeNull()
  expect(pickPlannerModel([], CHEAPEST_MODEL)).toBeNull()
  expect(buildStudyPlan({ summary: "One hour of physics" }, fallback).summary).toBe("One hour of physics")
  expect(DEFAULT_SETTINGS.workMinutes).toBe(25)
})
