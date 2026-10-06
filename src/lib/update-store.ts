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
