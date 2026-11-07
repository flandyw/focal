import { useMemo } from "react"
import { ArrowRight, Check, Flame } from "lucide-react"
import { Button } from "./ui/button"
import { Badge } from "./ui/badge"
import { PageHeader } from "./page-header"
import { AIOverview } from "./ai-overview"
import { buildDayPlan, isDayItemDone, type DayPlanSource } from "../lib/day-plan"
import { isCompletedSac } from "../lib/sac"
import { localDate } from "../lib/learning-workspace"
import { formatExamLabel, getExamStart, type Timetable } from "../lib/timetable"
import type { AppView } from "../lib/app-view"
import { cn, count } from "../lib/utils"

const DAY = 86_400_000
const hours = (minutes: number) => minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ""}`
const daysUntil = (date: string, today: string) => Math.round((Date.parse(date) - Date.parse(today)) / DAY)
const greeting = (hour: number) => hour < 5 ? "Late night" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"

/** The personal starting page: a read-only view over the same day plan the calendar uses, with one way into each kind of work. */
export function TodayPage({ now, data, timetable, dueMistakes, onNavigate, onStartFocus, onOpenAttempt }: {
  now: number
  data: DayPlanSource
  timetable: Timetable | null
  dueMistakes: number
  onNavigate: (view: AppView) => void
  onStartFocus: (subject: string | undefined, intent: string, sessionId?: string) => void
  onOpenAttempt: (id: string) => void
}) {
  const today = localDate(new Date(now))
  const plan = useMemo(() => buildDayPlan(today, data, timetable, now), [today, data, timetable, now])
  const live = plan.items.find((item) => item.kind === "session" && item.live)
    ?? plan.items.find((item) => item.kind === "session" && item.continuable)
  const items = plan.items.filter((item) => item.kind !== "mistakes")
  const done = items.filter(isDayItemDone).length

  // Past days only change when the data does, so they skip the per-tick `now`.
  const { week, streak } = useMemo(() => {
    const history = new Map<number, { date: Date; minutes: number }>()
    const minutesOn = (offset: number) => {
      const cached = history.get(offset)
      if (cached) return cached
      const date = new Date(`${today}T12:00:00`)
      date.setDate(date.getDate() - offset)
      const result = { date, minutes: buildDayPlan(localDate(date), data, timetable).completedMinutes }
      history.set(offset, result)
      return result
    }
    const week = Array.from({ length: 7 }, (_, index) => minutesOn(6 - index))
    // shortcut: streak stops counting at 60 days, raise the cap if anyone notices.
    let streak = 0
    for (let offset = 1; offset <= 60 && minutesOn(offset).minutes > 0; offset++) streak++
    return { week, streak }
  }, [today, data, timetable])
  const todayMinutes = plan.completedMinutes
  const days = week.map((day, index) => index === 6 ? { ...day, minutes: todayMinutes } : day)
  const weekMinutes = days.reduce((sum, day) => sum + day.minutes, 0)
  const peak = Math.max(30, ...days.map((day) => day.minutes))
  const totalStreak = streak + (todayMinutes > 0 ? 1 : 0)

  const tracked = new Set(data.trackedExamIds)
  const upcoming = [
    ...data.sacRecords.filter((sac) => !isCompletedSac(sac)).map((sac) => ({ id: sac.id, date: localDate(new Date(sac.scheduledAt)), label: `${sac.subject} · ${sac.title}`, kind: "SAC" })),
    ...(timetable?.exams ?? []).filter((exam) => tracked.has(exam.id)).map((exam) => ({ id: exam.id, date: localDate(getExamStart(exam)), label: formatExamLabel(exam), kind: "Exam" })),
  ].filter((item) => item.date > today).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5)
  const next = upcoming[0]

  // Latest papers with the change from the previous paper in the same subject.
  const papers = useMemo(() => {
    const sorted = data.attempts.filter((attempt) => attempt.rawMax > 0).sort((a, b) => b.completedAt.localeCompare(a.completedAt))
    const percent = (attempt: (typeof sorted)[number]) => Math.round((attempt.rawScore / attempt.rawMax) * 100)
    return sorted.slice(0, 4).map((attempt, index) => {
      const previous = sorted.slice(index + 1).find((other) => other.subject === attempt.subject)
      return { attempt, score: percent(attempt), delta: previous ? percent(attempt) - percent(previous) : null }
    })
  }, [data.attempts])

  const stats = [
    { label: "Studied today", value: hours(todayMinutes), note: plan.plannedMinutes ? `${hours(plan.plannedMinutes)} still planned` : "Nothing else planned" },
    { label: "This week", value: hours(weekMinutes), note: `${days.filter((day) => day.minutes > 0).length} of 7 days active` },
    { label: "Streak", value: count(totalStreak, "day"), note: totalStreak ? (todayMinutes ? "Kept alive today" : "Study today to keep it") : "Start one today", flame: totalStreak > 0 },
    { label: "Next up", value: next ? `${daysUntil(next.date, today)}d` : "—", note: next ? next.label : "No exams or SACs tracked" },
  ]

  const row = "flex items-center justify-between gap-3 border-b border-border py-3 text-sm last:border-b-0"
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={greeting(new Date(now).getHours())} description={new Date(now).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}>
        <Button onClick={() => live ? onStartFocus(undefined, live.title, live.id) : onStartFocus(undefined, "")}>{live ? `Resume ${live.title}` : "Start studying"}</Button>
      </PageHeader>

      <section aria-label="Study stats" className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-border bg-border lg:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="flex min-w-0 flex-col gap-1 bg-background p-4">
            <span className="text-xs text-muted-foreground">{stat.label}</span>
            <span className="flex items-center gap-1.5 text-2xl font-semibold tabular-nums">
              {stat.flame ? <Flame aria-hidden className="size-5 text-primary" /> : null}{stat.value}
            </span>
            <span className="truncate text-xs text-muted-foreground" title={stat.note}>{stat.note}</span>
          </div>
        ))}
      </section>

      <AIOverview area="today" fingerprint={`${dueMistakes}:${items.length}:${done}:${next?.id ?? ""}`} />

      <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <div className="flex flex-col gap-8">
        <section aria-labelledby="today-plan">
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 id="today-plan" className="font-medium">Plan{items.length ? <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">{done}/{items.length} done</span> : null}</h2>
            <Button variant="ghost" size="sm" onClick={() => onNavigate("calendar")}>Open calendar</Button>
          </div>
          {items.length ? (
            <>
              <div className="mb-2 h-1 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label="Plan progress" aria-valuemin={0} aria-valuemax={items.length} aria-valuenow={done}>
                <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${(done / items.length) * 100}%` }} />
              </div>
              <ul>{items.map((item) => {
                const finished = isDayItemDone(item)
                return (
                  <li key={`${item.kind}:${item.id}`} className={row}>
                    <span className={cn("flex min-w-0 items-center gap-2", finished && "text-muted-foreground line-through")}>
                      <span className={cn("grid size-4 shrink-0 place-items-center rounded-full border", finished ? "border-primary bg-primary text-primary-foreground" : "border-border")}>{finished ? <Check aria-hidden className="size-3" /> : null}</span>
                      {"startTime" in item && item.startTime ? <span className="tabular-nums text-muted-foreground">{item.startTime}</span> : null}
                      <span className="truncate">{item.title}</span>
                    </span>
                    <span className="shrink-0 text-muted-foreground tabular-nums">{item.minutes ? hours(item.minutes) : ""}</span>
                  </li>
                )
              })}</ul>
            </>
          ) : (
            <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              Nothing planned yet.
              <div className="mt-3 flex justify-center gap-2">
                <Button variant="outline" size="sm" onClick={() => onNavigate("calendar")}>Plan the day</Button>
                <Button variant="ghost" size="sm" onClick={() => onStartFocus(undefined, "")}>Just start</Button>
              </div>
            </div>
          )}
        </section>

        {papers.length ? (
          <section aria-labelledby="today-papers">
            <div className="mb-2 flex items-center justify-between gap-3">
              <h2 id="today-papers" className="font-medium">Recent papers</h2>
              <Button variant="ghost" size="sm" onClick={() => onNavigate("exams")}>All papers</Button>
            </div>
            <ul>{papers.map(({ attempt, score, delta }) => (
              <li key={attempt.id} className="border-b border-border last:border-b-0">
                <button type="button" className="flex w-full items-center gap-3 py-3 text-left text-sm outline-none hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpenAttempt(attempt.id)}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{attempt.title || `${attempt.provider} ${attempt.examYear} ${attempt.paper}`}</span>
                    <span className="block truncate text-xs text-muted-foreground">{attempt.subject} · {new Date(attempt.completedAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  </span>
                  <span className="hidden h-1 w-20 overflow-hidden rounded-full bg-muted sm:block" aria-hidden><span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, score)}%` }} /></span>
                  <span className="w-10 shrink-0 text-right font-medium tabular-nums">{score}%</span>
                  <span className={cn("w-10 shrink-0 text-right text-xs tabular-nums", delta == null ? "text-muted-foreground" : delta > 0 ? "text-success" : delta < 0 ? "text-destructive" : "text-muted-foreground")}>
                    {delta == null ? "new" : delta > 0 ? `▲${delta}` : delta < 0 ? `▼${-delta}` : "±0"}
                  </span>
                </button>
              </li>
            ))}</ul>
          </section>
        ) : null}
        </div>

        <div className="flex flex-col gap-8">
          <section aria-labelledby="today-reviews" className="flex items-center justify-between gap-3 rounded-md border border-border p-4">
            <div>
              <h2 id="today-reviews" className="font-medium">Reviews due</h2>
              <p className="text-sm text-muted-foreground">{dueMistakes ? `${count(dueMistakes, "mistake")} ready to review` : "Nothing due. Nice work."}</p>
            </div>
            {dueMistakes ? <Button variant="outline" onClick={() => onNavigate("mistakes")}>Review <ArrowRight aria-hidden /></Button> : <Check aria-hidden className="size-5 text-primary" />}
          </section>

          <section aria-labelledby="today-week">
            <div className="mb-3 flex items-center justify-between">
              <h2 id="today-week" className="font-medium">Last 7 days</h2>
              <Button variant="ghost" size="sm" onClick={() => onNavigate("progress")}>Progress</Button>
            </div>
            <ol className="flex h-28 items-end gap-2">
              {days.map((day, index) => (
                <li key={index} className="flex h-full flex-1 flex-col items-center justify-end gap-1.5" title={`${day.date.toLocaleDateString(undefined, { weekday: "long" })}: ${hours(day.minutes)}`}>
                  <span className="sr-only">{day.date.toLocaleDateString(undefined, { weekday: "long" })}: {hours(day.minutes)}</span>
                  {day.minutes ? <span aria-hidden className="text-[10px] tabular-nums text-muted-foreground">{hours(day.minutes)}</span> : null}
                  <div className={cn("w-full rounded-sm transition-[height] duration-500", index === 6 ? "bg-primary" : day.minutes ? "bg-primary/40" : "bg-muted")} style={{ height: `${Math.max(4, (day.minutes / peak) * 80)}%` }} />
                  <span aria-hidden className={cn("text-[11px] text-muted-foreground", index === 6 && "font-medium text-foreground")}>{day.date.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="today-upcoming">
            <h2 id="today-upcoming" className="mb-2 font-medium">Coming up</h2>
            {upcoming.length ? <ul>{upcoming.map((item) => {
              const away = daysUntil(item.date, today)
              return (
                <li key={`${item.kind}:${item.id}`} className={row}>
                  <span className="flex min-w-0 items-center gap-2">
                    <Badge variant={item.kind === "Exam" ? "default" : "secondary"}>{item.kind}</Badge>
                    <span className="truncate">{item.label}</span>
                  </span>
                  <Badge variant={away <= 3 ? "warning" : "outline"} className="shrink-0 tabular-nums">{away === 1 ? "Tomorrow" : `${away} days`}</Badge>
                </li>
              )
            })}</ul> : <p className="text-sm text-muted-foreground">No SACs or exams coming up.</p>}
          </section>
        </div>
      </div>
    </div>
  )
}
