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
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onViewChange: (view: AppView) => void
  onLogExam: () => void
  onLogMistake: () => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState("")
  const [rect, setRect] = useState<DOMRect>()

  useEffect(() => {
    if (open) {
      input.current?.focus()
      setRect(input.current?.getBoundingClientRect())
    } else {
      setQuery("")
      input.current?.blur()
    }
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
        <kbd className="rounded-xs border border-sidebar-border px-1.5 font-sans text-[10px] text-sidebar-foreground/60" aria-hidden>⌘K</kbd>
      </label>
      {open && rect && (
        <div
          onMouseDown={(event) => event.preventDefault()}
          style={{ top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 272) }}
          className="fixed z-50 rounded-sm border border-sidebar-border bg-popover p-1.5 shadow-lg"
        >
          <Command.List className="no-scrollbar max-h-[min(24rem,60vh)] overflow-y-auto outline-none">
            <Command.Empty className="px-3 py-3 text-[13px] text-muted-foreground">No matches.</Command.Empty>
            <Command.Group heading={<div className={headingClass}>Quick actions</div>} className="p-0">
              <Command.Item value="log practice exam add result" onSelect={() => run(onLogExam)} className={itemClass}>
                Log practice exam
              </Command.Item>
              <Command.Item value="log mistake add revision card" onSelect={() => run(onLogMistake)} className={itemClass}>
                Log mistake
              </Command.Item>
              <Command.Item value="start exam timer timed practice" onSelect={() => run(() => onViewChange("focus"))} className={itemClass}>
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
