import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

type DiscardChangesDialogProps = {
  open: boolean
  onKeep: () => void
  onDiscard: () => void
}

export function DiscardChangesDialog({ open, onKeep, onDiscard }: DiscardChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onKeep() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>Closing now loses everything typed into this form.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onKeep}>Keep editing</Button>
          <Button variant="destructive" onClick={onDiscard}>Discard changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
