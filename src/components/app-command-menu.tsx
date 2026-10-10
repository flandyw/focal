import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "./ui/command"
import type { AppView } from "../lib/app-view"
import { ALL_NAVIGATION } from "../lib/navigation"

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
    <Command className="rounded-sm border border-sidebar-border shadow-md">
      <CommandInput placeholder="Search pages and actions…" autoFocus onKeyDown={(event) => { if (event.key === "Escape") onOpenChange(false) }} />
      <CommandList>
        <CommandEmpty>No matching action.</CommandEmpty>
        <CommandGroup heading="Quick actions">
          <CommandItem value="log practice exam add result" onSelect={() => run(onLogExam)}>
            Log practice exam
          </CommandItem>
          <CommandItem value="log mistake add revision card" onSelect={() => run(onLogMistake)}>
            Log mistake
          </CommandItem>
          <CommandItem value="start exam timer timed practice" onSelect={() => run(() => onViewChange("focus"))}>
            Start timed paper
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Go to">
          {ALL_NAVIGATION.map((item) => (
            <CommandItem key={item.id} value={`${item.label} ${item.description}`} onSelect={() => run(() => onViewChange(item.id))}>
              <span className="min-w-0 flex-1">
                <span className="block">{item.label}</span>
                <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
              </span>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </Command>
  )
}
