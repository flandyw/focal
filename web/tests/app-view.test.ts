import { describe, expect, test } from "bun:test"

import { APP_VIEWS, APP_VIEW_STORAGE_KEY, isAppView, loadAppView, loadSidebarOpen, saveAppView } from "../src/lib/app-view"
import { ALL_NAVIGATION, getViewLabel } from "../src/lib/navigation"

describe("app view preferences", () => {
  test("accepts known views and rejects stale values", () => {
    expect(isAppView("mistakes")).toBeTrue()
    expect(isAppView("reports")).toBeFalse()
    expect(isAppView(null)).toBeFalse()
    // The timed paper is a mode of the study timer, not a view of its own.
    expect(isAppView("timer")).toBeFalse()
  })

  test("keeps every view discoverable in navigation", () => {
    expect(ALL_NAVIGATION.map((item) => item.id)).toEqual([...APP_VIEWS])
    expect(getViewLabel("predictor")).toBe("Study score")
  })

  test("restores a valid view and falls back safely", () => {
    expect(loadAppView({ getItem: () => "library" })).toBe("library")
    expect(loadAppView({ getItem: () => "removed-view" })).toBe("calendar")
    expect(loadAppView({ getItem: () => { throw new Error("blocked") } })).toBe("calendar")
    expect(loadAppView(null)).toBe("calendar")
    expect(loadAppView(null, "?timer=exam")).toBe("focus")
    expect(loadAppView(null, "?timer=sac")).toBe("sacs")
  })

  test("the calendar is the landing view and the old dashboard view lands on exams", () => {
    expect(loadAppView(null)).toBe(APP_VIEWS[0])
    expect(APP_VIEWS[0]).toBe("calendar")
    expect(loadAppView({ getItem: () => "dashboard" })).toBe("exams")
  })

  test("restores the collapsed sidebar from its cookie", () => {
    expect(loadSidebarOpen("other=1; sidebar_state=false")).toBeFalse()
    expect(loadSidebarOpen("sidebar_state=true")).toBeTrue()
    expect(loadSidebarOpen("other=1")).toBeTrue()
    expect(loadSidebarOpen(null)).toBeTrue()
  })

  test("persists navigation without making storage availability fatal", () => {
    let entry: [string, string] | undefined
    saveAppView({ setItem: (key, value) => { entry = [key, value] } }, "sacs")
    expect(entry).toEqual([APP_VIEW_STORAGE_KEY, "sacs"])
    expect(() => saveAppView({ setItem: () => { throw new Error("full") } }, "focus")).not.toThrow()
  })
})
