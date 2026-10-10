import { Command } from "cmdk"
import { Search } from "lucide-react"
import type { AppView } from "../lib/app-view"
import { ALL_NAVIGATION } from "../lib/navigation"

const itemClass = "flex h-8 cursor-default items-center rounded-xs px-3 text-[13px] text-sidebar-foreground outline-none data-[selected=true]:bg-sidebar-accent data-[selected=true]:text-sidebar-accent-foreground"
const headingClass = "focal-eyebrow flex h-6 items-center px-3 text-sidebar-foreground/50"

export function AppCommandMenu({
  onOpenChange,
  onViewChange,
  onLogExam,
  onLogMistake,
}: {
  onOpenChange: (open: boolean) => void
  onViewChange: (view: AppView) => void
  onLogExam: () => void
  onLogMistake: () => void
}) {
  function run(action: () => void) {
    onOpenChange(false)
    action()
  }

  return (
    <Command className="flex flex-col gap-1">
      <div className="mx-2 flex items-center gap-2 border-b border-sidebar-border pb-2">
        <Search className="size-3.5 shrink-0 text-sidebar-foreground/50" aria-hidden />
        <Command.Input
          autoFocus
          placeholder="Find a page or action"
          onKeyDown={(event) => { if (event.key === "Escape") onOpenChange(false) }}
          className="min-w-0 flex-1 bg-transparent text-[13px] text-sidebar-accent-foreground outline-none placeholder:text-sidebar-foreground/50"
        />
      </div>
      <Command.List className="no-scrollbar max-h-72 overflow-y-auto outline-none">
        <Command.Empty className="px-3 py-3 text-[13px] text-sidebar-foreground/60">No matches.</Command.Empty>
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
    </Command>
  )
}
