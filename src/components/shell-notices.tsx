import { useEffect, useState } from "react"
import { CloudOff, X } from "lucide-react"
import { Button } from "./ui/button"
import { canPromptInstall, onInstallChange, promptInstall } from "../lib/pwa"
import { isStandalone } from "../lib/mobile"

/** Phones hide the sidebar's sync status, so going offline would otherwise be invisible until something fails. */
export function OfflineChip({ status }: { status: string }) {
  const [online, setOnline] = useState(() => typeof navigator === "undefined" || navigator.onLine)
  useEffect(() => {
    const update = () => setOnline(navigator.onLine)
    window.addEventListener("online", update)
    window.addEventListener("offline", update)
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update) }
  }, [])
  if (online && status !== "reconnecting" && status !== "error") return null
  return <span role="status" title="Changes stay on this device and sync when you reconnect" className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground"><CloudOff aria-hidden className="size-3.5" />{online && status === "error" ? "Not synced" : "Offline"}</span>
}

const INSTALL_NUDGE_KEY = "focal:install-nudge:v1"

/** Reminders and a full-screen window both need the Home Screen app, and iOS never suggests it. Asks once, from the second launch. */
export function InstallNudge() {
  const [, refresh] = useState(0)
  const [hidden, setHidden] = useState(() => {
    if (import.meta.env.VITE_DESKTOP || typeof localStorage === "undefined" || !matchMedia("(pointer: coarse) and (max-width: 1023px)").matches || isStandalone()) return true
    try {
      const seen = Number(localStorage.getItem(INSTALL_NUDGE_KEY) ?? 0)
      if (seen >= 0) localStorage.setItem(INSTALL_NUDGE_KEY, String(seen + 1))
      return seen < 1
    } catch { return true }
  })
  useEffect(() => onInstallChange(() => refresh((value) => value + 1)), [])
  if (hidden) return null
  const dismiss = () => { setHidden(true); try { localStorage.setItem(INSTALL_NUDGE_KEY, "-1") } catch { /* Shows again next launch. */ } }
  return (
    <div className="mb-3 flex items-center gap-3 rounded-md border bg-card p-3 text-sm">
      <p className="min-w-0 flex-1 text-muted-foreground">{canPromptInstall() ? "Install Focal for reminders and a full-screen app." : "Add Focal to your Home Screen from the Share menu for reminders and a full-screen app."}</p>
      {canPromptInstall() ? <Button size="sm" onClick={() => void promptInstall().then(dismiss)}>Install</Button> : null}
      <Button size="icon-sm" variant="ghost" aria-label="Dismiss install suggestion" onClick={dismiss}><X aria-hidden /></Button>
    </div>
  )
}

