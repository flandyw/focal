import { toast } from "sonner"
import { downloadExamFile } from "./host"
import { localDate } from "./learning-workspace"
import { EMPTY_APP_DATA, migrateAppData, type AppData } from "./exam-data"

// ponytail: this `examtrack` prefix is load-bearing. Renaming it would orphan every
// browser's existing localStorage entries and IndexedDB database, and the sync
// protocol's app ids are a shared wire contract with the desktop build. It stays.
const STORAGE_KEY = "examtrack:data:v1"

export function loadAppData(): AppData {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return EMPTY_APP_DATA
    const parsed: unknown = JSON.parse(stored)
    return migrateAppData(parsed) ?? EMPTY_APP_DATA
  } catch {
    return EMPTY_APP_DATA
  }
}

let storageFullWarned = false

/** Runs from timers and pagehide, so a full disk must be said out loud here: nothing above can catch it. */
export function saveAppData(data: AppData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    storageFullWarned = false
  } catch (error) {
    console.error("Could not save Focal data on this device:", error)
    if (storageFullWarned) return
    storageFullWarned = true
    toast.error("This device's storage is full", { description: "Recent changes may be lost on restart unless they have synced. Free some space, or export a backup from Settings." })
  }
}

export function parseAppDataFile(text: string): AppData {
  let migrated: AppData | null
  try {
    migrated = migrateAppData(JSON.parse(text) as unknown)
  } catch {
    migrated = null
  }
  if (!migrated) throw new Error("This file is not a valid Focal export.")
  return migrated
}

export function downloadAppData(data: AppData) {
  return downloadExamFile(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `focal-${localDate(new Date())}.json`)
}
