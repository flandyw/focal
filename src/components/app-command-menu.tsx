import { Command } from "cmdk"
import { useEffect, useRef, useState } from "react"
import { Search } from "lucide-react"
import type { AppView } from "../lib/app-view"
import { ALL_NAVIGATION } from "../lib/navigation"

const itemClass = "flex h-8 cursor-default items-center rounded-xs px-3 text-[13px] text-popover-foreground outline-none data-[selected=true]:bg-sidebar-accent data-[selected=true]:text-sidebar-accent-foreground"
const headingClass = "focal-eyebrow flex h-6 items-center px-3 text-muted-foreground"

export function AppCommandMenu({
  open,
  onOpenChange,
  onViewChange,
  onLogExam,
  onLogMistake,
  onLogPastStudy,
  onStartExam,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onViewChange: (view: AppView) => void
  onLogExam: () => void
  onLogMistake: () => void
  onLogPastStudy: () => void
  onStartExam: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [rect, setRect] = useState<DOMRect>()

  useEffect(() => {
    let frame: number
    if (open) {
      const position = () => setRect(input.current?.getBoundingClientRect())
      const frame = requestAnimationFrame(() => { input.current?.focus(); position() })
      window.addEventListener("resize", position)
      window.addEventListener("scroll", position, true)
      return () => {
        cancelAnimationFrame(frame)
        window.removeEventListener("resize", position)
        window.removeEventListener("scroll", position, true)
      }
    } else {
      frame = requestAnimationFrame(() => setQuery(""))
      input.current?.blur()
    }
    return () => cancelAnimationFrame(frame)
  }, [open])

  function run(action: () => void) {
    onOpenChange(false)
    action()
  }

  return (
    <Command className="mx-2 group-data-[collapsible=icon]:hidden">
      <label className="flex h-8 items-center gap-2 rounded-xs px-3 text-sidebar-foreground/70 focus-within:bg-sidebar-accent hover:bg-sidebar-accent">
        <Search className="size-4 shrink-0 opacity-70" strokeWidth={1.5} aria-hidden />
        <Command.Input
          ref={input}
          aria-label="Search anything"
          placeholder="Search"
          value={query}
          onValueChange={setQuery}
          onFocus={() => onOpenChange(true)}
          onBlur={() => onOpenChange(false)}
          onKeyDown={(event) => { if (event.key === "Escape") onOpenChange(false) }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-accent-foreground outline-none placeholder:text-sidebar-foreground/70"
        />
        <kbd className="rounded-xs border border-sidebar-border px-1.5 font-sans text-[10px] text-sidebar-foreground/60" aria-hidden>{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd>
      </label>
      {open && rect && (
        <div
          onMouseDown={(event) => event.preventDefault()}
          style={{ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 288), width: Math.min(Math.max(rect.width, 272), window.innerWidth - 32) }}
          className="fixed z-50 rounded-sm border border-sidebar-border bg-popover p-1.5 shadow-lg"
        >
          <Command.List className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain outline-none" style={{ maxHeight: Math.max(44, window.innerHeight - rect.bottom - 24) }}>
            <Command.Empty className="px-3 py-3 text-[13px] text-muted-foreground">No matching actions. Try a page name or “log”.</Command.Empty>
            <Command.Group heading={<div className={headingClass}>Quick actions</div>} className="p-0">
              <Command.Item value="log practice exam add result" onSelect={() => run(onLogExam)} className={itemClass}>
                Log practice exam
              </Command.Item>
              <Command.Item value="log mistake add revision card" onSelect={() => run(onLogMistake)} className={itemClass}>
                Log mistake
              </Command.Item>
              <Command.Item value="log past study record session" onSelect={() => run(onLogPastStudy)} className={itemClass}>
                Log past study
              </Command.Item>
              <Command.Item value="Start timed paper" keywords={["exam", "timer", "practice"]} onSelect={() => run(onStartExam)} className={itemClass}>
                Start timed paper
              </Command.Item>
            </Command.Group>
            <Command.Group heading={<div className={headingClass}>Go to</div>} className="p-0">
              {ALL_NAVIGATION.map((item) => (
                <Command.Item key={item.id} value={`${item.label} ${item.description}`} onSelect={() => run(() => onViewChange(item.id))} className={itemClass}>
                  {item.label}
                </Command.Item>
              ))}
            </Command.Group>
          </Command.List>
        </div>
      )}
    </Command>
  )
}
