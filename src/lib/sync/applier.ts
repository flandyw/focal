/**
 * The only place a remote change becomes local state.
 *
 * Everything here is a projection of the log onto the local store: read the current
 * file, apply the decided entries, write it back, and tell the UI. It never touches the
 * network and never waits on it, and a remote write must not queue itself, so each record
 * write is bracketed by an outbox suppression that is cleared in the same breath.
 */
import {
  getAssistantCustomInstructions,
  getAssistantPersonality,
  getModel,
  getNotionCalendarSettings,
  getOllamaBaseUrl,
  getOllamaModel,
  getProvider,
  getReasoningEffort,
  getReasoningExclude,
  getReasoningMaxTokens,
  getTimetableConfig,
  setAssistantCustomInstructions,
  setAssistantPersonality,
  setModel,
  setNotionCalendarSettings,
  setOllamaBaseUrl,
  setOllamaModel,
  setProvider,
  setReasoningEffort,
  setReasoningExclude,
  setReasoningMaxTokens,
  setTimetableConfig,
  type AssistantPersonality,
  type ReasoningEffort,
} from "@/lib/settings"
import { getStoredQuickLinks, QUICK_LINKS_STORAGE_KEY } from "@/lib/quickLinks"
import { setCachedPreference } from "@/lib/storage/preferences"
import { emitLocalDataChanged, readLocalDataArray, readLocalStorageArray, SYNC_DATA_FILES } from "@/lib/sync/localData"
import { clearRecordOutboxSuppressions, suppressRecordOutbox, readOutbox } from "@/lib/sync/persistence"
import { recordNotionUpsertIntent, recordRemoteNotionDeleteIntent } from "@/lib/sync/sinks"
import type { LocalRecord, SyncRowState, SyncTable } from "@/lib/sync/types"
import type { Subject, TimetableConfig, UserSettings } from "@/lib/types"
import { mutatePersistedArray } from "@/lib/storage/database"
import { normalizeStudySession } from "@/lib/studySessions"
import { bustSubjectCache } from "@/lib/utils"

const CUSTOM_SUBJECTS_KEY = "focal-custom-subjects"
const HIDDEN_SUBJECTS_KEY = "focal-hidden-subjects"

const RECORD_TABLES = ["projects", "events", "study_sessions"] as const
type RecordTable = (typeof RECORD_TABLES)[number]

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isSubject(value: unknown): value is Subject {
  return isObject(value)
    && typeof value.id === "string"
    && typeof value.name === "string"
    && typeof value.shortCode === "string"
    && typeof value.color === "string"
}

/**
 * Apply decided entries. A snapshot's absent rows need no handling: every published row
 * is in the server's materialized state, so a local row missing from a snapshot exists
 * only here, which means it is still queued and `reduceSnapshot` kept it.
 */
export async function applyRemoteEntries(entries: readonly SyncRowState[]): Promise<void> {
  for (const table of RECORD_TABLES) {
    const tableEntries = entries.filter((entry) => entry.entity === table)
    if (tableEntries.length > 0) await applyRecordEntries(table, tableEntries)
  }
  applyCustomSubjectChanges(entries.filter((entry) => entry.entity === "custom_subjects"))
  applyHiddenSubjectChanges(entries.filter((entry) => entry.entity === "hidden_subjects"))
  applySingletonChange(entries, "timetable_config", (payload) => {
    setTimetableConfig(payload as TimetableConfig)
  })
  applySingletonChange(entries, "user_settings", (payload) => {
    applyUserSettings(payload as UserSettings)
  })
}

async function applyRecordEntries(table: RecordTable, entries: readonly SyncRowState[]): Promise<void> {
  const fileName = SYNC_DATA_FILES[table]!
  const putRecords: { entity: RecordTable; rowId: string; payload: unknown }[] = []
  try {
    await mutatePersistedArray(fileName, async (local) => {
      const byId = new Map((local as Record<string, unknown>[]).map((record) => [String(record.id), record]))
      // A local edit/delete can land after reduction while this projection waits
      // for the storage lock. Never overwrite that newer, unpublished boundary.
      const pending = new Set((await readOutbox()).filter((change) => change.entity === table).map((change) => change.rowId))
      for (const entry of entries) {
        if (pending.has(entry.rowId)) continue
        if (entry.operation === "delete") {
          await recordRemoteNotionDeleteIntent(
            { ...entry, changeId: "", createdAt: new Date().toISOString() },
            byId.get(entry.rowId),
          )
          byId.delete(entry.rowId)
        } else if (isObject(entry.payload)) {
          const rawPayload = { ...entry.payload, id: entry.rowId }
          const payload = table === "study_sessions"
            ? normalizeStudySession(rawPayload) as unknown as Record<string, unknown>
            : rawPayload
          byId.set(entry.rowId, payload)
          putRecords.push({ entity: table, rowId: entry.rowId, payload })
        }
      }
      await suppressRecordOutbox(putRecords)
      return [...byId.values()]
    })
  } finally {
    await clearRecordOutboxSuppressions(putRecords)
  }
  for (const record of putRecords) {
    await recordNotionUpsertIntent(table, record.rowId, record.payload as LocalRecord)
  }
  emitLocalDataChanged(table)
}

function applyCustomSubjectChanges(entries: readonly SyncRowState[]): void {
  if (entries.length === 0) return
  const byId = new Map(readLocalStorageArray<Subject>(CUSTOM_SUBJECTS_KEY).map((subject) => [subject.id, subject]))
  for (const entry of entries) {
    if (entry.operation === "delete") byId.delete(entry.rowId)
    else if (isSubject(entry.payload)) byId.set(entry.rowId, { ...entry.payload, id: entry.rowId })
  }
  setCachedPreference(CUSTOM_SUBJECTS_KEY, JSON.stringify([...byId.values()]), true)
  bustSubjectCache()
  emitLocalDataChanged("custom_subjects")
}

function applyHiddenSubjectChanges(entries: readonly SyncRowState[]): void {
  if (entries.length === 0) return
  const ids = new Set(readLocalStorageArray<string>(HIDDEN_SUBJECTS_KEY))
  for (const entry of entries) {
    if (entry.operation === "delete") ids.delete(entry.rowId)
    else ids.add(entry.rowId)
  }
  setCachedPreference(HIDDEN_SUBJECTS_KEY, JSON.stringify([...ids]), true)
  emitLocalDataChanged("hidden_subjects")
}

function applySingletonChange(entries: readonly SyncRowState[], entity: SyncTable, apply: (payload: unknown) => void): void {
  const relevant = entries.filter((entry) => entry.entity === entity)
  const last = relevant[relevant.length - 1]
  if (last?.operation !== "put" || !isObject(last.payload)) return
  apply(last.payload)
  emitLocalDataChanged(entity)
}

export async function readCurrentLocalValue(table: SyncTable, rowId: string): Promise<LocalRecord | undefined> {
  const fileName = SYNC_DATA_FILES[table]
  if (fileName) {
    const records = await readLocalDataArray<LocalRecord & { id?: string }>(fileName)
    return records.find((record) => record.id === rowId)
  }
  if (table === "custom_subjects") return readLocalStorageArray<Subject>(CUSTOM_SUBJECTS_KEY).find((subject) => subject.id === rowId)
  if (table === "hidden_subjects") return readLocalStorageArray<string>(HIDDEN_SUBJECTS_KEY).includes(rowId) ? rowId : undefined
  if (table === "timetable_config") return getTimetableConfig()
  if (table === "user_settings") return collectUserSettings()
  return undefined
}

export function collectUserSettings(): UserSettings {
  const notion = getNotionCalendarSettings()
  return {
    openrouter_api_key: "",
    openrouter_model: getModel(),
    reasoning_effort: getReasoningEffort(),
    reasoning_max_tokens: getReasoningMaxTokens(),
    reasoning_exclude: getReasoningExclude(),
    notion_token: "",
    notion_data_source_id: notion.dataSourceId,
    notion_title_property: notion.titleProperty,
    notion_date_property: notion.dateProperty,
    notion_type_property: notion.typeProperty,
    notion_completed_property: notion.completedProperty,
    notion_subject_property: notion.subjectProperty,
    provider: getProvider(),
    ollama_base_url: getOllamaBaseUrl(),
    ollama_model: getOllamaModel(),
    assistant_personality: getAssistantPersonality(),
    assistant_custom_instructions: getAssistantCustomInstructions(),
    quick_links: getStoredQuickLinks(),
  }
}

export function applyUserSettings(settings: UserSettings): void {
  if (settings.openrouter_model) setModel(settings.openrouter_model)
  if (settings.reasoning_effort) setReasoningEffort(settings.reasoning_effort as ReasoningEffort)
  if (typeof settings.reasoning_max_tokens === "number") setReasoningMaxTokens(settings.reasoning_max_tokens)
  setReasoningExclude(Boolean(settings.reasoning_exclude))
  if (settings.provider) setProvider(settings.provider)
  if (settings.ollama_base_url) setOllamaBaseUrl(settings.ollama_base_url)
  if (typeof settings.ollama_model === "string") setOllamaModel(settings.ollama_model)
  if (settings.assistant_personality) setAssistantPersonality(settings.assistant_personality as AssistantPersonality)
  setAssistantCustomInstructions(settings.assistant_custom_instructions ?? "")
  if (settings.quick_links) setCachedPreference(QUICK_LINKS_STORAGE_KEY, JSON.stringify(settings.quick_links), true)
  const currentNotion = getNotionCalendarSettings()
  setNotionCalendarSettings({
    token: currentNotion.token,
    dataSourceId: settings.notion_data_source_id ?? "",
    titleProperty: settings.notion_title_property ?? "Name",
    dateProperty: settings.notion_date_property ?? "Date",
    typeProperty: settings.notion_type_property ?? "Type",
    completedProperty: settings.notion_completed_property ?? "Complete",
    subjectProperty: settings.notion_subject_property ?? "Subject",
  })
}
