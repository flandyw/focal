import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip } from "@/components/ui/chart"
import type { ExamAttempt, Mistake } from "@/lib/exam-data"
import { buildFocusPriorities, type FocusPriority } from "@/lib/performance-insights"

const chartConfig = {
  priorityScore: { label: "Priority score", color: "#dc2626" },
}

function formatArea(value: string) {
  return value.length > 25 ? `${value.slice(0, 23)}…` : value
}

export function FocusPriorityChart({ attempts, mistakes }: { attempts: ExamAttempt[]; mistakes: Mistake[] }) {
  const priorities = useMemo(() => buildFocusPriorities(attempts, mistakes, { bucketByPaper: true }).slice(0, 7), [attempts, mistakes])
  const top = priorities[0]
  const summary = top
    ? `${top.areaOfStudy}${top.paper ? ` on ${top.paper}` : ""} in ${top.subject} is the highest-leverage focus area, with a priority score of ${top.priorityScore.toFixed(0)}/100.`
    : "Add topic, skill, or Area of Study labels while marking assessment items or mistakes to calculate targeted priorities."

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Where to focus next</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        {priorities.length ? (
          <>
            <ChartContainer
              config={chartConfig}
              className="w-full min-w-0 aspect-auto"
              style={{ height: Math.max(280, priorities.length * 48) }}
              role="img"
              aria-label={`${summary} Higher scores indicate a larger improvement opportunity.`}
            >
              <BarChart data={priorities.map((priority) => ({ ...priority, chartLabel: `${priority.areaOfStudy}${priority.paper ? ` · ${priority.paper}` : ""}` }))} layout="vertical" margin={{ left: 8, right: 14 }} accessibilityLayer>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" domain={[0, 100]} tickLine={false} axisLine={false} />
                <YAxis dataKey="chartLabel" type="category" width={142} tickLine={false} axisLine={false} tickFormatter={formatArea} tick={{ fontSize: 11 }} />
                <ChartTooltip content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as FocusPriority
                  return (
                    <div className="min-w-64 rounded-lg border bg-background p-3 text-xs shadow-md">
                      <p className="font-medium">{row.areaOfStudy}</p>
                      <p className="text-muted-foreground">{row.subject}{row.paper ? ` · ${row.paper}` : ""}</p>
                      <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 tabular-nums">
                        <dt className="text-muted-foreground">Priority score</dt><dd>{row.priorityScore.toFixed(0)}/100</dd>
                        <dt className="text-muted-foreground">Marked mastery</dt><dd>{row.mastery === null ? "Not measured" : `${row.mastery.toFixed(1)}%`}</dd>
                        <dt className="text-muted-foreground">Opportunity marks</dt><dd>{row.missedMarks}/{row.availableMarks}</dd>
                        <dt className="text-muted-foreground">Confidence risk</dt><dd>{row.confidenceRisk.toFixed(0)}%</dd>
                        <dt className="text-muted-foreground">Unresolved mistakes</dt><dd>{row.unresolvedMistakes}</dd>
                        <dt className="text-muted-foreground">Review lapses</dt><dd>{row.lapses}</dd>
                      </dl>
                    </div>
                  )
                }} />
                <Bar dataKey="priorityScore" fill="var(--color-priorityScore)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
            <p className="mt-3 text-xs text-muted-foreground">
              Score = 60% mark gap + 25% confidence risk + 15% unresolved-review risk. Use the ranking to choose topics, then validate progress on another marked paper.
            </p>
          </>
        ) : (
          <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground text-pretty">
            {summary}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
