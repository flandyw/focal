import { differenceInCalendarDays, parseISO } from "date-fns"

export function shiftCalendarPeriod(
  date: Date,
  view: "month" | "week",
  direction: -1 | 1,
): Date {
  return view === "month"
    ? new Date(date.getFullYear(), date.getMonth() + direction, 1)
    : new Date(date.getFullYear(), date.getMonth(), date.getDate() + 7 * direction)
}

export function moveCalendarEventToDate(
  startTime: string,
  endTime: string | undefined,
  targetDate: Date,
): { startTime: string; endTime?: string } {
  const start = parseISO(startTime)
  const dayDelta = differenceInCalendarDays(targetDate, start)
  const movedStart = new Date(start)
  movedStart.setDate(movedStart.getDate() + dayDelta)

  if (!endTime) return { startTime: movedStart.toISOString() }

  const movedEnd = parseISO(endTime)
  movedEnd.setDate(movedEnd.getDate() + dayDelta)
  return {
    startTime: movedStart.toISOString(),
    endTime: movedEnd.toISOString(),
  }
}
