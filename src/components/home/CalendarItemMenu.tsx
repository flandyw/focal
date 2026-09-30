import { BookOpen, CheckCircle2, Pencil, Trash2 } from "lucide-react"
import { ContextMenuContent, ContextMenuItem, ContextMenuSeparator } from "@/components/ui/context-menu"

export function CalendarItemMenu({
  onEdit, onConvert, onToggleComplete, onDelete, isCompleted,
}: {
  onEdit: () => void
  onConvert?: () => void
  onToggleComplete?: () => void
  onDelete?: () => void
  isCompleted: boolean
}) {
  return (
    <ContextMenuContent className="w-56">
      <ContextMenuItem onSelect={onEdit}><Pencil className="h-4 w-4" />Edit</ContextMenuItem>
      {onConvert && (
        <ContextMenuItem onSelect={onConvert}><BookOpen className="h-4 w-4" />Convert to study session</ContextMenuItem>
      )}
      {onToggleComplete && (
        <ContextMenuItem onSelect={onToggleComplete}>
          <CheckCircle2 className="h-4 w-4" />{isCompleted ? "Mark current" : "Mark complete"}
        </ContextMenuItem>
      )}
      {onDelete && <>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onSelect={onDelete}><Trash2 className="h-4 w-4" />Delete</ContextMenuItem>
      </>}
    </ContextMenuContent>
  )
}
