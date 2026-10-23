import type { ReactNode } from "react"

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-5 border-b border-border pb-6 md:flex-row md:items-end md:justify-between md:gap-6">
      <div className="min-w-0">
        <h1 className="focal-page-title text-balance">{title}</h1>
        {description ? <p className="mt-3 max-w-[60ch] text-sm leading-relaxed text-muted-foreground text-pretty">{description}</p> : null}
      </div>
      {children ? <div data-tour="page-actions" className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:max-sm:flex-1">{children}</div> : null}
    </div>
  )
}
