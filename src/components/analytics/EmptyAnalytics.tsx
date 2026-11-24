import { BarChart3, Plus } from "lucide-react"
import { Button } from "../ui/button"

interface EmptyAnalyticsProps {
  onNewSession: () => void
  onLogExam: () => void
}

export function EmptyAnalytics({ onNewSession, onLogExam }: EmptyAnalyticsProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
      <BarChart3 className="size-10 text-primary" aria-hidden="true" />
      <h2 className="focal-section-title">Your progress will show up here</h2>
      <p className="max-w-sm text-sm leading-relaxed text-muted-foreground text-pretty">
        Wrap up a study session or log a practice exam to start seeing your habits and results build over time.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onNewSession} size="sm"><Plus />Start study session</Button>
        <Button onClick={onLogExam} size="sm" variant="outline">Log an exam</Button>
      </div>
    </div>
  )
}
