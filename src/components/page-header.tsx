import type { ReactNode } from "react"
import { motion } from "framer-motion"

import { riseItem } from "../lib/progress-motion"

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  // On mobile the top bar already names the page, so only the actions stay visible.
  return (
    <motion.div variants={riseItem} data-slot="page-header" className={`flex flex-col gap-3 border-b border-border pb-4 compact:border-b-0 compact:pb-0 md:flex-row md:items-center md:justify-between md:gap-6 ${children ? "" : "compact:sr-only"}`}>
      <div className="min-w-0 compact:sr-only">
        <h1 className="focal-page-title text-balance">{title}</h1>
        {description ? <p className="mt-1 max-w-[60ch] text-sm text-muted-foreground text-pretty">{description}</p> : null}
      </div>
      {children ? <div data-tour="page-actions" className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:max-sm:flex-1">{children}</div> : null}
    </motion.div>
  )
}
