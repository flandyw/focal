import { useEffect, useState } from "react"
import { Bell, BellOff, Send } from "lucide-react"
import { supabase } from "../lib/supabase"
import { clearPushForOtherAccount, notificationPermission, registerPwa, requestTimerNotifications, showNotification, timerNotificationHelp } from "../lib/pwa"
import { DESKTOP_NOTIFICATIONS_SINCE_KEY, PUSH_OWNER_KEY, loadNotificationPreferences, notificationPreferencesSchema, saveNotificationPreferences, type NotificationPreferences } from "../lib/notification-preferences"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { NativeSelect, NativeSelectOption } from "./ui/native-select"
import { Switch } from "./ui/switch"

const reminderTypes = [
  { key: "planned", label: "Planned study", description: "A reminder before a scheduled study block." },
  { key: "deadlines", label: "Exams, SACs and deadlines", description: "Upcoming calendar deadlines and unmarked SACs." },
  { key: "daily", label: "Daily study reminder", description: "A daily nudge to make time for study." },
  { key: "friends", label: "Friends studying", description: "When a friend starts a study session." },
  { key: "cheers", label: "Cheers", description: "When a friend sends you encouragement." },
] as const

export function PushSettings({ userId }: { userId?: string }) {
  const desktop = Boolean(import.meta.env.VITE_DESKTOP)
  const [config, setConfig] = useState<{ configured: boolean; publicKey: string | null } | null>(null)
  const [subscription, setSubscription] = useState<PushSubscription | null>(null)
  const [preferences, setPreferences] = useState(loadNotificationPreferences)
  const [saved, setSaved] = useState(() => JSON.stringify(loadNotificationPreferences()))
  const [enabled, setEnabled] = useState(false)
  const [permission, setPermission] = useState<string>("default")
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const supported = desktop || window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && typeof Notification !== "undefined"
  const dirty = JSON.stringify(preferences) !== saved
  const valid = notificationPreferencesSchema.safeParse(preferences).success

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
        const currentPermission = await notificationPermission()
        if (cancelled) return
        setPermission(currentPermission)
        let next = loadNotificationPreferences()
        if (desktop) {
          setEnabled(!!userId && localStorage.getItem(PUSH_OWNER_KEY) === userId)
        } else if (supported) {
          const worker = await registerPwa()
          const current = await worker?.pushManager.getSubscription() ?? null
          const response = await fetch("/api/push")
          if (!response.ok) throw new Error("Could not load reminder settings. Try reopening this page.")
          const nextConfig = await response.json()
          const remote = nextConfig.configured && current && userId ? await api("POST", { endpoint: current.endpoint }) : null
          if (cancelled) return
          setSubscription(current)
          setConfig(nextConfig)
          setEnabled(!!remote)
          if (remote) {
            next = notificationPreferencesSchema.parse({ ...next, ...remote })
            saveNotificationPreferences(next)
          }
        }
        if (cancelled) return
        setPreferences(next)
        setSaved(JSON.stringify(next))
      } catch (error) {
        if (!cancelled) setError(error instanceof Error ? error.message : "Could not load reminders.")
      } finally {
        if (!cancelled) setBusy(false)
      }
    }
    void load()
    const refresh = () => void notificationPermission().then((value) => { if (!cancelled) setPermission(value) })
    window.addEventListener("focus", refresh)
    return () => { cancelled = true; window.removeEventListener("focus", refresh) }
    // This component is keyed by account in Settings, so credentials never cross accounts.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function save() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const next = notificationPreferencesSchema.parse(preferences)
      if (enabled && !desktop && subscription) await api("PUT", { ...subscription.toJSON(), ...next })
      saveNotificationPreferences(next)
      setSaved(JSON.stringify(next))
      setNotice("Notification preferences saved on this device.")
    } catch (error) { setError(error instanceof Error ? error.message : "Could not save reminders.") }
    finally { setBusy(false) }
  }

  async function test() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      if (desktop) await showNotification("Focal", "Test notification. Alerts are working on this device.", "focal-test")
      else if (subscription && enabled) await api("POST", { endpoint: subscription.endpoint }, "?test=1")
      else await showNotification("Focal", "Test notification. Timer alerts are working on this device.", "focal-test")
      setNotice("Test sent. Check your notifications. Tests ignore quiet hours.")
    } catch (error) { setError(error instanceof Error ? error.message : "Could not send a test notification.") }
    finally { setBusy(false) }
  }

  async function allowNotifications() {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const granted = await requestTimerNotifications()
      setPermission(await notificationPermission())
      if (!granted) throw new Error(timerNotificationHelp())
      setNotice("Notifications allowed. Choose your reminder types below.")
    } catch (error) { setError(error instanceof Error ? error.message : "Could not allow notifications.") }
    finally { setBusy(false) }
  }

  async function toggle() {
    setBusy(true)
    setError(null)
    setNotice(null)
    let current = subscription
    try {
      if (enabled) {
        if (desktop) {
          localStorage.removeItem(PUSH_OWNER_KEY)
          localStorage.removeItem(DESKTOP_NOTIFICATIONS_SINCE_KEY)
        } else {
          if (current && !await current.unsubscribe()) throw new Error("Could not disable this device. Try again.")
          localStorage.removeItem(PUSH_OWNER_KEY)
          setSubscription(null)
        }
        setEnabled(false)
        if (!desktop && current) await api("DELETE", { endpoint: current.endpoint })
        setNotice("Study and friend reminders disabled on this device. Timer alerts keep their own controls.")
        return
      }
      const granted = await requestTimerNotifications()
      setPermission(await notificationPermission())
      if (!granted) throw new Error(timerNotificationHelp())
      const next = notificationPreferencesSchema.parse(preferences)
      if (!desktop) {
        const worker = await registerPwa()
        if (!worker || !config?.publicKey) throw new Error("Could not start reminders. Reopen Focal and try again.")
        const key = Uint8Array.from(atob(config.publicKey.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0))
        current = await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
        await api("PUT", { ...current.toJSON(), ...next })
        setSubscription(current)
      } else {
        if (!supabase) throw new Error("Sign in to enable study and friend reminders.")
        const { error } = await supabase.rpc("desktop_notification_events", { p_preferences: next, p_since: new Date().toISOString() })
        if (error) throw new Error("Could not start reminders. Check your connection and try again.")
        localStorage.setItem(DESKTOP_NOTIFICATIONS_SINCE_KEY, new Date().toISOString())
      }
      localStorage.setItem(PUSH_OWNER_KEY, userId!)
      saveNotificationPreferences(next)
      setSaved(JSON.stringify(next))
      setEnabled(true)
    } catch (error) {
      if (!enabled && !desktop && current) await current.unsubscribe().catch(() => false)
      setError(error instanceof Error ? error.message : "Could not enable reminders.")
    } finally { setBusy(false) }
  }

  function update(patch: Partial<NotificationPreferences>) {
    setPreferences((value) => ({ ...value, ...patch }))
    setNotice(null)
  }

  return (
    <div className="space-y-8 py-5 text-sm" aria-busy={busy}>
      <div className="space-y-3">
        <p role="status" className="font-medium">{permission === "granted" ? "Notifications allowed on this device" : permission === "denied" ? "Notifications blocked" : "Allow notifications on this device"}</p>
        <p className="max-w-[65ch] text-muted-foreground">{desktop ? "Native alerts while Focal is running or minimized. Study and friend reminders use your synced account and need an internet connection." : "Study and friend reminders use push, even when Focal is closed. Timer alerts need Focal open and can be delayed in the background."}</p>
        {permission !== "granted" ? <p className="max-w-[65ch] text-muted-foreground">{timerNotificationHelp()}</p> : null}
        <div className="flex flex-wrap gap-2">
          {permission !== "granted" ? <Button variant="outline" disabled={busy || permission === "unsupported" || permission === "denied"} onClick={() => void allowNotifications()}><Bell />Allow notifications</Button> : null}
          <Button variant="outline" disabled={busy || permission !== "granted"} onClick={() => void test()}><Send />Send test notification</Button>
        </div>
      </div>

      <form className="space-y-8" onSubmit={(event) => { event.preventDefault(); void save() }}>
        <fieldset disabled={busy} className="min-w-0 space-y-1">
          <legend className="mb-2 font-medium">Study and friends</legend>
          <p className="pb-3 text-muted-foreground">{enabled ? "Reminders enabled on this device." : "Choose what you want, then enable reminders on this device."} Notification text keeps subjects, titles and names private.</p>
          {reminderTypes.map(({ key, label, description }) => (
            <div key={key} className="flex min-h-16 items-center justify-between gap-6 border-b py-3">
              <div><Label htmlFor={`notify-${key}`}>{label}</Label><p id={`notify-${key}-description`} className="mt-1 text-muted-foreground">{description}</p></div>
              <Switch id={`notify-${key}`} aria-describedby={`notify-${key}-description`} checked={preferences[key]} onCheckedChange={(checked) => update({ [key]: checked })} />
            </div>
          ))}
          {!userId ? <p className="pt-3 text-muted-foreground">Sign in under Account to enable study and friend reminders. Timer alerts work without an account.</p> : null}
          {!desktop && config && !config.configured ? <p className="pt-3 text-muted-foreground">Push reminders haven’t been configured on this server yet. Timer alerts are still available.</p> : null}
          <div className="pt-3"><Button type="button" variant="outline" disabled={busy || (!enabled && (!valid || !userId || !supported || !desktop && !config?.configured))} onClick={() => void toggle()}>{enabled ? <BellOff /> : <Bell />}{busy ? "Please wait…" : enabled ? "Disable reminders" : "Enable reminders"}</Button></div>
        </fieldset>

        <fieldset disabled={busy} className="min-w-0 space-y-4">
          <legend className="mb-2 font-medium">Timing</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="space-y-2"><Label htmlFor="notification-lead">Before planned study</Label><NativeSelect id="notification-lead" value={preferences.lead_minutes} disabled={!preferences.planned} onChange={(event) => update({ lead_minutes: Number(event.target.value) as NotificationPreferences["lead_minutes"] })}>{[0, 5, 10, 15, 30, 60].map((minutes) => <NativeSelectOption key={minutes} value={minutes}>{minutes ? `${minutes} minutes before` : "At the start"}</NativeSelectOption>)}</NativeSelect></div>
            <div className="space-y-2"><Label htmlFor="notification-deadline">Before a deadline</Label><NativeSelect id="notification-deadline" value={preferences.deadline_days} disabled={!preferences.deadlines} onChange={(event) => update({ deadline_days: Number(event.target.value) as NotificationPreferences["deadline_days"] })}>{[0, 1, 3, 7].map((days) => <NativeSelectOption key={days} value={days}>{days ? `${days} ${days === 1 ? "day" : "days"} before` : "On the day"}</NativeSelectOption>)}</NativeSelect></div>
            <div className="space-y-2"><Label htmlFor="notification-daily-time">Daily and deadline reminder time</Label><Input id="notification-daily-time" type="time" required value={preferences.daily_time} onChange={(event) => update({ daily_time: event.target.value })} /></div>
          </div>
          <p className="text-muted-foreground">Times use {preferences.timezone}. Same-day deadlines arrive at their start if it’s earlier than this time. Delivery may vary with device settings.</p>
          {preferences.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? <Button type="button" variant="outline" onClick={() => update({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>Use this device’s timezone</Button> : null}
          <div className="flex min-h-11 items-center justify-between gap-6"><Label htmlFor="notification-quiet">Quiet hours</Label><Switch id="notification-quiet" checked={preferences.quiet} onCheckedChange={(checked) => update({ quiet: checked })} /></div>
          {preferences.quiet ? (
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2"><Label htmlFor="notification-quiet-start">From</Label><Input id="notification-quiet-start" type="time" required value={preferences.quiet_start} onChange={(event) => update({ quiet_start: event.target.value })} /></div>
              <div className="space-y-2"><Label htmlFor="notification-quiet-end">Until</Label><Input id="notification-quiet-end" type="time" required value={preferences.quiet_end} onChange={(event) => update({ quiet_end: event.target.value })} /></div>
            </div>
          ) : null}
          <p className="text-muted-foreground">Reminders and timer notifications during quiet hours are skipped. Matching start and end times mute all day. Timer sounds follow the Study timer’s Sound switch.</p>
        </fieldset>

        <fieldset disabled={busy} className="min-w-0">
          <legend className="mb-2 font-medium">Timer alerts</legend>
          <p className="mb-2 text-muted-foreground">Keep Study timer open for focus and break alerts, and turn on Notifications under Pomodoro settings → Alerts and flow. Timed paper and SAC alerts work on any page while Focal is open.</p>
          {([{ key: "focus", label: "Focus block complete" }, { key: "breaks", label: "Break over" }, { key: "reading", label: "Exam reading time over" }, { key: "writing", label: "Exam writing time over" }, { key: "sac", label: "SAC time over" }] as const).map(({ key, label }) => <div key={key} className="flex min-h-14 items-center justify-between gap-6 border-b py-3"><Label htmlFor={`notify-${key}`}>{label}</Label><Switch id={`notify-${key}`} checked={preferences[key]} onCheckedChange={(checked) => update({ [key]: checked })} /></div>)}
        </fieldset>
        <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy || !dirty || !valid}>Save preferences</Button>{dirty ? <span className="text-muted-foreground">Unsaved changes</span> : null}</div>
      </form>
      {notice ? <p role="status" className="text-muted-foreground">{notice}</p> : null}
      {error ? <p role="alert" className="text-destructive">{error}</p> : null}
    </div>
  )
}
