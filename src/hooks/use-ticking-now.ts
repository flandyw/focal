import { useEffect, useState } from "react"
import { canonicalNow } from "../lib/study-session-sync"

/**
 * Returns a Date that auto-refreshes on the given interval (default 60s).
 * Use it anywhere a UI value depends on "now" — exam countdowns, relative
 * date strings, etc — so the value stays accurate across midnight without
 * the user reloading the tab.
 */
export function useTickingNow(intervalMs: number = 60_000): Date {
  const [now, setNow] = useState<Date>(canonicalNow)
  useEffect(() => {
    if (typeof window === "undefined") return
    const refresh = () => { if (!document.hidden) setNow(canonicalNow()) }
    const id = window.setInterval(refresh, intervalMs)
    document.addEventListener("visibilitychange", refresh)
    return () => {
      window.clearInterval(id)
      document.removeEventListener("visibilitychange", refresh)
    }
  }, [intervalMs])
  return now
}
