import { useEffect, type RefObject, type TouchEvent } from "react"

const hasTouch = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches

/** Installed to the Home Screen, where there is no browser chrome to fall back on. */
export function isStandalone() {
  return matchMedia("(display-mode: standalone)").matches || Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

/**
 * Exposes the software keyboard to CSS as `--keyboard-inset` and `[data-keyboard]`: on iOS and on Android's default
 * resizes-visual mode nothing else moves, so fixed bars, bottom sheets and the chat composer would sit behind it.
 */
export function trackKeyboard() {
  const viewport = window.visualViewport
  if (!viewport) return
  const root = document.documentElement
  let open = false
  const update = () => {
    const inset = Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop))
    const opened = inset > 120
    root.style.setProperty("--keyboard-inset", `${opened ? inset : 0}px`)
    root.toggleAttribute("data-keyboard", opened)
    if (opened && !open && document.activeElement instanceof HTMLElement) document.activeElement.scrollIntoView({ block: "center" })
    open = opened
  }
  viewport.addEventListener("resize", update)
  viewport.addEventListener("scroll", update)
}

const overlays: (() => void)[] = []

/** Back closes the open dialog or sheet first, as phones expect. Click a hidden Close so veto guards still run. */
export function useBackClose(button: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (import.meta.env.VITE_DESKTOP || !hasTouch()) return
    const close = () => button.current?.click()
    overlays.push(close)
    history.pushState({ ...history.state, overlay: true }, "")
    return () => { overlays.splice(overlays.indexOf(close), 1) }
  }, [button])
}

/** Routes Back: open overlays first, then the previous page. Returns a cleanup. */
export function handleBack<View>(onView: (view: View) => void) {
  const onPopState = (event: PopStateEvent) => {
    const top = overlays.at(-1)
    if (top) {
      top()
      // A guarded form refused to close, so it needs its Back entry again.
      window.setTimeout(() => { if (overlays.at(-1) === top) history.pushState({ ...history.state, overlay: true }, "") }, 50)
      return
    }
    // An overlay closed by its own button leaves its entry behind; step over it so Back never appears to do nothing.
    if (event.state?.overlay) { history.back(); return }
    if (event.state?.view) onView(event.state.view)
  }
  window.addEventListener("popstate", onPopState)
  return () => window.removeEventListener("popstate", onPopState)
}

/** Keeps the screen on while a timer runs; the browser drops the lock whenever the app is hidden, so retake it on return. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !("wakeLock" in navigator)) return
    let lock: WakeLockSentinel | undefined
    let stopped = false
    const acquire = async () => {
      if (document.visibilityState !== "visible") return
      try {
        lock = await navigator.wakeLock.request("screen")
        if (stopped) void lock.release()
      } catch { /* Low battery or an unfocused page; the timer is unaffected. */ }
    }
    void acquire()
    document.addEventListener("visibilitychange", acquire)
    return () => {
      stopped = true
      document.removeEventListener("visibilitychange", acquire)
      void lock?.release().catch(() => undefined)
    }
  }, [active])
}

/** Horizontal swipe for pagers; vertical scrolling and multi-touch are left alone. */
export function swipe(onPrevious: () => void, onNext: () => void) {
  let start: { x: number; y: number } | null = null
  return {
    onTouchStart: (event: TouchEvent) => { start = event.touches.length === 1 ? { x: event.touches[0].clientX, y: event.touches[0].clientY } : null },
    onTouchEnd: (event: TouchEvent) => {
      if (!start) return
      const x = event.changedTouches[0].clientX - start.x
      const y = event.changedTouches[0].clientY - start.y
      start = null
      if (Math.abs(x) > 70 && Math.abs(y) < 50) { buzz(); if (x > 0) onPrevious(); else onNext() }
    },
  }
}

/** Android only; iOS has no web vibration, and browsers ignore it without a recent tap. */
export function buzz(pattern: number | number[] = 12) {
  try { navigator.vibrate?.(pattern) } catch { /* Haptics are never essential. */ }
}

export function setAppBadge(count: number) {
  if (!("setAppBadge" in navigator)) return
  void (count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => undefined)
}

/** Downsizes a phone photo before saving: 12MP camera files overrun the attachment limit and slow every sync. */
export async function shrinkPhoto(file: File, maxEdge = 2000, quality = 0.82) {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size < 700_000) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height))
    const canvas = new OffscreenCanvas(Math.round(bitmap.width * scale), Math.round(bitmap.height * scale))
    canvas.getContext("2d")?.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
    const blob = await canvas.convertToBlob({ type: "image/jpeg", quality })
    return blob.size < file.size ? new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg", lastModified: file.lastModified }) : file
  } catch {
    return file
  }
}
