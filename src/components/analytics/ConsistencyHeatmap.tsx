import { useEffect, useMemo, useRef, useState, useCallback } from "react"
import type { KeyboardEvent, MouseEvent } from "react"
import { createPortal } from "react-dom"
import { motion, AnimatePresence, useMotionValue, useReducedMotion } from "framer-motion"
import { format } from "date-fns"
import { getHeatColor } from "../../lib/progress-chart-theme"
import { cn } from "../../lib/progress-utils"
import { REDUCED_TRANSITION, MOTION_DURATION, MOTION_EASE_SNAPPY } from "../../lib/progress-motion"
import type { ConsistencyDay, ConsistencyStats } from "../../lib/progress-analytics"

interface ConsistencyHeatmapProps {
  days: ConsistencyDay[]
  stats: ConsistencyStats
}

const dayLabels = ["Mon", "", "Wed", "", "Fri", "", "Sun"]

function formatMinutes(minutes: number) {
  if (minutes === 0) return "No study"
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

function formatStreak(days: number) {
  if (days === 0) return "0d"
  if (days === 1) return "1d"
  return `${days}d`
}

function formatTotalMinutes(m: number) {
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

export function ConsistencyHeatmap({ days, stats }: ConsistencyHeatmapProps) {
  const reduceMotion = useReducedMotion() === true
  const [tooltipDay, setTooltipDay] = useState<ConsistencyDay | null>(null)
  const [focusOverride, setFocusOverride] = useState<{ weekIdx: number; dayIdx: number } | null>(null)
  const cellRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const tooltipX = useMotionValue(0)
  const tooltipY = useMotionValue(0)

  const weeks = useMemo(() => {
    const result: (ConsistencyDay | null)[][] = []
    if (days.length === 0) return result

    const first = new Date(days[0].date + "T00:00:00")
    const firstDow = (first.getDay() + 6) % 7
    let currentWeek: (ConsistencyDay | null)[] = Array.from(
      { length: firstDow },
      () => null,
    )

    days.forEach((day) => {
      if (currentWeek.length === 7) {
        result.push(currentWeek)
        currentWeek = []
      }
      currentWeek.push(day)
    })
    if (currentWeek.length > 0) {
      while (currentWeek.length < 7) currentWeek.push(null)
      result.push(currentWeek)
    }
    return result
  }, [days])

  const monthLabels = useMemo(() => {
    if (weeks.length === 0) return new Map<number, string>()
    const labels = new Map<number, string>()
    let lastMonth: number | null = null
    weeks.forEach((week, wi) => {
      const firstDay = week.find((d) => d !== null)
      if (!firstDay) return
      const d = new Date(firstDay.date + "T00:00:00")
      const month = d.getMonth()
      if (month !== lastMonth) {
        labels.set(wi, format(d, "MMM"))
        lastMonth = month
      }
    })
    return labels
  }, [weeks])

  // Derive the focus position: user-set focus wins, otherwise fall back to the
  // last non-null cell. When `weeks` changes, any stale user focus is ignored
  // and we re-anchor on the new last cell — no setState-in-effect needed.
  const focus = (() => {
    if (focusOverride && weeks[focusOverride.weekIdx]?.[focusOverride.dayIdx]) {
      return focusOverride
    }
    for (let w = weeks.length - 1; w >= 0; w--) {
      for (let d = 6; d >= 0; d--) {
        if (weeks[w][d]) return { weekIdx: w, dayIdx: d }
      }
    }
    return null
  })()

  // When the focus state changes, move actual DOM focus to that cell
  useEffect(() => {
    if (!focus) return
    const el = cellRefs.current.get(`${focus.weekIdx}-${focus.dayIdx}`)
    el?.focus({ preventScroll: true })
  }, [focus])

  const findAdjacent = useCallback(
    (
      from: { weekIdx: number; dayIdx: number },
      dW: number,
      dD: number,
    ): { weekIdx: number; dayIdx: number } | null => {
      const d = from.dayIdx + dD
      const w = from.weekIdx + dW
      if (d < 0 || d > 6) return null
      if (w < 0 || w >= weeks.length) return null
      if (weeks[w][d]) return { weekIdx: w, dayIdx: d }
      return null
    },
    [weeks],
  )

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>, weekIdx: number, dayIdx: number) => {
      let next: { weekIdx: number; dayIdx: number } | null = null
      if (e.key === "ArrowRight") next = findAdjacent({ weekIdx, dayIdx }, 0, 1)
      else if (e.key === "ArrowLeft")
        next = findAdjacent({ weekIdx, dayIdx }, 0, -1)
      else if (e.key === "ArrowDown")
        next = findAdjacent({ weekIdx, dayIdx }, 1, 0)
      else if (e.key === "ArrowUp")
        next = findAdjacent({ weekIdx, dayIdx }, -1, 0)
      else if (e.key === "Home") {
        for (let d = 0; d < 7; d++) {
          if (weeks[weekIdx][d]) {
            next = { weekIdx, dayIdx: d }
            break
          }
        }
      } else if (e.key === "End") {
        for (let d = 6; d >= 0; d--) {
          if (weeks[weekIdx][d]) {
            next = { weekIdx, dayIdx: d }
            break
          }
        }
      }
      if (next) {
        e.preventDefault()
        setFocusOverride(next)
      }
    },
    [findAdjacent, weeks],
  )

  const handleCellEnter = useCallback(
    (e: MouseEvent<HTMLDivElement>, day: ConsistencyDay) => {
      tooltipX.set(e.clientX)
      tooltipY.set(e.clientY)
      setTooltipDay(day)
    },
    [tooltipX, tooltipY],
  )

  const handleCellMove = useCallback(
    (e: MouseEvent<HTMLDivElement>, day: ConsistencyDay) => {
      tooltipX.set(e.clientX)
      tooltipY.set(e.clientY)
      // Avoid re-render when the day hasn't changed
      setTooltipDay((prev) => (prev?.date === day.date ? prev : day))
    },
    [tooltipX, tooltipY],
  )

  const handleCellLeave = useCallback(() => {
    setTooltipDay(null)
  }, [])

  const hasAnyData = stats.totalStudyDays > 0

  return (
    <section className="border-t border-border/70 pt-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Study Consistency</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-micro text-muted-foreground/70">Less</span>
          {[0, 1, 2, 3, 4].map((level) => (
            <div
              key={level}
              className="h-2.5 w-2.5 rounded-xs"
              style={{ backgroundColor: getHeatColor(level as 0 | 1 | 2 | 3 | 4) }}
            />
          ))}
          <span className="text-micro text-muted-foreground/70">More</span>
        </div>
      </div> <div className="min-w-0 overflow-x-auto rounded-xl border border-border/60 bg-background/30 p-3">
 <div className="flex min-w-max gap-3">
          <div className="flex shrink-0 flex-col gap-0.75">
            {/* Spacer to align day labels with cells, below the month-label row */}
            <div className="h-3.5" />
            {dayLabels.map((label, i) => (
              <span
                key={i}
                className="h-3.5 w-8 text-micro leading-3.5 text-muted-foreground/70"
              >
                {label}
              </span>
            ))}
          </div>

          <div className="flex flex-col gap-0.75">
            {/* Month labels row */}
            <div className="flex h-3.5 gap-0.75">
              {weeks.map((_, wi) => (
                <span
                  key={wi}
                  className="w-3.5 text-micro leading-3.5 text-muted-foreground/70"
                >
                  {monthLabels.get(wi) ?? ""}
                </span>
              ))}
            </div>

            <div
              className="flex gap-0.75"
              role="grid"
              aria-label="Study consistency heatmap. Use arrow keys to navigate days."
            >
              {weeks.map((week, wi) => (
                <div key={wi} className="flex flex-col gap-0.75" role="row">
                  {week.map((day, di) => {
                    if (!day) {
                      return <div key={di} aria-hidden className="h-3.5 w-3.5" />
                    }
                    const isFocused =
                      focus?.weekIdx === wi && focus?.dayIdx === di
                    const date = new Date(day.date + "T00:00:00")
                    const ariaLabel = `${format(date, "EEEE, MMMM d")}: ${formatMinutes(day.minutes)}`
                    return (
                      <div
                        key={di}
                        ref={(el) => {
                          if (el) cellRefs.current.set(`${wi}-${di}`, el)
                          else cellRefs.current.delete(`${wi}-${di}`)
                        }}
                        role="gridcell"
                        tabIndex={isFocused ? 0 : -1}
                        aria-label={ariaLabel}
                        onClick={() => setFocusOverride({ weekIdx: wi, dayIdx: di })}
                        onMouseEnter={(e) => handleCellEnter(e, day)}
                        onMouseMove={(e) => handleCellMove(e, day)}
                        onMouseLeave={handleCellLeave}
                        onKeyDown={(e) => handleKeyDown(e, wi, di)}
                        className={cn(
                          "h-3.5 w-3.5 rounded-[3px] cursor-pointer transition-shadow outline-none",
                          isFocused && "ring-1 ring-foreground/80",
                        )}
                        style={{ backgroundColor: getHeatColor(day.level) }}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>
        
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 min-[1100px]:grid-cols-5">
        <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2">
          <div className="text-sm font-semibold tabular-nums">
            {formatStreak(stats.currentStreak)}
          </div>
          <div className="text-micro text-muted-foreground">Current streak</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2">
          <div className="text-sm font-semibold tabular-nums">
            {formatStreak(stats.longestStreak)}
          </div>
          <div className="text-micro text-muted-foreground">Longest streak</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2">
          <div className="text-sm font-semibold tabular-nums">{stats.totalStudyDays}</div>
          <div className="text-micro text-muted-foreground">Study days</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2">
          <div className="text-sm font-semibold tabular-nums">
            {stats.totalMinutes < 60
              ? `${stats.totalMinutes}m`
              : `${Math.floor(stats.totalMinutes / 60)}h`}
          </div>
          <div className="text-micro text-muted-foreground">Total time</div>
        </div>
        <div className="rounded-xl border border-border/60 bg-background/30 px-3 py-2">
          <div className="text-sm font-semibold tabular-nums">
            {stats.averageMinutesPerDay < 60
              ? `${stats.averageMinutesPerDay}m`
              : `${Math.floor(stats.averageMinutesPerDay / 60)}h`}
          </div>
          <div className="text-micro text-muted-foreground">Avg per day</div>
        </div>
      </div>

      {!hasAnyData && (
        <p className="mt-3 text-xs text-muted-foreground text-center">
          Complete study sessions to see your consistency.
        </p>
      )}

      <p className="sr-only">
        Study consistency over {days.length} day{days.length === 1 ? "" : "s"}.
        Current streak {formatStreak(stats.currentStreak)}, longest streak{" "}
        {formatStreak(stats.longestStreak)}, {stats.totalStudyDays} study day
        {stats.totalStudyDays === 1 ? "" : "s"}, {formatTotalMinutes(stats.totalMinutes)}{" "}
        total. Average {stats.averageMinutesPerDay} minutes per day.
      </p>

      {createPortal(
        <AnimatePresence>
          {tooltipDay && (
            <motion.div
              key="heat-tooltip"
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
              transition={
                reduceMotion
                  ? REDUCED_TRANSITION
                  : { duration: MOTION_DURATION.instant, ease: MOTION_EASE_SNAPPY }
              }
              style={{
                position: "fixed",
                left: 0,
                top: 0,
                x: tooltipX,
                y: tooltipY,
                translateX: "-50%",
                translateY: "calc(100% + 8px)",
                pointerEvents: "none",
                zIndex: 9999,
              }}
              className="rounded-lg border border-border/60 bg-popover px-2.5 py-1.5 shadow-md"
            >
              <div className="text-xs font-medium">
                {format(
                  new Date(tooltipDay.date + "T00:00:00"),
                  "EEE, MMM d",
                )}
              </div>
              <div className="text-micro text-muted-foreground">
                {formatMinutes(tooltipDay.minutes)}
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body,
      )}
    </section>
  )
}
