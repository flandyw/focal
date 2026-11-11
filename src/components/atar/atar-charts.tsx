import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { ChartContainer, ChartTooltip } from "../ui/chart"
import type { AtarHistoryPoint } from "../../lib/atar-model"

const PRIMARY = "var(--primary)"

function Tip({ title, lines }: { title: string; lines: string[] }) {
  return (
    <div className="max-w-64 rounded-lg border bg-popover p-2.5 text-xs text-popover-foreground shadow-md">
      <p className="truncate font-medium">{title}</p>
      {lines.map((line) => <p key={line} className="text-muted-foreground tabular-nums">{line}</p>)}
    </div>
  )
}

function Empty({ children }: { children: string }) {
  return <div className="rounded-md border bg-muted/30 px-4 py-8 text-center text-sm text-muted-foreground text-pretty">{children}</div>
}

const formatDay = (value: number) => new Date(value).toLocaleDateString("en-AU", { day: "numeric", month: "short" })

/** Saved scenarios and practice-driven re-estimates over time. */
export function AtarTrendCard({ history, target }: { history: AtarHistoryPoint[]; target: number | null }) {
  const data = history.filter((point) => point.atar !== null).map((point) => ({ ...point, [point.kind]: point.atar }))
  const first = data[0], last = data.at(-1)
  const summary = !last ? "Save a scenario or log practice for a Focal-estimated study to build a trend."
    : data.length === 1 ? `One point so far: ${last.label}.`
    : `${data.length} points; estimate ${last.atar! >= first!.atar! ? "up" : "down"} ${Math.abs(last.atar! - first!.atar!).toFixed(2)} from ${first!.label} to ${last.label}.`
  const values = data.map((point) => point.atar!).concat(target ?? [])
  const domain = values.length ? [Math.max(30, Math.floor(Math.min(...values) - 1)), Math.min(100, Math.ceil(Math.max(...values) + 1))] : [30, 100]
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>Estimate over time</CardTitle><CardDescription>{summary}</CardDescription></CardHeader>
      <CardContent className="min-w-0">
        {data.length ? <>
          <ChartContainer config={{ practice: { label: "After practice", color: PRIMARY }, saved: { label: "Saved scenario", color: "var(--muted-foreground)" } }} className="h-64 w-full min-w-0 aspect-auto" role="img" aria-label={summary}>
            <LineChart data={data} margin={{ left: 4, right: 12, top: 12, bottom: 4 }} accessibilityLayer>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="timestamp" type="number" scale="time" domain={["dataMin - 43200000", "dataMax + 43200000"]} tickLine={false} axisLine={false} minTickGap={32} tickFormatter={formatDay} />
              <YAxis domain={domain} allowDecimals={false} width={40} tickLine={false} axisLine={false} />
              {target !== null ? <ReferenceLine y={target} stroke="var(--border)" strokeDasharray="4 4" label={{ value: `Target ${target.toFixed(2)}`, position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }} /> : null}
              <ChartTooltip content={({ active, payload }) => {
                const point = active ? payload?.[0]?.payload as (typeof data)[number] | undefined : undefined
                return point ? <Tip title={`ATAR ${point.label}`} lines={[`${new Date(point.timestamp).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" })} · ${point.kind === "saved" ? "saved scenario" : "after practice"}`, `Aggregate ${point.aggregate.toFixed(2)}`]} /> : null
              }} />
              <Line dataKey="practice" stroke="var(--color-practice)" strokeWidth={2} connectNulls dot={{ r: 3, fill: "var(--color-practice)" }} isAnimationActive={false} />
              <Line dataKey="saved" stroke="none" dot={{ r: 4, fill: "var(--card)", stroke: "var(--color-saved)", strokeWidth: 2 }} activeDot={{ r: 5 }} isAnimationActive={false} />
            </LineChart>
          </ChartContainer>
          <p className="mt-3 text-xs text-muted-foreground">Line: your current studies re-estimated after each practice result. Rings: scenarios as saved.</p>
        </> : <Empty>No history yet.</Empty>}
      </CardContent>
    </Card>
  )
}
