import type { ReactNode } from "react"

export function PageHeader({
  title,
  description,
  children,
}: {
  title: string
  description: string
  children?: ReactNode
}) {
  return (
    <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-balance xl:text-3xl">{title}</h1>
        <p className="mt-1 max-w-[68ch] text-sm text-muted-foreground text-pretty">{description}</p>
      </div>
      {children ? <div className="flex shrink-0 flex-wrap items-center gap-2 [&>*]:max-sm:flex-1">{children}</div> : null}
    </div>
  )
}
