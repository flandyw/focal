import type { ReactNode } from "react"

import { Card, CardContent, CardDescription, CardHeader } from "./ui/card"
import { cn } from "../lib/utils"

export function WorkspacePage({ children, className }: { children: ReactNode; className?: string }) {
  // Fluid by design: the page never caps at a measure. Extra width is spent on
  // more columns (see the 2xl grids in the pages), never on longer lines.
  return <div className={cn("grid w-full min-w-0 grid-cols-1 gap-6 lg:gap-8", className)}>{children}</div>
}

export function MetricGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3", className)}>{children}</div>
}

export function MetricCard({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) {
  return (
    <Card size="sm" className="min-w-0 justify-between border-x-0 border-b-0 border-t-2 border-t-primary/40 rounded-none bg-transparent">
      <CardHeader className="gap-1">
        <CardDescription className="text-[10px] font-medium leading-tight uppercase tracking-wide sm:text-xs">{label}</CardDescription>
        <div className="focal-stat-value tabular-nums">{value}</div>
      </CardHeader>
      {children ? <CardContent className="hidden text-sm text-muted-foreground sm:block">{children}</CardContent> : null}
    </Card>
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
