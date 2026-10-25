import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react"
import type { User } from "@supabase/supabase-js"
import { EMPTY_APP_DATA, type AppData } from "./exam-data"
import { passwordRecoveryRequested, supabase } from "./supabase"
import { onAnnounce } from "./outbox"
import { appSyncHealth, associateAppSyncAccount, diffAppData, pushAppChanges, recordLocalChanges, sameValue, syncAppData } from "./app-sync"

const OWNER_KEY = "examtrack:sync:owner:v1"

function ownerBackupKey(owner: string) {
  return `examtrack:sync:owner-backup:v1:${owner}`
}

export type SyncStatus = "unconfigured" | "restoring" | "reconnecting" | "sign-in-required" | "signed-out" | "syncing" | "synced" | "pending" | "error"

/** Folio reviews change scheduling payloads without changing collection IDs or counts. */
function equalAppData(first: AppData, second: AppData) {
  return sameValue(first, second)
}

/** A projection started from an older snapshot must not overwrite a local edit queued while it ran. */
function isSupersededSync(startedFrom: AppData, queuedLatest: AppData): boolean {
  return queuedLatest !== startedFrom
}

export function useSupabaseSync(data: AppData, setData: Dispatch<SetStateAction<AppData>>) {
  const [user, setUser] = useState<User | null>(null)
  const [status, setStatus] = useState<SyncStatus>(supabase ? "restoring" : "unconfigured")
  const [accountStatus, setAccountStatus] = useState<"restoring" | "connected" | "reconnecting" | "sign-in-required" | "signed-out">("restoring")
  const [pendingCount, setPendingCount] = useState(0)
  const [passwordRecovery, setPasswordRecovery] = useState<"checking" | "ready" | "invalid" | null>(passwordRecoveryRequested ? "checking" : null)
  const previous = useRef(data)
  // previous only advances once the change is durably queued, which is async. A
  // projection that started from an older snapshot must compare against the
  // latest render, or it overwrites the edit made while it was in flight.
  const latest = useRef(data)
  useEffect(() => { latest.current = data })
  const activeAccount = useRef<string | null>(null)
  const queueTask = useRef<Promise<void>>(Promise.resolve())
  const queueFailed = useRef(false)
  const syncTask = useRef<Promise<unknown>>(Promise.resolve())
  const [refresh, setRefresh] = useState(0)
  const recoverAuth = useRef<() => Promise<void>>(async () => {})
  const signingOut = useRef(false)

  useEffect(() => {
    if (!supabase) return
    const refreshSync = () => {
      if (document.visibilityState !== "hidden") {
        void recoverAuth.current()
        setRefresh((value) => value + 1)
      }
    }
    window.addEventListener("online", refreshSync)
    window.addEventListener("focus", refreshSync)
    window.addEventListener("examtrack:sync-wakeup", refreshSync)
    document.addEventListener("visibilitychange", refreshSync)
    const interval = window.setInterval(refreshSync, 30_000)
    const stopAnnounce = onAnnounce(refreshSync)
    return () => {
      stopAnnounce()
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
      // Write-ahead: durable in the outbox first, then sent at once. Whatever the server does not
      // take stays queued and the sync loop below retries it.
      await pushAppChanges(accountId, diffAppData(old, data))
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
    if (!supabase || !user || accountStatus !== "connected") return
    let cancelled = false
    const task = syncTask.current.catch(() => {}).then(async () => {
      await queueTask.current
      if (queueFailed.current) throw new Error("Local sync changes could not be saved")
      if (cancelled || activeAccount.current !== user.id) return null
      setStatus("syncing")
      const merged = await syncAppData(data, user.id)
      const health = await appSyncHealth(user.id)
      if (cancelled || activeAccount.current !== user.id) return null
      setPendingCount(health.pending)
      setStatus(health.pending || health.cursor < health.head ? "pending" : "synced")
      if (isSupersededSync(data, latest.current)) return null
      previous.current = merged
      setData((current) => equalAppData(current, merged) ? current : merged)
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
  }, [accountStatus, data, refresh, setData, user])

  useEffect(() => {
    if (!supabase) return
    const client = supabase
    let accountEpoch = 0
    let connected = false
    let disposed = false
    if (passwordRecoveryRequested) {
      void (async () => {
        const initialized = await client.auth.initialize()
        const { data, error } = await client.auth.getSession()
        if (!disposed) setPasswordRecovery(!initialized.error && !error && data.session ? "ready" : "invalid")
      })().catch(() => { if (!disposed) setPasswordRecovery("invalid") })
    }
    const acceptUser = (current: User | null) => {
      const epoch = ++accountEpoch
      activeAccount.current = current?.id ?? null
      if (!current) { setUser(null); setPendingCount(0); setAccountStatus("signed-out"); return }
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
        connected = true
        setAccountStatus("connected")
        setStatus("syncing")
        setRefresh((value) => value + 1)
      })().catch((error: unknown) => {
        if (epoch === accountEpoch) {
          console.error("Could not associate Focal sync data with this account:", error)
          setStatus("error")
        }
      })
    }
    const restore = async () => {
      if (connected || signingOut.current || disposed) return
      const epoch = accountEpoch
      try {
        const { data: { session }, error } = await client.auth.getSession()
        if (disposed || epoch !== accountEpoch) return
        if (error) { setAccountStatus([400, 401, 422].includes(error.status ?? 0) ? "sign-in-required" : "reconnecting"); return }
        if (session) acceptUser(session.user)
        else setAccountStatus(activeAccount.current ? "sign-in-required" : "signed-out")
      } catch {
        if (!disposed && epoch === accountEpoch) setAccountStatus("reconnecting")
      }
    }
    recoverAuth.current = restore
    const reconnecting = () => { connected = false; setAccountStatus("reconnecting") }
    const required = () => { connected = false; setAccountStatus("sign-in-required") }
    window.addEventListener("focal:auth-reconnecting", reconnecting)
    window.addEventListener("focal:auth-required", required)
    const { data: { subscription } } = client.auth.onAuthStateChange((event, session) => {
      // No network-based getUser race: INITIAL_SESSION and token events own restoration.
      // Keep callbacks synchronous; recovery runs after the SDK's notification finishes.
      if (disposed) return
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery("ready")
      if (session) { acceptUser(session.user); return }
      if (event === "INITIAL_SESSION") { void Promise.resolve().then(restore); return }
      if (event === "SIGNED_OUT") {
        setPasswordRecovery((current) => current ? "invalid" : null)
        ++accountEpoch
        connected = false
        if (signingOut.current || !activeAccount.current) acceptUser(null)
        else setAccountStatus("sign-in-required") // Keep outgoing work scoped to its original owner.
      }
    })
    return () => {
      disposed = true
      ++accountEpoch
      recoverAuth.current = async () => {}
      subscription.unsubscribe()
      window.removeEventListener("focal:auth-reconnecting", reconnecting)
      window.removeEventListener("focal:auth-required", required)
    }
  }, [setData])

  function finishPasswordRecovery() {
    const url = new URL(window.location.href)
    url.searchParams.delete("reset-password")
    url.hash = ""
    window.history.replaceState(window.history.state, "", url)
    setPasswordRecovery(null)
  }

  return {
    configured: Boolean(supabase),
    user,
    status: supabase && accountStatus !== "connected" ? accountStatus : status,
    pendingCount,
    passwordRecovery,
    finishPasswordRecovery,
    retry: () => {
      void recoverAuth.current()
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
    resetPassword: async (email: string) => {
      if (!supabase) throw new Error("Supabase is not configured.")
      // Desktop email links finish on the hosted Site URL in the user's browser.
      const { error } = await supabase.auth.resetPasswordForEmail(email, import.meta.env.VITE_DESKTOP
        ? undefined : { redirectTo: new URL("?reset-password=1", window.location.href).href })
      if (error) throw error
    },
    updatePassword: async (password: string) => {
      if (!supabase || passwordRecovery !== "ready") throw new Error("Open a valid password reset link from your email first.")
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      finishPasswordRecovery()
    },
    signOut: async () => {
      if (!supabase) return
      signingOut.current = true
      try {
        // Supabase defaults to global sign-out, which also revokes Folio and other devices.
        const { error } = await supabase.auth.signOut({ scope: "local" })
        if (error) throw error
      } finally { signingOut.current = false }
    },
  }
}
