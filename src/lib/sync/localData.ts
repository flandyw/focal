import { readRecords } from "@/lib/storage/database"
import type { CoreDataFile, CoreRecordKind } from "@/lib/storage/records"
import type { SyncTable } from "@/lib/sync/types"

export const SYNC_DATA_FILES: Partial<Record<SyncTable, CoreDataFile>> = {
  projects: "projects.json",
  events: "events.json",
  study_sessions: "sessions.json",
}

export async function readLocalRecords<T>(kind: CoreRecordKind): Promise<T[]> {
  return await readRecords(kind) as T[]
}

export function readLocalStorageArray<T>(key: string): T[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

export function emitLocalDataChanged(table: SyncTable | readonly SyncTable[]): void {
  const tables = typeof table === "string" ? [table] : table
  window.dispatchEvent(new CustomEvent("focal-sync-data-changed", {
    detail: { table: tables[0], tables, fileName: SYNC_DATA_FILES[tables[0]] },
  }))
  if (tables.includes("timetable_config")) {
    window.dispatchEvent(new CustomEvent("focal-timetable-updated"))
  }
}
