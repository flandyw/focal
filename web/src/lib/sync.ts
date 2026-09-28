import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { User } from "@supabase/supabase-js"
import { EMPTY_APP_DATA, type AppData } from "@/lib/exam-data"
import { supabase } from "@/lib/supabase"
import { appSyncHealth, associateAppSyncAccount, diffAppData, queueAppChanges, recordLocalChanges, syncAppData } from "@/lib/app-sync"

const OWNER_KEY = "examtrack:sync:owner:v1"

function ownerBackupKey(owner: string) {
  return `examtrack:sync:owner-backup:v1:${owner}`
}

export type SyncStatus = "unconfigured" | "signed-out" | "syncing" | "synced" | "pending" | "error"

function snapshotVersion(data: AppData) {
  return [
    data.attempts.length,
    data.mistakes.length,
    data.sacRecords.length,
    data.sacRecordsUpdatedAt,
    data.subjectsUpdatedAt,
    data.trackedExamIdsUpdatedAt,
    data.completedExamIdsUpdatedAt,
    data.atarEstimatesUpdatedAt,
    data.learning.updatedAt,
    data.mistakeInsights?.questionsGeneratedAt ?? data.mistakeInsights?.generatedAt ?? "",
    data.alternativeMistakeDeck?.updatedAt ?? "",
    data.examDifficulty?.updatedAt ?? "",
    data.examProgression?.updatedAt ?? "",
  ].join("|")
}

function shallowEqualAppData(first: AppData, second: AppData) {
  if (first === second) return true
  if (snapshotVersion(first) !== snapshotVersion(second)) return false
  const sameIds = (a: { id: string }[], b: { id: string }[]) => {
    if (a.length !== b.length) return false
    if (a === b) return true
    const ids = new Set(a.map((item) => item.id))
    return b.every((item) => ids.has(item.id))
  }
  return sameIds(first.attempts, second.attempts) && sameIds(first.mistakes, second.mistakes)
}

/** A projection started from an older snapshot must not overwrite a local edit queued while it ran. */
export function isSupersededSync(startedFrom: AppData, queuedLatest: AppData): boolean {
  return queuedLatest !== startedFrom
}

export function useSupabaseSync(data: AppData, setData: Dispatch<SetStateAction<AppData>>) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<SyncStatus>(supabase ? "signed-out" : "unconfigured")
  const [pendingCount, setPendingCount] = useState(0)
  const previous = useRef(data)
  // previous only advances once the change is durably queued, which is async. A
  // projection that started from an older snapshot must compare against the
  // latest render, or it overwrites the edit made while it was in flight.
  const latest = useRef(data)
  latest.current = data
  const activeAccount = useRef<string | null>(null)
  const queueTask = useRef<Promise<void>>(Promise.resolve())
  const queueFailed = useRef(false)
  const syncTask = useRef<Promise<unknown>>(Promise.resolve())
  const [refresh, setRefresh] = useState(0)

  useEffect(() => {
    if (!user) return
    const refreshSync = () => {
      if (document.visibilityState !== "hidden") setRefresh((value) => value + 1)
    }
    window.addEventListener("online", refreshSync)
    window.addEventListener("focus", refreshSync)
    window.addEventListener("examtrack:sync-wakeup", refreshSync)
    document.addEventListener("visibilitychange", refreshSync)
    const interval = window.setInterval(refreshSync, 30_000)
    return () => {
      window.removeEventListener("online", refreshSync)
      window.removeEventListener("focus", refreshSync)
      window.removeEventListener("examtrack:sync-wakeup", refreshSync)
      document.removeEventListener("visibilitychange", refreshSync)
      window.clearInterval(interval)
    }
  }, [user])

  useEffect(() => {
    queueTask.current = queueTask.current.catch(() => {}).then(async () => {
      const old = previous.current
      if (old === data) return
      const accountId = user?.id ?? null
      if (activeAccount.current !== accountId) return
      recordLocalChanges(old, data)
      if (!accountId) return
      await queueAppChanges(accountId, diffAppData(old, data))
      if (activeAccount.current !== accountId) return
      previous.current = data
      queueFailed.current = false
      const health = await appSyncHealth(accountId)
      setPendingCount(health.pending)
      if (health.pending) setStatus("pending")
      setRefresh((value) => value + 1)
    }).catch((error: unknown) => {
      queueFailed.current = true
      setStatus("error")
      console.error("Could not persist Focal sync changes:", error)
    })
  }, [data, refresh, user])

  useEffect(() => {
    if (!supabase || !user) return
    let cancelled = false
    setStatus("syncing")
    const task = syncTask.current.catch(() => {}).then(async () => {
      await queueTask.current
      if (queueFailed.current) throw new Error("Local sync changes could not be saved")
      if (cancelled) return null
      const merged = await syncAppData(data, user.id)
      const health = await appSyncHealth(user.id)
      if (cancelled) return null
      setPendingCount(health.pending)
      setStatus(health.pending ? "pending" : "synced")
      if (isSupersededSync(data, latest.current)) return null
      previous.current = merged
      setData((current) => shallowEqualAppData(current, merged) ? current : merged)
      return merged
    })
    syncTask.current = task
    task.catch((error: unknown) => {
      if (cancelled) return
      console.error("Focal sync failed:", error)
      setStatus(typeof navigator !== "undefined" && !navigator.onLine ? "pending" : "error")
      void appSyncHealth(user.id).then((health) => setPendingCount(health.pending)).catch(() => {})
    })
    return () => { cancelled = true }
  }, [data, refresh, setData, user])

  useEffect(() => {
    if (!supabase) return
    let accountEpoch = 0
    const acceptUser = (current: User | null) => {
      const epoch = ++accountEpoch
      activeAccount.current = current?.id ?? null
      if (!current) { setUser(null); return }
      void (async () => {
        const localOwner = localStorage.getItem(OWNER_KEY)
        const priorOwner = await associateAppSyncAccount(current.id, localOwner)
        if (epoch !== accountEpoch) return
        if (priorOwner && priorOwner !== current.id) {
          try {
            localStorage.setItem(ownerBackupKey(priorOwner), JSON.stringify(previous.current))
          } catch {
            // Storage full or unavailable; account-scoped IndexedDB queues stay isolated.
          }
          localStorage.removeItem("examtrack:sync:tombstones:v1")
          previous.current = EMPTY_APP_DATA
          setData(EMPTY_APP_DATA)
        }
        localStorage.setItem(OWNER_KEY, current.id)
        void appSyncHealth(current.id).then((health) => setPendingCount(health.pending)).catch(() => {})
        setUser(current)
      })().catch((error: unknown) => {
        if (epoch === accountEpoch) {
          console.error("Could not associate Focal sync data with this account:", error)
          setStatus("error")
        }
      })
    }
    supabase.auth.getUser()
      .then(({ data: { user: current } }) => acceptUser(current))
      .catch(() => setStatus("error"))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      acceptUser(session?.user ?? null)
      setStatus(session ? "syncing" : "signed-out")
    })
    return () => subscription.unsubscribe()
  }, [setData])

  return {
    configured: Boolean(supabase),
    user,
    status,
    pendingCount,
    retry: () => {
      if (!user) return
      setStatus("syncing")
      setRefresh((value) => value + 1)
    },
    signIn: async (email: string, password: string) => {
      if (!supabase) throw new Error("Supabase is not configured.")
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    },
    signUp: async (email: string, password: string) => {
      if (!supabase) throw new Error("Supabase is not configured.")
      const { data, error } = await supabase.auth.signUp({ email, password })
      if (error) throw error
      return Boolean(data.session)
    },
    signOut: async () => {
      if (!supabase) return
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  }
}
