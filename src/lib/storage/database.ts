import Database from "@tauri-apps/plugin-sql"
import { appDataDir } from "@tauri-apps/api/path"
import { exists, readTextFile } from "@tauri-apps/plugin-fs"
import {
  coreRecordKind,
  parseStoredPayloads,
  prepareStoredRecords,
  type CoreDataFile,
  type StoredPayloadRow,
} from "@/lib/storage/records"

const DATABASE_URL = "sqlite:focal.db"
const UPSERT_BATCH_SIZE = 75
const DELETE_BATCH_SIZE = 250

let databasePromise: Promise<Database> | null = null
const importPromises = new Map<CoreDataFile, Promise<void>>()
const writeLocks = new Map<CoreDataFile, Promise<unknown>>()

interface CountRow {
  count: number
}

interface IdRow {
  id: string
}

export function openFocalDatabase(): Promise<Database> {
  databasePromise ??= Database.load(DATABASE_URL)
  return databasePromise
}

export async function withWriteLock<T>(fileName: CoreDataFile, operation: () => Promise<T>): Promise<T> {
  const previous = writeLocks.get(fileName) ?? Promise.resolve()
  const result = previous.then(operation, operation)
  writeLocks.set(fileName, result.catch(() => undefined))
  return result
}

async function readLegacyArray(fileName: CoreDataFile): Promise<unknown[]> {
  const path = `${await appDataDir()}/${fileName}`
  if (!(await exists(path))) return []
  const parsed = JSON.parse(await readTextFile(path)) as unknown
  return Array.isArray(parsed)
    ? parsed.map((item: unknown): unknown => item)
    : []
}

async function writeRecordBatch(
  database: Database,
  kind: string,
  records: ReturnType<typeof prepareStoredRecords>,
): Promise<void> {
  for (let offset = 0; offset < records.length; offset += UPSERT_BATCH_SIZE) {
    const batch = records.slice(offset, offset + UPSERT_BATCH_SIZE)
    const values: unknown[] = []
    const placeholders = batch.map((record, index) => {
      const base = index * 4
      values.push(kind, record.id, record.payload, record.position)
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`
    })
    await database.execute(
      `insert into records (kind, id, payload, position)
       values ${placeholders.join(", ")}
       on conflict (kind, id) do update set
         payload = excluded.payload,
         position = excluded.position
       where records.payload <> excluded.payload or records.position <> excluded.position`,
      values,
    )
  }
}

async function removeStaleRecords(
  database: Database,
  kind: string,
  expectedIds: Set<string>,
): Promise<void> {
  const current = await database.select<IdRow[]>(
    "select id from records where kind = $1",
    [kind],
  )
  const staleIds = current.map((row) => row.id).filter((id) => !expectedIds.has(id))
  for (let offset = 0; offset < staleIds.length; offset += DELETE_BATCH_SIZE) {
    const batch = staleIds.slice(offset, offset + DELETE_BATCH_SIZE)
    const placeholders = batch.map((_, index) => `$${index + 2}`).join(", ")
    await database.execute(
      `delete from records where kind = $1 and id in (${placeholders})`,
      [kind, ...batch],
    )
  }
}

async function replaceRecords(
  database: Database,
  fileName: CoreDataFile,
  items: unknown[],
): Promise<void> {
  const kind = coreRecordKind(fileName)
  const records = prepareStoredRecords(items)
  // ponytail: upsert before pruning. A crash can temporarily retain a stale row,
  // but cannot erase the last durable copy. Upgrade to a native transaction only
  // if the SQL plugin exposes a pool-pinned transaction API.
  await writeRecordBatch(database, kind, records)
  await removeStaleRecords(database, kind, new Set(records.map((record) => record.id)))
}

async function importLegacyFile(fileName: CoreDataFile): Promise<void> {
  const database = await openFocalDatabase()
  const imported = await database.select<CountRow[]>(
    "select count(*) as count from legacy_imports where source = $1",
    [fileName],
  )
  if ((imported[0]?.count ?? 0) > 0) return

  const kind = coreRecordKind(fileName)
  const existing = await database.select<CountRow[]>(
    "select count(*) as count from records where kind = $1",
    [kind],
  )
  let itemCount = existing[0]?.count ?? 0
  if (itemCount === 0) {
    const legacy = await readLegacyArray(fileName)
    await replaceRecords(database, fileName, legacy)
    itemCount = legacy.length
  }

  await database.execute(
    `insert into legacy_imports (source, imported_at, item_count)
     values ($1, $2, $3)
     on conflict (source) do nothing`,
    [fileName, new Date().toISOString(), itemCount],
  )
}

async function ensureLegacyImport(fileName: CoreDataFile): Promise<void> {
  let pending = importPromises.get(fileName)
  if (!pending) {
    pending = importLegacyFile(fileName)
    importPromises.set(fileName, pending)
  }
  try {
    await pending
  } catch (error) {
    importPromises.delete(fileName)
    throw error
  }
}

export async function readPersistedArray(fileName: CoreDataFile): Promise<unknown[]> {
  await ensureLegacyImport(fileName)
  const database = await openFocalDatabase()
  const rows = await database.select<StoredPayloadRow[]>(
    "select payload from records where kind = $1 order by position asc",
    [coreRecordKind(fileName)],
  )
  return parseStoredPayloads(rows)
}

export async function writePersistedArray(fileName: CoreDataFile, items: unknown[]): Promise<void> {
  await ensureLegacyImport(fileName)
  await withWriteLock(fileName, async () => {
    await replaceRecords(await openFocalDatabase(), fileName, items)
  })
}

export async function mutatePersistedArray<T>(
  fileName: CoreDataFile,
  mutate: (current: unknown[]) => T[] | Promise<T[]>,
): Promise<T[]> {
  await ensureLegacyImport(fileName)
  return withWriteLock(fileName, async () => {
    const database = await openFocalDatabase()
    const rows = await database.select<StoredPayloadRow[]>(
      "select payload from records where kind = $1 order by position asc",
      [coreRecordKind(fileName)],
    )
    const updated = await mutate(parseStoredPayloads(rows))
    await replaceRecords(database, fileName, updated)
    return updated
  })
}
