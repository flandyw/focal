import type { ComponentType, ReactNode } from "react"
import { motion } from "framer-motion"

import { riseItem } from "../lib/progress-motion"

export function PageHeader({
  title,
  description,
  icon: Icon,
  children,
}: {
  title: string
  icon?: ComponentType<{ className?: string; strokeWidth?: number }>
  description?: string
  children?: ReactNode
}) {
  // On mobile the top bar already names the page, so only the actions stay visible.
  return (
    <motion.div variants={riseItem} data-slot="page-header" className={`flex flex-col gap-3 border-b border-border pb-4 compact:border-b-0 compact:pb-0 md:flex-row md:items-center md:justify-between md:gap-6 ${children ? "" : "compact:sr-only"}`}>
      <div className="flex min-w-0 items-center gap-3 compact:sr-only">
        {Icon ? <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><Icon className="size-5" strokeWidth={1.75} /></span> : null}
        <div className="min-w-0">
          <h1 className="focal-page-title text-balance">{title}</h1>
          {description ? <p className={`${Icon ? "" : "mt-1 "}max-w-[60ch] text-sm text-muted-foreground text-pretty`}>{description}</p> : null}
        </div>
      </div>
      {children ? <div data-tour="page-actions" className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:max-sm:flex-1">{children}</div> : null}
    </motion.div>
  )
}
