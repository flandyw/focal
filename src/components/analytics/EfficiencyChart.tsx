import { useMemo } from "react"
import { getSubjectColor } from "../../lib/progress-chart-theme"
import { getSubjectById } from "../../lib/progress-utils"
import type { EfficiencyPoint } from "../../lib/progress-analytics"

interface EfficiencyChartProps {
  data: EfficiencyPoint[]
}

export function EfficiencyChart({ data }: EfficiencyChartProps) {
  const maxMinutes = useMemo(() => Math.max(...data.map((d) => d.minutes), 1), [data])

  if (data.length === 0) {
    return (
      <section className="border-t border-border/70 pt-5">
        <h3 className="text-sm font-semibold mb-1">Study Efficiency</h3>
        <p className="text-xs text-muted-foreground">No confidence reflections recorded for this period.</p>
      </section>
    )
  }

  return (
    <section className="border-t border-border/70 pt-5">
      <h3 className="text-sm font-semibold mb-4">Study Efficiency</h3>
      <p className="text-xs text-muted-foreground mb-4">
        Minutes studied vs. confidence level (1-5)
      </p>

      <div className="space-y-3">
        {data.map((item) => {
          const subject = getSubjectById(item.subjectId)
          const color = getSubjectColor(item.subjectId)
          const barWidth = (item.minutes / maxMinutes) * 100
          const confidencePercent = (item.averageConfidence / 5) * 100

          return (
            <div key={item.subjectId} className="space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="min-w-0 flex-1 truncate text-xs font-medium">
                    {subject?.name ?? "Unassigned"}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="tabular-nums">
                    {item.minutes < 60
                      ? `${item.minutes}m`
                      : `${Math.floor(item.minutes / 60)}h ${item.minutes % 60}m`}
                  </span>
                  <span className="tabular-nums">
                    {item.sessionCount} sessions
                  </span>
                  <span className="tabular-nums font-medium text-foreground">
                    {item.averageConfidence.toFixed(1)}★
                  </span>
                </div>
              </div>
              <div className="flex gap-1">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="h-full rounded-full transition-[width] duration-200 motion-reduce:transition-none"
                    style={{
                      width: `${barWidth}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted/50">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-200 motion-reduce:transition-none"
                    style={{ width: `${confidencePercent}%` }}
                  />
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-6 rounded-full bg-muted/50" />
          <span>Minutes</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-6 rounded-full bg-primary" />
          <span>Confidence</span>
        </div>
      </div>
      <p className="sr-only">
        Study efficiency: {data
          .map((d, i) => {
            const name = getSubjectById(d.subjectId)?.name ?? "Unassigned"
            const h = Math.floor(d.minutes / 60)
            const m = d.minutes % 60
            const time = h > 0 ? `${h}h ${m}m` : `${m}m`
            return `${i > 0 ? "; " : ""}${name} ${time}, ${d.sessionCount} session${d.sessionCount === 1 ? "" : "s"}, confidence ${d.averageConfidence} of 5`
          })
          .join("")}
        .
      </p>
    </section>
  )
}
