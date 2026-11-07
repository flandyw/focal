import { createContext, useSyncExternalStore } from "react"
import type { OverviewAction } from "./ai-overview"
export type { OverviewAction } from "./ai-overview"

/** App supplies the account and how each suggested action is carried out. */
export const AIOverviewContext = createContext<{ userId?: string; onAction: (action: OverviewAction) => void }>({ onAction: () => {} })

const SETTINGS_KEY = "focal:ai-overviews:v1"
export type OverviewSettings = { enabled: boolean; model: string }

export function loadOverviewSettings(): OverviewSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as Partial<OverviewSettings>
    return { enabled: saved.enabled !== false, model: typeof saved.model === "string" ? saved.model : "" }
  } catch { return { enabled: true, model: "" } }
}

export function saveOverviewSettings(settings: OverviewSettings) {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* Settings still apply for this session. */ }
  window.dispatchEvent(new Event("focal:ai-overviews"))
}

const subscribe = (change: () => void) => {
  window.addEventListener("focal:ai-overviews", change)
  return () => window.removeEventListener("focal:ai-overviews", change)
}
let snapshot = loadOverviewSettings()
const readSettings = () => {
  const next = loadOverviewSettings()
  if (next.enabled !== snapshot.enabled || next.model !== snapshot.model) snapshot = next
  return snapshot
}
export function useOverviewSettings() {
  return useSyncExternalStore(subscribe, readSettings)
}
