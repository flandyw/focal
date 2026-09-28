import type { ReactNode } from "react"

import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { cn } from "@/lib/utils"

/**
 * The one instrument both timer runs are read through. A focus block and a
 * timed paper are different jobs, but they are read the same way: what phase
 * am I in, how long is left, how far through am I. Keeping that in one place
 * is what stops the two from drifting into different visual languages.
 */
export function TimerReadout({
  mode,
  status,
  display,
  progress,
  overtime = false,
  animationKey,
  marks,
  caption,
  onCaption,
  children,
}: {
  mode: string
  status: string
  display: string
  progress: number
  overtime?: boolean
  animationKey: string
  /** Discrete marks for a multi-step run: a set of focus blocks, or exam phases. */
  marks?: { total: number; filled: number; label: string }
  caption: string
  onCaption?: string
  children?: ReactNode
}) {
  return (
    <div className="grid gap-6">
      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={overtime ? "destructive" : "secondary"}>{mode}</Badge>
            <span className="text-sm text-muted-foreground">{status}</span>
          </div>
          {marks ? (
            <p className="text-sm text-muted-foreground tabular-nums">{marks.label}</p>
          ) : null}
        </div>

        <p
          aria-label={`${mode}, ${display} remaining`}
          className="font-semibold tracking-tight tabular-nums text-6xl sm:text-7xl lg:text-8xl"
          role="timer"
        >
          <span
            className={cn(
              "inline-block motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-1 motion-safe:duration-300",
              overtime && "text-destructive",
            )}
            key={animationKey}
          >
            {display}
          </span>
        </p>

        <Progress aria-label={`${mode} progress`} value={progress} />

        {marks ? (
          <ol aria-label={marks.label} className="flex items-center gap-1.5">
            {Array.from({ length: marks.total }, (_, index) => (
              <li
                className={cn("h-1.5 w-6 rounded-sm", index < marks.filled ? "bg-primary" : "bg-muted")}
                key={index}
              />
            ))}
          </ol>
        ) : null}

        <p className="max-w-[68ch] text-sm text-pretty text-muted-foreground">{caption}</p>
        <p className="sr-only" role="status">{onCaption ?? ""}</p>
      </div>
      {children}
    </div>
  )
}
