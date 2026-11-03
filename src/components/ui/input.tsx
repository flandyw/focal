import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"

import { cn } from "../../lib/utils"

const FINE_POINTER = typeof matchMedia === "function" && matchMedia("(pointer: fine)").matches

function Input({ className, type, autoFocus, onFocus, inputMode, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      // Phones get the decimal pad for marks, and aren't handed a keyboard covering the form they just opened.
      inputMode={inputMode ?? (type === "number" ? "decimal" : undefined)}
      autoCapitalize={type === "email" || type === "url" ? "none" : undefined}
      spellCheck={type === "search" || type === "email" || type === "url" ? false : undefined}
      // Scrolling the page past a focused mark must not quietly change it.
      onWheel={type === "number" ? (event) => event.currentTarget.blur() : undefined}
      enterKeyHint={type === "search" ? "search" : undefined}
      // Tapping a pre-filled mark should replace it; on a phone, placing the caret to delete a 0 is fiddly.
      onFocus={(event) => { if (type === "number") event.target.select(); onFocus?.(event) }}
      autoFocus={autoFocus && FINE_POINTER}
      className={cn(
        "h-9 w-full min-w-0 rounded-sm border border-input bg-card px-3 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 md:text-sm",
        className
      )}
      {...props}
    />
  )
}

export { Input }
