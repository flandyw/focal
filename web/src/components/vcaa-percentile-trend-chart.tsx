import { useEffect, useId, useMemo, useState } from "react"
import { CartesianGrid, Dot, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import { SubjectCombobox } from "@/components/subject-combobox"
import { buildAttemptBenchmarks, type AssessmentReference, type ExamAttempt } from "@/lib/exam-data"
import { firstPreferredSubject, prioritiseSubjects } from "@/lib/subjects"

const chartConfig = {
  percentile: { label: "Estimated percentile", color: "#16a34a" },
}

function formatTick(value: number) {
  return new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" })
}

export function VcaaPercentileTrendChart({
  attempts,
  references,
  preferredSubjects,
}: {
  attempts: ExamAttempt[]
  references: AssessmentReference[]
  preferredSubjects: string[]
}) {
  const filterId = useId()
  const subjects = useMemo(
    () => prioritiseSubjects(attempts.map((attempt) => attempt.subject), preferredSubjects),
    [attempts, preferredSubjects],
  )
  const [subjectFilter, setSubjectFilter] = useState(() => firstPreferredSubject(subjects, preferredSubjects) || "all")
  useEffect(() => {
    if (subjectFilter !== "all" && !subjects.includes(subjectFilter)) setSubjectFilter("all")
  }, [subjectFilter, subjects])
  const points = useMemo(() => buildAttemptBenchmarks(attempts, references)
    .filter((item) => item.percentile !== null && (subjectFilter === "all" || item.attempt.subject === subjectFilter))
    .map((item) => ({
      ...item,
      timestamp: new Date(`${item.attempt.completedAt}T00:00:00`).getTime(),
      dateLabel: new Date(`${item.attempt.completedAt}T00:00:00`).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" }),
    })), [attempts, references, subjectFilter])
  const first = points[0]
  const latest = points.at(-1)
  const change = first?.percentile != null && latest?.percentile != null
    ? latest.percentile - first.percentile
    : null
  const summary = latest?.percentile !== null && latest?.percentile !== undefined
    ? `${points.length} VCAA-linked attempt${points.length === 1 ? "" : "s"}; latest estimate ${latest.percentile.toFixed(0)}th percentile${change !== null && points.length > 1 ? ` (${change >= 0 ? "+" : ""}${change.toFixed(0)} since the first linked attempt)` : ""}.`
    : "No VCAA-linked attempts have enough grade-band data for a percentile estimate."

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <CardTitle>VCAA percentile trajectory</CardTitle>
            <CardDescription>{summary}</CardDescription>
          </div>
          {subjects.length > 1 ? (
            <div className="flex items-center gap-2">
              <label htmlFor={`percentile-subject-${filterId}`} className="text-sm text-muted-foreground">Subject</label>
              <SubjectCombobox subjects={subjects} preferredSubjects={preferredSubjects} value={subjectFilter} onValueChange={setSubjectFilter} includeAll id={`percentile-subject-${filterId}`} className="h-8 w-44" />
            </div>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="min-w-0">
        {points.length ? (
          <>
            <ChartContainer config={chartConfig} className="h-72 w-full min-w-0 aspect-auto" role="img" aria-label={summary}>
              <LineChart data={points} margin={{ left: 4, right: 12, top: 12, bottom: 4 }} accessibilityLayer>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="timestamp" type="number" domain={["dataMin", "dataMax"]} scale="time" tickLine={false} axisLine={false} minTickGap={32} tickFormatter={formatTick} />
                <YAxis domain={[0, 100]} width={42} tickLine={false} axisLine={false} tickFormatter={(value) => `${value}th`} />
                <ReferenceLine y={50} stroke="var(--border)" strokeDasharray="4 4" label={{ value: "50th", position: "insideBottomRight", fontSize: 10, fill: "var(--muted-foreground)" }} />
                <ReferenceLine y={90} stroke="var(--border)" strokeDasharray="4 4" label={{ value: "Top 10%", position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} />
                <ChartTooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0].payload as (typeof points)[number]
                  return (
                    <div className="min-w-64 rounded-lg border bg-background p-3 text-xs shadow-md">
                      <p className="font-medium">{point.attempt.title}</p>
                      <p className="text-muted-foreground">{point.attempt.subject} · {point.dateLabel} · VCAA {point.reference.year}</p>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5">
                        <Badge variant="secondary">{point.grade ?? "—"}</Badge>
                        <span className="font-medium tabular-nums">{point.percentile?.toFixed(0)}th percentile</span>
                      </div>
                      <p className="mt-1 text-muted-foreground tabular-nums">
                        Mark {point.percentage.toFixed(1)}% · {point.gapToAPlus === null ? "A+ cutoff unavailable" : `${Math.abs(point.gapToAPlus).toFixed(1)} points ${point.gapToAPlus >= 0 ? "above" : "below"} A+`}
                      </p>
                    </div>
                  )
                }} />
                <Line type="monotone" dataKey="percentile" stroke="var(--color-percentile)" strokeWidth={2.5} connectNulls isAnimationActive={false} dot={(props) => {
                  const { cx, cy } = props as { cx: number; cy: number }
                  return <Dot cx={cx} cy={cy} r={3.5} fill="var(--color-percentile)" stroke="var(--background)" strokeWidth={1.5} />
                }} activeDot={{ r: 5 }} />
              </LineChart>
            </ChartContainer>
            <p className="mt-3 text-xs text-muted-foreground">Percentiles are estimates within VCAA grouped grade bands, not published individual ranks.</p>
          </>
        ) : (
          <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground">
            Link an attempt to a VCAA distribution to chart estimated percentile progress.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
