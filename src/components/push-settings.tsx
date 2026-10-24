import { useEffect, useState } from "react"
import { Bell, BellOff, Send } from "lucide-react"
import { supabase } from "../lib/supabase"
import { PUSH_OWNER_KEY, PUSH_PREFERENCES_KEY, clearPushForOtherAccount, registerPwa, requestTimerNotifications, timerNotificationHelp } from "../lib/pwa"
import { Button } from "./ui/button"
import { Checkbox } from "./ui/checkbox"

type Preferences = { planned: boolean; friends: boolean }

export function PushSettings({ userId }: { userId?: string }) {
  const [config, setConfig] = useState<{ configured: boolean; publicKey: string | null } | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [preferences, setPreferences] = useState<Preferences>({ planned: true, friends: true })
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const supported = window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined"

  async function api(method: string, input: unknown, query = "") {
    if (!supabase || !userId) throw new Error("Sign in again to manage reminders.")
    const { data, error } = await supabase.auth.getSession()
    if (error || !data.session || data.session.user.id !== userId) throw new Error("Sign in again to manage reminders.")
    const response = await fetch(`/api/push${query}`, { method,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${data.session.access_token}` },
      body: JSON.stringify(input),
    })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error ?? "Could not save reminders. Try again.")
    return result
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        await clearPushForOtherAccount(userId)
        const worker = supported ? await registerPwa() : null
        const current = await worker?.pushManager.getSubscription() ?? null
        if (cancelled) return
        setSubscription(current)
        setEnabled(!!current)
        const response = await fetch("/api/push")
        if (!response.ok) throw new Error("Could not load reminder settings. Try reopening this page.")
        const nextConfig = await response.json()
        const saved = nextConfig.configured && current && userId ? await api("POST", { endpoint: current.endpoint }) : null
        if (cancelled) return
        setConfig(nextConfig)
        if (nextConfig.configured && current && userId) setEnabled(!!saved)
        if (saved) { setPreferences(saved); localStorage.setItem(PUSH_PREFERENCES_KEY, JSON.stringify(saved)) }
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not load reminders.")
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void load()
    return () => { cancelled = true }
    // This component is keyed by account in Settings, so credentials never cross accounts.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save(next: Preferences) {
    if (!subscription) return
    setBusy(true)
    setError(null)
    try {
      await api("PUT", { ...subscription.toJSON(), ...next })
      localStorage.setItem(PUSH_PREFERENCES_KEY, JSON.stringify(next))
      setPreferences(next)
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save reminders.") }
    finally { setBusy(false) }
  }

  async function test() {
    if (!subscription) return
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await api("POST", { endpoint: subscription.endpoint }, "?test=1")
      setNotice("Test sent. It should arrive within a few seconds.")
    } catch (error) { setError(error instanceof Error ? error.message : "Could not send a test notification.") }
    finally { setBusy(false) }
  }

  async function toggle() {
    setBusy(true)
    setError(null)
    let current = subscription
    try {
      if (enabled) {
        if (current && !await current.unsubscribe()) throw new Error("Could not disable this device. Try again.")
        setEnabled(false)
        setSubscription(null)
        localStorage.removeItem(PUSH_OWNER_KEY)
        localStorage.removeItem(PUSH_PREFERENCES_KEY)
        if (current) await api("DELETE", { endpoint: current.endpoint })
        return
      }
      if (!await requestTimerNotifications()) throw new Error(timerNotificationHelp())
      const worker = await registerPwa()
      if (!worker || !config?.publicKey) throw new Error("Could not start reminders. Reopen Focal and try again.")
      const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
      current = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      await api("PUT", { ...current.toJSON(), ...preferences })
      localStorage.setItem(PUSH_OWNER_KEY, userId!)
      localStorage.setItem(PUSH_PREFERENCES_KEY, JSON.stringify(preferences))
      setSubscription(current)
      setEnabled(true)
    } catch (error) {
      if (!enabled && current) await current.unsubscribe().catch(() => false)
      setError(error instanceof Error ? error.message : "Could not enable reminders.")
    } finally { setBusy(false) }
  }

  return (
    <div className="space-y-4 border-t pt-5">
      <div className="space-y-2">
        <h3 className="font-medium">Reminders on this device</h3>
        <p className="text-muted-foreground">Get planned study reminders, friends starting study, and received cheers, even when Focal is closed. Alerts use generic text on your lock screen.</p>
      </div>
      {!userId ? <p className="text-muted-foreground">Sign in under Account to enable reminders for your synced study and friends.</p> : null}
      {!supported ? <p className="text-muted-foreground">{timerNotificationHelp()}</p> : null}
      {config && !config.configured ? <p className="text-muted-foreground">Push reminders haven’t been configured on this server yet.</p> : null}
      <div className="grid gap-2">
        <label className="flex min-h-11 items-center gap-3">
          <Checkbox checked={preferences.planned} disabled={busy} onCheckedChange={(checked) => enabled ? void save({ ...preferences, planned: !!checked }) : setPreferences({ ...preferences, planned: !!checked })} />
          Planned study starts
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <Checkbox checked={preferences.friends} disabled={busy} onCheckedChange={(checked) => enabled ? void save({ ...preferences, friends: !!checked }) : setPreferences({ ...preferences, friends: !!checked })} />
          Friend activity and cheers
        </label>
      </div>
      <Button variant="outline" disabled={busy || (!enabled && (!userId || !supported || !config?.configured))} onClick={() => void toggle()}>
        {enabled ? <BellOff /> : <Bell />}{busy ? "Please wait…" : enabled ? "Disable reminders on this device" : "Enable reminders"}
      </Button>
      {enabled ? <Button variant="outline" disabled={busy} onClick={() => void test()}><Send />Send test notification</Button> : null}
      {notice ? <p role="status" className="text-muted-foreground">{notice}</p> : null}
      {enabled ? <p role="status" className="text-muted-foreground">Reminders enabled on this device. Delivery depends on your device’s notification settings.</p> : null}
      {enabled && Notification.permission !== "granted" ? <p className="text-muted-foreground">{timerNotificationHelp()}</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
  )
}
