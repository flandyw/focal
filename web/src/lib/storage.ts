import { EMPTY_APP_DATA, migrateAppData, type AppData } from "@/lib/exam-data"

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

export function saveAppData(data: AppData) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
}

export function parseAppDataFile(text: string): AppData {
  const parsed: unknown = JSON.parse(text)
  const migrated = migrateAppData(parsed)
  if (!migrated) {
    throw new Error("This file is not a valid ExamTrack export.")
  }
  return migrated
}

export function downloadAppData(data: AppData) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
  )
  const link = document.createElement("a")
  link.href = url
  link.download = `examtrack-${new Date().toISOString().slice(0, 10)}.json`
  link.click()
  URL.revokeObjectURL(url)
}
