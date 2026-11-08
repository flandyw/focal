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
    return parseAppDataFile(stored)
  } catch (cause) {
    // An empty fallback would be autosaved over the only copy of the unreadable data.
    throw new Error("Focal could not read your saved data. Export a backup before trying to recover it. Your saved file has not been replaced.", { cause })
  }
}

let storageFullWarned = false

/** Runs from timers and pagehide, so a full disk must be said out loud here: nothing above can catch it. */
export function saveAppData(data: AppData): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    storageFullWarned = false
    return true
  } catch (error) {
    console.error("Could not save Focal data on this device:", error)
    if (storageFullWarned) return false
    storageFullWarned = true
    toast.error("This device's storage is full", { description: "Recent changes may be lost on restart unless they have synced. Free some space, or export a backup from Settings." })
    return false
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

/** Without a snapshot, export the original bytes even if migration or parsing failed. */
export function downloadAppData(data?: AppData) {
  const text = data ? JSON.stringify(data, null, 2) : localStorage.getItem(STORAGE_KEY)
  if (text === null) throw new Error("No saved Focal data was found on this device.")
  return downloadExamFile(new Blob([text], { type: "application/json" }), `focal-${localDate(new Date())}.json`)
}
