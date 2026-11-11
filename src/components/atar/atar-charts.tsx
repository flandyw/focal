import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card"
import { ChartContainer, ChartTooltip } from "../ui/chart"
import type { AtarHistoryPoint, AtarModel } from "../../lib/atar-model"

const PRIMARY = "var(--primary)"
const INCREMENT = "color-mix(in oklch, var(--primary) 40%, var(--card))"
const shortName = (name: string) => name.length > 16 ? `${name.slice(0, 15)}…` : name
const signed = (value: number) => `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`

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

/** Raw → scaled → weighted contribution for every counted study. */
export function AtarBreakdownCard({ model }: { model: AtarModel }) {
  const counted = model.rows.filter((item) => item.contribution > 0).toSorted((a, b) => (a.role === "Increment" ? 1 : 0) - (b.role === "Increment" ? 1 : 0) || b.contribution - a.contribution)
  const data = counted.map((item) => ({ name: item.study!.studyName, raw: item.rawScore!, scaled: item.scaledScore!, contribution: item.contribution, increment: item.role === "Increment", role: item.role }))
  const primary = data.filter((item) => !item.increment).reduce((total, item) => total + item.contribution, 0)
  const increments = data.filter((item) => item.increment).reduce((total, item) => total + item.contribution, 0)
  const summary = model.estimate ? `Primary four ${primary.toFixed(2)} plus increments ${increments.toFixed(2)} gives aggregate ${model.estimate.aggregate.toFixed(2)}.` : "Score four studies including English to see the breakdown."
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>Contribution breakdown</CardTitle><CardDescription>{summary}</CardDescription></CardHeader>
      <CardContent className="grid min-w-0 gap-4">
        {data.length ? <>
          <ChartContainer config={{ contribution: { label: "Contribution", color: PRIMARY } }} className="w-full min-w-0 aspect-auto" style={{ height: Math.max(160, data.length * 36) }} role="img" aria-label={summary}>
            <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12 }} accessibilityLayer>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" domain={[0, 55]} tickLine={false} axisLine={false} />
              <YAxis dataKey="name" type="category" width={112} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={shortName} />
              <ChartTooltip cursor={false} content={({ active, payload }) => {
                const point = active ? payload?.[0]?.payload as (typeof data)[number] | undefined : undefined
                return point ? <Tip title={point.name} lines={[`Raw ${point.raw} → scaled ${point.scaled.toFixed(2)}`, `${point.increment ? "10% increment" : point.role} · adds ${point.contribution.toFixed(2)}`]} /> : null
              }} />
              <Bar dataKey="contribution" radius={4} isAnimationActive={false}>
                {data.map((item) => <Cell key={item.name} fill={item.increment ? INCREMENT : PRIMARY} />)}
              </Bar>
            </BarChart>
          </ChartContainer>
          <table className="w-full text-sm tabular-nums">
            <caption className="sr-only">Raw, scaled and weighted contribution per counted study</caption>
            <thead className="text-xs text-muted-foreground"><tr><th className="py-1 text-left font-medium">Study</th><th className="text-right font-medium">Raw</th><th className="text-right font-medium">Scaled</th><th className="text-right font-medium">Weight</th><th className="text-right font-medium">Adds</th></tr></thead>
            <tbody className="divide-y">
              {data.map((item) => (
                <tr key={item.name}>
                  <td className="max-w-0 truncate py-1.5 pr-2" title={item.name}>{item.name}</td>
                  <td className="text-right">{item.raw}</td>
                  <td className="text-right">{item.scaled.toFixed(1)}</td>
                  <td className="text-right text-muted-foreground">{item.increment ? "10%" : "100%"}</td>
                  <td className="text-right font-medium">{item.contribution.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </> : <Empty>Nothing counts yet.</Empty>}
      </CardContent>
    </Card>
  )
}

/** Aggregate (and ATAR) change from one more raw mark in each study, with VTAC selection re-run. */
export function AtarSensitivityCard({ model }: { model: AtarModel }) {
  const data = model.rows.flatMap((item) => item.sensitivity && item.study ? [{ name: item.study.studyName, aggregate: item.sensitivity.aggregate, atar: item.sensitivity.atar }] : [])
    .toSorted((a, b) => b.aggregate - a.aggregate)
  const top = data[0]
  const summary = top && top.aggregate > 0
    ? `+1 raw in ${top.name} moves your aggregate most (${signed(top.aggregate)}${top.atar !== null ? `, ATAR ${signed(top.atar)}` : ""}).`
    : "Score four studies including English to see which study moves your ATAR most."
  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>What moves your ATAR most</CardTitle><CardDescription>{summary}</CardDescription></CardHeader>
      <CardContent className="min-w-0">
        {data.length ? <>
          <ChartContainer config={{ aggregate: { label: "Aggregate change", color: PRIMARY } }} className="w-full min-w-0 aspect-auto" style={{ height: Math.max(160, data.length * 36) }} role="img" aria-label={summary}>
            <BarChart data={data} layout="vertical" margin={{ left: 4, right: 12 }} accessibilityLayer>
              <CartesianGrid horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tickFormatter={(value: number) => value.toFixed(1)} />
              <YAxis dataKey="name" type="category" width={112} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} tickFormatter={shortName} />
              <ChartTooltip cursor={false} content={({ active, payload }) => {
                const point = active ? payload?.[0]?.payload as (typeof data)[number] | undefined : undefined
                return point ? <Tip title={`+1 raw in ${point.name}`} lines={[`Aggregate ${signed(point.aggregate)}`, point.atar === null ? "ATAR change outside the table" : `ATAR ${signed(point.atar)}`]} /> : null
              }} />
              <Bar dataKey="aggregate" fill="var(--color-aggregate)" radius={4} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
          <p className="mt-3 text-xs text-muted-foreground">Studies at 50 are left out. A study outside the counted six can move the aggregate once it overtakes one inside it.</p>
        </> : <Empty>No scored studies yet.</Empty>}
      </CardContent>
    </Card>
  )
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
              <YAxis domain={domain} width={40} tickLine={false} axisLine={false} tickFormatter={(value: number) => value.toFixed(0)} />
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
