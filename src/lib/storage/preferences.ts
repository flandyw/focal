import { openFocalDatabase } from "@/lib/storage/database"
import { isTauri } from "@tauri-apps/api/core"

export interface PreferenceDefinition {
  key: string
  legacyValue: string | null
  syncable: boolean
}

interface PreferenceRow {
  key: string
  value: string
}

let writeLock: Promise<unknown> = Promise.resolve()

function withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const result = writeLock.then(operation, operation)
  writeLock = result.catch((error: unknown) => {
    console.error("Failed to persist preference:", error)
  })
  return result
}

function decodePreference(value: string): string | null {
  try {
    const parsed = JSON.parse(value) as unknown
    return typeof parsed === "string" ? parsed : null
  } catch {
    return null
  }
}

export async function hydratePreferences(
  definitions: PreferenceDefinition[],
): Promise<Map<string, string>> {
  const database = await openFocalDatabase()
  const rows = await database.select<PreferenceRow[]>("select key, value from preferences")
  const stored = new Map<string, string>()
  for (const row of rows) {
    const value = decodePreference(row.value)
    if (value !== null) stored.set(row.key, value)
  }

  for (const definition of definitions) {
    if (stored.has(definition.key) || definition.legacyValue === null) continue
    await database.execute(
      `insert into preferences (key, value, syncable, updated_at)
       values ($1, $2, $3, $4)
       on conflict (key) do nothing`,
      [
        definition.key,
        JSON.stringify(definition.legacyValue),
        definition.syncable ? 1 : 0,
        new Date().toISOString(),
      ],
    )
    stored.set(definition.key, definition.legacyValue)
  }
  return new Map(
    definitions.flatMap(({ key }) => {
      const value = stored.get(key)
      return value === undefined ? [] : [[key, value] as const]
    }),
  )
}

export function persistPreference(key: string, value: string, syncable: boolean): Promise<void> {
  return withWriteLock(async () => {
    const database = await openFocalDatabase()
    await database.execute(
      `insert into preferences (key, value, syncable, updated_at)
       values ($1, $2, $3, $4)
       on conflict (key) do update set
         value = excluded.value,
         syncable = excluded.syncable,
         updated_at = excluded.updated_at`,
      [key, JSON.stringify(value), syncable ? 1 : 0, new Date().toISOString()],
    )
  })
}

export function setCachedPreference(key: string, value: string, syncable: boolean): void {
  localStorage.setItem(key, value)
  if (!isTauri()) return
  void persistPreference(key, value, syncable)
}

export function removePreference(key: string): Promise<void> {
  return withWriteLock(async () => {
    await (await openFocalDatabase()).execute("delete from preferences where key = $1", [key])
  })
}

export async function flushPreferenceWrites(): Promise<void> {
  await writeLock
}
