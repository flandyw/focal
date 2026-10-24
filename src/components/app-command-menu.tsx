import { Command as CommandPrimitive } from "cmdk"
import { useEffect, useRef, useState } from "react"
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { History, Plus, Search, Settings2, Timer, X, type LucideIcon } from "lucide-react"
import type { AppView } from "../lib/app-view"
import { ALL_NAVIGATION } from "../lib/navigation"
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "./ui/command"
import { Button } from "./ui/button"
import { Label } from "./ui/label"

const itemClass = "h-8 rounded-xs px-3 py-0 text-[13px] text-popover-foreground outline-none data-selected:bg-sidebar-accent data-selected:text-sidebar-accent-foreground"
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
    <Command className="mx-2 size-auto rounded-none! bg-transparent p-0 group-data-[collapsible=icon]:hidden">
      <Label className="h-8 rounded-xs px-3 font-normal text-sidebar-foreground/70 focus-within:bg-sidebar-accent hover:bg-sidebar-accent">
        <Search className="size-4 shrink-0 opacity-70" strokeWidth={1.5} aria-hidden />
        <CommandPrimitive.Input
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
      </Label>
      {open && rect && (
        <div
          onMouseDown={(event) => event.preventDefault()}
          style={{ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 288), width: Math.min(Math.max(rect.width, 272), window.innerWidth - 32) }}
          className="fixed z-50 rounded-sm border border-sidebar-border bg-popover p-1.5 shadow-lg"
        >
          <CommandList className="max-h-[min(24rem,60dvh)] overflow-y-auto overscroll-contain outline-none" style={{ maxHeight: Math.max(44, window.innerHeight - rect.bottom - 24) }}>
            <CommandEmpty className="px-3 py-3 text-[13px] text-muted-foreground">No matching actions. Try a page name or “log”.</CommandEmpty>
            <CommandGroup heading={<div className={headingClass}>Quick actions</div>} className="p-0">
              <CommandItem value="log practice exam add result" onSelect={() => run(onLogExam)} className={itemClass}>
                Log practice exam
              </CommandItem>
              <CommandItem value="log mistake add revision card" onSelect={() => run(onLogMistake)} className={itemClass}>
                Log mistake
              </CommandItem>
              <CommandItem value="log past study record session" onSelect={() => run(onLogPastStudy)} className={itemClass}>
                Log past study
              </CommandItem>
              <CommandItem value="Start timed paper" keywords={["exam", "timer", "practice"]} onSelect={() => run(onStartExam)} className={itemClass}>
                Start timed paper
              </CommandItem>
            </CommandGroup>
            <CommandGroup heading={<div className={headingClass}>Go to</div>} className="p-0">
              {ALL_NAVIGATION.map((item) => (
                <CommandItem key={item.id} value={`${item.label} ${item.description}`} onSelect={() => run(() => onViewChange(item.id))} className={itemClass}>
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </div>
      )}
    </Command>
  )
}

const mobileItemClass = "min-h-12 gap-3 rounded-sm px-3 py-2 text-[15px] data-selected:bg-muted"
const mobileHeadingClass = "focal-eyebrow px-3 pt-4 pb-1.5 text-muted-foreground"

/** Full-screen search for phones and tablets, where the sidebar input would sit inside the drawer. */
export function MobileSearch({
  open,
  onOpenChange,
  icons,
  onViewChange,
  onLogExam,
  onLogMistake,
  onLogPastStudy,
  onStartExam,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  icons: Partial<Record<AppView, LucideIcon>>
  onViewChange: (view: AppView) => void
  onLogExam: () => void
  onLogMistake: () => void
  onLogPastStudy: () => void
  onStartExam: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")

  function run(action: () => void) {
    onOpenChange(false)
    action()
  }

  const actions = [
    { label: "Log practice exam", value: "log practice exam add result", Icon: Plus, action: onLogExam },
    { label: "Log mistake", value: "log mistake add revision card", Icon: Plus, action: onLogMistake },
    { label: "Log past study", value: "log past study record session", Icon: History, action: onLogPastStudy },
    { label: "Start timed paper", value: "start timed paper exam timer practice", Icon: Timer, action: onStartExam },
  ]

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => { onOpenChange(next); if (!next) setQuery("") }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Popup
          initialFocus={input}
          aria-label="Search"
          className="fixed inset-0 z-50 flex flex-col bg-background pt-[env(safe-area-inset-top)] text-foreground outline-none duration-150 data-open:animate-in data-open:fade-in-0 data-open:slide-in-from-bottom-4 data-closed:animate-out data-closed:fade-out-0"
        >
          <Command className="min-h-0 flex-1 rounded-none! bg-transparent p-0">
            <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <Label className="h-11 min-w-0 flex-1 gap-2 rounded-sm bg-muted px-3 font-normal">
                <Search className="size-4.5 shrink-0 text-muted-foreground" strokeWidth={1.75} aria-hidden />
                <CommandPrimitive.Input
                  ref={input}
                  aria-label="Search pages and actions"
                  placeholder="Search pages and actions"
                  value={query}
                  onValueChange={setQuery}
                  enterKeyHint="go"
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  // 16px keeps iOS Safari from zooming on focus.
                  className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground"
                />
                {query && (
                  <button type="button" aria-label="Clear search" onClick={() => { setQuery(""); input.current?.focus() }} className="-mr-1.5 grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground">
                    <X className="size-4" aria-hidden />
                  </button>
                )}
              </Label>
              <DialogPrimitive.Close render={<Button variant="ghost" className="h-11 px-2 text-[15px] text-primary" />}>Cancel</DialogPrimitive.Close>
            </div>
            <CommandList className="max-h-none flex-1 overscroll-contain px-2 pb-[max(1rem,env(safe-area-inset-bottom))]">
              <CommandEmpty className="px-6 py-12 text-center text-[15px] text-muted-foreground">No results for “{query}”.<br />Try a page name or “log”.</CommandEmpty>
              <CommandGroup heading={<div className={mobileHeadingClass}>Quick actions</div>} className="p-0">
                {actions.map(({ label, value, Icon, action }) => (
                  <CommandItem key={label} value={value} onSelect={() => run(action)} className={mobileItemClass}>
                    <Icon className="size-5! text-primary" strokeWidth={1.75} aria-hidden />
                    {label}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading={<div className={mobileHeadingClass}>Go to</div>} className="p-0">
                {ALL_NAVIGATION.map((item) => {
                  const Icon = icons[item.id] ?? Settings2
                  return (
                    <CommandItem key={item.id} value={`${item.label} ${item.description}`} onSelect={() => run(() => onViewChange(item.id))} className={mobileItemClass}>
                      <Icon className="size-5! text-muted-foreground" strokeWidth={1.5} aria-hidden />
                      <span className="flex min-w-0 flex-col">
                        <span>{item.label}</span>
                        <span className="truncate text-[13px] text-muted-foreground">{item.description}</span>
                      </span>
                    </CommandItem>
                  )
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
