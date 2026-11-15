import { useSyncExternalStore } from "react"

export type UpdateState = {
  status: "idle" | "checking" | "uptodate" | "available" | "downloading" | "ready" | "installing" | "error"
  version?: string
  downloaded: number
  total?: number
  speed: number
  error?: string
}

// Desktop fills `updateActions`; the browser build never does, so the store stays idle.
export const updateActions: { check?: () => Promise<void>; download?: () => Promise<void>; install?: () => Promise<void> } = {}

let state: UpdateState = { status: "idle", downloaded: 0, speed: 0 }
const listeners = new Set<() => void>()

export const getUpdateState = () => state

const OVERNIGHT_KEY = "focal:update-overnight:v1"
export function readOvernightInstall() {
  try { return localStorage.getItem(OVERNIGHT_KEY) === "1" } catch { return false }
}
export function saveOvernightInstall(on: boolean) {
  try { localStorage.setItem(OVERNIGHT_KEY, on ? "1" : "0") } catch { /* Applies for this session only. */ }
}

export function setUpdateState(next: Partial<UpdateState>) {
  state = { ...state, ...next }
  listeners.forEach((listener) => listener())
}

export function useUpdateState() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, () => state)
}
