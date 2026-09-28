import { useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ExamAttempt } from "@/lib/exam-data"
import { buildPerformanceContextAnalysis } from "@/lib/performance-context"
import type { SacRecord } from "@/lib/sac"

type PerformanceContextInsightsProps = {
  attempts: ExamAttempt[]
  sacRecords: SacRecord[]
}

export function PerformanceContextInsights({ attempts, sacRecords }: PerformanceContextInsightsProps) {
  const analysis = useMemo(() => buildPerformanceContextAnalysis(attempts, sacRecords), [attempts, sacRecords])
  const coverage = analysis.completedAssessments
    ? Math.round((analysis.recordedAssessments / analysis.completedAssessments) * 100)
    : 0
  const strongestPositive = analysis.insights.find((insight) => insight.favourableChange > 0)

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <CardTitle>Conditions and headspace</CardTitle>
            <CardDescription>Links sleep and mental-state check-ins with results relative to your usual mark for that subject and assessment type.</CardDescription>
          </div>
          <Badge variant="outline">{analysis.recordedAssessments}/{analysis.completedAssessments} recorded · {coverage}%</Badge>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        {analysis.insights.length ? (
          <>
            <div className="grid gap-3 md:grid-cols-3">
              {analysis.insights.slice(0, 3).map((insight) => (
                <div key={insight.key} className="rounded-lg border p-4">
                  <p className="text-sm text-muted-foreground">{insight.label}</p>
                  <p className="mt-1 text-2xl font-semibold tabular-nums">
                    {insight.favourableChange > 0 ? "+" : ""}{insight.favourableChange.toFixed(1)} pts
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">with {insight.condition} · {insight.sampleSize} results</p>
                </div>
              ))}
            </div>
            <div className="rounded-lg bg-muted/50 px-4 py-3 text-sm">
              {strongestPositive
                ? <><span className="font-medium">Best current lever:</span> {strongestPositive.action}</>
                : <>No positive condition pattern is reliable yet. Keep recording varied results to make the comparison useful.</>}
            </div>
            <p className="text-xs text-muted-foreground">These are personal correlations, not proof of cause. Signals require at least three results with different ratings and become more useful as coverage grows.</p>
          </>
        ) : (
          <div className="rounded-lg border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            Record a factor across at least three completed assessments with different ratings to reveal personal performance patterns.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
