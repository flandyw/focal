import { Button } from "./ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog"

type DiscardChangesDialogProps = {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}

export function DiscardChangesDialog({ open, onKeep, onDiscard }: DiscardChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onKeep() }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>Discard your unsaved changes?</DialogTitle>
          <DialogDescription>If you close this now, you’ll lose what you’ve typed so far.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onKeep} autoFocus>Keep editing</Button>
          <Button variant="destructive" onClick={onDiscard}>Discard changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
