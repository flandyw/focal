import { useMemo } from "react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { buildExamActivity, type ExamActivityDay, type ExamActivityLevel } from "@/lib/exam-activity"
import type { ExamAttempt } from "@/lib/exam-data"

const LEVEL_CLASSES: Record<ExamActivityLevel, string> = {
  0: "bg-muted",
  1: "bg-primary/20",
  2: "bg-primary/40",
  3: "bg-primary/60",
  4: "bg-primary",
}

function formatActivityDate(value: string) {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-AU", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  })
}

function describeDay(day: ExamActivityDay) {
  if (day.count === 0) return `No exams on ${formatActivityDate(day.date)}`
  return `${day.count} exam${day.count === 1 ? "" : "s"} on ${formatActivityDate(day.date)}`
}

export function ExamActivityChart({ attempts }: { attempts: ExamAttempt[] }) {
  const activity = useMemo(() => buildExamActivity(attempts), [attempts])
  const summary = `${activity.total} exam${activity.total === 1 ? "" : "s"} across ${activity.activeDays} active day${activity.activeDays === 1 ? "" : "s"} in the last year.`

  return (
    <Card className="min-w-0">
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle>Exam activity</CardTitle>
            <CardDescription>{summary}</CardDescription>
          </div>
          <div className="flex gap-5 text-right text-xs text-muted-foreground">
            <div>
              <p className="text-base font-semibold tabular-nums text-foreground">{activity.activeDays}</p>
              <p>active days</p>
            </div>
            <div>
              <p className="text-base font-semibold tabular-nums text-foreground">{activity.longestStreak}</p>
              <p>best streak</p>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto pb-1">
          <div
            className="min-w-max"
            role="img"
            aria-label={`Exam activity calendar. ${summary} Longest streak: ${activity.longestStreak} day${activity.longestStreak === 1 ? "" : "s"}.`}
          >
            <div
              className="mb-2 ml-8 grid gap-1 text-[10px] leading-none text-muted-foreground"
              style={{ gridTemplateColumns: `repeat(${activity.weeks.length}, 0.75rem)` }}
              aria-hidden
            >
              {activity.months.map((month) => (
                <span
                  key={`${month.label}-${month.weekIndex}`}
                  className="whitespace-nowrap"
                  style={{ gridColumnStart: month.weekIndex + 1 }}
                >
                  {month.label}
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <div className="grid w-6 grid-rows-7 gap-1 text-[10px] leading-3 text-muted-foreground" aria-hidden>
                <span />
                <span>Mon</span>
                <span />
                <span>Wed</span>
                <span />
                <span>Fri</span>
                <span />
              </div>
              <div
                className="grid grid-flow-col grid-rows-7 gap-1"
                style={{ gridTemplateColumns: `repeat(${activity.weeks.length}, 0.75rem)` }}
                aria-hidden
              >
                {activity.weeks.flatMap((week) => week.map((day) => (
                  <span
                    key={day.date}
                    className={`size-3 rounded-[3px] ring-1 ring-inset ring-foreground/5 ${day.inRange ? LEVEL_CLASSES[day.level] : "bg-transparent ring-transparent"}`}
                    title={day.inRange ? describeDay(day) : undefined}
                  />
                )))}
              </div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-end gap-1.5 text-xs text-muted-foreground" aria-hidden>
          <span>Less</span>
          {([0, 1, 2, 3, 4] as const).map((level) => (
            <span key={level} className={`size-3 rounded-[3px] ring-1 ring-inset ring-foreground/5 ${LEVEL_CLASSES[level]}`} />
          ))}
          <span>More</span>
        </div>
      </CardContent>
    </Card>
  )
}
