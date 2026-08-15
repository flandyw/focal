import { useState, useEffect, useCallback } from "react"
import { persistPreference } from "@/lib/storage/preferences"
import {
  applyMaterialTheme,
  DEFAULT_SEED_COLOR,
  isHexColor,
} from "@/lib/materialTheme"

export type ThemeMode = "light" | "dark" | "system"

interface ThemeSelection {
  mode: ThemeMode
  seedColor: string
}

const STORAGE_KEY = "focal-theme"

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system"
}

function getSystemDark(): boolean {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-color-scheme: dark)").matches
}

function resolveDark(mode: ThemeMode, systemDark: boolean): boolean {
  if (mode === "system") return systemDark
  return mode === "dark"
}

function getInitialSelection(): ThemeSelection {
  if (typeof window === "undefined") return { mode: "system", seedColor: DEFAULT_SEED_COLOR }
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as unknown
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>
        const direct = record.mode
        const seedColor = isHexColor(record.seedColor) ? record.seedColor.toLowerCase() : DEFAULT_SEED_COLOR
        if (isThemeMode(direct)) return { mode: direct, seedColor }
        const legacyDark = record.dark
        if (typeof legacyDark === "boolean") {
          return { mode: legacyDark ? "dark" : "light", seedColor }
        }
      }
    } catch {
      /* fall through */
    }
  }
  const oldDark = localStorage.getItem("focal-dark")
  if (oldDark !== null) {
    return { mode: oldDark === "true" ? "dark" : "light", seedColor: DEFAULT_SEED_COLOR }
  }
  return { mode: "system", seedColor: DEFAULT_SEED_COLOR }
}

export function useTheme() {
  const [selection, setSelection] = useState<ThemeSelection>(getInitialSelection)
  const [systemDark, setSystemDark] = useState(getSystemDark)
  const resolvedDark = resolveDark(selection.mode, systemDark)

  useEffect(() => {
    const value = JSON.stringify(selection)
    localStorage.setItem(STORAGE_KEY, value)
    // ponytail: debounce slider updates; persistence still settles after the user stops dragging.
    const timeout = window.setTimeout(() => void persistPreference(STORAGE_KEY, value, true), 150)
    return () => window.clearTimeout(timeout)
  }, [selection])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolvedDark)
    applyMaterialTheme(selection.seedColor, resolvedDark)
  }, [selection.seedColor, resolvedDark])

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)")
    const handler = () => setSystemDark(mq.matches)
    mq.addEventListener("change", handler)
    return () => mq.removeEventListener("change", handler)
  }, [])

  const setMode = useCallback((mode: ThemeMode) => {
    setSelection((prev) => ({ ...prev, mode }))
  }, [])

  const setSeedColor = useCallback((seedColor: string) => {
    if (!isHexColor(seedColor)) return
    setSelection((prev) => ({ ...prev, seedColor: seedColor.toLowerCase() }))
  }, [])

  return {
    mode: selection.mode,
    resolvedDark,
    seedColor: selection.seedColor,
    setMode,
    setSeedColor,
  }
}
