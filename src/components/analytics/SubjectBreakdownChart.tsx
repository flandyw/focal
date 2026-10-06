import { useMemo } from "react"
import { getSubjectColor } from "../../lib/progress-chart-theme"
import { getSubjectById } from "../../lib/progress-utils"
import type { SubjectMinutes } from "../../lib/progress-analytics"

interface SubjectBreakdownChartProps {
  data: SubjectMinutes[]
}

interface DonutSegment {
  subjectId: string
  segment: number
  offset: number
  color: string
}

export function SubjectBreakdownChart({ data }: SubjectBreakdownChartProps) {
  const totalMinutes = useMemo(() => data.reduce((sum, d) => sum + d.minutes, 0), [data])
  const totalHours = useMemo(() => Math.round(totalMinutes / 60 * 10) / 10, [totalMinutes])

  const donutSegments = useMemo<DonutSegment[]>(() => {
    const radius = 36
    const circumference = 2 * Math.PI * radius
    const { segments } = data.reduce<{ segments: DonutSegment[]; offset: number }>(
      (acc, item) => {
        const segment = (item.minutes / totalMinutes) * circumference
        acc.segments.push({
          subjectId: item.subjectId,
          segment,
          offset: acc.offset,
          color: getSubjectColor(item.subjectId),
        })
        acc.offset += segment
        return acc
      },
      { segments: [], offset: 0 },
    )
    return segments
  }, [data, totalMinutes])

  if (data.length === 0) {
    return (
      <section className="border-t border-border/70 pt-5">
        <h3 className="text-sm font-semibold mb-1">Subject Breakdown</h3>
        <p className="text-xs text-muted-foreground">No study data for this period.</p>
      </section>
    )
  }

  return (
    <section className="border-t border-border/70 pt-5">
      <h3 className="text-sm font-semibold mb-4">Subject Breakdown</h3>

      <div className="flex items-center gap-6">
        <div className="relative flex h-36 w-36 shrink-0 items-center justify-center">
          <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
            {donutSegments.map((seg) => (
              <circle
                key={seg.subjectId}
                cx="50"
                cy="50"
                r={36}
                fill="none"
                stroke={seg.color}
                strokeWidth="14"
                strokeDasharray={`${seg.segment} ${2 * Math.PI * 36 - seg.segment}`}
                strokeDashoffset={`${-seg.offset}`}
                strokeLinecap="round"
              />
            ))}
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-lg font-semibold tabular-nums">{totalHours}h</span>
            <span className="text-micro text-muted-foreground">total</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-2">
          {data.map((item) => {
            const subject = getSubjectById(item.subjectId)
            const color = getSubjectColor(item.subjectId)
            return (
              <div key={item.subjectId} className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="min-w-0 flex-1 truncate text-xs font-medium">
                  {subject?.name ?? "Unassigned"}
                </span>
                <span className="text-caption tabular-nums text-muted-foreground shrink-0">
                  {item.minutes < 60
                    ? `${item.minutes}m`
                    : `${Math.floor(item.minutes / 60)}h ${item.minutes % 60}m`}
                </span>
                <span className="text-micro tabular-nums text-muted-foreground/70 w-8 text-right shrink-0">
                  {item.percentage}%
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <p className="sr-only">
        Subject breakdown: {data.length} subject{data.length === 1 ? "" : "s"},
        total {totalHours} hours. {data
          .map((d, i) => {
            const name = getSubjectById(d.subjectId)?.name ?? "Unassigned"
            const h = Math.floor(d.minutes / 60)
            const m = d.minutes % 60
            const time = h > 0 ? `${h}h ${m}m` : `${m}m`
            return `${i > 0 ? "; " : ""}${name} ${time} (${d.percentage}%)`
          })
          .join("")}
        .
      </p>
    </section>
  )
}
