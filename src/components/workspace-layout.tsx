import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react"
import { motion } from "framer-motion"
import type { GroupImperativeHandle } from "react-resizable-panels"
import { savePaneSize, useAppearance } from "../lib/appearance"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "./ui/resizable"

import { riseItem } from "../lib/progress-motion"
import { cn } from "../lib/utils"

export function WorkspacePage({ children, className }: { children: ReactNode; className?: string }) {
  // Fluid by design: the page never caps at a measure. Extra width is spent on
  // more columns (see the 2xl grids in the pages), never on longer lines.
  return <div className={cn("grid w-full min-w-0 grid-cols-1 gap-6 lg:gap-8", className)}>{children}</div>
}

/** Stat tiles sit on one grid everywhere: 2 columns on phones, then as many as fit. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-3 md:grid-cols-4", className)}>{children}</div>
}

const TONES = { default: "text-primary bg-primary/10", success: "text-success bg-success/10", warning: "text-warning bg-warning/10", danger: "text-destructive bg-destructive/10" } as const

/** Inline trend line; decorative, so the tile's text carries the meaning. */
export function Sparkline({ values, className }: { values: number[]; className?: string }) {
  if (values.length < 2) return null
  const min = Math.min(...values), span = Math.max(...values) - min || 1
  const points = values.map((value, index) => `${(index / (values.length - 1)) * 100},${27 - ((value - min) / span) * 24}`).join(" ")
  return (
    <svg aria-hidden viewBox="0 0 100 30" preserveAspectRatio="none" className={cn("h-8 w-full text-primary", className)}>
      <polygon points={`0,30 ${points} 100,30`} fill="currentColor" opacity="0.08" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" pathLength={1} className="focal-draw" />
    </svg>
  )
}

/** Change against the previous period: an arrow and sign as well as colour. */
export function Delta({ value, suffix = "", invert }: { value: number | null | undefined; suffix?: string; invert?: boolean }) {
  if (value == null || !Number.isFinite(value)) return null
  const good = invert ? value < 0 : value > 0
  return (
    <span className={cn("inline-flex items-center gap-0.5 rounded-sm px-1 py-0.5 text-xs font-medium tabular-nums", value === 0 ? "bg-muted text-muted-foreground" : good ? "bg-success/10 text-success" : "bg-destructive/10 text-destructive")}>
      <span aria-hidden>{value === 0 ? "–" : value > 0 ? "▲" : "▼"}</span><span className="sr-only">{value === 0 ? "no change " : value > 0 ? "up " : "down "}</span>{Math.abs(value).toFixed(Number.isInteger(value) ? 0 : 1)}{suffix}
    </span>
  )
}

export function StatTile({ icon: Icon, label, value, hint, delta, spark, tone = "default", onClick, className }: {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  value: ReactNode
  hint?: ReactNode
  delta?: ReactNode
  spark?: number[]
  tone?: keyof typeof TONES
  onClick?: () => void
  className?: string
}) {
  const Tag = onClick ? motion.button : motion.div
  return (
    <Tag variants={riseItem} type={onClick ? "button" : undefined} onClick={onClick} className={cn("focal-tile group/tile flex min-w-0 flex-col gap-2 rounded-lg border border-border bg-card p-4 text-left", onClick && "focal-tile-action", className)}>
      <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
        {Icon ? <span className={cn("flex size-6 shrink-0 items-center justify-center rounded-md", TONES[tone])}><Icon aria-hidden className="size-3.5" strokeWidth={2} /></span> : null}
        <span className="truncate">{label}</span>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="focal-stat-value">{value}</span>
        {delta}
      </div>
      {hint ? <div className="truncate text-xs text-muted-foreground">{hint}</div> : null}
      {spark && spark.length > 1 ? <Sparkline values={spark} className={cn("mt-auto", tone === "success" && "text-success", tone === "warning" && "text-warning", tone === "danger" && "text-destructive")} /> : null}
    </Tag>
  )
}

/** The one section container: a titled card with a fixed header row and fixed padding. */
export function Panel({ icon: Icon, title, description, action, children, className, flush, id }: {
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  children: ReactNode
  className?: string
  /** Content runs edge to edge (tables, lists with their own row padding). */
  flush?: boolean
  id?: string
}) {
  return (
    <motion.section variants={riseItem} aria-labelledby={id} className={cn("flex min-w-0 flex-col rounded-lg border border-border bg-card", className)}>
      <header className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          {Icon ? <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" strokeWidth={1.75} /> : null}
          <h2 id={id} className="truncate text-sm font-semibold">{title}</h2>
          {description ? <span className="hidden truncate text-xs text-muted-foreground sm:inline">{description}</span> : null}
        </div>
        {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
      </header>
      <div className={cn("min-w-0 flex-1", flush ? "" : "p-4 sm:p-5")}>{children}</div>
    </motion.section>
  )
}

/** Horizontal bar that grows in; pair it with a visible number. */
export function Meter({ value, max = 100, className, barClassName }: { value: number; max?: number; className?: string; barClassName?: string }) {
  return (
    <span aria-hidden className={cn("block h-1.5 overflow-hidden rounded-full bg-muted", className)}>
      <span className={cn("focal-grow block h-full rounded-full bg-primary", barClassName)} style={{ width: `${Math.max(0, Math.min(100, max ? (value / max) * 100 : 0))}%` }} />
    </span>
  )
}

/** Progress ring with its value in the middle. */
export function Ring({ value, size = 88, children, className, tone = "var(--primary)" }: { value: number; size?: number; children?: ReactNode; className?: string; tone?: string }) {
  const clamped = Math.max(0, Math.min(1, value))
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center", className)} style={{ width: size, height: size }}>
      <svg aria-hidden viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
        <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--muted)" strokeWidth="3" />
        {clamped > 0 ? <circle cx="18" cy="18" r="15.5" fill="none" stroke={tone} strokeWidth="3" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset={1 - clamped} className="focal-ring" /> : null}
      </svg>
      <span className="relative text-center leading-tight">{children}</span>
    </span>
  )
}

export function EmptyState({ icon: Icon, title, description, action, className }: {
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  title: string
  description?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col items-center gap-2 px-4 py-8 text-center", className)}>
      <span className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"><Icon aria-hidden className="size-5" strokeWidth={1.75} /></span>
      <p className="text-sm font-semibold">{title}</p>
      {description ? <p className="max-w-[44ch] text-sm text-muted-foreground">{description}</p> : null}
      {action ? <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div> : null}
    </div>
  )
}

export function SectionHeading({ id, title, description, action, className }: {
  id?: string
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between", className)}>
      <div className="min-w-0 space-y-1">
        <h2 id={id} className="focal-section-title">{title}</h2>
        <p className="max-w-[68ch] text-sm text-muted-foreground text-pretty">{description}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function WorkspaceSplit({ id, primary, secondary }: { id: "calendar" | "mistakes"; primary: ReactNode; secondary: ReactNode }) {
  const appearance = useAppearance()
  const field = id === "calendar" ? "calendarPane" : "mistakePane"
  const percent = appearance[field]
  const container = useRef<HTMLDivElement>(null)
  const group = useRef<GroupImperativeHandle>(null)
  const [wide, setWide] = useState(false)

  useEffect(() => {
    const element = container.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => setWide(entry.contentRect.width >= 44 * parseFloat(getComputedStyle(document.documentElement).fontSize)))
    observer.observe(element)
    return () => observer.disconnect()
  }, [appearance.fontSize])

  useEffect(() => {
    if (wide) group.current?.setLayout({ primary: percent, secondary: 100 - percent })
  }, [percent, wide])

  // Panes remount when `wide` flips, after the page's entry animation has run; starting the subtree at "animate" keeps their cards from staying invisible.
  return <motion.div ref={container} initial="animate" className="workspace-split min-w-0" data-split={wide}>
    {wide && secondary ? <ResizablePanelGroup groupRef={group} orientation="horizontal" className="h-auto! items-stretch" style={{ overflow: "visible" }} defaultLayout={{ primary: percent, secondary: 100 - percent }} onLayoutChanged={(layout, meta) => {
      if (meta.isUserInteraction) savePaneSize(field, (meta.requestedLayout ?? layout).primary)
    }}>
      <ResizablePanel id="primary" minSize={id === "calendar" ? "35%" : "25%"} style={{ overflow: "visible" }} className="relative min-w-0"><div className="w-full min-w-0 pr-3">{primary}</div></ResizablePanel>
      <ResizableHandle withHandle aria-label={id === "calendar" ? "Resize calendar and day plan" : "Resize mistake list and details"} className="self-stretch" />
      <ResizablePanel id="secondary" minSize={id === "calendar" ? "25%" : "30%"} style={{ overflow: "visible" }} className="relative min-w-0"><div className="flex w-full min-w-0 flex-col pl-3">{secondary}</div></ResizablePanel>
    </ResizablePanelGroup> : <div className="grid min-w-0 gap-4">{primary}{secondary}</div>}
  </motion.div>
}
