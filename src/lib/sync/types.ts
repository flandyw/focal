import type { CalendarEvent, Project, StudySession, Subject, TimetableConfig, UserSettings } from "@/lib/types"

export const SYNC_TABLES = [
  "projects",
  "events",
  "study_sessions",
  "custom_subjects",
  "hidden_subjects",
  "timetable_config",
  "user_settings",
] as const

export type SyncTable = (typeof SYNC_TABLES)[number]

/**
 * Every entity either Supabase project accepts. A client applies only the seven it
 * understands; the rest sit in its applied-state table and cost it nothing, which is what
 * lets one log carry Focal, ExamTrack and Folio data side by side.
 */
export const SYNC_ENTITIES = [
  ...SYNC_TABLES,
  "mistakes",
  "attempts",
  "user_state",
  "folio_notebooks",
  "folio_pages",
  "folio_strokes",
] as const
export type SyncOperation = "put" | "delete"
export type SyncStatus = "signed-out" | "syncing" | "synced" | "pending" | "error"

/** Any locally stored record, in any of the shapes the seven entities take. */
export type LocalRecord = Project | CalendarEvent | StudySession | Subject | string | TimetableConfig | UserSettings

/** A change waiting to be published. `lamport` orders it against other devices. */
export interface SyncChange {
  changeId: string
  entity: SyncTable
  rowId: string
  operation: SyncOperation
  payload: unknown
  createdAt: string
  lamport: number
  retryCount: number
  lastError?: string
  nextAttemptAt?: string
  blockedAt?: string
}

/** A change as the log stores it. `seq` is the only ordering authority. */
export interface RemoteSyncChange {
  seq: number
  changeId: string
  clientId: string
  entity: string
  rowId: string
  operation: SyncOperation
  payload: unknown
  lamport: number
  createdAt: string
}

/** The last remote version of a row that this device applied, in `sync_applied`. */
export interface SyncRowState {
  entity: string
  rowId: string
  operation: SyncOperation
  payload: unknown
  lamport: number
  clientId: string
  seq: number
}

export interface SyncConflictItem {
  table: string
  rowId: string
  localUpdatedAt: string | null
  remoteUpdatedAt: string | null
  remoteDeviceId: string | null
  label: string
}

/**
 * The numbers that say whether sync is healthy. A spinner says nothing.
 */
export interface SyncMetrics {
  /** Server sequence minus the sequence this device has applied. */
  cursorLag: number
  lastPushMs: number | null
  lastPullMs: number | null
  /** Times this device had to take a full snapshot because it fell behind the floor. */
  snapshots: number
  pushAttempts: number
  failures: number
}

export interface SyncStatusSnapshot {
  status: SyncStatus
  pendingCount: number
  error: string | null
  lastSuccessfulSyncAt: string | null
  details: string | null
  tableStats: { table: string; pulled?: number; pushed?: number; failed?: number }[] | null
  failedItems: { table: string; rowId: string; error: string }[] | null
  conflicts: SyncConflictItem[] | null
  isOnline: boolean
  metrics: SyncMetrics
}

export const EMPTY_METRICS: SyncMetrics = {
  cursorLag: 0,
  lastPushMs: null,
  lastPullMs: null,
  snapshots: 0,
  pushAttempts: 0,
  failures: 0,
}
