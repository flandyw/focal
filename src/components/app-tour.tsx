import { useEffect, useLayoutEffect, useState, type ReactNode } from "react"
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { Button } from "./ui/button"

const SHORTCUT = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"

// Steps without a target show centred; targets that aren't on screen (mobile, hidden links) are skipped.
const STEPS: Array<{ target?: string; title: string; text: ReactNode }> = [
  { title: "A quick look around", text: "Here’s where everything lives. Use the arrow keys or Next, and Esc to leave anytime." },
  { target: "[data-tour=add]", title: "Add to your study", text: "Log a practice exam, past study, or a mistake from any page." },
  { target: "[aria-label='Search anything']", title: "Search anything", text: `Press ${SHORTCUT} to jump to any page or action.` },
  { target: "[data-tour=nav-calendar]", title: "Calendar", text: "Your day plan, with SACs, classes, and the exam timetable." },
  { target: "[data-tour=nav-exams]", title: "Exams", text: "Practice results compared with VCAA grade distributions." },
  { target: "[data-tour=nav-focus]", title: "Study timer", text: "Focus blocks, or timed papers under exam conditions." },
  { target: "[data-tour=nav-mistakes]", title: "Mistakes", text: "Errors become cards on a spaced schedule. The badge shows how many are due." },
  { target: "[data-tour=nav-progress]", title: "Progress", text: "Study patterns, exam trends, and consistency over time." },
  { target: "[data-tour=nav-predictor]", title: "Study score", text: "Estimate study scores and your ATAR from your results." },
  { target: "[data-tour=settings]", title: "Settings", text: "Subjects, appearance, and data. You can replay this tour from here." },
  { target: "[data-tour=account]", title: "Account and sync", text: "Sign in to sync with your other devices and Folio. The dot shows sync status." },
  { title: "You’re all set", text: "Start with whatever is due next. Good luck with your exams." },
]

function findTarget(selector?: string) {
  if (!selector) return null
  return [...document.querySelectorAll<HTMLElement>(selector)].find((element) => element.getClientRects().length > 0) ?? null
}

export function AppTour({ onClose }: { onClose: () => void }) {
  const [steps] = useState(() => STEPS.filter((step) => !step.target || findTarget(step.target)))
  const [index, setIndex] = useState(0)
  const [measured, setRect] = useState<DOMRect | null>(null)
  const step = steps[index]
  const anchor = findTarget(step.target)
  const rect = anchor ? measured : null
  const last = index === steps.length - 1

  useLayoutEffect(() => {
    if (!anchor) return
    anchor.scrollIntoView({ block: "nearest" })
    const update = () => setRect(anchor.getBoundingClientRect())
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true) }
  }, [anchor])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose()
      else if (event.key === "ArrowRight") setIndex((value) => Math.min(value + 1, steps.length - 1))
      else if (event.key === "ArrowLeft") setIndex((value) => Math.max(value - 1, 0))
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [onClose, steps.length])

  const card = (
    <div className="grid w-72 gap-3 rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10">
      <div className="grid gap-1">
        <p className="text-xs text-muted-foreground tabular-nums">{index + 1} of {steps.length}</p>
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
        style={rect ? { top: rect.top - 4, left: rect.left - 4, width: rect.width + 8, height: rect.height + 8 } : { top: "50%", left: "50%", width: 0, height: 0 }}
      />
      {anchor ? (
        <PopoverPrimitive.Root open modal={false}>
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Positioner anchor={anchor} side="inline-end" align="center" sideOffset={12} className="isolate z-50">
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
