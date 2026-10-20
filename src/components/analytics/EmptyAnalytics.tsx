import { BarChart3, Plus } from "lucide-react"
import { Button } from "../ui/button"

interface EmptyAnalyticsProps {
  onNewSession: () => void
}

export function EmptyAnalytics({ onNewSession }: EmptyAnalyticsProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
      <BarChart3 className="size-10 text-primary" aria-hidden="true" />
      <h2 className="font-heading text-2xl font-normal">No study analytics yet</h2>
      <p className="max-w-64 text-sm leading-relaxed text-muted-foreground">
        Complete your first study session to see analytics about your study habits.
      </p>
      <Button onClick={onNewSession} size="sm"><Plus />Start study session</Button>
    </div>
  )
}
