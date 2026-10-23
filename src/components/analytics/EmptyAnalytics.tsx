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
      <h2 className="font-heading text-2xl font-normal">See your progress take shape</h2>
      <p className="max-w-64 text-sm leading-relaxed text-muted-foreground">
        Complete a study session or log an exam to start tracking your habits and results.
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={onNewSession} size="sm"><Plus />Start study session</Button>
        <Button onClick={onLogExam} size="sm" variant="outline">Log an exam</Button>
      </div>
    </div>
  )
}
