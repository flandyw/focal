import { useState } from "react"
import { CheckCircle2, Play, Timer, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface RecoveryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sessionLabel?: string
  elapsedLabel?: string
  ready: boolean
  canDiscard: boolean
  onResume: () => void
  onFinish: () => Promise<boolean>
  onDiscard: () => Promise<boolean>
}

export function RecoveryDialog({
  open,
  onOpenChange,
  sessionLabel,
  elapsedLabel,
  ready,
  canDiscard,
  onResume,
  onFinish,
  onDiscard,
}: RecoveryDialogProps) {
  const [working, setWorking] = useState(false)

  const run = async (action: () => Promise<boolean>) => {
    if (working || !ready) return
    setWorking(true)
    try {
      if (await action()) onOpenChange(false)
    } finally {
      setWorking(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        <DialogHeader className="pr-0">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10">
            <Timer className="h-6 w-6 text-primary" />
          </div>
          <DialogTitle>Recover study session</DialogTitle>
          <DialogDescription>
            You had an active Pomodoro session when the app was closed. What would you like to do?
          </DialogDescription>
        </DialogHeader>
        {(sessionLabel ?? elapsedLabel) && (
          <p className="rounded-lg bg-muted px-3 py-2 text-sm">
            <span className="font-medium">{sessionLabel ?? "Focus session"}</span>
            {elapsedLabel && <span className="text-muted-foreground"> · {elapsedLabel} recorded</span>}
          </p>
        )}
        <div className="mt-6 space-y-2">
          <Button
            onClick={() => { onResume(); onOpenChange(false) }}
            className="w-full justify-start gap-2 text-primary-foreground"
            variant="default"
            disabled={!ready || working}
          >
            <Play className="h-4 w-4" />
            {ready ? "Resume session" : "Loading session…"}
          </Button>
          <Button
            onClick={() => void run(onFinish)}
            className="w-full justify-start gap-2"
            variant="outline"
            disabled={!ready || working}
          >
            <CheckCircle2 className="h-4 w-4" />
            Finish and save
          </Button>
          <Button
            onClick={() => void run(onDiscard)}
            className="w-full justify-start gap-2 text-destructive hover:text-destructive"
            variant="ghost"
            disabled={!ready || !canDiscard || working}
          >
            <Trash2 className="h-4 w-4" />
            Discard session
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
