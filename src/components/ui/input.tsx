import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-lg border border-input bg-card px-3 py-1.5 text-base shadow-xs outline-none transition-[color,background-color,border-color,box-shadow] placeholder:text-muted-foreground hover:border-ring/45 focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 read-only:cursor-default read-only:bg-muted/35 read-only:hover:border-input disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted/60 disabled:opacity-60 aria-busy:cursor-wait aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
