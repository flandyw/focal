import { expect, test } from "bun:test"
import { DEFAULT_AI_SETTINGS, parseAISettings } from "../src/lib/ai-settings"

test("loads valid AI preferences and falls back from malformed values", () => {
  expect(parseAISettings('{"model":"gpt-5.4","reasoningEffort":"high"}')).toEqual({ model: "gpt-5.4", reasoningEffort: "high" })
  expect(parseAISettings('{"model":7,"reasoningEffort":"maximum"}')).toEqual(DEFAULT_AI_SETTINGS)
  expect(parseAISettings("not json")).toEqual(DEFAULT_AI_SETTINGS)
})
