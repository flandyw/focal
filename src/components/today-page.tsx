import { useMemo } from "react"
import { ArrowRight } from "lucide-react"
import { Button } from "./ui/button"
import { PageHeader } from "./page-header"
import { buildDayPlan, isDayItemDone, type DayPlanSource } from "../lib/day-plan"
import { localDate } from "../lib/learning-workspace"
import type { Timetable } from "../lib/timetable"
import type { AppView } from "../lib/app-view"
import { count } from "../lib/utils"

/** The personal starting page: a read-only view over the same day plan the calendar uses, with one way into each kind of work. */
export function TodayPage({ now, data, timetable, dueMistakes, onNavigate, onStartFocus }: {
  now: number
  data: DayPlanSource
  timetable: Timetable | null
  dueMistakes: number
  onNavigate: (view: AppView) => void
  onStartFocus: (subject: string | undefined, intent: string, sessionId?: string) => void
}) {
  const today = localDate(new Date(now))
  const plan = useMemo(() => buildDayPlan(today, data, timetable, now), [today, data, timetable, now])
  const live = plan.items.find((item) => item.kind === "session" && (item.live || item.continuable))
  const open = plan.items.filter((item) => item.kind !== "mistakes" && !isDayItemDone(item))
  const upcoming = data.sacRecords
    .filter((sac) => sac.scheduledAt.slice(0, 10) > today)
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt))
    .slice(0, 3)

  const row = "flex items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-b-0"
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Today" description={new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}>
        <Button onClick={() => live ? onStartFocus(undefined, live.title, live.id) : onStartFocus(undefined, "")}>{live ? `Resume ${live.title}` : "Start studying"}</Button>
      </PageHeader>

      <section aria-labelledby="today-reviews" className="flex items-center justify-between gap-3 rounded-md border border-border p-4">
        <div>
          <h2 id="today-reviews" className="font-medium">Reviews due</h2>
          <p className="text-sm text-muted-foreground">{dueMistakes ? `${count(dueMistakes, "mistake")} ready to review` : "Nothing due. Nice work."}</p>
        </div>
        {dueMistakes ? <Button variant="outline" onClick={() => onNavigate("mistakes")}>Review <ArrowRight aria-hidden /></Button> : null}
      </section>

      <section aria-labelledby="today-plan">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="today-plan" className="font-medium">Plan</h2>
          <Button variant="ghost" size="sm" onClick={() => onNavigate("calendar")}>Open calendar</Button>
        </div>
        {open.length ? <ul>{open.map((item) => (
          <li key={`${item.kind}:${item.id}`} className={row}>
            <span className="min-w-0 truncate">{"startTime" in item ? <span className="mr-2 tabular-nums text-muted-foreground">{item.startTime}</span> : null}{item.title}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{item.minutes ? `${item.minutes}m` : ""}</span>
          </li>
        ))}</ul> : <p className="text-sm text-muted-foreground">Nothing left on today’s plan.</p>}
      </section>

      <section aria-labelledby="today-upcoming">
        <h2 id="today-upcoming" className="mb-2 font-medium">Upcoming assessments</h2>
        {upcoming.length ? <ul>{upcoming.map((sac) => (
          <li key={sac.id} className={row}>
            <span className="min-w-0 truncate">{sac.subject} · {sac.title}</span>
            <span className="shrink-0 text-muted-foreground tabular-nums">{new Date(sac.scheduledAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
          </li>
        ))}</ul> : <p className="text-sm text-muted-foreground">No SACs scheduled.</p>}
      </section>
    </div>
  )
}
