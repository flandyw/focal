import { useEffect, useLayoutEffect, useState } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import type { AppView } from "../lib/app-view"
import { Button } from "./ui/button"

const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"
const TITLE = "#main-content h1"
const ACTIONS = "#main-content [data-tour=page-actions]"

// Each step opens its view first. A target that never appears (mobile sidebar, empty states) shows the card centred.
const STEPS: Array<{ view?: AppView; target?: string; title: string; text: string }> = [
  { view: "calendar", title: "A quick tour of Focal", text: "We’ll visit each page and show what it’s for. Use the arrow keys or Next, and Esc to leave anytime." },
  { target: "[data-tour=add]", title: "Add to your study", text: "Log a practice exam, past study, or a mistake from any page." },
  { target: "[aria-label='Search anything']", title: "Search anything", text: `Press ${SHORTCUT} to jump to any page or action.` },
  { view: "calendar", target: TITLE, title: "Calendar", text: "Your month at a glance. Pick a day to see its plan: study blocks, SACs, classes and exams." },
  { view: "calendar", target: ACTIONS, title: "Plan your days", text: "Add events, or paste a schedule from a chatbot with Import." },
  { view: "exams", target: TITLE, title: "Exams", text: "Every practice paper you’ve sat, with marks compared against VCAA grade distributions." },
  { view: "exams", target: ACTIONS, title: "Log an exam", text: "Record a paper’s mark here. Focal suggests which papers to sit next." },
  { view: "focus", target: "#main-content [role=tablist]", title: "Study timer", text: "Run a study session, or switch to Timed paper to sit an exam under real conditions." },
  { view: "focus", target: "#main-content [aria-label='Study mode']", title: "Pomodoro or free study", text: "Work in focus blocks with breaks, or just let the clock run. Every session counts towards your progress." },
  { view: "mistakes", target: TITLE, title: "Mistakes", text: "Each error becomes a card you review on a spaced schedule, so it sticks." },
  { view: "mistakes", target: "#main-content [role=tablist]", title: "Library, review and schedule", text: "Browse every mistake, review what’s due today, and see what’s coming up." },
  { view: "timetable", target: TITLE, title: "Class timetable", text: "Add your school’s cycle so classes show on your calendar." },
  { view: "sacs", target: ACTIONS, title: "SACs", text: "Plan upcoming SACs, time practice ones, and record your results." },
  { view: "library", target: TITLE, title: "VCAA exam library", text: "Official past papers and reports. Start a timed attempt or mark one done." },
  { view: "progress", target: TITLE, title: "Progress", text: "Study time, consistency, and exam trends, building up as you use Focal." },
  { view: "stoplight", target: TITLE, title: "Stoplight", text: "Rate every skill in the study design red, amber or green, then work on the reds." },
  { view: "goals", target: TITLE, title: "Score goals", text: "Set a target score and see what you need on each assessment to get there." },
  { view: "predictor", target: TITLE, title: "Study score", text: "Predict raw and scaled study scores from your practice results." },
  { view: "atar", target: TITLE, title: "ATAR", text: "Combine study scores, predicted or entered, into an ATAR estimate." },
  { view: "chat", target: "#main-content textarea", title: "Chat", text: "Ask about your study, and let the assistant plan sessions or log things for you." },
  { target: "[data-tour=settings]", title: "Settings", text: "Subjects, appearance, and data. You can replay this tour from here." },
  { target: "[data-tour=account]", title: "Account and sync", text: "Sign in to sync with your other devices and Folio. The dot shows sync status." },
  { view: "calendar", title: "You’re all set", text: "Start with today’s plan. Good luck with your exams." },
]

function findTarget(selector?: string) {
  if (!selector) return null
  return [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.getClientRects().length > 0) ?? null
}

export function AppTour({ onNavigate, onClose }: { onNavigate: (view: AppView) => void; onClose: () => void }) {
  const [index, setIndex] = useState(0)
  const [found, setFound] = useState<{ index: number; element: HTMLElement | null } | null>(null)
  const [measured, setRect] = useState<DOMRect | null>(null)
  const step = STEPS[index]
  const ready = found?.index === index
  const anchor = ready ? found.element : null
  const rect = anchor ? measured : null
  const last = index === STEPS.length - 1

  // Pages load lazily, so poll briefly for the target after switching views.
  useEffect(() => {
    if (step.view) onNavigate(step.view)
    let tries = 0
    const timer = window.setInterval(() => {
      const element = findTarget(step.target)
      if (element || !step.target || ++tries > 40) {
        window.clearInterval(timer)
        setFound({ index, element })
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [index, step, onNavigate])

  useLayoutEffect(() => {
    if (!anchor) return
    anchor.scrollIntoView({ block: "center", behavior: "smooth" })
    const update = () => {
      const next = anchor.getBoundingClientRect()
      setRect((prev) => prev && prev.top === next.top && prev.left === next.left && prev.width === next.width && prev.height === next.height ? prev : next)
    }
    update()
    // Smooth scrolling and late layout shifts move the target after the first measurement.
    const timer = window.setInterval(update, 100)
    window.addEventListener("resize", update)
    return () => { window.clearInterval(timer); window.removeEventListener("resize", update) }
  }, [anchor])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      else if (event.key === "ArrowRight") setIndex((value) => Math.min(value + 1, STEPS.length - 1))
      else if (event.key === "ArrowLeft") setIndex((value) => Math.max(value - 1, 0))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose])

  const card = (
    <div className="grid w-80 max-w-[calc(100vw-2rem)] gap-3 rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <div className="grid gap-1">
        <p className="text-xs text-muted-foreground tabular-nums">{index + 1} of {STEPS.length}</p>
        <h2 className="font-medium">{step.title}</h2>
        <p className="text-muted-foreground">{step.text}</p>
      </div>
      <div className="flex items-center justify-between gap-2">
        {last ? <span /> : <Button size="sm" variant="ghost" onClick={onClose}>Skip tour</Button>}
        <div className="flex gap-2">
          {index > 0 ? <Button size="sm" variant="outline" onClick={() => setIndex(index - 1)}>Back</Button> : null}
          <Button size="sm" autoFocus onClick={() => last ? onClose() : setIndex(index + 1)}>{last ? "Done" : "Next"}</Button>
        </div>
      </div>
    </div>
  )

  return (
    <>
      {/* Blocks the app while touring; the spotlight's shadow does the dimming. */}
      <div className="fixed inset-0 z-50" aria-hidden />
      <div
        aria-hidden
        className={`pointer-events-none fixed z-50 rounded-md shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] transition-all duration-200 motion-reduce:transition-none ${rect ? "ring-2 ring-primary" : ""}`}
        style={rect ? { top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 } : { top: "50%", left: "50%", width: 0, height: 0 }}
      />
      {!ready ? null : anchor ? (
        <PopoverPrimitive.Root open modal={false}>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner anchor={anchor} side={anchor.closest("#main-content") ? "bottom" : "inline-end"} align="start" sideOffset={14} className="isolate z-50">
              <PopoverPrimitive.Popup key={index} aria-live="polite" className="outline-hidden duration-150 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95">{card}</PopoverPrimitive.Popup>
            </PopoverPrimitive.Positioner>
          </PopoverPrimitive.Portal>
        </PopoverPrimitive.Root>
      ) : (
        <div role="dialog" aria-label={step.title} className="fixed top-1/2 left-1/2 z-50 -translate-x-1/2 -translate-y-1/2 animate-in fade-in-0 zoom-in-95">{card}</div>
      )}
    </>
  )
}
