import { useEffect, useRef } from "react"

interface ShortcutHandlers {
  onSearch?: () => void
  onNewAssessment?: () => void
  onNewEvent?: () => void
  onNewSession?: () => void
  onGoHome?: () => void
  onGoTimetable?: () => void
  onGoPlanner?: () => void
  onGoInbox?: () => void
  onGoAnalytics?: () => void
  onGoExamTrack?: () => void
  onOpenFocus?: () => void
  onGoSettings?: () => void
  onOpenAiAssistant?: () => void
  onShowShortcuts?: () => void
  onToggleSidebar?: () => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onZoomReset?: () => void
}

export function blocksSingleKeyShortcut(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object") return false
  const element = target as HTMLElement
  const tag = typeof element.tagName === "string" ? element.tagName.toLowerCase() : ""
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    Boolean(element.isContentEditable) ||
    Boolean(element.closest?.('[role="dialog"]'))
  )
}

export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  const handlersRef = useRef(handlers)

  useEffect(() => {
    handlersRef.current = handlers
  })

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const meta = e.metaKey || e.ctrlKey
      const key = e.key.toLowerCase()

      // Cmd/Ctrl + K: Search
      if (meta && key === "k") {
        e.preventDefault()
        handlersRef.current.onSearch?.()
        return
      }

      // Cmd/Ctrl + N: New assessment
      if (meta && key === "n" && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onNewAssessment?.()
        return
      }

      // Cmd/Ctrl + Shift + N: New event
      if (meta && key === "n" && e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onNewEvent?.()
        return
      }

      // Cmd/Ctrl + Shift + S: New study session
      if (meta && key === "s" && e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onNewSession?.()
        return
      }

      // Cmd/Ctrl + = (or +): Zoom in
      if (meta && (key === "=" || key === "+")) {
        e.preventDefault()
        handlersRef.current.onZoomIn?.()
        return
      }

      // Cmd/Ctrl + -: Zoom out
      if (meta && key === "-") {
        e.preventDefault()
        handlersRef.current.onZoomOut?.()
        return
      }

      // Cmd/Ctrl + 0: Reset zoom
      if (meta && key === "0") {
        e.preventDefault()
        handlersRef.current.onZoomReset?.()
        return
      }

      // Cmd/Ctrl + ,: Settings
      if (meta && key === ",") {
        e.preventDefault()
        handlersRef.current.onGoSettings?.()
        return
      }

      // Single-key commands should never escape a field or modal dialog.
      if (blocksSingleKeyShortcut(e.target)) return

      // ?: Show keyboard shortcut guide
      if (e.key === "?" && !meta && !e.altKey) {
        e.preventDefault()
        handlersRef.current.onShowShortcuts?.()
        return
      }

      // H: Go home
      if (key === "h" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onGoHome?.()
        return
      }

      // F: Open focus setup
      if (key === "f" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onOpenFocus?.()
        return
      }

      // T: Go timetable
      if (key === "t" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onGoTimetable?.()
        return
      }

      // P: Go to the adaptive planner
      if (key === "p" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onGoPlanner?.()
        return
      }

      // B: Go to the academic inbox
      if (key === "b" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onGoInbox?.()
        return
      }

      // A: Go analytics
      if (key === "a" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onGoAnalytics?.()
        return
      }

      // E: Go to Exam practice
      if (key === "e" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onGoExamTrack?.()
        return
      }

      // I: Open AI assistant
      if (key === "i" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onOpenAiAssistant?.()
        return
      }

      // /: Search without reaching for a modifier key
      if (e.key === "/" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onSearch?.()
        return
      }

      // [ : Toggle sidebar
      if (key === "[" && !meta && !e.altKey && !e.shiftKey) {
        e.preventDefault()
        handlersRef.current.onToggleSidebar?.()
        return
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])
}
