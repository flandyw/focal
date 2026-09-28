import { useMemo } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"
import type { Mistake } from "@/lib/exam-data"
import { buildRevisionPriorities } from "@/lib/mistake-review"

const chartConfig = {
  unresolved: { label: "Unresolved", color: "#dc2626" },
  resolved: { label: "Resolved", color: "#16a34a" },
}

export function RevisionPriorityChart({ mistakes }: { mistakes: Mistake[] }) {
  const priorities = useMemo(() => buildRevisionPriorities(mistakes), [mistakes])
  const unresolved = priorities.reduce((total, item) => total + item.unresolved, 0)
  const top = priorities.find((item) => item.unresolved > 0)
  const summary = top
    ? `${top.category} is your top revision priority with ${top.unresolved} unresolved ${top.unresolved === 1 ? "mistake" : "mistakes"}.`
    : priorities.length
      ? "All logged mistakes are resolved."
      : "Log mistakes against practice exams to reveal revision priorities."

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Revision priorities</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent>
        {priorities.length ? (
          <>
            <ChartContainer
              config={chartConfig}
              className="w-full min-w-0 aspect-auto"
              style={{ height: Math.max(220, priorities.length * 44) }}
              role="img"
              aria-label={`${summary} ${unresolved} unresolved mistakes in total.`}
            >
              <BarChart data={priorities} layout="vertical" margin={{ left: 8, right: 12 }} accessibilityLayer>
                <CartesianGrid horizontal={false} />
                <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} />
                <YAxis
                  dataKey="category"
                  type="category"
                  width={104}
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11 }}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="unresolved" stackId="mistakes" fill="var(--color-unresolved)" radius={[4, 0, 0, 4]} isAnimationActive={false} />
                <Bar dataKey="resolved" stackId="mistakes" fill="var(--color-resolved)" radius={[0, 4, 4, 0]} isAnimationActive={false} />
              </BarChart>
            </ChartContainer>
            <p className="mt-3 text-xs text-muted-foreground">
              Dark bars are unresolved; light bars are resolved. Prioritise the categories at the top.
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
