import { useState, useEffect, useCallback } from "react"
import { useLatestRef } from "@/lib/hooks/useLatestRef"
import { mutatePersistedArray, readRecords, writePersistedArray } from "@/lib/storage/database"
import { coreDataFile, type CoreRecordKind } from "@/lib/storage/records"

/**
 * Generic hook for reading/writing a persisted record array.
 * Normalises each raw row on load, applies an optional post-load filter, and
 * listens to `focal-sync-data-changed` events so external sync writes are reflected
 * in React state without reloading the page.
 */
interface PersistedDataOptions<T> {
  kind: CoreRecordKind
  normalize: (raw: unknown) => T
  onLoad?: (data: T[]) => T[]
}

interface PersistedDataResult<T> {
  data: T[]
  loading: boolean
  error: string | null
  save: (updated: T[]) => Promise<void>
  mutate: (updater: (current: T[]) => T[]) => Promise<T[]>
  refresh: () => Promise<void>
}

export function usePersistedData<T>({
  kind,
  normalize,
  onLoad,
}: PersistedDataOptions<T>): PersistedDataResult<T> {
  const fileName = coreDataFile(kind)
  const [data, setData] = useState<T[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Refs for callbacks so changes don't trigger re-fetches.
  const normalizeRef = useLatestRef(normalize)
  const onLoadRef = useLatestRef(onLoad)

  const refresh = useCallback(async () => {
    try {
      setError(null)
      const raw = await readRecords(kind)
      let normalised = raw.map(normalizeRef.current)
      if (onLoadRef.current) {
        normalised = onLoadRef.current(normalised)
      }
      setData(normalised)
    } catch (e) {
      const msg = `Failed to load ${kind}: ${String(e)}`
      console.error(msg)
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [kind, normalizeRef, onLoadRef])

  const save = useCallback(async (updated: T[]) => {
    await writePersistedArray(fileName, updated)
    setData(updated)
  }, [fileName])

  const mutate = useCallback(async (updater: (current: T[]) => T[]) => {
    const updated = await mutatePersistedArray(fileName, (current) => (
      updater(current.map(normalizeRef.current))
    ))
    setData(updated)
    return updated
  }, [fileName, normalizeRef])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect, @typescript-eslint/no-floating-promises
    refresh()
  }, [refresh])

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ table?: string; tables?: string[] }>).detail
      if (detail?.table === kind || detail?.tables?.includes(kind)) {
        void refresh()
      }
    }
    window.addEventListener("focal-sync-data-changed", handler)
    return () => window.removeEventListener("focal-sync-data-changed", handler)
  }, [kind, refresh])

  return { data, loading, error, save, mutate, refresh }
}
