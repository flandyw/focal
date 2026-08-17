import { Keyboard } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { isMacOS } from "@/lib/platform"

interface KeyboardShortcutsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: KeyboardShortcutsDialogProps) {
  const mod = isMacOS ? "⌘" : "Ctrl"
  const groups = [
    {
      label: "Create & find",
      shortcuts: [
        { keys: [`${mod} K`], action: "Search and quick actions" },
        { keys: [`${mod} N`], action: "New assessment" },
        { keys: [`${mod} ⇧ N`], action: "New event" },
        { keys: [`${mod} ⇧ S`], action: "Plan study session" },
      ],
    },
    {
      label: "Navigate",
      shortcuts: [
        { keys: ["F"], action: "Start focus" },
        { keys: ["H"], action: "Go to Today" },
        { keys: ["T"], action: "Go to Schedule" },
        { keys: ["A"], action: "Go to Progress" },
        { keys: ["I"], action: "Open AI Assistant" },
        { keys: [`${mod} ,`], action: "Open settings" },
      ],
    },
    {
      label: "Calendar",
      shortcuts: [
        { keys: ["← ↑ ↓ →"], action: "Move between dates" },
        { keys: ["Shift ↵"], action: "Create event on date" },
      ],
    },
    {
      label: "Workspace",
      shortcuts: [
        { keys: ["["], action: "Toggle sidebar" },
        { keys: [`${mod} +`, `${mod} −`], action: "Zoom in or out" },
        { keys: [`${mod} 0`], action: "Reset zoom" },
        { keys: ["Esc"], action: "Clear search or close overlay" },
        { keys: ["?"], action: "Show this shortcut guide" },
      ],
    },
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogHeader className="border-b px-5 pb-4 pt-5">
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="size-4 text-muted-foreground" aria-hidden="true" />
            Keyboard shortcuts
          </DialogTitle>
          <DialogDescription>
            Move through Focal without leaving the keyboard.
          </DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 gap-5 overflow-y-auto overscroll-contain px-5 py-5 sm:grid-cols-2">
          {groups.map((group) => (
            <section key={group.label} className="grid content-start gap-2">
              <h3 className="text-xs font-semibold uppercase text-muted-foreground">
                {group.label}
              </h3>
              <div className="grid gap-1">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.action}
                    className="flex min-h-9 items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-muted/50"
                  >
                    <span className="text-sm">{shortcut.action}</span>
                    <span className="flex shrink-0 gap-1">
                      {shortcut.keys.map((key) => (
                        <kbd
                          key={key}
                          className="inline-flex h-6 min-w-6 items-center justify-center rounded border bg-muted px-1.5 font-mono text-xs text-muted-foreground shadow-xs"
                        >
                          {key}
                        </kbd>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
        <p className="border-t bg-popover px-5 py-3 text-xs text-muted-foreground">
          Single-key shortcuts pause while you are typing in a field.
        </p>
      </DialogContent>
    </Dialog>
  )
}
