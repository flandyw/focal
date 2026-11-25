import { useId, useMemo, useState } from "react"
import { Bar, BarChart, CartesianGrid, Cell, XAxis, YAxis } from "recharts"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./ui/chart"
import { NativeSelect, NativeSelectOption } from "./ui/native-select"
import { getMistakeSchedule, localDayDifference, type ExamAttempt, type Mistake } from "../lib/exam-data"
import { MarkdownPreview } from "./markdown-preview"
import { buildReviewForecast } from "../lib/performance-insights"
import { localDate } from "../lib/local-date"
import { useTickingNow } from "../hooks/use-ticking-now"

const chartConfig = {
  scheduled: { label: "Due that day", color: "var(--chart-4)" },
  overdue: { label: "Overdue", color: "var(--chart-1)" },
}

export function ReviewForecastChart({ mistakes, attempts }: { mistakes: Mistake[]; attempts: ExamAttempt[] }) {
  // Recompute only when the local calendar day changes, not on every minute tick.
  const today = localDate(useTickingNow())
  const forecast = useMemo(() => buildReviewForecast(mistakes, new Date(`${today}T00:00:00`)), [mistakes, today])
  const [selection, setSelection] = useState<string | null>(null)
  // A picked day can fall out of the 14-day window after midnight; fall back to the default.
  const selected = selection !== null && (selection === "" || forecast.some((day) => day.date === selection)) ? selection : forecast[0].due ? today : ""
  const listId = useId()
  const selectedDay = forecast.find((day) => day.date === selected)
  const cards = mistakes.filter((mistake) => {
    if (mistake.suspended || !selectedDay) return false
    const difference = localDayDifference(new Date(getMistakeSchedule(mistake).dueAt), new Date(`${selected}T00:00:00`))
    return difference === 0 || (selected === today && difference < 0)
  })
  const cardItem = (mistake: Mistake) => <li key={mistake.id} className="min-w-0 break-words">
    <MarkdownPreview inline>{mistake.question}</MarkdownPreview>
    <p className="text-xs text-muted-foreground">
      {attempts.find((attempt) => attempt.id === mistake.attemptId)?.subject ?? mistake.subject ?? "Uncategorised"}
      {localDayDifference(new Date(getMistakeSchedule(mistake).dueAt), new Date(`${today}T00:00:00`)) < 0 ? " · Overdue" : ""}
    </p>
  </li>
  const total = forecast.reduce((sum, day) => sum + day.due, 0)
  const busiest = forecast.reduce((current, day) => day.due > current.due ? day : current, forecast[0])
  const summary = total
    ? `${total} card${total === 1 ? "" : "s"} due over 14 days${forecast[0].overdue ? ` (${forecast[0].overdue} overdue)` : ""}; the largest load is ${busiest.due} on ${busiest.label.toLowerCase()}.`
    : "No active mistake cards are due in the next 14 days."

  return (
    <Card className="min-w-0">
      <CardHeader>
        <CardTitle>Review workload</CardTitle>
        <CardDescription>{summary}</CardDescription>
      </CardHeader>
      <CardContent className="min-w-0">
        <ChartContainer config={chartConfig} className="h-72 w-full min-w-0 aspect-auto [&_:focus:not(:focus-visible)]:outline-none [&_:focus-visible]:outline-solid [&_:focus-visible]:outline-2 [&_:focus-visible]:outline-offset-2 [&_:focus-visible]:outline-ring" role="img" aria-label={summary}>
          <BarChart data={forecast.map((day) => ({ ...day, scheduled: day.due - day.overdue }))} margin={{ left: 0, right: 8, top: 8, bottom: 4 }} accessibilityLayer onClick={(state) => {
            if (state.activeTooltipIndex == null) return
            const day = forecast[Number(state.activeTooltipIndex)]
            if (day) setSelection(day.date)
          }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={20} tick={{ fontSize: 10 }} />
            <YAxis allowDecimals={false} tickLine={false} axisLine={false} width={30} />
            <ChartTooltip content={<ChartTooltipContent />} />
            <Bar dataKey="scheduled" stackId="due" fill="var(--color-scheduled)" isAnimationActive={false}>
              {forecast.map((day) => <Cell key={day.date} opacity={!selectedDay || day.date === selected ? 1 : 0.35} />)}
            </Bar>
            <Bar dataKey="overdue" stackId="due" fill="var(--color-overdue)" radius={[4, 4, 0, 0]} isAnimationActive={false}>
              {forecast.map((day) => <Cell key={day.date} opacity={!selectedDay || day.date === selected ? 1 : 0.35} />)}
            </Bar>
          </BarChart>
        </ChartContainer>
        <p className="mt-3 text-xs text-muted-foreground">
          Today stacks cards due today with overdue cards. Select a bar or choose a day to see its cards. Use quieter days for a timed paper.
        </p>
        <label className="mt-4 grid gap-2 text-sm font-medium">
          Review day
          <NativeSelect className="w-full" value={selected} onChange={(event) => setSelection(event.target.value)} aria-controls={listId}>
            <NativeSelectOption value="">Choose a day</NativeSelectOption>
            {forecast.map((day) => <NativeSelectOption key={day.date} value={day.date}>{day.label} · {day.due} card{day.due === 1 ? "" : "s"}</NativeSelectOption>)}
          </NativeSelect>
        </label>
        <div id={listId} aria-live="polite" className="mt-3 text-sm">
          {selectedDay ? <>
            <h3 className="font-medium">{selectedDay.label} · {cards.length} card{cards.length === 1 ? "" : "s"}</h3>
            {cards.length ? <ul className="mt-2 grid gap-3">{cards.slice(0, 8).map(cardItem)}</ul> : <p className="mt-2 text-muted-foreground">No cards due this day.</p>}
            {cards.length > 8 ? <details key={selected} className="mt-2">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">+{cards.length - 8} more</summary>
              <ul className="mt-2 grid gap-3">{cards.slice(8).map(cardItem)}</ul>
            </details> : null}
          </> : <p className="text-muted-foreground">Choose a day to see its cards.</p>}
        </div>
      </CardContent>
    </Card>
  )
}
