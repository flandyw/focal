import { useEffect, useLayoutEffect, useState } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import type { AppView } from "../lib/app-view"
import { AI_ENABLED } from "../lib/host"
import { Button } from "./ui/button"

const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"
const TITLE = "#main-content h1"
const ACTIONS = "#main-content [data-tour=page-actions]"

// Each step opens its view first. A target that never appears (mobile sidebar, empty states) shows the card centred.
const STEPS_ALL: Array<{ view?: AppView; target?: string; title: string; text: string }> = [
  { view: "calendar", title: "Quick tour of Focal", text: "Let’s take a quick walk through each page so you know where everything lives. Use the arrow keys or Next, and press Esc anytime to hop out." },
  { target: "[data-tour=add]", title: "Log study fast", text: "Record a practice exam, past study session, or mistake from wherever you are." },
  { target: "[aria-label='Search pages and actions'], [aria-label='Search']", title: "Jump anywhere", text: matchMedia("(pointer: coarse)").matches ? "Tap Search to jump straight to any page or action." : `Hit ${SHORTCUT} anytime to jump straight to a page or quick action.` },
  { view: "calendar", target: TITLE, title: "Calendar", text: "Your month at a glance. Click any day to see its study blocks, SACs, classes, and exams." },
  { view: "calendar", target: ACTIONS, title: "Plan your week", text: "Add events yourself, or paste a schedule from a chatbot with Import." },
  { view: "exams", target: TITLE, title: "Practice", text: "All the practice papers you’ve logged, lined up against official VCAA grade distributions." },
  { view: "exams", target: ACTIONS, title: "Log an exam", text: "Enter a paper’s mark here. Focal will also suggest which papers are worth sitting next." },
  { view: "focus", target: "#main-content [role=tablist]", title: "Study timer", text: "Start a study session, or switch to Timed paper to sit an exam under real conditions." },
  { view: "focus", target: "#main-content [aria-label='Study mode']", title: "Pomodoro or free study", text: "Work in timed focus blocks with breaks, or just let the clock run. Everything counts toward your progress." },
  { view: "mistakes", target: TITLE, title: "Mistakes", text: "Each mistake becomes a revision card that pops back up on a spaced schedule until it clicks." },
  { view: "mistakes", target: "#main-content [role=tablist]", title: "Library, review, and schedule", text: "Browse your full library, clear what’s due today, and peek at what’s coming up next." },
  { view: "timetable", target: TITLE, title: "Class timetable", text: "Pop in your school cycle so your classes and free periods show up on your calendar." },
  { view: "sacs", target: ACTIONS, title: "SACs", text: "Keep track of upcoming SACs, time practice runs, and log your results." },
  { view: "library", target: TITLE, title: "VCAA exam library", text: "Official past papers and examiner reports. Start a timed sitting or tick them off as you go." },
  { view: "progress", target: TITLE, title: "Progress", text: "Your study hours, streaks, and exam trends, growing naturally as you use Focal." },
  { view: "stoplight", target: TITLE, title: "Skills", text: "Rate every skill in your study design red, amber, or green so you always know what needs work." },
  { view: "goals", target: TITLE, title: "Score goals", text: "Set a target score and see what you’ll need on each assessment to reach it." },
  { view: "predictor", target: TITLE, title: "Study score", text: "See where your raw and scaled study scores are tracking based on your practice results." },
  { view: "atar", target: TITLE, title: "ATAR", text: "Bring your predicted or entered study scores together into an ATAR estimate." },
  { view: "chat", target: "#main-content textarea", title: "Chat", text: "Ask questions about your study or get help planning sessions and logging work." },
  { target: "[data-tour=settings]", title: "Settings", text: "Manage your subjects, theme, reminders, and backups. You can also replay this tour here." },
  { target: "[data-tour=account]", title: "Account and sync", text: "Sign in to sync across your devices and Folio. The little dot lets you know everything’s up to date." },
  { view: "calendar", title: "You’re all set", text: "Have a look at today’s plan whenever you’re ready. Good luck with your exams." },
]

const STEPS = STEPS_ALL.filter((step) => AI_ENABLED || step.view !== "chat")

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
      // A page may take a moment to load; a sidebar target is either there or hidden on this screen.
      if (element || !step.target || ++tries > (step.view ? 40 : 3)) {
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
        className={`pointer-events-none fixed z-50 rounded-md shadow-[0_0_0_9999px_rgb(0_0_0/0.5)] transition-[top,left,width,height] duration-200 motion-reduce:transition-none ${rect ? "ring-2 ring-primary" : ""}`}
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
