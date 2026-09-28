import { describe, expect, test } from "bun:test"

import { APP_VIEWS, APP_VIEW_STORAGE_KEY, isAppView, loadAppView, saveAppView } from "../src/lib/app-view"
import { ALL_NAVIGATION, getViewLabel } from "../src/lib/navigation"

describe("app view preferences", () => {
  test("accepts known views and rejects stale values", () => {
    expect(isAppView("mistakes")).toBeTrue()
    expect(isAppView("reports")).toBeFalse()
    expect(isAppView(null)).toBeFalse()
  })

  test("keeps every view discoverable in navigation", () => {
    expect(ALL_NAVIGATION.map((item) => item.id)).toEqual([...APP_VIEWS])
    expect(getViewLabel("predictor")).toBe("Study score")
  })

  test("restores a valid view and falls back safely", () => {
    expect(loadAppView({ getItem: () => "library" })).toBe("library")
    expect(loadAppView({ getItem: () => "removed-view" })).toBe("dashboard")
    expect(loadAppView({ getItem: () => { throw new Error("blocked") } })).toBe("dashboard")
    expect(loadAppView(null)).toBe("dashboard")
    expect(loadAppView(null, "?timer=exam")).toBe("timer")
    expect(loadAppView(null, "?timer=sac")).toBe("sacs")
  })

  test("persists navigation without making storage availability fatal", () => {
    let entry: [string, string] | undefined
    saveAppView({ setItem: (key, value) => { entry = [key, value] } }, "sacs")
    expect(entry).toEqual([APP_VIEW_STORAGE_KEY, "sacs"])
    expect(() => saveAppView({ setItem: () => { throw new Error("full") } }, "timer")).not.toThrow()
  })
})
